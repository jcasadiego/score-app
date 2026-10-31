import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DiagnosticFamily } from '../../../generated/prisma/enums';
import { EMAIL_MAX, NAME_MAX } from '../../users/dto/limits';
import { NormalizeText, Trim } from '../../users/dto/normalize-text';

/** Largo máximo de cada parámetro UTM. */
export const UTM_MAX = 200;

/**
 * Dígitos, espacios, guiones, paréntesis y un `+` inicial opcional, entre
 * 7 y 20 caracteres. Validación de forma, no de número real — el formato
 * internacional varía demasiado como para algo más estricto sin una
 * librería dedicada.
 */
export const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/;

/**
 * Payload del formulario de precalificación de `score-sitio`. Es un
 * contrato con otro repo (ver `docs/contrato-precalificacion.md`):
 * cambiar campos, tipos o límites se coordina con José antes de mergear.
 */
export class CreateLeadDto {
  @ApiProperty({ minLength: 2, maxLength: NAME_MAX, example: 'Ana Pérez' })
  @NormalizeText()
  @IsString()
  @MinLength(2)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiProperty({ maxLength: EMAIL_MAX, example: 'ana@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @ApiPropertyOptional({ example: '+52 55 1234 5678' })
  @IsOptional()
  @Trim()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone?: string;

  @ApiProperty({ enum: DiagnosticFamily, enumName: 'DiagnosticFamily' })
  @IsEnum(DiagnosticFamily)
  family!: DiagnosticFamily;

  @ApiPropertyOptional({ maxLength: UTM_MAX, example: 'instagram' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(UTM_MAX)
  utmSource?: string;

  @ApiPropertyOptional({ maxLength: UTM_MAX, example: 'social' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(UTM_MAX)
  utmMedium?: string;

  @ApiPropertyOptional({ maxLength: UTM_MAX, example: 'lanzamiento-2026' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(UTM_MAX)
  utmCampaign?: string;
}
