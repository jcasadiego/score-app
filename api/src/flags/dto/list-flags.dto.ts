import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListFlagsDto {
  /** Sin valor: los del cálculo vigente (el último exitoso). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  calculationId?: string;
}
