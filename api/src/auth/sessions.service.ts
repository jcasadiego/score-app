import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Sesiones abiertas del panel: lo que permite revocar un JWT ya emitido. */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre la sesión del usuario y deja sin valor la anterior: cambiar el id hace
   * que su token ya no encuentre la fila. Un solo `upsert` sobre `userId` único
   * mantiene una sesión por usuario también con logins simultáneos.
   */
  async start(userId: string, expiresAt: Date): Promise<string> {
    const id = randomUUID();
    await this.prisma.userSession.upsert({
      where: { userId },
      create: { id, userId, expiresAt },
      update: { id, expiresAt, createdAt: new Date() },
    });
    return id;
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
