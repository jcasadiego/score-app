import { validarEnv } from './validar-env';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/score',
  CORS_ORIGINS: 'http://localhost:3002',
  JWT_SECRET: 'x'.repeat(32),
  ENLACE_JWT_SECRET: 'y'.repeat(32),
};

const RESEND = {
  CORREO_MODO: 'resend',
  RESEND_API_KEY: 're_prueba',
  CORREO_REMITENTE: 'Music Finance Pro <onboarding@resend.dev>',
  CORREO_REPLY_TO: 'equipo@example.com',
};

describe('validarEnv · correo', () => {
  it('en desarrollo usa el modo log por defecto y trata "" como vacío', () => {
    const env = validarEnv({
      ...BASE,
      RESEND_API_KEY: '',
      CORREO_LOGO_URL: '',
    });

    expect(env.CORREO_MODO).toBe('log');
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.CORREO_LOGO_URL).toBeUndefined();
  });

  it('en producción no arranca con el modo log', () => {
    expect(() => validarEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /CORREO_MODO: en producción debe ser 'resend'/,
    );
  });

  it('con resend exige key, remitente y reply-to, y dice cuál falta', () => {
    expect(() =>
      validarEnv({
        ...BASE,
        ...RESEND,
        RESEND_API_KEY: '',
        CORREO_REPLY_TO: '',
      }),
    ).toThrow(
      /RESEND_API_KEY: obligatoria con CORREO_MODO=resend[\s\S]*CORREO_REPLY_TO: obligatoria/,
    );
  });

  it('con resend completo arranca también en producción', () => {
    expect(
      validarEnv({ ...BASE, ...RESEND, NODE_ENV: 'production' }).CORREO_MODO,
    ).toBe('resend');
  });
});
