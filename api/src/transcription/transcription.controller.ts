import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TranscriptionService } from './transcription.service';

interface RequestWithUser extends Request {
  user: { id: string };
}

/**
 * Transcripción de la voz desde el panel (PF-88). Ambos roles ven el estado y
 * reintentan una fallida (CLAUDE.md 5.3, fila de grabaciones): reintentar no
 * cambia la respuesta del cliente.
 */
@ApiTags('transcription')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TranscriptionController {
  constructor(private readonly transcriptions: TranscriptionService) {}

  /** Qué proveedor está activo, para avisar en el panel si es simulado. */
  @Get('transcription/status')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  status() {
    return this.transcriptions.status();
  }

  @Post('diagnostics/:id/answers/:questionId/transcription/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  // El servicio lo registra en la misma transacción, con el id de la transcripción.
  @AuditRoute({ byService: true })
  retry(
    @Param('id') diagnosticId: string,
    @Param('questionId') questionId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.transcriptions.retry(diagnosticId, questionId, req.user.id);
  }
}
