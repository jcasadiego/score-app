import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
} from 'class-validator';
import { MAX_QUESTIONS_PER_VERSION } from './limits';

/** Todas las preguntas de la versión, cada una una vez, en el orden nuevo. */
export class QuestionOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS_PER_VERSION)
  @ArrayUnique()
  @IsString({ each: true })
  questionIds!: string[];
}
