import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { CrmSyncErrorCode } from '../../../generated/prisma/enums';
import {
  CrmAdapter,
  CrmAdapterError,
  CrmContact,
  CrmStatusUpdate,
} from '../crm.port';

/**
 * CRM de mentira (PF-80): no llama a nada externo. Devuelve un id de contacto
 * estable por correo y, si se configura, falla siempre con el código dado para
 * probar los reintentos. El log no lleva datos personales.
 */
export class SimulatedCrmAdapter implements CrmAdapter {
  readonly name = 'simulated' as const;
  readonly simulated = true;
  private readonly logger = new Logger(SimulatedCrmAdapter.name);

  constructor(private readonly forcedFailure?: CrmSyncErrorCode) {}

  upsertContact(
    contact: CrmContact,
    update: CrmStatusUpdate,
  ): Promise<{ contactId: string }> {
    this.failIfForced();
    // Estable por correo (como buscar por correo en el CRM real), sin exponerlo.
    const contactId = `sim_${createHash('sha256')
      .update(contact.email.trim().toLowerCase())
      .digest('hex')
      .slice(0, 24)}`;
    this.logger.log(
      `CRM simulado: contacto ${contactId} creado o actualizado (estado ${update.status})`,
    );
    return Promise.resolve({ contactId });
  }

  updateStatus(contactId: string, update: CrmStatusUpdate): Promise<void> {
    this.failIfForced();
    this.logger.log(
      `CRM simulado: contacto ${contactId} pasa a ${update.status}`,
    );
    return Promise.resolve();
  }

  private failIfForced() {
    if (this.forcedFailure) {
      throw new CrmAdapterError(
        this.forcedFailure,
        FORCED_HTTP_STATUS[this.forcedFailure],
      );
    }
  }
}

/** El estado HTTP con que respondería un CRM real a cada fallo. */
const FORCED_HTTP_STATUS: Record<CrmSyncErrorCode, number | undefined> = {
  TIMEOUT: undefined,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 503,
  INVALID_DATA: 422,
  AUTH_FAILED: 401,
};
