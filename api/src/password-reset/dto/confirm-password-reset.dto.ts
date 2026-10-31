import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN } from '../../users/dto/limits';

export class ConfirmPasswordResetDto {
  /** El token que llegó en el enlace del correo. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  /** Mismas reglas que al crear un usuario. */
  @IsString()
  @MinLength(PASSWORD_MIN)
  password!: string;
}
