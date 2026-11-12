import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../users/dto/normalize-text';

/** Largo máximo de una sección (también en la base, como `VARCHAR`). */
export const REPORT_SECTION_BODY_MAX = 4000;

export class UpdateSectionDto {
  @ApiProperty({ minLength: 1, maxLength: REPORT_SECTION_BODY_MAX })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(REPORT_SECTION_BODY_MAX)
  body!: string;
}
