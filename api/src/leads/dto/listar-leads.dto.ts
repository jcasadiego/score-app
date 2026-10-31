import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EstadoLead,
  FamiliaDiagnostico,
} from '../../../generated/prisma/enums';
import {
  TAMANO_PAGINA_MAX,
  TAMANO_PAGINA_POR_DEFECTO,
} from '../../usuarios/dto/listar-usuarios.dto';
import { Recortar } from '../../usuarios/dto/normalizar-texto';

export class ListarLeadsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: TAMANO_PAGINA_MAX,
    default: TAMANO_PAGINA_POR_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANO_PAGINA_MAX)
  tamano: number = TAMANO_PAGINA_POR_DEFECTO;

  /** Búsqueda parcial, sin distinguir mayúsculas, por nombre o email. */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: FamiliaDiagnostico,
    enumName: 'FamiliaDiagnostico',
  })
  @IsOptional()
  @IsEnum(FamiliaDiagnostico)
  familia?: FamiliaDiagnostico;

  @ApiPropertyOptional({ enum: EstadoLead, enumName: 'EstadoLead' })
  @IsOptional()
  @IsEnum(EstadoLead)
  estado?: EstadoLead;
}
