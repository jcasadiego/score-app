import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EMAIL_MAX, NOMBRE_MAX } from './limites';
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
}
