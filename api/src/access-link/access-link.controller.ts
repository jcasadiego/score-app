import { AuditRoute } from '../audit/audit-route.decorator';
import {
  Body,
  Controller,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../../generated/prisma/enums';
import { IssueAccessLinkDto } from './dto/issue-access-link.dto';
import { AccessLinkService } from './access-link.service';

/**
 * TODO(pendiente #2): endpoint solo para pruebas manuales/QA mientras no
 * existe `Diagnostic`. Se reemplaza por el flujo real de emisión de enlaces
 * cuando esa entidad se defina (ver access-link.service.ts). Lista de permitidos,
 * como Swagger: fuera de desarrollo y test no existe, porque emite enlaces para
 * cualquier `subjectId` sin registrar ninguno ni poder revocarlos.
 */
@ApiTags('access-links')
@ApiBearerAuth()
@Controller('access-links')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccessLinkController {
  constructor(private readonly accessLink: AccessLinkService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @AuditRoute({
    action: 'ACCESS_LINK_ISSUED',
    entity: 'AccessLink',
    fields: ['subjectId'],
  })
  async issue(@Body() dto: IssueAccessLinkDto) {
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
      throw new NotFoundException();
    }
    const token = await this.accessLink.sign(dto.subjectId);
    return { token };
  }
}
