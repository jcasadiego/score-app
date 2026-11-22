import { randomBytes } from 'node:crypto';
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
 * aleatorio y, si se configura, falla siempre con el código dado para
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
    // Aleatorio: un hash del correo sería un seudónimo que se puede vincular
    // al lead. El procesador lo guarda en el lead tras el primer envío.
    const contactId = `sim_${randomBytes(12).toString('hex')}`;
    // Sin el id de contacto: el log solo dice qué estado habría salido.
    this.logger.log(
      `CRM simulado: contacto creado o actualizado (estado ${update.status})`,
    );
    return Promise.resolve({ contactId });
  }

  updateStatus(contactId: string, update: CrmStatusUpdate): Promise<void> {
    this.failIfForced();
    this.logger.log(`CRM simulado: contacto pasa a ${update.status}`);
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
