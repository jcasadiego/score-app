import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Recortar } from './normalizar-texto';

export const TAMANO_PAGINA_POR_DEFECTO = 20;
export const TAMANO_PAGINA_MAX = 100;

export class ListarUsuariosDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANO_PAGINA_MAX)
  tamano: number = TAMANO_PAGINA_POR_DEFECTO;

  /** Búsqueda parcial, sin distinguir mayúsculas, por nombre o email. */
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(100)
  q?: string;
}
