import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DiagnosticFamily, LeadStatus } from '../../../generated/prisma/enums';
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
}
