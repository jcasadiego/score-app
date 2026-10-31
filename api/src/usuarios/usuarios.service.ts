import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SELECT_PUBLICO = {
  id: true,
  name: true,
  email: true,
  active: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UsuarioPublico = Prisma.UserGetPayload<{
  select: typeof SELECT_PUBLICO;
}>;

interface CrearUsuarioParams {
  name: string;
  email: string;
  password: string;
}

interface ListarUsuariosParams {
  page: number;
  pageSize: number;
  search?: string;
}

export interface PaginaUsuarios {
  data: UsuarioPublico[];
  total: number;
  page: number;
  pageSize: number;
}

interface ActualizarUsuarioParams {
  name?: string;
  email?: string;
  password?: string;
}

/**
 * Datos de Prisma para cambiar una contraseña. Es el único lugar que la
 * cambia (CRUD y recuperación), para que ningún camino olvide subir
 * `sessionVersion` — eso es lo que cierra las sesiones abiertas.
 */
export async function datosCambioPassword(password: string) {
  return {
    passwordHash: await argon2.hash(password),
    sessionVersion: { increment: 1 },
  } satisfies Prisma.UserUpdateInput;
}

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  buscarPorEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  buscarPorId(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async crear({
    name,
    email,
    password,
  }: CrearUsuarioParams): Promise<UsuarioPublico> {
    const passwordHash = await argon2.hash(password);

    try {
      return await this.prisma.user.create({
        data: { name, email, passwordHash },
        select: SELECT_PUBLICO,
      });
    } catch (error) {
      throw this.traducirErrorPrisma(error, email);
    }
  }

  /**
   * Página de usuarios + total en una sola transacción (dos queries, un
   * round trip lógico), con el filtro aplicado en la base y no en memoria.
   * `id` desempata el orden para que la paginación sea estable.
   */
  async listar({
    page,
    pageSize,
    search,
  }: ListarUsuariosParams): Promise<PaginaUsuarios> {
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
        select: SELECT_PUBLICO,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async obtener(id: string): Promise<UsuarioPublico> {
    const usuario = await this.prisma.user.findUnique({
      where: { id },
      select: SELECT_PUBLICO,
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }

    return usuario;
  }

  async actualizar(
    id: string,
    { password, ...datos }: ActualizarUsuarioParams,
  ): Promise<UsuarioPublico> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...datos,
          ...(password ? await datosCambioPassword(password) : {}),
        },
        select: SELECT_PUBLICO,
      });
    } catch (error) {
      throw this.traducirErrorPrisma(error, datos.email, id);
    }
  }

  async desactivar(
    id: string,
    solicitanteId?: string,
  ): Promise<UsuarioPublico> {
    if (solicitanteId && solicitanteId === id) {
      throw new ConflictException('No puedes desactivar tu propia cuenta.');
    }
    return this.cambiarActivo(id, false);
  }

  async activar(id: string): Promise<UsuarioPublico> {
    return this.cambiarActivo(id, true);
  }

  private async cambiarActivo(
    id: string,
    active: boolean,
  ): Promise<UsuarioPublico> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { active },
        select: SELECT_PUBLICO,
      });
    } catch (error) {
      throw this.traducirErrorPrisma(error, undefined, id);
    }
  }

  private traducirErrorPrisma(
    error: unknown,
    email?: string,
    id?: string,
  ): Error {
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
