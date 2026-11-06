import { AuditRoute } from '../audit/audit-route.decorator';
import {
  Body,
  Controller,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
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
import { MfaService } from '../auth/mfa.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../../generated/prisma/enums';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UsersService } from './users.service';

interface RequestWithUser extends Request {
  user: { id: string };
}

/**
 * Gestión de las cuentas internas de `apps/panel`. Sin autoservicio a
 * propósito: los usuarios los crea el propio equipo, por eso todo el
 * controlador exige estar ya autenticado como Aprobador (ver seed en
 * `prisma/seed.ts` para el primer usuario).
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(forwardRef(() => MfaService)) private readonly mfa: MfaService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @AuditRoute({
    action: 'USER_CREATED',
    entity: 'User',
    fields: ['name', 'email', 'role'],
  })
  create(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.users.create(dto, req.user.id);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  list(@Query() query: ListUsersDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  // El cambio de rol lo registra el servicio, con el rol anterior y el nuevo.
  @AuditRoute({
    action: 'USER_UPDATED',
    entity: 'User',
    fields: ['name', 'email'],
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: RequestWithUser,
  ) {
    return this.users.update(id, dto, req.user.id);
  }

  /**
   * Invalida la contraseña y le manda a su dueño un enlace para definir otra.
   * También reenvía el de activación. Nunca sobre uno mismo.
   */
  @Post(':id/password-reset')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  resetPassword(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.users.resetPassword(id, req.user.id);
  }

  /** Para quien perdió el autenticador y sus códigos; nunca sobre uno mismo. */
  @Patch(':id/reset-mfa')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  resetMfa(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.mfa.reset(id, req.user.id);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ action: 'USER_DEACTIVATED', entity: 'User' })
  deactivate(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.users.deactivate(id, req.user.id);
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ action: 'USER_ACTIVATED', entity: 'User' })
  activate(@Param('id') id: string) {
    return this.users.activate(id);
  }
}
