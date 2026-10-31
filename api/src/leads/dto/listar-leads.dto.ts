import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DiagnosticFamily, LeadStatus } from '../../../generated/prisma/enums';
import { ListarUsuariosDto } from '../../usuarios/dto/listar-usuarios.dto';

/** Paginación y búsqueda de siempre, más los filtros propios de leads. */
export class ListarLeadsDto extends ListarUsuariosDto {
  @ApiPropertyOptional({ enum: DiagnosticFamily, enumName: 'DiagnosticFamily' })
  @IsOptional()
  @IsEnum(DiagnosticFamily)
  family?: DiagnosticFamily;

  @ApiPropertyOptional({ enum: LeadStatus, enumName: 'LeadStatus' })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;
}
