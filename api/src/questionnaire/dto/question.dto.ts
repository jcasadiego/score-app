import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../../../generated/prisma/enums';
import { NormalizeText, Trim } from '../../users/dto/normalize-text';
import {
  CODE_MAX,
  CODE_PATTERN,
  FREE_TEXT_MAX_LENGTH,
  HELP_TEXT_MAX,
  MAX_OPTIONS,
  OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
} from './limits';

const CODE_MESSAGE =
  'debe empezar por una letra y tener solo minúsculas, dígitos y guion bajo';

export class AnswerOptionDto {
  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(OPTION_TEXT_MAX)
  text!: string;

  /** Estable entre versiones: es lo que se guarda como respuesta. */
  @ApiProperty({ pattern: CODE_PATTERN.source, maxLength: CODE_MAX })
  @Trim()
  @IsString()
  @MaxLength(CODE_MAX)
  @Matches(CODE_PATTERN, { message: `value ${CODE_MESSAGE}` })
  value!: string;
}

/**
 * Pregunta con sus opciones, en el orden en que llegan. Crear y editar reciben
 * la pregunta completa: editar reemplaza también todas sus opciones.
 */
export class QuestionDto {
  /** Estable entre versiones: identifica la misma pregunta aunque cambie su texto. */
  @ApiProperty({ pattern: CODE_PATTERN.source, maxLength: CODE_MAX })
  @Trim()
  @IsString()
  @MaxLength(CODE_MAX)
  @Matches(CODE_PATTERN, { message: `code ${CODE_MESSAGE}` })
  code!: string;

  @NormalizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(QUESTION_TEXT_MAX)
  text!: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  @IsEnum(QuestionType)
  type!: QuestionType;

  /** Ayuda o ejemplo bajo la pregunta. Se muestra como texto, nunca como HTML. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(HELP_TEXT_MAX)
  helpText?: string;

  @IsBoolean()
  required!: boolean;

  /** Obligatorio en `FREE_TEXT` y prohibido en las de selección. */
  @ApiPropertyOptional({ minimum: 1, maximum: FREE_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(FREE_TEXT_MAX_LENGTH)
  maxLength?: number;

  /** Al menos 2 en las de selección; ninguna en `FREE_TEXT`. */
  @ApiProperty({ type: [AnswerOptionDto] })
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => AnswerOptionDto)
  options: AnswerOptionDto[] = [];
}
