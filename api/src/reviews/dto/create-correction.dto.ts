import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AnswerDto } from '../../diagnostics/dto/answer.dto';
import { ID_MAX } from '../../diagnostics/dto/limits';
import { NormalizeText } from '../../users/dto/normalize-text';
import { REVIEW_REASON_MAX } from './limits';

/** El valor nuevo con la misma forma que una respuesta: `text` u `optionIds`. */
export class CreateCorrectionDto extends AnswerDto {
  @ApiProperty({ maxLength: ID_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ID_MAX)
  answerId!: string;

  /** Por qué se corrige. Obligatorio. */
  @ApiProperty({ minLength: 1, maxLength: REVIEW_REASON_MAX })
  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_REASON_MAX)
  reason!: string;
}
