import { z } from 'zod';

/**
 * Se valida `process.env` completo al boot para fallar rápido y con un
 * mensaje claro si falta una variable, en vez de un error opaco más
 * adelante (ej. un JWT_SECRET undefined que rompe silenciosamente la
 * firma de tokens).
 */
const EsquemaEnv = z.object({
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
