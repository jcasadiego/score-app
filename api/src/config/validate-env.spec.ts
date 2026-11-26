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
  APP_ENV: 'production',
  SCORING_ENGINE_DRIVER: 'disabled',
  AI_PROVIDER: 'disabled',
  CRM_PROVIDER: 'simulated',
  STORAGE_DRIVER: 'disabled',
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

describe('validateEnv · enlace de descarga del informe', () => {
  it('vence en 30 días si no se configura', () => {
    expect(validateEnv(BASE).REPORT_LINK_TTL_DAYS).toBe(30);
  });

  it('rechaza vigencias fuera de 1 a 90 días', () => {
    for (const REPORT_LINK_TTL_DAYS of ['0', '91', '1.5']) {
      expect(() => validateEnv({ ...BASE, REPORT_LINK_TTL_DAYS })).toThrow(
        /REPORT_LINK_TTL_DAYS/,
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

describe('validateEnv · motor de cálculo', () => {
  it('en desarrollo, APP_ENV y SCORING_ENGINE_DRIVER son opcionales', () => {
    const env = validateEnv(BASE);
    expect(env.APP_ENV).toBeUndefined();
    expect(env.SCORING_ENGINE_DRIVER).toBeUndefined();
  });

  it.each(['APP_ENV', 'SCORING_ENGINE_DRIVER'])(
    'con NODE_ENV=production no arranca sin %s',
    (key) => {
      expect(() => validateEnv({ ...PRODUCTION, [key]: '' })).toThrow(
        new RegExp(`${key}: obligatoria con NODE_ENV=production`),
      );
    },
  );

  it('con APP_ENV=production no admite el adapter simulado', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, SCORING_ENGINE_DRIVER: 'stub' }),
    ).toThrow(/SCORING_ENGINE_DRIVER: con APP_ENV=production no admite 'stub'/);
  });

  it('en QA sí admite el adapter simulado', () => {
    expect(
      validateEnv({
        ...PRODUCTION,
        APP_ENV: 'qa',
        SCORING_ENGINE_DRIVER: 'stub',
      }).SCORING_ENGINE_DRIVER,
    ).toBe('stub');
  });

  it('rechaza un motor desconocido', () => {
    expect(() =>
      validateEnv({ ...BASE, SCORING_ENGINE_DRIVER: 'real' }),
    ).toThrow(/SCORING_ENGINE_DRIVER/);
  });
});

describe('validateEnv · IA', () => {
  it('en desarrollo, el proveedor es opcional', () => {
    expect(validateEnv(BASE).AI_PROVIDER).toBeUndefined();
  });

  it('con NODE_ENV=production no arranca sin AI_PROVIDER', () => {
    expect(() => validateEnv({ ...PRODUCTION, AI_PROVIDER: '' })).toThrow(
      /AI_PROVIDER: obligatoria con NODE_ENV=production/,
    );
  });

  it.each(['AI_PROVIDER', 'AI_FLAGS_PROVIDER', 'AI_REPORT_PROVIDER'])(
    'con APP_ENV=production, %s no admite el simulado',
    (key) => {
      expect(() => validateEnv({ ...PRODUCTION, [key]: 'stub' })).toThrow(
        new RegExp(`${key}: con APP_ENV=production no admite 'stub'`),
      );
    },
  );

  it('con claude exige la API key, también si solo un uso lo pide', () => {
    expect(() => validateEnv({ ...BASE, AI_FLAGS_PROVIDER: 'claude' })).toThrow(
      /ANTHROPIC_API_KEY: obligatoria con AI_FLAGS_PROVIDER=claude/,
    );
    expect(
      validateEnv({
        ...BASE,
        AI_PROVIDER: 'claude',
        ANTHROPIC_API_KEY: 'sk-ant-prueba',
      }).AI_PROVIDER,
    ).toBe('claude');
  });

  it('rechaza un proveedor desconocido', () => {
    expect(() => validateEnv({ ...BASE, AI_PROVIDER: 'openai' })).toThrow(
      /AI_PROVIDER/,
    );
  });
});

describe('validateEnv · CRM', () => {
  it('en desarrollo, el proveedor es opcional y la bandeja corre cada 30 s', () => {
    const env = validateEnv(BASE);
    expect(env.CRM_PROVIDER).toBeUndefined();
    expect(env.CRM_SYNC_INTERVAL_MS).toBe(30_000);
  });

  it('con NODE_ENV=production no arranca sin CRM_PROVIDER', () => {
    expect(() => validateEnv({ ...PRODUCTION, CRM_PROVIDER: '' })).toThrow(
      /CRM_PROVIDER: obligatoria con NODE_ENV=production/,
    );
  });

  it('el fallo forzado del simulado sirve en QA pero no en producción', () => {
    expect(
      validateEnv({
        ...PRODUCTION,
        APP_ENV: 'qa',
        CRM_SIMULATED_FAILURE: 'PROVIDER_ERROR',
      }).CRM_SIMULATED_FAILURE,
    ).toBe('PROVIDER_ERROR');
    expect(() =>
      validateEnv({ ...PRODUCTION, CRM_SIMULATED_FAILURE: 'PROVIDER_ERROR' }),
    ).toThrow(/CRM_SIMULATED_FAILURE: no se admite con APP_ENV=production/);
  });

  it('rechaza un proveedor o un código de fallo desconocidos', () => {
    expect(() => validateEnv({ ...BASE, CRM_PROVIDER: 'hubspot' })).toThrow(
      /CRM_PROVIDER/,
    );
    expect(() =>
      validateEnv({ ...BASE, CRM_SIMULATED_FAILURE: 'BOOM' }),
    ).toThrow(/CRM_SIMULATED_FAILURE/);
  });
});

describe('validateEnv · transcripción', () => {
  it('sin proveedor arranca, con el modelo y el intervalo por defecto', () => {
    const env = validateEnv(PRODUCTION);
    expect(env.TRANSCRIPTION_PROVIDER).toBeUndefined();
    expect(env.TRANSCRIPTION_MODEL).toBe('gpt-4o-mini-transcribe');
    expect(env.TRANSCRIPTION_INTERVAL_MS).toBe(30_000);
  });

  it('con openai exige la llave', () => {
    expect(() =>
      validateEnv({ ...BASE, TRANSCRIPTION_PROVIDER: 'openai' }),
    ).toThrow(/OPENAI_API_KEY: obligatoria con TRANSCRIPTION_PROVIDER=openai/);
    expect(
      validateEnv({
        ...BASE,
        TRANSCRIPTION_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
      }).TRANSCRIPTION_PROVIDER,
    ).toBe('openai');
  });

  it('el fallo forzado del simulado sirve en QA pero no en producción', () => {
    expect(
      validateEnv({
        ...PRODUCTION,
        APP_ENV: 'qa',
        TRANSCRIPTION_SIMULATED_FAILURE: 'TIMEOUT',
      }).TRANSCRIPTION_SIMULATED_FAILURE,
    ).toBe('TIMEOUT');
    expect(() =>
      validateEnv({
        ...PRODUCTION,
        TRANSCRIPTION_SIMULATED_FAILURE: 'TIMEOUT',
      }),
    ).toThrow(/TRANSCRIPTION_SIMULATED_FAILURE: no se admite/);
  });

  it('rechaza un proveedor desconocido', () => {
    expect(() =>
      validateEnv({ ...BASE, TRANSCRIPTION_PROVIDER: 'deepgram' }),
    ).toThrow(/TRANSCRIPTION_PROVIDER/);
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

describe('validateEnv · almacenamiento', () => {
  const S3 = {
    STORAGE_DRIVER: 's3',
    STORAGE_S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com',
    STORAGE_S3_BUCKET: 'score-voice-qa',
    STORAGE_S3_ACCESS_KEY_ID: 'id',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secreto',
  };

  it('en desarrollo es opcional, con región auto y URLs de 5 minutos', () => {
    const env = validateEnv({ ...BASE, STORAGE_DRIVER: '' });
    expect(env.STORAGE_DRIVER).toBeUndefined();
    expect(env.STORAGE_S3_REGION).toBe('auto');
    expect(env.STORAGE_SIGNED_URL_TTL_SECONDS).toBe(300);
  });

  it('en producción no arranca sin él', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, STORAGE_DRIVER: undefined }),
    ).toThrow(/STORAGE_DRIVER: obligatoria/);
  });

  it('en producción no admite memory', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION, STORAGE_DRIVER: 'memory' }),
    ).toThrow(/STORAGE_DRIVER: en producción no admite 'memory'/);
  });

  it('con s3 exige endpoint, bucket y llaves, y dice cuál falta', () => {
    for (const key of [
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
    ]) {
      expect(() => validateEnv({ ...BASE, ...S3, [key]: '' })).toThrow(
        new RegExp(`${key}: obligatoria con STORAGE_DRIVER=s3`),
      );
    }
  });

  it('con s3 completo arranca también en producción', () => {
    expect(validateEnv({ ...PRODUCTION, ...S3 }).STORAGE_DRIVER).toBe('s3');
  });

  it('en producción exige https en el endpoint', () => {
    expect(() =>
      validateEnv({
        ...PRODUCTION,
        ...S3,
        STORAGE_S3_ENDPOINT: 'http://localhost:9000',
      }),
    ).toThrow(/STORAGE_S3_ENDPOINT: en producción debe usar https/);
  });

  it('rechaza URLs firmadas de más de 15 minutos', () => {
    expect(() =>
      validateEnv({ ...BASE, STORAGE_SIGNED_URL_TTL_SECONDS: '901' }),
    ).toThrow(/STORAGE_SIGNED_URL_TTL_SECONDS/);
  });
});

