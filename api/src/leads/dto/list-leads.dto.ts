import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { DiagnosticFamily, LeadStatus } from '../../../generated/prisma/enums';
import { CRM_SYNC_STATUSES, type CrmSyncStatus } from '../../crm/crm.types';
import { ListUsersDto } from '../../users/dto/list-users.dto';

/** Paginación y búsqueda de siempre, más los filtros propios de leads. */
export class ListLeadsDto extends ListUsersDto {
  @ApiPropertyOptional({ enum: DiagnosticFamily, enumName: 'DiagnosticFamily' })
  @IsOptional()
  @IsEnum(DiagnosticFamily)
  family?: DiagnosticFamily;

  @ApiPropertyOptional({ enum: LeadStatus, enumName: 'LeadStatus' })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  /** Estado general del envío al CRM (PF-80), filtrado en la base. */
  @ApiPropertyOptional({ enum: CRM_SYNC_STATUSES, enumName: 'CrmSyncStatus' })
  @IsOptional()
  @IsIn(CRM_SYNC_STATUSES)
  crmSyncStatus?: CrmSyncStatus;
}
