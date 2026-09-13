import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  buscarPorEmail(email: string) {
    return this.prisma.usuario.findUnique({ where: { email } });
  }

  buscarPorId(id: string) {
    return this.prisma.usuario.findUnique({ where: { id } });
  }

  async crear(email: string, password: string) {
    const passwordHash = await argon2.hash(password);
    return this.prisma.usuario.create({ data: { email, passwordHash } });
  }
}
