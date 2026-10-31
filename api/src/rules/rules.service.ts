import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  createVersion(content: Prisma.InputJsonValue) {
    return this.prisma.ruleSetVersion.create({ data: { content: content } });
  }

  getActiveVersion() {
    return this.prisma.ruleSetVersion.findFirst({ where: { active: true } });
  }

  async activateVersion(versionNumber: number) {
    return this.prisma.$transaction([
      this.prisma.ruleSetVersion.updateMany({
        where: { active: true },
        data: { active: false },
      }),
      this.prisma.ruleSetVersion.update({
        where: { number: versionNumber },
        data: { active: true },
      }),
    ]);
  }
}
