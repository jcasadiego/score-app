import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  iniciarSesion(@Body() dto: IniciarSesionDto) {
    return this.auth.iniciarSesion(dto.email, dto.password);
  }
}
