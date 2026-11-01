import { z } from 'zod';

/** Vacío en `.env` (`VAR=""`) cuenta como no definido. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * Se valida `process.env` completo al boot para fallar rápido y con un
 * mensaje claro si falta una variable, en vez de un error opaco más
 * adelante (ej. un JWT_SECRET undefined que rompe silenciosamente la
 * firma de tokens).
 */
const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
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
    ACCESS_LINK_JWT_SECRET: z
      .string()
      .min(32, 'debe tener al menos 32 caracteres'),
    ACCESS_LINK_JWT_EXPIRES_IN: z.string().default('24h'),
    THROTTLE_TTL: z.coerce.number().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().default(100),
    // Con este secreto, el panel informa la IP real de quien inicia sesión.
    PANEL_API_SECRET: optional(
      z.string().min(32, 'debe tener al menos 32 caracteres'),
    ),
    // Base de los enlaces del panel que salen por correo (recuperación).
    PANEL_URL: optional(z.url()),
    // `log` no envía nada real (desarrollo); `resend` envía de verdad.
    MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: optional(z.string()),
    MAIL_FROM: optional(z.string()),
    MAIL_REPLY_TO: optional(z.email()),
    MAIL_LOGO_URL: optional(z.url()),
  })
  .superRefine((env, ctx) => {
    // Fuera de desarrollo, un correo que no sale debe impedir el arranque,
    // no descubrirse cuando un cliente reclama que no le llegó el enlace.
    if (env.NODE_ENV === 'production' && !env.PANEL_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['PANEL_URL'],
        message: 'obligatoria en producción (va en los enlaces por correo)',
      });
    }
    // Sin él, un solo contador de login para todo el equipo.
    if (env.NODE_ENV === 'production' && !env.PANEL_API_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PANEL_API_SECRET'],
        message: 'obligatoria en producción (límite de login por cliente)',
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
