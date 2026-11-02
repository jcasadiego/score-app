import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from './validate-env';

const DEV_PANEL_URL = 'http://localhost:3002';

/** URL absoluta a una pantalla de `apps/panel`, para los enlaces por correo. */
export function panelLink(
  config: ConfigService<ValidatedEnv, true>,
  path: string,
): URL {
  return new URL(
    path,
    config.get('PANEL_URL', { infer: true }) ?? DEV_PANEL_URL,
  );
}
