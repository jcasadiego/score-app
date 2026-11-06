import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../generated/prisma/enums';
import { EMAIL_MAX, NAME_MAX } from './limits';
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

  /** Cambiarlo cierra las sesiones abiertas del usuario. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
