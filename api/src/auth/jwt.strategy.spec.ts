import type { Mock } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { SessionsService } from './sessions.service';

describe('JwtStrategy', () => {
  const payload = { sub: '1', ver: 3, sid: 's1', authAt: 100 };
  const session = (
    user: { active?: boolean; sessionVersion?: number } = {},
  ) => ({
    userId: '1',
    user: {
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      active: true,
      sessionVersion: 3,
      ...user,
    },
  });
  let sessions: { find: Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
    sessions = { find: vi.fn() };
    strategy = new JwtStrategy(sessions as unknown as SessionsService);
  });

  it('rechaza si la sesión ya no existe', async () => {
    sessions.find.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token sin sesión, sin consultar la base', async () => {
    await expect(
      strategy.validate({ sub: '1', ver: 3, authAt: 100 }),
    ).rejects.toThrow(UnauthorizedException);

    expect(sessions.find).not.toHaveBeenCalled();
  });

  it('rechaza si la sesión es de otro usuario', async () => {
    sessions.find.mockResolvedValue(session());

    await expect(strategy.validate({ ...payload, sub: '2' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza si el usuario está desactivado', async () => {
    sessions.find.mockResolvedValue(session({ active: false }));

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token emitido antes del último cambio de contraseña', async () => {
    sessions.find.mockResolvedValue(session({ sessionVersion: 4 }));

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('devuelve el usuario si la sesión sigue abierta', async () => {
    sessions.find.mockResolvedValue(session());

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      sessionVersion: 3,
      sessionId: 's1',
      authAt: 100,
    });
  });
});
