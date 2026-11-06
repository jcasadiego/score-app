import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ANSWER_TEXT_MAX, ID_MAX, MAX_SELECTED_OPTIONS } from './limits';

/** `text` en las de texto libre; `optionIds` en las de selección. */
export class AnswerDto {
  @ApiPropertyOptional({ maxLength: ANSWER_TEXT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ANSWER_TEXT_MAX)
  text?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_SELECTED_OPTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SELECTED_OPTIONS)
  @IsString({ each: true })
  @MaxLength(ID_MAX, { each: true })
  optionIds?: string[];
}
