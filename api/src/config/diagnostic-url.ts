import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from './validate-env';

const DEV_DIAGNOSTIC_URL = 'http://localhost:3001';

/** URL absoluta a una pantalla de `apps/diagnostico`, para los enlaces por correo. */
export function diagnosticLink(
  config: ConfigService<ValidatedEnv, true>,
  path: string,
): URL {
  return new URL(
    path,
    config.get('DIAGNOSTIC_URL', { infer: true }) ?? DEV_DIAGNOSTIC_URL,
  );
}
