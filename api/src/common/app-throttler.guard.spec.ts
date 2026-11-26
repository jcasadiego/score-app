import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_SESSION_AUDIENCE } from '../auth/session-audience';
import { SESSION_AUDIENCE } from '../diagnostics/access-links.service';
import { AppThrottlerGuard } from './app-throttler.guard';

const PANEL_SECRET = 'p'.repeat(32);
const LINK_SECRET = 'l'.repeat(32);

type Tracker = (req: {
  ip?: string;
  headers: Record<string, string>;
}) => Promise<string>;

describe('AppThrottlerGuard · contador', () => {
  const jwt = new JwtService();
  let tracker: Tracker;

  beforeEach(() => {
    process.env.JWT_SECRET = PANEL_SECRET;
    process.env.ACCESS_LINK_JWT_SECRET = LINK_SECRET;
    const guard = Object.create(AppThrottlerGuard.prototype) as {
      getTracker: Tracker;
      jwt: JwtService;
    };
    guard.jwt = jwt;
    tracker = (req) => guard.getTracker(req);
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.ACCESS_LINK_JWT_SECRET;
  });

  const bearer = (token: string) => ({
    ip: '192.0.2.1',
    headers: { authorization: `Bearer ${token}` },
  });

  it('una sesión de cliente final cuenta por diagnóstico', async () => {
    const token = jwt.sign(
      { sub: 'diag-1', lid: 'link-1' },
      { secret: LINK_SECRET, audience: SESSION_AUDIENCE },
    );
    await expect(tracker(bearer(token))).resolves.toBe('diagnostic:diag-1');
  });

  it('una sesión con otra audiencia o firma cuenta por IP', async () => {
    const otherAudience = jwt.sign(
      { sub: 'diag-1' },
      { secret: LINK_SECRET, audience: 'otra' },
    );
    const forged = jwt.sign(
      { sub: 'diag-1' },
      { secret: 'x'.repeat(32), audience: SESSION_AUDIENCE },
    );
    await expect(tracker(bearer(otherAudience))).resolves.toBe('192.0.2.1');
    await expect(tracker(bearer(forged))).resolves.toBe('192.0.2.1');
  });

  it('un usuario del panel sigue contando por usuario', async () => {
    const token = jwt.sign(
      { sub: 'user-1' },
      { secret: PANEL_SECRET, audience: PANEL_SESSION_AUDIENCE },
    );
    await expect(tracker(bearer(token))).resolves.toBe('user:user-1');
  });

  it('un token vencido o de otra audiencia (el desafío MFA) cuenta por IP', async () => {
    const expired = jwt.sign(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: PANEL_SECRET, audience: PANEL_SESSION_AUDIENCE },
    );
    const challenge = jwt.sign(
      { sub: 'user-1' },
      { secret: PANEL_SECRET, audience: 'mfa-challenge' },
    );
    await expect(tracker(bearer(expired))).resolves.toBe('192.0.2.1');
    await expect(tracker(bearer(challenge))).resolves.toBe('192.0.2.1');
  });

  describe('con CLIENT_IP_HEADER', () => {
    beforeEach(() => {
      process.env.CLIENT_IP_HEADER = 'CF-Connecting-IP';
    });
    afterEach(() => {
      delete process.env.CLIENT_IP_HEADER;
    });

    it('usa la IP de la plataforma antes que la de la conexión', async () => {
      await expect(
        tracker({
          ip: '6.6.6.6',
          headers: { 'cf-connecting-ip': '203.0.113.7' },
        }),
      ).resolves.toBe('203.0.113.7');
    });

    it('si el encabezado falta o no es una IP, cuenta por la conexión', async () => {
      await expect(tracker({ ip: '192.0.2.1', headers: {} })).resolves.toBe(
        '192.0.2.1',
      );
      await expect(
        tracker({
          ip: '192.0.2.1',
          headers: { 'cf-connecting-ip': 'no-es-ip' },
        }),
      ).resolves.toBe('192.0.2.1');
    });
  });
});
