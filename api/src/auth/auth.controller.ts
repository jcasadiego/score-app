import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Límite propio, más estricto que el global, como mitigación de fuerza
  // bruta sobre credenciales.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  iniciarSesion(@Body() dto: IniciarSesionDto) {
    return this.auth.iniciarSesion(dto.email, dto.password);
  }
}
