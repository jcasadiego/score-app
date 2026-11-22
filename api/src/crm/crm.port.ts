import type {
  CrmSyncErrorCode,
  DiagnosticFamily,
} from '../../generated/prisma/enums';

/** Proveedores de CRM disponibles. El real (Funnel Up) llega con PF-82. */
export const CRM_PROVIDERS = ['simulated'] as const;
export type CrmProviderName = (typeof CRM_PROVIDERS)[number];

/**
 * Lo único que sale de SCORE hacia el CRM: contacto, familia y origen de
 * campaña. Nunca respuestas, resultados, puntajes, el informe ni su enlace.
 */
export interface CrmContact {
  name: string;
  email: string;
  phone: string | null;
  family: DiagnosticFamily;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

/** El estado SCORE del contacto: el valor del campo y las etiquetas a sumar. */
export interface CrmStatusUpdate {
  status: string;
  /** Se agregan; nunca se quitan las que puso el equipo comercial. */
  tags: readonly string[];
}

/**
 * Un fallo del proveedor ya clasificado. Nunca lleva el token ni la respuesta
 * del proveedor (puede traer datos del lead): solo el código y el estado HTTP.
 */
export class CrmAdapterError extends Error {
  constructor(
    readonly code: CrmSyncErrorCode,
    readonly httpStatus?: number,
    /** Cuánto pide esperar el proveedor antes de reintentar (429). */
    readonly retryAfterMs?: number,
  ) {
    super(`Falló el envío al CRM: ${code}`);
    this.name = 'CrmAdapterError';
  }
}

/**
 * Límite entre la API y un CRM. Agregar un proveedor es escribir un adapter
 * nuevo; la bandeja de salida y los eventos no cambian. Las dos operaciones
 * se pueden repetir sin duplicar efectos.
 */
export interface CrmAdapter {
  readonly name: CrmProviderName;
  /** `true` si no llama a nada externo: los datos no salen de SCORE. */
  readonly simulated: boolean;
  /** Crea el contacto o actualiza el que ya tenga ese correo. */
  upsertContact(
    contact: CrmContact,
    update: CrmStatusUpdate,
  ): Promise<{ contactId: string }>;
  /** Actualiza el estado SCORE y suma etiquetas a un contacto existente. */
  updateStatus(contactId: string, update: CrmStatusUpdate): Promise<void>;
}
