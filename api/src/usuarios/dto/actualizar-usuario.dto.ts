import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EMAIL_MAX, NOMBRE_MAX, PASSWORD_MIN } from './limites';
import { NormalizarTexto, Recortar } from './normalizar-texto';

export class ActualizarUsuarioDto {
  @IsOptional()
  @NormalizarTexto()
  @IsString()
  @MinLength(2)
  @MaxLength(NOMBRE_MAX)
  nombre?: string;

  @IsOptional()
  @Recortar()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email?: string;

  /** Contraseña nueva puesta por un admin; cierra las sesiones abiertas. */
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN)
  password?: string;
}
