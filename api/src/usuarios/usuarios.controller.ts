import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../../generated/prisma/enums';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto';
import { UsuariosService } from './usuarios.service';

interface RequestConUsuario extends Request {
  user: { id: string };
}

/**
 * Gestión de las cuentas internas de `apps/panel`. Sin autoservicio a
 * propósito: los usuarios los crea el propio equipo, por eso todo el
 * controlador exige estar ya autenticado como ADMIN (ver seed en
 * `prisma/seed.ts` para el primer usuario).
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  crear(@Body() dto: CrearUsuarioDto) {
    return this.usuarios.crear(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  listar(@Query() query: ListarUsuariosDto) {
    return this.usuarios.listar(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  obtener(@Param('id') id: string) {
    return this.usuarios.obtener(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  actualizar(@Param('id') id: string, @Body() dto: ActualizarUsuarioDto) {
    return this.usuarios.actualizar(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  desactivar(@Param('id') id: string, @Req() req: RequestConUsuario) {
    return this.usuarios.desactivar(id, req.user.id);
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  activar(@Param('id') id: string) {
    return this.usuarios.activar(id);
  }
}
