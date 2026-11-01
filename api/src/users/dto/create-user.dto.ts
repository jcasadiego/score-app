import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { EMAIL_MAX, NAME_MAX, PASSWORD_MIN } from './limits';
import { NormalizeText, Trim } from './normalize-text';

export class CreateUserDto {
  @NormalizeText()
  @IsString()
  @MinLength(2)
  @MaxLength(NAME_MAX)
  name!: string;

  @Trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  password!: string;
}
