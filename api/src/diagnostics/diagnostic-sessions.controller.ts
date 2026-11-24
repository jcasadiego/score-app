import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ExternalPlatform } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { AccessLinkGuard, RequestWithAccessLink } from './access-link.guard';
import { AccessLinksService } from './access-links.service';
import {
  AnswerRecordingsService,
  UploadedAudio,
} from './answer-recordings.service';
import { DiagnosticSessionsService } from './diagnostic-sessions.service';
import { AnswerDto } from './dto/answer.dto';
import { ExternalLinkDto } from './dto/external-link.dto';
import {
  UploadRecordingBody,
  UploadRecordingDto,
  VoiceConsentDto,
} from './dto/recording.dto';
import { VALIDATION_FAILED_CODE } from '../common/problem-details';
import { MAX_RECORDING_BYTES } from './recording-rules';
import { RecordingTooLargeInterceptor } from './recording-upload.interceptor';
import { RedeemAccessLinkDto } from './dto/redeem-access-link.dto';

const platformPipe = new ParseEnumPipe(ExternalPlatform);

/**
 * Rutas de `apps/diagnostico` para el cliente final, sin contraseña. El enlace
 * del correo se canjea por una sesión; el resto exige esa sesión, y el
 * diagnóstico sale siempre de ella (`current`), nunca de un id en la URL.
 */
@ApiTags('diagnostic-sessions')
@Controller('diagnostic-sessions')
export class DiagnosticSessionsController {
  constructor(
    private readonly accessLinks: AccessLinksService,
    private readonly sessions: DiagnosticSessionsService,
    private readonly recordings: AnswerRecordingsService,
  ) {}

  /** Canje del enlace. Límite propio contra quien pruebe tokens. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  redeem(@Body() dto: RedeemAccessLinkDto) {
    return this.accessLinks.redeem(dto.token);
  }

  @Get('current')
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  current(@Req() req: RequestWithAccessLink) {
    return this.sessions.current(req.accessLink.sub);
  }

  @Put('current/answers/:questionId')
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  saveAnswer(
    @Req() req: RequestWithAccessLink,
    @Param('questionId') questionId: string,
    @Body() dto: AnswerDto,
  ) {
    return this.sessions.saveAnswer(req.accessLink, questionId, dto);
  }

  @Delete('current/answers/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  deleteAnswer(
    @Req() req: RequestWithAccessLink,
    @Param('questionId') questionId: string,
  ) {
    return this.sessions.deleteAnswer(req.accessLink, questionId);
  }

  /** Acepta el uso de la voz (PF-86). Se pide antes de la primera grabación. */
  @Post('current/voice-consent')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  giveVoiceConsent(
    @Req() req: RequestWithAccessLink,
    @Body() dto: VoiceConsentDto,
  ) {
    return this.recordings.giveConsent(req.accessLink, dto.version);
  }

  /**
   * Crea o reemplaza la grabación de una respuesta: multipart con el archivo
   * `audio` y `durationMs`. Límite propio: cada subida pesa hasta 5 MB.
   */
  @Put('current/answers/:questionId/recording')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadRecordingBody })
  @UseGuards(AccessLinkGuard)
  @UseInterceptors(
    RecordingTooLargeInterceptor,
    FileInterceptor('audio', {
      limits: { fileSize: MAX_RECORDING_BYTES, files: 1, fields: 1, parts: 2 },
    }),
  )
  @AuditRoute({ byService: true })
  uploadRecording(
    @Req() req: RequestWithAccessLink,
    @Param('questionId') questionId: string,
    @Body() dto: UploadRecordingDto,
    @UploadedFile() file: UploadedAudio | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: ['Falta el archivo audio.'],
        code: VALIDATION_FAILED_CODE,
        errors: [{ field: 'audio', message: 'Falta el archivo de audio.' }],
      });
    }
    return this.recordings.upload(
      req.accessLink,
      questionId,
      file,
      dto.durationMs,
    );
  }

  @Delete('current/answers/:questionId/recording')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  deleteRecording(
    @Req() req: RequestWithAccessLink,
    @Param('questionId') questionId: string,
  ) {
    return this.recordings.remove(req.accessLink, questionId);
  }

  /** URL firmada de vida corta para escuchar la propia grabación. */
  @Get('current/answers/:questionId/recording')
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  playRecording(
    @Req() req: RequestWithAccessLink,
    @Param('questionId') questionId: string,
  ) {
    return this.recordings.clientPlayback(req.accessLink, questionId);
  }

  @Put('current/external-links/:platform')
  @ApiBearerAuth()
  @ApiParam({ name: 'platform', enum: ExternalPlatform })
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  saveExternalLink(
    @Req() req: RequestWithAccessLink,
    @Param('platform', platformPipe) platform: ExternalPlatform,
    @Body() dto: ExternalLinkDto,
  ) {
    return this.sessions.saveExternalLink(req.accessLink, platform, dto.url);
  }

  @Delete('current/external-links/:platform')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiParam({ name: 'platform', enum: ExternalPlatform })
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  deleteExternalLink(
    @Req() req: RequestWithAccessLink,
    @Param('platform', platformPipe) platform: ExternalPlatform,
  ) {
    return this.sessions.deleteExternalLink(req.accessLink, platform);
  }

  /** Envía el diagnóstico. Desde aquí no admite cambios y la sesión termina. */
  @Post('current/submission')
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  submit(@Req() req: RequestWithAccessLink) {
    return this.sessions.submit(req.accessLink);
  }
}
