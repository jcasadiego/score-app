import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenEnlaceService } from './token-enlace.service';

interface RequestConEnlace extends Request {
  enlace?: Record<string, unknown>;
}

@Injectable()
export class TokenEnlaceGuard implements CanActivate {
  constructor(private readonly tokenEnlace: TokenEnlaceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConEnlace>();
    const token = this.extraerToken(request);

    if (!token) {
      throw new UnauthorizedException('Falta el token de enlace');
    }

    request.enlace = await this.tokenEnlace.verificar(token);
    return true;
  }

  private extraerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
  }
}
