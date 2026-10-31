import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DiagnosticFamily } from '../../../generated/prisma/enums';
import { EMAIL_MAX, NAME_MAX } from '../../users/dto/limits';
import { NormalizeText, Trim } from '../../users/dto/normalize-text';
import { PHONE_REGEX, UTM_MAX } from '../dto/create-lead.dto';

/** Valores de `familia` del contrato viejo → enum actual. */
export const LEGACY_FAMILY: Record<string, DiagnosticFamily> = {
  PROYECTO: DiagnosticFamily.PROJECT,
  B2B: DiagnosticFamily.B2B,
  PROFESIONAL: DiagnosticFamily.PROFESSIONAL,
  CATALOGO: DiagnosticFamily.CATALOG,
};

/**
 * Payload de `POST /leads/precalificacion` tal como lo manda hoy
 * `score-sitio` (campos y valores en español). Mismas reglas que
 * `CreateLeadDto`, para que el sitio no note el cambio.
 */
export class LegacyPrequalificationDto {
  @ApiProperty({ minLength: 2, maxLength: NAME_MAX })
  @NormalizeText()
  @IsString()
  @MinLength(2)
  @MaxLength(NAME_MAX)
  nombre!: string;

  @ApiProperty({ maxLength: EMAIL_MAX })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @Matches(PHONE_REGEX, { message: 'telefono no tiene un formato válido' })
  telefono?: string;

  @ApiProperty({ enum: Object.keys(LEGACY_FAMILY) })
  @IsIn(Object.keys(LEGACY_FAMILY))
  familia!: string;

  @ApiPropertyOptional({ maxLength: UTM_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(UTM_MAX)
  utmSource?: string;

  @ApiPropertyOptional({ maxLength: UTM_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(UTM_MAX)
  utmMedium?: string;

  @ApiPropertyOptional({ maxLength: UTM_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(UTM_MAX)
  utmCampaign?: string;
}
