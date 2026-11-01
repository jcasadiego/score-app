import { validateEnv } from './validate-env';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/score',
  CORS_ORIGINS: 'http://localhost:3002',
  JWT_SECRET: 'x'.repeat(32),
  ACCESS_LINK_JWT_SECRET: 'y'.repeat(32),
};

const RESEND = {
  MAIL_DRIVER: 'resend',
  RESEND_API_KEY: 're_prueba',
  MAIL_FROM: 'Music Finance Pro <onboarding@resend.dev>',
  MAIL_REPLY_TO: 'equipo@example.com',
};

describe('validateEnv · correo', () => {
  it('en desarrollo usa el modo log por defecto y trata "" como vacío', () => {
    const env = validateEnv({
      ...BASE,
      RESEND_API_KEY: '',
      MAIL_LOGO_URL: '',
    });

    expect(env.MAIL_DRIVER).toBe('log');
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.MAIL_LOGO_URL).toBeUndefined();
  });

  it('en producción no arranca con el modo log', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /MAIL_DRIVER: en producción debe ser 'resend'/,
    );
  });

  it('con resend exige key, remitente y reply-to, y dice cuál falta', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        ...RESEND,
        RESEND_API_KEY: '',
        MAIL_REPLY_TO: '',
      }),
    ).toThrow(
      /RESEND_API_KEY: obligatoria con MAIL_DRIVER=resend[\s\S]*MAIL_REPLY_TO: obligatoria/,
    );
  });

  it('con resend completo arranca también en producción', () => {
    expect(
      validateEnv({
        ...BASE,
        ...RESEND,
        PANEL_API_SECRET: 'z'.repeat(32),
        NODE_ENV: 'production',
        PANEL_URL: 'https://panel.example.com',
      }).MAIL_DRIVER,
    ).toBe('resend');
  });

  it('en producción exige PANEL_URL para los enlaces por correo', () => {
    expect(() =>
      validateEnv({ ...BASE, ...RESEND, NODE_ENV: 'production' }),
    ).toThrow(/PANEL_URL: obligatoria en producción/);
  });
});

describe('validateEnv · PANEL_API_SECRET', () => {
  it('es opcional en desarrollo', () => {
    expect(validateEnv(BASE).PANEL_API_SECRET).toBeUndefined();
  });

  it('en producción no arranca sin él', () => {
    expect(() =>
      validateEnv({ ...BASE, ...RESEND, NODE_ENV: 'production' }),
    ).toThrow(/PANEL_API_SECRET: obligatoria en producción/);
  });

  it('rechaza un secreto corto', () => {
    expect(() => validateEnv({ ...BASE, PANEL_API_SECRET: 'corto' })).toThrow(
      /PANEL_API_SECRET: debe tener al menos 32 caracteres/,
    );
  });
});
