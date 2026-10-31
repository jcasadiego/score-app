import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EMAIL_MAX, NAME_MAX, PASSWORD_MIN } from './limits';
import { NormalizeText, Trim } from './normalize-text';

export class UpdateUserDto {
  @IsOptional()
  @NormalizeText()
  @IsString()
  @MinLength(2)
  @MaxLength(NAME_MAX)
  name?: string;

  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email?: string;

  /** Contraseña nueva puesta por un admin; cierra las sesiones abiertas. */
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN)
  password?: string;
}
