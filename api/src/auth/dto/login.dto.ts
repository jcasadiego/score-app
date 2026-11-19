import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX } from '../../users/dto/limits';

export class LoginDto {
  @IsEmail()
  email!: string;

  // Sin mínimo de largo: la política es para elegir contraseña, no para entrar.
  // Una contraseña corta es un intento fallido más (401, cuenta para el
  // bloqueo); con un 400 el panel no podía decir "correo o contraseña
  // incorrectos" y el intento no contaba (PF-73).
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}
