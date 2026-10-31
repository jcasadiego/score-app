import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { EMAIL_MAX, NOMBRE_MAX, PASSWORD_MIN } from './limites';
import { NormalizarTexto, Recortar } from './normalizar-texto';

export class CrearUsuarioDto {
  @NormalizarTexto()
  @IsString()
  @MinLength(2)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @Recortar()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  password!: string;
}
