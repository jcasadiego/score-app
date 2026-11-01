import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX } from '../../users/dto/limits';
import { Trim } from '../../users/dto/normalize-text';

export class RequestPasswordResetDto {
  @Trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;
}
