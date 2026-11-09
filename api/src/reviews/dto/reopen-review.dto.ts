import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeText } from '../../users/dto/normalize-text';
import { REVIEW_REASON_MAX } from './limits';

export class ReopenReviewDto {
  /** Por qué se reabre la aprobación. Obligatorio. */
  @ApiProperty({ minLength: 1, maxLength: REVIEW_REASON_MAX })
  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_REASON_MAX)
  reason!: string;
}
