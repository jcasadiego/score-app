import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VALIDATION_FAILED_CODE } from '../common/problem-details';
import type { ValidatedEnv } from '../config/validate-env';
import {
  HIBP_TIMEOUT_MS,
  isCommonPassword,
  PWNED_PASSWORDS_URL,
  pwnedPasswordsHash,
  suffixInRange,
} from './breached-passwords';

export const PASSWORD_BREACHED_CODE = 'PASSWORD_BREACHED';
export const PASSWORD_BREACHED_MESSAGE =
  'Esta contraseña aparece en filtraciones conocidas. Elige otra.';

/**
 * Rechaza contraseñas filtradas al fijarlas (PF-60). La longitud ya la valida
 * el DTO; aquí no hay reglas de composición, a propósito (NIST SP 800-63B).
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);

  constructor(private readonly config: ConfigService<ValidatedEnv, true>) {}

  /** 400 con `errors[].field = password` si la contraseña está filtrada. */
  async assertNotBreached(password: string): Promise<void> {
    if (isCommonPassword(password) || (await this.isPwned(password))) {
      throw new BadRequestException({
        message: [PASSWORD_BREACHED_MESSAGE],
        code: VALIDATION_FAILED_CODE,
        errors: [
          {
            field: 'password',
            code: PASSWORD_BREACHED_CODE,
            message: PASSWORD_BREACHED_MESSAGE,
          },
        ],
      });
    }
  }

  /** Consulta Pwned Passwords con k-anonimato. Ante cualquier fallo, false. */
  private async isPwned(password: string): Promise<boolean> {
    if (
      this.config.get('BREACHED_PASSWORDS_PROVIDER', { infer: true }) !== 'hibp'
    ) {
      return false;
    }
    const { prefix, suffix } = pwnedPasswordsHash(password);
    try {
      const response = await fetch(`${PWNED_PASSWORDS_URL}${prefix}`, {
        // Relleno: todas las respuestas pesan parecido y no delatan el prefijo.
        headers: { 'Add-Padding': 'true', 'User-Agent': 'score-api' },
        signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) {
        this.logger.warn(
          `Pwned Passwords respondió ${response.status}: se usa solo la lista local`,
        );
        return false;
      }
      return suffixInRange(await response.text(), suffix);
    } catch (error) {
      // Sin el prefijo ni la contraseña en el log.
      this.logger.warn(
        `Pwned Passwords no respondió (${error instanceof Error ? error.name : 'error'}): se usa solo la lista local`,
      );
      return false;
    }
  }
}
