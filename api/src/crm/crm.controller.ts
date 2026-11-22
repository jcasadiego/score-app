import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CrmSyncService } from './crm-sync.service';
import { ListCrmSyncEventsDto } from './dto/list-crm-sync-events.dto';

interface RequestWithUser extends Request {
  user: { id: string };
}

/**
 * Estado de la sincronización con el CRM (PF-80). Ambos roles ven y
 * reintentan (CLAUDE.md 5.3): reintentar no cambia datos del negocio. Nada de
 * esto expone el token, ids de la cuenta ni la respuesta del proveedor.
 */
@ApiTags('crm')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CrmController {
  constructor(private readonly sync: CrmSyncService) {}

  @Get('crm/status')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  status() {
    return this.sync.status();
  }

  @Get('leads/:id/crm-sync-events')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'CRM_SYNC_EVENTS_LISTED', entity: 'Lead' })
  list(@Param('id') leadId: string, @Query() query: ListCrmSyncEventsDto) {
    return this.sync.listEvents(leadId, query.page, query.pageSize);
  }

  @Post('leads/:id/crm-sync-events/:eventId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  // El servicio lo registra en la misma transacción, con el id del evento.
  @AuditRoute({ byService: true })
  retry(
    @Param('id') leadId: string,
    @Param('eventId') eventId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.sync.retry(leadId, eventId, req.user.id);
  }
}
