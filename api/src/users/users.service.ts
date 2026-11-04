import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
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
  password: string;
}

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

interface UpdateUserParams {
  name?: string;
  email?: string;
  password?: string;
}

/**
 * Datos de Prisma para cambiar una contraseña. Es el único lugar que la
 * cambia (CRUD y recuperación), para que ningún camino olvide subir
 * `sessionVersion` — eso es lo que cierra las sesiones abiertas.
 */
export async function passwordChangeData(password: string) {
  return {
    passwordHash: await argon2.hash(password),
    sessionVersion: { increment: 1 },
    // Quien recuperó su cuenta no debe seguir esperando a que venza el bloqueo.
    failedLoginAttempts: 0,
    lockedUntil: null,
  } satisfies Prisma.UserUpdateInput;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create({
    name,
    email,
    password,
  }: CreateUserParams): Promise<PublicUser> {
    const passwordHash = await argon2.hash(password);

    try {
      return await this.prisma.user.create({
        data: { name, email, passwordHash },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw this.mapPrismaError(error, email);
    }
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
    { password, ...data }: UpdateUserParams,
  ): Promise<PublicUser> {
    const revokeResetLinks =
      !!password || (await this.emailChanges(id, data.email));

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...data,
          ...(password ? await passwordChangeData(password) : {}),
          ...(revokeResetLinks ? REVOKE_RESET_LINKS : {}),
        },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw this.mapPrismaError(error, data.email, id);
    }
  }

  async deactivate(id: string, requesterId?: string): Promise<PublicUser> {
    if (requesterId && requesterId === id) {
      throw new ConflictException('No puedes desactivar tu propia cuenta.');
    }
    // Cierra sus sesiones: si no, reactivar la cuenta revivía los tokens que
    // aún no habían vencido.
    return this.setActive(id, {
      active: false,
      sessions: { deleteMany: {} },
      ...REVOKE_RESET_LINKS,
    });
  }

  async activate(id: string): Promise<PublicUser> {
    return this.setActive(id, { active: true });
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

  private async setActive(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<PublicUser> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw this.mapPrismaError(error, undefined, id);
    }
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
