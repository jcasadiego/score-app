import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReglasService {
  constructor(private readonly prisma: PrismaService) {}

  crearVersion(contenido: Prisma.InputJsonValue) {
    return this.prisma.versionReglas.create({ data: { contenido } });
  }

  obtenerVersionActiva() {
    return this.prisma.versionReglas.findFirst({ where: { activa: true } });
  }

  async activarVersion(numero: number) {
    return this.prisma.$transaction([
      this.prisma.versionReglas.updateMany({
        where: { activa: true },
        data: { activa: false },
      }),
      this.prisma.versionReglas.update({
        where: { numero },
        data: { activa: true },
      }),
    ]);
  }
}
