import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AuditActorType, UserRole } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import {
  newLinkToken,
  PasswordLinkService,
  SETUP_LINK_TTL_MS,
  unusablePasswordHash,
} from '../password-reset/password-link.service';
import { PrismaService } from '../prisma/prisma.service';

/** Intentos fallidos seguidos antes de bloquear la cuenta, y por cuánto tiempo. */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  active: true,
  role: true,
  mfaEnabledAt: true,
  passwordSetAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * Deja sin valor los enlaces de recuperación pendientes. Va junto a cada acción
 * que le quita el acceso a quien pudo pedirlos: si no, un enlace ya enviado
 * seguiría sirviendo para tomar la cuenta durante su hora de vigencia.
 */
const REVOKE_RESET_LINKS = {
  passwordResetTokens: { deleteMany: { usedAt: null } },
} satisfies Prisma.UserUpdateInput;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof PUBLIC_SELECT;
}>;

interface CreateUserParams {
  name: string;
  email: string;
  role: UserRole;
}

/** El usuario y si salió el correo con su enlace (si no, el panel lo avisa). */
export type UserWithLinkSent = PublicUser & { linkSent: boolean };

interface ListUsersParams {
  page: number;
  pageSize: number;
  search?: string;
}

export interface UsersPage {
  data: PublicUser[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Sin `password` a propósito (PF-59): nadie define ni cambia la contraseña de
 * otra persona. Para eso está `resetPassword`, que le manda un enlace a su dueño.
 */
interface UpdateUserParams {
  name?: string;
  email?: string;
  role?: UserRole;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwordLinks: PasswordLinkService,
  ) {}

  /** Correos de quienes reciben los avisos al equipo. */
  async findActiveEmails(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { active: true },
      select: { email: true },
    });
    return users.map((user) => user.email);
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Suma un intento fallido y bloquea al llegar al máximo. Devuelve si bloqueó.
   * El contador se reinicia para que, al vencer el bloqueo, haya otra tanda de
   * intentos en vez de un bloqueo permanente que cualquiera podría provocar.
   */
  async registerFailedLogin(id: string): Promise<boolean> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts < MAX_FAILED_LOGINS) return false;

    await this.prisma.user.update({
      where: { id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS),
      },
    });
    return true;
  }

  async clearFailedLogins(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  /**
   * La cuenta nace sin contraseña usable: su dueño la define con el enlace que
   * le llega por correo, así que quien la crea no puede entrar con ella ni
   * configurar su MFA (PF-59).
   */
  async create(
    { name, email, role }: CreateUserParams,
    requesterId: string,
  ): Promise<UserWithLinkSent> {
    const passwordHash = await unusablePasswordHash();
    const { token, record } = newLinkToken(SETUP_LINK_TTL_MS);

    let user: PublicUser;
    try {
      user = await this.prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          passwordSetAt: null,
          role,
          passwordResetTokens: { create: record },
        },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw this.mapPrismaError(error, email);
    }

    const linkSent = await this.passwordLinks.send(
      user,
      token,
      'ACCOUNT_CREATED',
      requesterId,
    );
    return { ...user, linkSent };
  }

  /**
   * Invalida la contraseña de otra cuenta y le manda a su dueño un enlace para
   * definir una nueva; también sirve para reenviar el de activación. Nunca sobre
   * uno mismo: para eso está "¿Olvidaste tu contraseña?".
   */
  async resetPassword(
    id: string,
    requesterId: string,
  ): Promise<UserWithLinkSent> {
    if (id === requesterId) {
      throw new ConflictException(
        'Para cambiar tu contraseña, usa "¿Olvidaste tu contraseña?".',
      );
    }

    const { user, token } = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { active: true },
      });
      if (!target) {
        throw new NotFoundException(`Usuario ${id} no encontrado`);
      }
      // El enlace no le serviría: la confirmación rechaza cuentas desactivadas.
      if (!target.active) {
        throw new ConflictException('La cuenta está desactivada.');
      }
      const token = await this.passwordLinks.revokePassword(tx, id);
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: requesterId,
          action: 'PASSWORD_RESET_BY_APPROVER',
          entity: 'User',
          entityId: id,
        },
        tx,
      );
      const user = await tx.user.findUniqueOrThrow({
        where: { id },
        select: PUBLIC_SELECT,
      });
      return { user, token };
    });

    const linkSent = await this.passwordLinks.send(
      user,
      token,
      'PASSWORD_RESET_BY_APPROVER',
      requesterId,
    );
    return { ...user, linkSent };
  }

  /**
   * Página de usuarios + total en una sola transacción (dos queries, un
   * round trip lógico), con el filtro aplicado en la base y no en memoria.
   * `id` desempata el orden para que la paginación sea estable.
   */
  async list({ page, pageSize, search }: ListUsersParams): Promise<UsersPage> {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }

    return user;
  }

  async update(
    id: string,
    { role, ...data }: UpdateUserParams,
    requesterId: string,
  ): Promise<PublicUser> {
    const revokeResetLinks = await this.emailChanges(id, data.email);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const roleData = role
          ? await this.roleChangeData(tx, id, role, requesterId)
          : {};
        return tx.user.update({
          where: { id },
          data: {
            ...data,
            ...roleData,
            ...(revokeResetLinks ? REVOKE_RESET_LINKS : {}),
          },
          select: PUBLIC_SELECT,
        });
      });
    } catch (error) {
      throw this.mapPrismaError(error, data.email, id);
    }
  }

  async deactivate(id: string, requesterId?: string): Promise<PublicUser> {
    if (requesterId && requesterId === id) {
      throw new ConflictException('No puedes desactivar tu propia cuenta.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id },
          select: { role: true, active: true },
        });
        if (target?.active && target.role === UserRole.ADMIN) {
          await this.assertAnotherActiveApprover(tx, id);
        }
        // Cierra sus sesiones: si no, reactivar la cuenta revivía los tokens que
        // aún no habían vencido.
        return tx.user.update({
          where: { id },
          data: {
            active: false,
            sessions: { deleteMany: {} },
            ...REVOKE_RESET_LINKS,
          },
          select: PUBLIC_SELECT,
        });
      });
    } catch (error) {
      throw this.mapPrismaError(error, undefined, id);
    }
  }

  async activate(id: string): Promise<PublicUser> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { active: true },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw this.mapPrismaError(error, undefined, id);
    }
  }

  /**
   * Datos para cambiar el rol, o nada si no cambia (el panel lo manda en cada
   * edición). Cierra las sesiones para que el token, que lleva el rol, nunca
   * muestre uno viejo: quien cambia de privilegios vuelve a iniciar sesión.
   */
  private async roleChangeData(
    tx: Prisma.TransactionClient,
    id: string,
    role: UserRole,
    requesterId: string,
  ) {
    const target = await tx.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target || target.role === role) return {};

    if (target.role === UserRole.ADMIN) {
      await this.assertAnotherActiveApprover(tx, id);
    }
    await this.audit.record(
      {
        actorType: AuditActorType.PANEL_USER,
        actorId: requesterId,
        action: 'USER_ROLE_CHANGED',
        entity: 'User',
        entityId: id,
        data: { from: target.role, to: role },
      },
      tx,
    );
    return {
      role,
      sessionVersion: { increment: 1 },
      sessions: { deleteMany: {} },
    } satisfies Prisma.UserUpdateInput;
  }

  /**
   * Bloquea a los Aprobadores activos hasta terminar la transacción: si no, dos
   * peticiones a la vez, cada una sobre un Aprobador distinto, verían que queda
   * otro y dejarían el sistema sin ninguno. El orden fijo evita un deadlock entre
   * ellas.
   */
  private async assertAnotherActiveApprover(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const approvers = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE role = 'ADMIN' AND active = true
      ORDER BY id
      FOR UPDATE
    `;
    if (!approvers.some((approver) => approver.id !== id)) {
      throw new ConflictException('Debe quedar al menos un Aprobador activo.');
    }
  }

  /** El panel manda el correo en cada edición, aunque no haya cambiado. */
  private async emailChanges(id: string, email?: string): Promise<boolean> {
    if (!email) return false;
    const current = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });
    return current?.email !== email;
  }

  private mapPrismaError(error: unknown, email?: string, id?: string): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new ConflictException(
          email
            ? `El email ${email} ya está en uso`
            : 'El email ya está en uso',
        );
      }
      if (error.code === 'P2025') {
        return new NotFoundException(`Usuario ${id} no encontrado`);
      }
    }

    return error as Error;
  }
}
