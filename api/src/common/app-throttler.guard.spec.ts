import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    const token = jwt.sign({ sub: 'user-1' }, { secret: PANEL_SECRET });
    await expect(tracker(bearer(token))).resolves.toBe('user:user-1');
  });
});
