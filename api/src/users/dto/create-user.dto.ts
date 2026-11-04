import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../generated/prisma/enums';
import { EMAIL_MAX, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from './limits';
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
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
