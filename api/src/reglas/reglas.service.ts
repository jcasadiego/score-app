import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReglasService {
  constructor(private readonly prisma: PrismaService) {}

  crearVersion(contenido: Prisma.InputJsonValue) {
    return this.prisma.ruleSetVersion.create({ data: { content: contenido } });
  }

  obtenerVersionActiva() {
    return this.prisma.ruleSetVersion.findFirst({ where: { active: true } });
  }

  async activarVersion(numero: number) {
    return this.prisma.$transaction([
      this.prisma.ruleSetVersion.updateMany({
        where: { active: true },
        data: { active: false },
      }),
      this.prisma.ruleSetVersion.update({
        where: { number: numero },
        data: { active: true },
      }),
    ]);
  }
}
