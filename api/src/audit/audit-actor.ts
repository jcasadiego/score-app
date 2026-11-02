import { Request } from 'express';
import { AuditActorType } from '../../generated/prisma/enums';
import type { RecordAuditParams } from './audit.service';

export interface AuditableRequest extends Request {
  user?: { id: string };
  accessLink?: { sub: string };
}

/**
 * `request.user` lo deja `JwtAuthGuard` (usuario del panel) y
 * `request.accessLink` lo deja `AccessLinkGuard` (cliente final). Ninguno de los
 * dos es global, así que en rutas sin guard de auth (ej. antes de un login) no
 * hay actor autenticado y se registra como sistema.
 */
export function resolveAuditActor(
  request: AuditableRequest,
): Pick<RecordAuditParams, 'actorType' | 'actorId'> {
  if (request.user?.id) {
    return { actorType: AuditActorType.PANEL_USER, actorId: request.user.id };
  }
  if (request.accessLink?.sub) {
    return {
      actorType: AuditActorType.END_CLIENT,
      actorId: request.accessLink.sub,
    };
  }
  return { actorType: AuditActorType.SYSTEM };
}
