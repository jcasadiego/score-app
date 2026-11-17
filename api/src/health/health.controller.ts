import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Commit desplegado. Render lo expone como `RENDER_GIT_COMMIT`; el workflow de
 * despliegue (PF-71) espera a ver el SHA fusionado para saber que la versión
 * nueva ya está arriba, porque la anterior también responde 200. El repo es
 * público, así que el SHA no revela nada nuevo. Fuera de Render queda en null.
 */
function deployedCommit(): string | null {
  const commit = process.env.RENDER_GIT_COMMIT;
  return commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', commit: deployedCommit() };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        detail: 'sin conexión a la base de datos',
      });
    }
  }
}
