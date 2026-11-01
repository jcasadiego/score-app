import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

interface ThrottledRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * El panel llama a la API desde su servidor: contar solo por IP de conexión
 * juntaría a todo el equipo en un contador por ruta. Por eso cuenta, en orden:
 *
 * 1. Por usuario, si el JWT tiene una firma válida. Un token vencido o revocado
 *    también vale aquí: identifica a quien lo emitió, y `JwtAuthGuard` lo rechaza
 *    después. Una firma falsa no puede gastar el contador de otra persona.
 * 2. Por la IP que informa el panel en rutas sin sesión (login, recuperación),
 *    solo si trae `PANEL_API_SECRET`. Sin el secreto, el encabezado no cuenta.
 * 3. Por la IP de la conexión, como hasta ahora.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();

  protected getTracker(req: ThrottledRequest): Promise<string> {
    const userId = this.userIdFromToken(req);
    if (userId) return Promise.resolve(`user:${userId}`);

    return super.getTracker({ ip: this.ipFromPanel(req) ?? req.ip });
  }

  private userIdFromToken(req: ThrottledRequest): string | null {
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return null;

    try {
      const { sub } = this.jwt.verify<{ sub?: string }>(token, {
        secret: process.env.JWT_SECRET,
        algorithms: ['HS256'],
        ignoreExpiration: true,
      });
      return sub ?? null;
    } catch {
      return null;
    }
  }

  private ipFromPanel(req: ThrottledRequest): string | null {
    const expected = process.env.PANEL_API_SECRET;
    const received = req.headers['x-panel-secret'];
    const ip = req.headers['x-client-ip'];
    if (!expected || typeof received !== 'string' || typeof ip !== 'string') {
      return null;
    }

    // Con hash, para comparar siempre el mismo largo en tiempo constante.
    const isPanel = timingSafeEqual(sha256(received), sha256(expected));
    return isPanel && isIP(ip) ? ip : null;
  }
}
