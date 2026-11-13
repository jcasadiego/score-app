import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeText } from '../../users/dto/normalize-text';

/** Largo máximo del motivo (también en la base, como `VARCHAR`). */
export const REPORT_REOPEN_REASON_MAX = 500;

export class ReopenReportDto {
  /** Por qué se reabre el informe aprobado. Obligatorio. */
  @ApiProperty({ minLength: 1, maxLength: REPORT_REOPEN_REASON_MAX })
  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(REPORT_REOPEN_REASON_MAX)
  reason!: string;
}
