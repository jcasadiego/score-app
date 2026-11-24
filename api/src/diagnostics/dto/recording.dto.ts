import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  VOICE_CONSENT_VERSIONS,
} from '../recording-rules';

/** Campos de texto del multipart que acompañan al archivo `audio`. */
export class UploadRecordingDto {
  /** Duración que midió el navegador, en milisegundos. */
  @ApiProperty({ minimum: 1, maximum: MAX_RECORDING_DURATION_MS })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RECORDING_DURATION_MS, {
    message: `durationMs no puede superar ${MAX_RECORDING_DURATION_MS / 60_000} minutos`,
  })
  durationMs!: number;
}

/** Para Swagger: el cuerpo multipart completo. */
export class UploadRecordingBody extends UploadRecordingDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: `WebM (Opus) o MP4 (AAC), hasta ${MAX_RECORDING_BYTES} bytes.`,
  })
  audio!: unknown;
}

export class VoiceConsentDto {
  /** Versión del texto de consentimiento que vio el cliente. */
  @ApiProperty({ enum: VOICE_CONSENT_VERSIONS })
  @IsIn(VOICE_CONSENT_VERSIONS)
  version!: string;
}
