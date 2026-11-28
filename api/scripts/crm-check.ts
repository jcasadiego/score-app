/**
 * Prueba de conexión con Funnel Up (`pnpm crm:check`, PF-82). Con
 * `CRM_FUNNELUP_TOKEN` y `CRM_FUNNELUP_LOCATION_ID` de `.env` comprueba, solo
 * con lecturas, que el token sirve, que es de esa subcuenta, que existen los
 * campos que escribe SCORE con su tipo y opciones, y que el token no tiene
 * permisos de más. No crea ni cambia nada en el CRM, no necesita Postgres y
 * nunca imprime el token.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateEnv, type ValidatedEnv } from '../src/config/validate-env';
import {
  FUNNELUP_API_VERSION,
  FUNNELUP_BASE_URL,
  FUNNELUP_FIELDS,
  FUNNELUP_TIMEOUT_MS,
} from '../src/crm/adapters/funnelup-crm.adapter';
import { CRM_STATUS_BY_EVENT } from '../src/crm/crm.types';
import { FAMILY_LABEL } from '../src/mail/templates/emails';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
})
class CrmCheckModule {}

interface CustomField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  picklistOptions?: string[];
  model?: string;
}

function check(ok: boolean, label: string): boolean {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function main() {
  const app = await NestFactory.createApplicationContext(CrmCheckModule, {
    logger: ['error', 'warn'],
  });
  const config = app.get(ConfigService<ValidatedEnv, true>);
  const token = config.get('CRM_FUNNELUP_TOKEN', { infer: true });
  const locationId = config.get('CRM_FUNNELUP_LOCATION_ID', { infer: true });
  await app.close();

  if (
    !check(!!token, 'CRM_FUNNELUP_TOKEN definida') ||
    !check(!!locationId, 'CRM_FUNNELUP_LOCATION_ID definida')
  ) {
    return;
  }

  const get = async (path: string) => {
    const response = await fetch(`${FUNNELUP_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: FUNNELUP_API_VERSION,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(FUNNELUP_TIMEOUT_MS),
    });
    // El cuerpo de un error no se imprime: solo el estado.
    const body: unknown = response.ok ? await response.json() : null;
    if (!response.ok) await response.body?.cancel().catch(() => undefined);
    return { status: response.status, body };
  };

  console.log(`API ${FUNNELUP_BASE_URL} · versión ${FUNNELUP_API_VERSION}`);

  const location = await get(`/locations/${locationId}`);
  const reason =
    location.status === 401
      ? ' — token inválido, vencido o rotado'
      : location.status === 403
        ? ' — el token no es de esta subcuenta o le falta locations.readonly'
        : '';
  const locationBody = location.body as {
    location?: { id?: string; name?: string };
  } | null;
  if (
    !check(
      location.status === 200 && locationBody?.location?.id === locationId,
      `Token y subcuenta (HTTP ${location.status})${reason}`,
    )
  ) {
    return;
  }
  console.log(`  Subcuenta: ${locationBody?.location?.name ?? '(sin nombre)'}`);

  const fields = await get(
    `/locations/${locationId}/customFields?model=contact`,
  );
  if (
    !check(
      fields.status === 200,
      `Lectura de campos personalizados (HTTP ${fields.status})` +
        (fields.status === 403
          ? ' — falta locations/customFields.readonly'
          : ''),
    )
  ) {
    return;
  }
  const all =
    (fields.body as { customFields?: CustomField[] } | null)?.customFields ??
    [];
  const byKey = new Map(all.map((field) => [field.fieldKey, field]));

  const expectOptions = (
    key: string,
    label: string,
    required: readonly string[],
  ) => {
    const field = byKey.get(key);
    if (!check(!!field, `Campo "${label}" (${key})`)) return;
    console.log(`  id ${field!.id} · tipo ${field!.dataType}`);
    const options = new Set(field!.picklistOptions ?? []);
    const missing = required.filter((option) => !options.has(option));
    check(
      field!.dataType === 'SINGLE_OPTIONS' && missing.length === 0,
      `  Lista de una opción con ${required.join(', ')}` +
        (missing.length > 0 ? ` — faltan: ${missing.join(', ')}` : ''),
    );
  };
  expectOptions(FUNNELUP_FIELDS.status, 'Estado SCORE', [
    ...new Set(Object.values(CRM_STATUS_BY_EVENT).map((u) => u.status)),
  ]);
  expectOptions(
    FUNNELUP_FIELDS.family,
    'Familia SCORE',
    Object.values(FAMILY_LABEL),
  );
  for (const [key, label] of [
    [FUNNELUP_FIELDS.utmSource, 'UTM Source'],
    [FUNNELUP_FIELDS.utmMedium, 'UTM Medium'],
    [FUNNELUP_FIELDS.utmCampaign, 'UTM Campaign'],
  ] as const) {
    const field = byKey.get(key);
    if (check(!!field, `Campo "${label}" (${key})`)) {
      check(
        field!.dataType === 'TEXT',
        `  Texto de una línea (tipo ${field!.dataType})`,
      );
    }
  }

  // Mínimo privilegio: el token no debería poder leer calendarios ni usuarios.
  for (const [path, scope] of [
    [`/calendars/?locationId=${locationId}`, 'calendars.readonly'],
    [`/users/?locationId=${locationId}`, 'users.readonly'],
  ] as const) {
    const { status } = await get(path);
    check(
      status === 401 || status === 403,
      `Sin permiso ${scope} (HTTP ${status})` +
        (status === 200 ? ' — el token tiene permisos de más: quítalo' : ''),
    );
  }
}

main().catch((error: unknown) => {
  // Solo el nombre del error: el mensaje podría traer la URL o encabezados.
  console.error(
    `✘ La prueba no terminó: ${error instanceof Error ? error.name : typeof error}`,
  );
  process.exitCode = 1;
});
