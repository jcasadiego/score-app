import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Sesiones abiertas del panel: lo que permite revocar un JWT ya emitido. */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Abre una sesión y limpia las ya vencidas de ese usuario. */
  async start(userId: string, expiresAt: Date): Promise<string> {
    const [, session] = await this.prisma.$transaction([
      this.prisma.userSession.deleteMany({
        where: { userId, expiresAt: { lte: new Date() } },
      }),
      this.prisma.userSession.create({
        data: { userId, expiresAt },
        select: { id: true },
      }),
    ]);
    return session.id;
  }

  /** Sesión con su usuario en una sola consulta: corre en cada petición. */
  find(sessionId: string) {
    return this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            active: true,
            sessionVersion: true,
          },
        },
      },
    });
  }

  /** Sin error si ya no existe: cerrar sesión dos veces no es un fallo. */
  async end(sessionId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { id: sessionId } });
  }
}
