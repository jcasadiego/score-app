import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX } from '../../users/dto/limits';
import { Trim } from '../../users/dto/normalize-text';

export class RecoverAccessLinkDto {
  @ApiProperty({ maxLength: EMAIL_MAX, example: 'ana@example.com' })
  @Trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;
}
