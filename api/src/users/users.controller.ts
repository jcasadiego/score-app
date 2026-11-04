import { AuditRoute } from '../audit/audit-route.decorator';
import {
  Body,
  Controller,
  forwardRef,
  Get,
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
 * controlador exige estar ya autenticado como ADMIN (ver seed en
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
    fields: ['name', 'email'],
  })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
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
  // `password` queda como [REDACTADO]: deja constancia de que cambió.
  @AuditRoute({
    action: 'USER_UPDATED',
    entity: 'User',
    fields: ['name', 'email', 'password'],
  })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
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
