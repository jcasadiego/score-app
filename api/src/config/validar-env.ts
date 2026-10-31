import { z } from 'zod';

/** Vacío en `.env` (`VAR=""`) cuenta como no definido. */
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), esquema.optional());

/**
 * Se valida `process.env` completo al boot para fallar rápido y con un
 * mensaje claro si falta una variable, en vez de un error opaco más
 * adelante (ej. un JWT_SECRET undefined que rompe silenciosamente la
 * firma de tokens).
 */
const EsquemaEnv = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGINS: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
    JWT_EXPIRACION: z.string().default('1d'),
    ENLACE_JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
    ENLACE_JWT_EXPIRACION: z.string().default('24h'),
    THROTTLE_TTL: z.coerce.number().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().default(100),
    // `log` no envía nada real (desarrollo); `resend` envía de verdad.
    CORREO_MODO: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: opcional(z.string()),
    CORREO_REMITENTE: opcional(z.string()),
    CORREO_REPLY_TO: opcional(z.email()),
    CORREO_LOGO_URL: opcional(z.url()),
  })
  .superRefine((env, ctx) => {
    // Fuera de desarrollo, un correo que no sale debe impedir el arranque,
    // no descubrirse cuando un cliente reclama que no le llegó el enlace.
    if (env.NODE_ENV === 'production' && env.CORREO_MODO !== 'resend') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORREO_MODO'],
        message: "en producción debe ser 'resend' ('log' no envía correos)",
      });
    }
    if (env.CORREO_MODO === 'resend') {
      for (const clave of [
        'RESEND_API_KEY',
        'CORREO_REMITENTE',
        'CORREO_REPLY_TO',
      ] as const) {
        if (!env[clave]) {
          ctx.addIssue({
            code: 'custom',
            path: [clave],
            message: 'obligatoria con CORREO_MODO=resend',
          });
        }
      }
    }
  });

export type EnvValidado = z.infer<typeof EsquemaEnv>;

export function validarEnv(env: Record<string, unknown>): EnvValidado {
  const resultado = EsquemaEnv.safeParse(env);

  if (!resultado.success) {
    throw new Error(
      `Variables de entorno inválidas:\n${resultado.error.issues
        .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }

  return resultado.data;
}
