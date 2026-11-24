import { z } from 'zod';
import { CrmSyncErrorCode } from '../../generated/prisma/enums';
import { CRM_PROVIDERS } from '../crm/crm.port';
import { STORAGE_DRIVERS } from '../storage/storage.port';
import { hasEncryptedConnection } from '../prisma/database-roles';
import { isSecureOrigin, parseCorsOrigins } from './cors';

/** Vacío en `.env` (`VAR=""`) cuenta como no definido. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * Se valida `process.env` completo al boot para fallar rápido y con un
 * mensaje claro si falta una variable, en vez de un error opaco más
 * adelante (ej. un JWT_SECRET undefined que rompe silenciosamente la
 * firma de tokens).
 */
const AI_PROVIDERS = ['disabled', 'stub', 'claude'] as const;

const EnvSchema = z
  .object({
    // Sin valor por defecto: si faltara en un servidor, la API arrancaría como
    // desarrollo, con Swagger público y sin las exigencias de producción.
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGINS: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('1d'),
    JWT_MAX_SESSION_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(604_800),
    // Firma la sesión del cliente final tras canjear su enlace.
    ACCESS_LINK_JWT_SECRET: z
      .string()
      .min(32, 'debe tener al menos 32 caracteres'),
    // Vigencia del enlace que recibe el cliente por correo.
    ACCESS_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    // Vigencia del enlace de descarga del informe (PF-42).
    REPORT_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    // Cifra los secretos TOTP. Perderla obliga a reconfigurar el MFA de todos.
    MFA_ENCRYPTION_KEY: z
      .base64()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'debe ser de 32 bytes en base64 (openssl rand -base64 32)',
      ),
    THROTTLE_TTL: z.coerce.number().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().default(100),
    // Proxies de confianza delante de la API. De más, un cliente puede inventar
    // su IP con `X-Forwarded-For` y saltarse el límite de login; de menos, todos
    // los clientes comparten un contador.
    TRUST_PROXY_HOPS: optional(z.coerce.number().int().min(0)),
    // Con este secreto, el panel informa la IP real de quien inicia sesión.
    PANEL_API_SECRET: optional(
      z.string().min(32, 'debe tener al menos 32 caracteres'),
    ),
    // Lo mismo para apps/diagnostico, que llama a la API desde su servidor.
    DIAGNOSTIC_API_SECRET: optional(
      z.string().min(32, 'debe tener al menos 32 caracteres'),
    ),
    // Base de los enlaces del panel que salen por correo (recuperación).
    PANEL_URL: optional(z.url()),
    // Base del enlace que recibe el cliente final (apps/diagnostico).
    DIAGNOSTIC_URL: optional(z.url()),
    // Entorno de despliegue. Distingue QA de producción, que comparten
    // NODE_ENV=production. Obligatorio con NODE_ENV=production.
    APP_ENV: optional(z.enum(['development', 'qa', 'production'])),
    // Motor de cálculo (PF-24): `disabled` deja los cálculos pendientes; `stub`
    // es el adapter simulado. PF-26 agregará el real. Vacío en desarrollo =
    // `stub`; obligatorio con NODE_ENV=production.
    SCORING_ENGINE_DRIVER: optional(z.enum(['disabled', 'stub'])),
    // IA (PF-32): proveedor y modelo por defecto, y por uso (`AI_FLAGS_*`,
    // `AI_REPORT_*`). `disabled` no llama a nadie; `stub` responde datos de
    // ejemplo sin costo. Vacío en desarrollo = `stub`; obligatorio con
    // NODE_ENV=production.
    AI_PROVIDER: optional(z.enum(AI_PROVIDERS)),
    AI_MODEL: optional(z.string().max(64)),
    AI_FLAGS_PROVIDER: optional(z.enum(AI_PROVIDERS)),
    AI_FLAGS_MODEL: optional(z.string().max(64)),
    AI_REPORT_PROVIDER: optional(z.enum(AI_PROVIDERS)),
    AI_REPORT_MODEL: optional(z.string().max(64)),
    // Flags (PF-34): Confianza del motor por debajo de esto genera un flag.
    // 0.5 mientras la escala real del motor no esté confirmada.
    FLAG_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
    AI_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(60_000),
    ANTHROPIC_API_KEY: optional(z.string().min(1)),
    // `log` no envía nada real (desarrollo); `resend` envía de verdad.
    MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: optional(z.string()),
    MAIL_FROM: optional(z.string()),
    MAIL_REPLY_TO: optional(z.email()),
    MAIL_LOGO_URL: optional(z.url()),
    // Contraseñas filtradas (PF-60): `hibp` consulta Pwned Passwords con
    // k-anonimato además de la lista local; `local`, solo la lista (tests).
    BREACHED_PASSWORDS_PROVIDER: z.enum(['hibp', 'local']).default('hibp'),
    // Contadores del límite de peticiones (PF-60): `postgres` los comparte entre
    // instancias; `memory` es por proceso (tests).
    THROTTLE_STORAGE: z.enum(['postgres', 'memory']).default('postgres'),
    // CRM (PF-80): `simulated` no llama a nada externo (el real llega con
    // PF-82). Obligatorio con NODE_ENV=production.
    CRM_PROVIDER: optional(z.enum(CRM_PROVIDERS)),
    // Solo desarrollo y QA: el CRM simulado falla siempre con este código, para
    // probar los reintentos y el panel.
    CRM_SIMULATED_FAILURE: optional(z.enum(CrmSyncErrorCode)),
    // Cada cuánto revisa la bandeja de salida; 0 la apaga (tests).
    CRM_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
    // Almacenamiento de objetos (PF-85): audios de voz. `memory` solo en
    // desarrollo y tests; `s3`, un bucket compatible con S3 (Cloudflare R2);
    // `disabled`, nada se guarda. Vacío en desarrollo = memory; obligatoria
    // con NODE_ENV=production.
    STORAGE_DRIVER: optional(z.enum(STORAGE_DRIVERS)),
    STORAGE_S3_ENDPOINT: optional(z.url()),
    // R2 usa `auto`.
    STORAGE_S3_REGION: z.string().min(1).default('auto'),
    STORAGE_S3_BUCKET: optional(z.string().min(3).max(63)),
    STORAGE_S3_ACCESS_KEY_ID: optional(z.string().min(1)),
    STORAGE_S3_SECRET_ACCESS_KEY: optional(z.string().min(1)),
    // Vida de las URLs firmadas de lectura, en segundos (máx. 15 minutos).
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(900)
      .default(300),
  })
  .superRefine((env, ctx) => {
    // Con el mismo secreto, un token del panel serviría como enlace de cliente.
    if (env.JWT_SECRET === env.ACCESS_LINK_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['ACCESS_LINK_JWT_SECRET'],
        message: 'debe ser distinto de JWT_SECRET',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.TRUST_PROXY_HOPS === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY_HOPS'],
          message: 'obligatoria en producción (0 si no hay proxy delante)',
        });
      }
      if (!parseCorsOrigins(env.CORS_ORIGINS).every(isSecureOrigin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'en producción, solo orígenes https exactos, sin comodines',
        });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (!hasEncryptedConnection(env.DATABASE_URL)) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message:
            'en producción, conexión cifrada: sslmode=require, verify-ca o verify-full',
        });
      }
      // Los enlaces que salen por correo llevan un token: no pueden viajar sin cifrar.
      for (const key of ['PANEL_URL', 'DIAGNOSTIC_URL'] as const) {
        if (env[key] && !env[key].startsWith('https://')) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'en producción debe usar https',
          });
        }
      }
    }
    // Fuera de desarrollo, un correo que no sale debe impedir el arranque,
    // no descubrirse cuando un cliente reclama que no le llegó el enlace.
    if (env.NODE_ENV === 'production') {
      for (const key of ['PANEL_URL', 'DIAGNOSTIC_URL'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'obligatoria en producción (va en los enlaces por correo)',
          });
        }
      }
    }
    // Sin él, un solo contador de login para todo el equipo.
    if (env.NODE_ENV === 'production' && !env.PANEL_API_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PANEL_API_SECRET'],
        message: 'obligatoria en producción (límite de login por cliente)',
      });
    }
    // Sin él, todos los clientes finales comparten el contador del canje.
    if (env.NODE_ENV === 'production' && !env.DIAGNOSTIC_API_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['DIAGNOSTIC_API_SECRET'],
        message: 'obligatoria en producción (límite del canje por cliente)',
      });
    }
    // Con el mismo secreto, filtrar el de una app expondría a la otra.
    if (
      env.DIAGNOSTIC_API_SECRET &&
      env.DIAGNOSTIC_API_SECRET === env.PANEL_API_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DIAGNOSTIC_API_SECRET'],
        message: 'debe ser distinto de PANEL_API_SECRET',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['APP_ENV', 'SCORING_ENGINE_DRIVER'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'obligatoria con NODE_ENV=production',
          });
        }
      }
    }
    if (env.NODE_ENV === 'production' && !env.CRM_PROVIDER) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRM_PROVIDER'],
        message: 'obligatoria con NODE_ENV=production',
      });
    }
    // Un fallo inventado nunca puede frenar los envíos reales.
    if (env.APP_ENV === 'production' && env.CRM_SIMULATED_FAILURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRM_SIMULATED_FAILURE'],
        message: 'no se admite con APP_ENV=production',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.STORAGE_DRIVER) {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'obligatoria con NODE_ENV=production',
        });
      }
      // En memoria, los audios se pierden en cada reinicio o despliegue.
      if (env.STORAGE_DRIVER === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: "en producción no admite 'memory' (se pierde al reiniciar)",
        });
      }
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of [
        'STORAGE_S3_ENDPOINT',
        'STORAGE_S3_BUCKET',
        'STORAGE_S3_ACCESS_KEY_ID',
        'STORAGE_S3_SECRET_ACCESS_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'obligatoria con STORAGE_DRIVER=s3',
          });
        }
      }
      // Las llaves y los audios no pueden viajar sin cifrar.
      if (
        env.NODE_ENV === 'production' &&
        env.STORAGE_S3_ENDPOINT &&
        !env.STORAGE_S3_ENDPOINT.startsWith('https://')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_S3_ENDPOINT'],
          message: 'en producción debe usar https',
        });
      }
    }
    if (env.NODE_ENV === 'production' && !env.AI_PROVIDER) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'obligatoria con NODE_ENV=production',
      });
    }
    const aiProviders = [
      ['AI_PROVIDER', env.AI_PROVIDER],
      ['AI_FLAGS_PROVIDER', env.AI_FLAGS_PROVIDER],
      ['AI_REPORT_PROVIDER', env.AI_REPORT_PROVIDER],
    ] as const;
    for (const [key, provider] of aiProviders) {
      // Una respuesta inventada nunca puede llegar a un caso real.
      if (env.APP_ENV === 'production' && provider === 'stub') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message:
            "con APP_ENV=production no admite 'stub' (respuestas de ejemplo)",
        });
      }
      if (provider === 'claude' && !env.ANTHROPIC_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['ANTHROPIC_API_KEY'],
          message: `obligatoria con ${key}=claude`,
        });
      }
    }
    // Un resultado simulado nunca puede llegar a un cliente real.
    if (env.APP_ENV === 'production' && env.SCORING_ENGINE_DRIVER === 'stub') {
      ctx.addIssue({
        code: 'custom',
        path: ['SCORING_ENGINE_DRIVER'],
        message:
          "con APP_ENV=production no admite 'stub' (el resultado es simulado)",
      });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_DRIVER !== 'resend') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: "en producción debe ser 'resend' ('log' no envía correos)",
      });
    }
    if (env.MAIL_DRIVER === 'resend') {
      for (const key of [
        'RESEND_API_KEY',
        'MAIL_FROM',
        'MAIL_REPLY_TO',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'obligatoria con MAIL_DRIVER=resend',
          });
        }
      }
    }
  });

export type ValidatedEnv = z.infer<typeof EnvSchema>;

export function validateEnv(env: Record<string, unknown>): ValidatedEnv {
  const result = EnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(
      `Variables de entorno inválidas:\n${result.error.issues
        .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }

  return result.data;
}
