import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DiagnosticFamily } from '../../../generated/prisma/enums';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../../users/dto/list-users.dto';
import { Trim } from '../../users/dto/normalize-text';
import { DiagnosticViewStatus } from '../diagnostic-status';

const VIEW_STATUSES = Object.values(DiagnosticViewStatus);

export class ListDiagnosticsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  /** Incluye `ABANDONED`, que se calcula y no se guarda. */
  @ApiPropertyOptional({ enum: VIEW_STATUSES })
  @IsOptional()
  @IsIn(VIEW_STATUSES)
  status?: DiagnosticViewStatus;

  @ApiPropertyOptional({ enum: DiagnosticFamily, enumName: 'DiagnosticFamily' })
  @IsOptional()
  @IsEnum(DiagnosticFamily)
  family?: DiagnosticFamily;

  /** Búsqueda parcial, sin distinguir mayúsculas, por nombre o email del lead. */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}
