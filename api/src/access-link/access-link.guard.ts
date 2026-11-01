import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessLinkService } from './access-link.service';

interface RequestWithAccessLink extends Request {
  accessLink?: Record<string, unknown>;
}

@Injectable()
export class AccessLinkGuard implements CanActivate {
  constructor(private readonly accessLink: AccessLinkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAccessLink>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Falta el token de enlace');
    }

    request.accessLink = await this.accessLink.verify(token);
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
  }
}
