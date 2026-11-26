import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PANEL_SESSION_AUDIENCE } from '../auth/session-audience';
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
 * 1. Por usuario del panel, si trae una sesión vigente con firma y audiencia
 *    válidas. Una firma falsa, un token vencido o de otra audiencia (el desafío
 *    MFA) no cuentan aquí: quien tenga un token viejo de otro no puede gastarle
 *    sus contadores.
 * 2. Por diagnóstico, si trae una sesión de cliente final vigente (misma regla).
 * 3. Por la IP que informa el panel o `apps/diagnostico` en rutas sin sesión
 *    (login, canje y recuperación de enlaces), solo si trae el secreto de esa
 *    app. Sin el secreto, el encabezado no cuenta.
 * 4. Por la IP que pone la plataforma en `CLIENT_IP_HEADER` (en Render,
 *    `cf-connecting-ip`: Cloudflare rechaza la petición que lo trae del cliente).
 *    Contar proxies con `TRUST_PROXY_HOPS` no es estable en Render y, con una
 *    cadena más corta, dejaría al cliente elegir su IP.
 * 5. Por la IP de la conexión (`req.ip`, según `TRUST_PROXY_HOPS`).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();
  private keySecret?: Buffer;

  /**
   * La clave del contador se guarda en la base (PF-60) y lleva la IP: con un
   * SHA-256 sin sal se podría revertir probando todas las IPv4. Con HMAC, y una
   * llave derivada de `JWT_SECRET` solo para esto, no se puede sin el secreto.
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const jwtSecret = process.env.JWT_SECRET;
    // validate-env ya lo exige; esto evita derivar la llave de un secreto vacío.
    if (!jwtSecret) throw new Error('Falta JWT_SECRET para el límite');
    this.keySecret ??= Buffer.from(
      hkdfSync('sha256', jwtSecret, Buffer.alloc(0), 'score-throttle-keys', 32),
    );
    return createHmac('sha256', this.keySecret)
      .update(
        `${context.getClass().name}-${context.getHandler().name}-${name}-${suffix}`,
      )
      .digest('hex');
  }

  protected getTracker(req: ThrottledRequest): Promise<string> {
    const token = this.bearerToken(req);
    const userId =
      token &&
      this.subject(token, process.env.JWT_SECRET, PANEL_SESSION_AUDIENCE);
    if (userId) return Promise.resolve(`user:${userId}`);

    const diagnosticId =
      token &&
      this.subject(token, process.env.ACCESS_LINK_JWT_SECRET, SESSION_AUDIENCE);
    if (diagnosticId) return Promise.resolve(`diagnostic:${diagnosticId}`);

    return super.getTracker({
      ip: this.ipFromTrustedApp(req) ?? this.ipFromPlatform(req) ?? req.ip,
    });
  }

  private bearerToken(req: ThrottledRequest): string | null {
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }

  private subject(
    token: string,
    secret: string | undefined,
    audience: string,
  ): string | null {
    if (!secret) return null;
    try {
      const { sub } = this.jwt.verify<{ sub?: string }>(token, {
        secret,
        algorithms: ['HS256'],
        audience,
      });
      return typeof sub === 'string' ? sub : null;
    } catch {
      return null;
    }
  }

  /** El encabezado de la plataforma, si está configurado y trae una IP válida. */
  private ipFromPlatform(req: ThrottledRequest): string | null {
    const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
    if (!name) return null;
    const ip = req.headers[name];
    return typeof ip === 'string' && isIP(ip.trim()) ? ip.trim() : null;
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