describe('validateEnv — cupo de avisos de lead nuevo (PF-36)', () => {
  it('sin la variable, o vacía, el cupo es 30 por día', () => {
    expect(validateEnv(BASE).NEW_LEAD_NOTICE_DAILY_LIMIT).toBe(30);
    expect(
      validateEnv({ ...BASE, NEW_LEAD_NOTICE_DAILY_LIMIT: '' })
        .NEW_LEAD_NOTICE_DAILY_LIMIT,
    ).toBe(30);
  });

  it('acepta otro número, incluido 0, y rechaza los inválidos', () => {
    expect(
      validateEnv({ ...BASE, NEW_LEAD_NOTICE_DAILY_LIMIT: '0' })
        .NEW_LEAD_NOTICE_DAILY_LIMIT,
    ).toBe(0);
    expect(() =>
      validateEnv({ ...BASE, NEW_LEAD_NOTICE_DAILY_LIMIT: '-1' }),
    ).toThrow(/NEW_LEAD_NOTICE_DAILY_LIMIT/);
    expect(() =>
      validateEnv({ ...BASE, NEW_LEAD_NOTICE_DAILY_LIMIT: 'muchos' }),
    ).toThrow(/NEW_LEAD_NOTICE_DAILY_LIMIT/);
  });
});

describe('validateEnv — alertas de seguridad (PF-55)', () => {
  it('el correo de soporte es opcional y debe ser válido', () => {
    expect(validateEnv(BASE).SECURITY_ALERT_EMAIL).toBeUndefined();
    expect(
      validateEnv({ ...BASE, SECURITY_ALERT_EMAIL: 'soporte@example.com' })
        .SECURITY_ALERT_EMAIL,
    ).toBe('soporte@example.com');
    expect(() =>
      validateEnv({ ...BASE, SECURITY_ALERT_EMAIL: 'no-es-correo' }),
    ).toThrow(/SECURITY_ALERT_EMAIL/);
  });

  it('sin intervalo, o vacío, revisa cada minuto', () => {
    expect(validateEnv(BASE).SECURITY_ALERT_INTERVAL_MS).toBe(60_000);
    expect(
      validateEnv({ ...BASE, SECURITY_ALERT_INTERVAL_MS: '' })
        .SECURITY_ALERT_INTERVAL_MS,
    ).toBe(60_000);
  });
});
