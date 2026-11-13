import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ACCESS_TOKEN_MAX } from '../../diagnostics/dto/limits';

export class DownloadReportDto {
  /** El token del enlace que llegó por correo (lo que va después de `#token=`). */
  @ApiProperty({ maxLength: ACCESS_TOKEN_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ACCESS_TOKEN_MAX)
  token!: string;
}
