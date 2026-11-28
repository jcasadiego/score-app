import { CrmSyncErrorCode } from '../../../generated/prisma/enums';
import { FAMILY_LABEL } from '../../mail/templates/emails';
import {
  CrmAdapter,
  CrmAdapterError,
  CrmContact,
  CrmStatusUpdate,
} from '../crm.port';

/**
 * API de Funnel Up (HighLevel con otra marca). Fija en el código: nunca sale
 * de datos ni de la configuración. Documentación:
 * https://marketplace.gohighlevel.com/docs/
 */
export const FUNNELUP_BASE_URL = 'https://services.leadconnectorhq.com';
/** Versión de la API (encabezado `Version`) de los endpoints que se usan. */
export const FUNNELUP_API_VERSION = 'v3';
/** Tiempo de espera de cada llamada: dos caben holgadas en la transacción de envío. */
export const FUNNELUP_TIMEOUT_MS = 10_000;
/** Espera ante un 429 si la respuesta no trae los encabezados de límite. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 10_000;
/** Lo que guarda SCORE como `source` del contacto. */
const CONTACT_SOURCE = 'SCORE';

/**
 * Campos personalizados del contacto que escribe SCORE, por su clave. Los crea
 * el equipo de Music Finance Pro en la subcuenta; `pnpm crm:check` comprueba
 * que existen con el tipo y las opciones que se esperan.
 */
export const FUNNELUP_FIELDS = {
  status: 'contact.estado_score',
  family: 'contact.familia_score',
  utmSource: 'contact.utm_source',
  utmMedium: 'contact.utm_medium',
  utmCampaign: 'contact.utm_campaign',
} as const;

export interface FunnelUpOptions {
  token: string;
  locationId: string;
  /** Etiqueta que se suma a todo contacto (p. ej. `score-qa` en QA). */
  extraTag?: string;
  /** Para los tests. */
  fetch?: typeof fetch;
}

interface CustomFieldValue {
  key: string;
  fieldValue: string;
}

/**
 * Adaptador real del CRM (PF-82), sin SDK. Crea o actualiza el contacto por
 * correo (`POST /contacts/upsert`), escribe "Estado SCORE" y suma etiquetas
 * con su propio endpoint: el arreglo `tags` del upsert reemplaza todas las
 * del contacto y borraría las del equipo comercial. Sin reintentos propios:
 * los hace la bandeja. Nunca guarda ni registra el cuerpo de una respuesta
 * de error ni el token.
 */
export class FunnelUpCrmAdapter implements CrmAdapter {
  readonly name = 'funnelup' as const;
  readonly simulated = false;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FunnelUpOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  async upsertContact(
    contact: CrmContact,
    update: CrmStatusUpdate,
  ): Promise<{ contactId: string }> {
    const { firstName, lastName } = splitName(contact.name);
    const customFields: CustomFieldValue[] = [
      { key: FUNNELUP_FIELDS.status, fieldValue: update.status },
      { key: FUNNELUP_FIELDS.family, fieldValue: FAMILY_LABEL[contact.family] },
    ];
    // Un UTM vacío no borra el que ya tenga el contacto.
    for (const [field, value] of [
      [FUNNELUP_FIELDS.utmSource, contact.utmSource],
      [FUNNELUP_FIELDS.utmMedium, contact.utmMedium],
      [FUNNELUP_FIELDS.utmCampaign, contact.utmCampaign],
    ] as const) {
      if (value) customFields.push({ key: field, fieldValue: value });
    }

    const body = await this.request('POST', '/contacts/upsert', {
      locationId: this.options.locationId,
      firstName,
      ...(lastName && { lastName }),
      email: contact.email,
      ...(contact.phone && { phone: contact.phone }),
      source: CONTACT_SOURCE,
      customFields,
    });
    const contactId = (body as { contact?: { id?: unknown } } | null)?.contact
      ?.id;
    if (typeof contactId !== 'string' || contactId.length === 0) {
      throw new CrmAdapterError(CrmSyncErrorCode.PROVIDER_ERROR);
    }
    await this.addTags(contactId, update.tags);
    return { contactId };
  }

  async updateStatus(contactId: string, update: CrmStatusUpdate) {
    await this.request('PUT', `/contacts/${contactPath(contactId)}`, {
      customFields: [
        { key: FUNNELUP_FIELDS.status, fieldValue: update.status },
      ] satisfies CustomFieldValue[],
    });
    await this.addTags(contactId, update.tags);
  }

  /** Suma etiquetas sin tocar las que ya tiene el contacto. */
  private async addTags(contactId: string, tags: readonly string[]) {
    const all = this.options.extraTag
      ? [...tags, this.options.extraTag]
      : [...tags];
    if (all.length === 0) return;
    await this.request('POST', `/contacts/${contactPath(contactId)}/tags`, {
      tags: all,
    });
  }

  private async request(
    method: 'POST' | 'PUT',
    path: string,
    payload: object,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${FUNNELUP_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Version: FUNNELUP_API_VERSION,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(FUNNELUP_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new CrmAdapterError(
        timeout ? CrmSyncErrorCode.TIMEOUT : CrmSyncErrorCode.PROVIDER_ERROR,
      );
    }

    if (!response.ok) {
      // El cuerpo no se lee: puede repetir datos del lead.
      await response.body?.cancel().catch(() => undefined);
      throw errorFor(response);
    }
    try {
      return await response.json();
    } catch {
      throw new CrmAdapterError(
        CrmSyncErrorCode.PROVIDER_ERROR,
        response.status,
      );
    }
  }
}

/** El id va en la ruta: solo letras y números, como los que da Funnel Up. */
function contactPath(contactId: string): string {
  if (!/^[A-Za-z0-9]{1,100}$/.test(contactId)) {
    throw new CrmAdapterError(CrmSyncErrorCode.INVALID_DATA);
  }
  return contactId;
}

/** Nombre y apellido como los muestra el CRM: la primera palabra y el resto. */
export function splitName(name: string): {
  firstName: string;
  lastName?: string;
} {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return rest.length > 0
    ? { firstName, lastName: rest.join(' ') }
    : { firstName };
}

function errorFor(response: Response): CrmAdapterError {
  const { status } = response;
  if (status === 401 || status === 403) {
    return new CrmAdapterError(CrmSyncErrorCode.AUTH_FAILED, status);
  }
  if (status === 429) {
    return new CrmAdapterError(
      CrmSyncErrorCode.RATE_LIMITED,
      status,
      rateLimitWaitMs(response.headers),
    );
  }
  if (status === 408) {
    return new CrmAdapterError(CrmSyncErrorCode.TIMEOUT, status);
  }
  // Datos que el CRM rechaza (formato, contacto inexistente): reintentar
  // solo no lo arregla.
  if (status >= 400 && status < 500) {
    return new CrmAdapterError(CrmSyncErrorCode.INVALID_DATA, status);
  }
  return new CrmAdapterError(CrmSyncErrorCode.PROVIDER_ERROR, status);
}

/**
 * El 429 de Funnel Up no trae `Retry-After`: se espera al reinicio del cupo
 * diario si se agotó o, si no, a la ventana de ráfaga.
 */
export function rateLimitWaitMs(headers: Headers): number {
  const number = (name: string) => {
    const value = Number(headers.get(name));
    return headers.has(name) && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  };
  const dailyReset = number('x-ratelimit-daily-reset');
  if (number('x-ratelimit-daily-remaining') === 0 && dailyReset !== undefined) {
    return dailyReset;
  }
  return (
    number('x-ratelimit-interval-milliseconds') ?? DEFAULT_RATE_LIMIT_WAIT_MS
  );
}
