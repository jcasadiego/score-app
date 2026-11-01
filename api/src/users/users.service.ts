import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  active: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

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
  } satisfies Prisma.UserUpdateInput;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
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
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...data,
          ...(password ? await passwordChangeData(password) : {}),
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
    return this.setActive(id, { active: false, sessions: { deleteMany: {} } });
  }

  async activate(id: string): Promise<PublicUser> {
    return this.setActive(id, { active: true });
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
