import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX } from '../../usuarios/dto/limites';
import { Recortar } from '../../usuarios/dto/normalizar-texto';

export class SolicitarRecuperacionDto {
  @Recortar()
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;
}
