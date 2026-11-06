import { createHash, randomInt } from 'node:crypto';
import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AuditActorType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { SecurityNoticeEvent } from '../mail/templates/emails';
import { PasswordLinkService } from '../password-reset/password-link.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService, UserWithLinkSent } from '../users/users.service';
import { AuthService, LoginUser } from './auth.service';
import { decryptMfaSecret, encryptMfaSecret } from './mfa/secret-cipher';
import {
  findTotpStep,
  generateTotpSecret,
  toBase32,
  totpUri,
} from './mfa/totp';

/** Un token emitido para otra cosa no sirve aquí, aunque la firma coincida. */
const CHALLENGE_AUDIENCE = 'mfa-challenge';
const CHALLENGE_TTL = '5m';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const INVALID_CODE = {
  message: 'El código no es válido.',
  code: 'INVALID_MFA_CODE',
};
const EXPIRED_CHALLENGE = {
  message: 'Pasó demasiado tiempo. Vuelve a iniciar sesión.',
  code: 'MFA_CHALLENGE_EXPIRED',
};

export type MfaStatus = 'CHALLENGE_REQUIRED' | 'ENROLLMENT_REQUIRED';

function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

/** 16 caracteres de un alfabeto de 32: 80 bits, en grupos fáciles de copiar. */
function generateRecoveryCode(): string {
  const chars = Array.from(
    { length: 16 },
    () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)],
  );
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Segundo factor del panel (TOTP, RFC 6238), obligatorio para todos. Tras la
 * contraseña se emite un token de corta vida que no abre sesión y solo sirve para
 * configurar el autenticador o presentar un código. La sesión la abre
 * `AuthService.completeLogin`, y solo cuando este servicio devolvió al usuario.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => AuthService)) private readonly auth: AuthService,
    private readonly passwordLinks: PasswordLinkService,
  ) {}

  async issueChallenge(user: {
    id: string;
    sessionVersion: number;
    mfaEnabledAt: Date | null;
  }): Promise<{ mfaToken: string; mfaStatus: MfaStatus }> {
    const mfaToken = await this.jwt.signAsync(
      { sub: user.id, ver: user.sessionVersion },
      {
        secret: process.env.JWT_SECRET,
        audience: CHALLENGE_AUDIENCE,
        expiresIn: CHALLENGE_TTL,
      } as JwtSignOptions,
    );
    return {
      mfaToken,
      mfaStatus: user.mfaEnabledAt
        ? 'CHALLENGE_REQUIRED'
        : 'ENROLLMENT_REQUIRED',
    };
  }

  /**
   * Reemplaza un secreto aún sin confirmar. Una cuenta con MFA activo no pasa por
   * aquí: si no, la contraseña sola bastaría para cambiar el segundo factor.
   */
  async startEnrollment(mfaToken: string) {
    const user = await this.userFromChallenge(mfaToken);
    if (user.mfaEnabledAt) {
      throw new ConflictException(
        'La verificación en dos pasos ya está activa.',
      );
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: encryptMfaSecret(secret, user.id) },
    });
    return {
      secret: toBase32(secret),
      otpauthUri: totpUri(secret, user.email),
    };
  }

  async confirmEnrollment(mfaToken: string, code: string) {
    const user = await this.userFromChallenge(mfaToken);
    if (user.mfaEnabledAt) {
      throw new ConflictException(
        'La verificación en dos pasos ya está activa.',
      );
    }
    if (!user.mfaSecret) {
      await this.rejectCode(user.id);
    }

    const secret = decryptMfaSecret(user.mfaSecret as string, user.id);
    const step = findTotpStep(secret, code);
    if (step === null) {
      await this.rejectCode(user.id);
    }

    const recoveryCodes = Array.from(
      { length: RECOVERY_CODE_COUNT },
      generateRecoveryCode,
    );
    await this.prisma.$transaction(async (tx) => {
      // Solo si sigue sin activar y con el secreto que se comprobó: de dos
      // confirmaciones gana una, y nadie activa un secreto cambiado en el medio.
      const { count } = await tx.user.updateMany({
        where: { id: user.id, mfaEnabledAt: null, mfaSecret: user.mfaSecret },
        data: { mfaEnabledAt: new Date(), mfaLastUsedStep: step },
      });
      if (count === 0) {
        throw new ConflictException(
          'La verificación en dos pasos ya está activa.',
        );
      }
      await tx.userRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.userRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          userId: user.id,
          codeHash: hashRecoveryCode(recoveryCode),
        })),
      });
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: user.id,
          action: 'MFA_ENROLLED',
          entity: 'User',
          entityId: user.id,
        },
        tx,
      );
    });

    this.notify(user, 'MFA_ENROLLED');
    return { user: user as LoginUser, recoveryCodes };
  }

  async verifyCode(mfaToken: string, code: string): Promise<LoginUser> {
    const user = await this.userFromChallenge(mfaToken);
    if (!user.mfaEnabledAt || !user.mfaSecret) {
      await this.rejectCode(user.id);
    }

    const secret = decryptMfaSecret(user.mfaSecret as string, user.id);
    const step = findTotpStep(secret, code);
    if (step === null) {
      await this.rejectCode(user.id);
    }

    // En una sola consulta: de dos peticiones con el mismo código, gana una.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [
          { mfaLastUsedStep: null },
          { mfaLastUsedStep: { lt: step as number } },
        ],
      },
      data: { mfaLastUsedStep: step },
    });
    if (count === 0) {
      await this.rejectCode(user.id);
    }
    return user;
  }

  async verifyRecoveryCode(
    mfaToken: string,
    recoveryCode: string,
  ): Promise<LoginUser> {
    const user = await this.userFromChallenge(mfaToken);

    const used = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userRecoveryCode.updateMany({
        where: {
          userId: user.id,
          codeHash: hashRecoveryCode(recoveryCode),
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      if (count === 0) return false;
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: user.id,
          action: 'MFA_RECOVERY_CODE_USED',
          entity: 'User',
          entityId: user.id,
        },
        tx,
      );
      return true;
    });
    if (!used) {
      await this.rejectCode(user.id);
    }

    this.notify(user, 'MFA_RECOVERY_CODE_USED');
    return user;
  }

  /**
   * Quita el segundo factor de otra cuenta y le cierra todo: sesiones abiertas y
   * retos en curso (`sessionVersion`). Lo configurará en su próximo acceso.
   */
  async reset(id: string, requesterId: string): Promise<UserWithLinkSent> {
    if (id === requesterId) {
      throw new ConflictException(
        'Otro Aprobador debe restablecer tu verificación en dos pasos.',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!target) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }

    // También invalida la contraseña (PF-59): si no, quien la conociera podría
    // configurar su propio autenticador antes que el dueño. Este, con el enlace
    // del correo, define una nueva y vuelve a configurar el MFA.
    const token = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          mfaSecret: null,
          mfaEnabledAt: null,
          mfaLastUsedStep: null,
          recoveryCodes: { deleteMany: {} },
        },
      });
      // Sube `sessionVersion` y cierra las sesiones: corta también los retos.
      const token = await this.passwordLinks.revokePassword(tx, id);
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: requesterId,
          action: 'MFA_RESET',
          entity: 'User',
          entityId: id,
        },
        tx,
      );
      return token;
    });

    const linkSent = await this.passwordLinks.send(
      target,
      token,
      'MFA_RESET',
      requesterId,
    );
    return { ...(await this.users.findOne(id)), linkSent };
  }

  private async userFromChallenge(mfaToken: string) {
    let payload: { sub: string; ver: number };
    try {
      payload = await this.jwt.verifyAsync(mfaToken, {
        secret: process.env.JWT_SECRET,
        algorithms: ['HS256'],
        audience: CHALLENGE_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException(EXPIRED_CHALLENGE);
    }

    const user = await this.users.findById(payload.sub);
    // Cambiar la contraseña o desactivar la cuenta invalida el reto en curso.
    if (!user || !user.active || user.sessionVersion !== payload.ver) {
      throw new UnauthorizedException(EXPIRED_CHALLENGE);
    }
    // Mismo mensaje que un código incorrecto: no confirma que el bloqueo existe.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    return user;
  }

  /** Cada código incorrecto cuenta para el mismo bloqueo que la contraseña. */
  private async rejectCode(userId: string): Promise<never> {
    await this.auth.recordFailedAttempt(userId);
    throw new UnauthorizedException(INVALID_CODE);
  }

  /** `MailService` no lanza; el correo nunca frena el acceso. */
  private notify(
    user: { id: string; name: string; email: string },
    event: SecurityNoticeEvent,
  ): void {
    void this.mail
      .sendSecurityNotice(
        user.email,
        { name: user.name, event },
        { entity: 'User', entityId: user.id },
      )
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo enviar el aviso de seguridad',
          error instanceof Error ? error.stack : undefined,
        ),
      );
  }
}
