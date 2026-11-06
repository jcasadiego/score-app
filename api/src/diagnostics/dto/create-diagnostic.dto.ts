import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeText } from '../../users/dto/normalize-text';
import { CREATION_REASON_MAX, ID_MAX } from './limits';

export class CreateDiagnosticDto {
  @ApiProperty({ maxLength: ID_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ID_MAX)
  leadId!: string;

  /** Por qué se genera sin pago (CLAUDE.md 5.3). Uso interno del equipo. */
  @ApiProperty({ minLength: 3, maxLength: CREATION_REASON_MAX })
  @NormalizeText()
  @IsString()
  @MinLength(3)
  @MaxLength(CREATION_REASON_MAX)
  reason!: string;
}
