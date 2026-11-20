import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeText } from '../../users/dto/normalize-text';
import { VOID_REASON_MAX } from './limits';

export class VoidPaymentDto {
  /** Por qué se anula. Uso interno del equipo: no entra a la bitácora. */
  @ApiProperty({ minLength: 3, maxLength: VOID_REASON_MAX })
  @NormalizeText()
  @IsString()
  @MinLength(3)
  @MaxLength(VOID_REASON_MAX)
  reason!: string;
}
