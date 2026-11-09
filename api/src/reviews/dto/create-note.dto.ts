import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeText, Trim } from '../../users/dto/normalize-text';
import { REVIEW_NOTE_BODY_MAX, REVIEW_NOTE_DIMENSION_MAX } from './limits';

export class CreateNoteDto {
  @ApiProperty({ minLength: 1, maxLength: REVIEW_NOTE_BODY_MAX })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_NOTE_BODY_MAX)
  body!: string;

  /** Sin dimensión es una nota general. Texto libre hasta confirmar D1–D8. */
  @ApiPropertyOptional({ minLength: 1, maxLength: REVIEW_NOTE_DIMENSION_MAX })
  @IsOptional()
  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_NOTE_DIMENSION_MAX)
  dimension?: string;
}
