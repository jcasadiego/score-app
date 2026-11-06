import {
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ExternalPlatform } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { AccessLinkGuard, RequestWithAccessLink } from './access-link.guard';
import { AccessLinksService } from './access-links.service';
import { DiagnosticSessionsService } from './diagnostic-sessions.service';
import { AnswerDto } from './dto/answer.dto';
import { ExternalLinkDto } from './dto/external-link.dto';
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
    return this.sessions.saveAnswer(req.accessLink.sub, questionId, dto);
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
    return this.sessions.deleteAnswer(req.accessLink.sub, questionId);
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
    return this.sessions.saveExternalLink(
      req.accessLink.sub,
      platform,
      dto.url,
    );
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
    return this.sessions.deleteExternalLink(req.accessLink.sub, platform);
  }

  /** Envía el diagnóstico. Desde aquí no admite cambios y la sesión termina. */
  @Post('current/submission')
  @ApiBearerAuth()
  @UseGuards(AccessLinkGuard)
  @AuditRoute({ byService: true })
  submit(@Req() req: RequestWithAccessLink) {
    return this.sessions.submit(req.accessLink.sub);
  }
}
