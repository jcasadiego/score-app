import { validateEnv } from './validate-env';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/score',
  CORS_ORIGINS: 'http://localhost:3002',
  JWT_SECRET: 'x'.repeat(32),
  ACCESS_LINK_JWT_SECRET: 'y'.repeat(32),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

const RESEND = {
  MAIL_DRIVER: 'resend',
  RESEND_API_KEY: 're_prueba',
  MAIL_FROM: 'Music Finance Pro <onboarding@resend.dev>',
  MAIL_REPLY_TO: 'equipo@example.com',
};

const PRODUCTION = {
  ...BASE,
  ...RESEND,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://db.example.com/score?sslmode=verify-full',
  CORS_ORIGINS: 'https://diagnostico.example.com,https://sitio.example.com',
  TRUST_PROXY_HOPS: '1',
  PANEL_API_SECRET: 'z'.repeat(32),
  DIAGNOSTIC_API_SECRET: 'y'.repeat(32),
  PANEL_URL: 'https://panel.example.com',
  DIAGNOSTIC_URL: 'https://diagnostico.example.com',
};

describe('validateEnv · MFA', () => {
  it('exige una llave de 32 bytes en base64', () => {
    for (const MFA_ENCRYPTION_KEY of [undefined, '', 'corta', 'AAAA']) {
      expect(() => validateEnv({ ...BASE, MFA_ENCRYPTION_KEY })).toThrow(
        /MFA_ENCRYPTION_KEY/,
      );
    }
  });
});

describe('validateEnv · cifrado en tránsito', () => {
  it('en producción exige cifrar la conexión a la base', () => {
    for (const DATABASE_URL of [
      'postgresql://db.example.com/score',
      'postgresql://db.example.com/score?sslmode=disable',
      'postgresql://db.example.com/score?sslmode=prefer',
    ]) {
      expect(() => validateEnv({ ...PRODUCTION, DATABASE_URL })).toThrow(
        /DATABASE_URL: en producción, conexión cifrada/,
      );
    }
  });

  it('en producción exige https en los enlaces del panel', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, PANEL_URL: 'http://panel.example.com' }),
    ).toThrow(/PANEL_URL: en producción debe usar https/);
  });

  it('en producción exige https en el enlace del cliente final', () => {
    expect(() =>
      validateEnv({
        ...PRODUCTION,
        DIAGNOSTIC_URL: 'http://diagnostico.example.com',
      }),
    ).toThrow(/DIAGNOSTIC_URL: en producción debe usar https/);
  });

  it('en desarrollo no exige cifrar la base local', () => {
    expect(validateEnv(BASE).DATABASE_URL).toBe(BASE.DATABASE_URL);
  });
});

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
    expect(validateEnv(PRODUCTION).MAIL_DRIVER).toBe('resend');
  });

  it('en producción exige PANEL_URL para los enlaces por correo', () => {
    expect(() =>
      validateEnv({ ...BASE, ...RESEND, NODE_ENV: 'production' }),
    ).toThrow(/PANEL_URL: obligatoria en producción/);
  });

  it('en producción exige DIAGNOSTIC_URL para el enlace del cliente', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, DIAGNOSTIC_URL: undefined }),
    ).toThrow(/DIAGNOSTIC_URL: obligatoria en producción/);
  });
});

describe('validateEnv · enlace del cliente final', () => {
  it('vence en 30 días si no se configura', () => {
    expect(validateEnv(BASE).ACCESS_LINK_TTL_DAYS).toBe(30);
  });

  it('rechaza vigencias fuera de 1 a 90 días', () => {
    for (const ACCESS_LINK_TTL_DAYS of ['0', '91', '1.5']) {
      expect(() => validateEnv({ ...BASE, ACCESS_LINK_TTL_DAYS })).toThrow(
        /ACCESS_LINK_TTL_DAYS/,
      );
    }
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

describe('validateEnv · DIAGNOSTIC_API_SECRET', () => {
  it('es opcional en desarrollo', () => {
    expect(validateEnv(BASE).DIAGNOSTIC_API_SECRET).toBeUndefined();
  });

  it('en producción no arranca sin él', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, DIAGNOSTIC_API_SECRET: '' }),
    ).toThrow(/DIAGNOSTIC_API_SECRET: obligatoria en producción/);
  });

  it('debe ser distinto del secreto del panel', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        PANEL_API_SECRET: 'x'.repeat(32),
        DIAGNOSTIC_API_SECRET: 'x'.repeat(32),
      }),
    ).toThrow(/DIAGNOSTIC_API_SECRET: debe ser distinto de PANEL_API_SECRET/);
  });
});

describe('validateEnv · despliegue', () => {
  it('no arranca sin NODE_ENV', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: undefined })).toThrow(
      /NODE_ENV/,
    );
  });

  it('en producción exige TRUST_PROXY_HOPS y acepta 0', () => {
    expect(() => validateEnv({ ...PRODUCTION, TRUST_PROXY_HOPS: '' })).toThrow(
      /TRUST_PROXY_HOPS: obligatoria en producción/,
    );
    expect(
      validateEnv({ ...PRODUCTION, TRUST_PROXY_HOPS: '0' }).TRUST_PROXY_HOPS,
    ).toBe(0);
  });

  it('es opcional en desarrollo', () => {
    expect(validateEnv(BASE).TRUST_PROXY_HOPS).toBeUndefined();
  });

  it.each([
    'http://sitio.example.com',
    '*',
    'https://*.example.com',
    'https://sitio.example.com/',
  ])('en producción rechaza el origen %s', (origin) => {
    expect(() => validateEnv({ ...PRODUCTION, CORS_ORIGINS: origin })).toThrow(
      /CORS_ORIGINS: en producción/,
    );
  });

  it('no arranca con el mismo secreto para el panel y los enlaces', () => {
    expect(() =>
      validateEnv({ ...BASE, ACCESS_LINK_JWT_SECRET: BASE.JWT_SECRET }),
    ).toThrow(/ACCESS_LINK_JWT_SECRET: debe ser distinto/);
  });
});
