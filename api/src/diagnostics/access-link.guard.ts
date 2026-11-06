import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessLinksService, ClientSession } from './access-links.service';

export interface RequestWithAccessLink extends Request {
  accessLink: ClientSession;
}

/**
 * Rutas del cliente final: exige la sesión que se obtiene al canjear el enlace
 * y deja en `request.accessLink` el diagnóstico al que da acceso. El diagnóstico
 * sale siempre de aquí, nunca de un id en la URL.
 */
@Injectable()
export class AccessLinkGuard implements CanActivate {
  constructor(private readonly accessLinks: AccessLinksService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { accessLink?: ClientSession }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }
    request.accessLink = await this.accessLinks.verifySession(
      header.slice('Bearer '.length),
    );
    return true;
  }
}
