import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX } from '../../users/dto/limits';

export class LoginDto {
  @IsEmail()
  email!: string;

  // El mínimo no sigue a PASSWORD_MIN: una cuenta creada con la política
  // anterior debe poder entrar hasta que cambie su contraseña.
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}
