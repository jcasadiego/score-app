import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SESSION_AUDIENCE } from '../diagnostics/access-links.service';

interface ThrottledRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Apps que llaman desde su servidor y pueden informar la IP de su usuario. */
const TRUSTED_APPS = [
  { header: 'x-panel-secret', secretEnv: 'PANEL_API_SECRET' },
  { header: 'x-diagnostic-secret', secretEnv: 'DIAGNOSTIC_API_SECRET' },
] as const;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * El panel y `apps/diagnostico` llaman a la API desde su servidor: contar solo
 * por IP de conexión juntaría a todos sus usuarios en un contador por ruta. Por
 * eso cuenta, en orden:
 *
 * 1. Por usuario del panel, si el JWT tiene una firma válida. Un token vencido o
 *    revocado también vale aquí: identifica a quien lo emitió, y `JwtAuthGuard`
 *    lo rechaza después. Una firma falsa no puede gastar el contador de otro.
 * 2. Por diagnóstico, si trae una sesión de cliente final con firma válida (con
 *    la misma regla del vencimiento).
 * 3. Por la IP que informa el panel o `apps/diagnostico` en rutas sin sesión
 *    (login, canje y recuperación de enlaces), solo si trae el secreto de esa
 *    app. Sin el secreto, el encabezado no cuenta.
 * 4. Por la IP de la conexión.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();

  protected getTracker(req: ThrottledRequest): Promise<string> {
    const token = this.bearerToken(req);
    const userId = token && this.subject(token, process.env.JWT_SECRET);
    if (userId) return Promise.resolve(`user:${userId}`);

    const diagnosticId =
      token &&
      this.subject(token, process.env.ACCESS_LINK_JWT_SECRET, SESSION_AUDIENCE);
    if (diagnosticId) return Promise.resolve(`diagnostic:${diagnosticId}`);

    return super.getTracker({ ip: this.ipFromTrustedApp(req) ?? req.ip });
  }

  private bearerToken(req: ThrottledRequest): string | null {
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }

  private subject(
    token: string,
    secret: string | undefined,
    audience?: string,
  ): string | null {
    if (!secret) return null;
    try {
      const { sub } = this.jwt.verify<{ sub?: string }>(token, {
        secret,
        algorithms: ['HS256'],
        ignoreExpiration: true,
        ...(audience && { audience }),
      });
      return typeof sub === 'string' ? sub : null;
    } catch {
      return null;
    }
  }

  private ipFromTrustedApp(req: ThrottledRequest): string | null {
    const ip = req.headers['x-client-ip'];
    if (typeof ip !== 'string' || !isIP(ip)) return null;

    const trusted = TRUSTED_APPS.some(({ header, secretEnv }) => {
      const expected = process.env[secretEnv];
      const received = req.headers[header];
      // Con hash, para comparar siempre el mismo largo en tiempo constante.
      return (
        !!expected &&
        typeof received === 'string' &&
        timingSafeEqual(sha256(received), sha256(expected))
      );
    });
    return trusted ? ip : null;
  }
}
