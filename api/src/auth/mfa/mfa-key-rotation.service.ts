import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AuditActorType } from '../../../generated/prisma/enums';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  currentMfaPrefix,
  decryptMfaSecret,
  encryptMfaSecret,
} from './secret-cipher';

const BATCH_SIZE = 100;

export interface MfaReencryptionResult {
  reencrypted: number;
  failed: number;
}

/**
 * Rotación de `MFA_ENCRYPTION_KEY` (PF-57). Al arrancar, recifra con la llave
 * actual los secretos que siguen con una anterior (`MFA_ENCRYPTION_PREVIOUS_KEYS`)
 * o en el formato v1. Así rotar es: poner la llave nueva, pasar la vieja a las
 * anteriores, desplegar, y quitarla cuando el log diga que no queda ninguno.
 *
 * Es idempotente y seguro con varias instancias: cada fila se actualiza solo si
 * su valor no cambió desde que se leyó, así nunca pisa un MFA recién configurado.
 */
@Injectable()
export class MfaKeyRotationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MfaKeyRotationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Se espera (son pocas filas) para no dejar trabajo vivo tras cerrar la app,
    // pero un fallo nunca impide arrancar.
    try {
      await this.reencryptAll();
    } catch (error) {
      this.logger.error(
        'No se pudieron recifrar los secretos MFA',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async reencryptAll(): Promise<MfaReencryptionResult> {
    const prefix = currentMfaPrefix();
    const result: MfaReencryptionResult = { reencrypted: 0, failed: 0 };
    let cursor: string | undefined;

    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          mfaSecret: { not: null },
          NOT: { mfaSecret: { startsWith: prefix } },
        },
        select: { id: true, mfaSecret: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      for (const { id, mfaSecret } of users) {
        let reencrypted: string;
        try {
          reencrypted = encryptMfaSecret(
            decryptMfaSecret(mfaSecret as string, id),
            id,
          );
        } catch {
          // Llave desconocida o dato alterado: queda como está y ese usuario
          // tendrá que restablecer su MFA. Nunca se borra solo.
          result.failed += 1;
          continue;
        }
        const { count } = await this.prisma.user.updateMany({
          where: { id, mfaSecret },
          data: { mfaSecret: reencrypted },
        });
        result.reencrypted += count;
      }
    }

    if (result.reencrypted > 0 || result.failed > 0) {
      await this.audit.record({
        actorType: AuditActorType.SYSTEM,
        action: 'MFA_SECRETS_REENCRYPTED',
        entity: 'User',
        data: { ...result },
      });
    }
    if (result.reencrypted > 0) {
      this.logger.log(
        `Secretos MFA recifrados con la llave actual: ${result.reencrypted}`,
      );
    }
    if (result.failed > 0) {
      this.logger.error(
        `Secretos MFA que no se pudieron descifrar con ninguna llave: ${result.failed}. Esos usuarios deben restablecer su MFA`,
      );
    }
    return result;
  }
}
