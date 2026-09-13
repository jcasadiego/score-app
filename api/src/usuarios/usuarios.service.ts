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
  nombre: true,
  email: true,
  activo: true,
  rol: true,
  creadoEn: true,
  actualizadoEn: true,
} satisfies Prisma.UsuarioSelect;

export type UsuarioPublico = Prisma.UsuarioGetPayload<{
  select: typeof SELECT_PUBLICO;
}>;

interface CrearUsuarioParams {
  nombre: string;
  email: string;
  password: string;
}

interface ActualizarUsuarioParams {
  nombre?: string;
  email?: string;
}

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  buscarPorEmail(email: string) {
    return this.prisma.usuario.findUnique({ where: { email } });
  }

  buscarPorId(id: string) {
    return this.prisma.usuario.findUnique({ where: { id } });
  }

  async crear({
    nombre,
    email,
    password,
  }: CrearUsuarioParams): Promise<UsuarioPublico> {
    const passwordHash = await argon2.hash(password);

    try {
      return await this.prisma.usuario.create({
        data: { nombre, email, passwordHash },
        select: SELECT_PUBLICO,
      });
    } catch (error) {
      throw this.traducirErrorPrisma(error, email);
    }
  }

  listar(): Promise<UsuarioPublico[]> {
    return this.prisma.usuario.findMany({
      select: SELECT_PUBLICO,
      orderBy: { creadoEn: 'asc' },
    });
  }

  async obtener(id: string): Promise<UsuarioPublico> {
    const usuario = await this.prisma.usuario.findUnique({
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
    datos: ActualizarUsuarioParams,
  ): Promise<UsuarioPublico> {
    try {
      return await this.prisma.usuario.update({
        where: { id },
        data: datos,
        select: SELECT_PUBLICO,
      });
    } catch (error) {
      throw this.traducirErrorPrisma(error, datos.email, id);
    }
  }

  async desactivar(id: string): Promise<UsuarioPublico> {
    return this.cambiarActivo(id, false);
  }

  async activar(id: string): Promise<UsuarioPublico> {
    return this.cambiarActivo(id, true);
  }

  private async cambiarActivo(
    id: string,
    activo: boolean,
  ): Promise<UsuarioPublico> {
    try {
      return await this.prisma.usuario.update({
        where: { id },
        data: { activo },
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
