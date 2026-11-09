import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeText } from '../../users/dto/normalize-text';
import { REVIEW_REASON_MAX } from './limits';

export class ApproveReviewDto {
  /**
   * Excepción de IA: por qué se aprueba sin un análisis con IA exitoso. Solo se
   * guarda si el análisis no terminó bien.
   */
  @ApiPropertyOptional({ minLength: 1, maxLength: REVIEW_REASON_MAX })
  @IsOptional()
  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_REASON_MAX)
  aiExceptionReason?: string;
}
