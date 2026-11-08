import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FlagStatus } from '../../../generated/prisma/enums';
import { Trim } from '../../users/dto/normalize-text';

export const REVIEW_NOTE_MAX = 1000;

export class ReviewFlagDto {
  /** `OPEN` reabre un flag ya revisado o descartado. */
  @ApiProperty({ enum: FlagStatus, enumName: 'FlagStatus' })
  @IsEnum(FlagStatus)
  status!: FlagStatus;

  /** Obligatoria al descartar. */
  @ApiPropertyOptional({ maxLength: REVIEW_NOTE_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(REVIEW_NOTE_MAX)
  note?: string;
}
