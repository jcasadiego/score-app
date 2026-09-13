import { IsString, MinLength } from 'class-validator';

export class EmitirEnlaceDto {
  @IsString()
  @MinLength(1)
  identificadorId!: string;
}
