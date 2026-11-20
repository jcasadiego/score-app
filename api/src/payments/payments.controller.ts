import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { requireIfMatch, reviewEtag as etag } from '../reviews/etag';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { PaymentsService } from './payments.service';

interface RequestWithUser extends Request {
  user: { id: string };
}

const PAYMENT_IF_MATCH = {
  name: 'If-Match',
  required: true,
  description: 'ETag de `GET /payments/:id` (la versión del pago).',
};

const SUMMARY_IF_MATCH = {
  name: 'If-Match',
  required: true,
  description:
    'ETag de `GET /leads/:id/payment-summary` (cuántos pagos confirmados vio el Aprobador).',
};

/**
 * Pagos registrados a mano (PF-51). Todo el módulo es solo del Aprobador
 * (CLAUDE.md 5.3): el Revisor recibe 403. Las lecturas se auditan porque
 * muestran datos del cliente.
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Registra un pago pendiente. */
  @Post()
  @AuditRoute({ byService: true })
  async register(
    @Body() dto: CreatePaymentDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { payment, version } = await this.payments.register(dto, req.user.id);
    res.location(`/api/v1/payments/${encodeURIComponent(payment.id)}`);
    res.setHeader('ETag', etag(version));
    return payment;
  }

  @Get()
  @AuditRoute({ action: 'PAYMENTS_LISTED', entity: 'Payment' })
  list(@Query() query: ListPaymentsDto) {
    return this.payments.list(query);
  }

  @Get(':id')
  @AuditRoute({ action: 'PAYMENT_VIEWED', entity: 'Payment' })
  async findOne(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { payment, version } = await this.payments.findOne(id);
    res.setHeader('ETag', etag(version));
    return payment;
  }

  /** Verifica el cobro. No crea el diagnóstico: eso es activar, aparte. */
  @Post(':id/confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(PAYMENT_IF_MATCH)
  @AuditRoute({ byService: true })
  async confirm(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, 'del pago');
    const { payment, version } = await this.payments.confirm(
      id,
      expected,
      req.user.id,
    );
    res.setHeader('ETag', etag(version));
    return payment;
  }

  /** Anula un pago pendiente, con motivo. Uno confirmado no se anula. */
  @Post(':id/voiding')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(PAYMENT_IF_MATCH)
  @AuditRoute({ byService: true })
  async void(
    @Param('id') id: string,
    @Body() dto: VoidPaymentDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, 'del pago');
    const { payment, version } = await this.payments.void(
      id,
      dto.reason,
      expected,
      req.user.id,
    );
    res.setHeader('ETag', etag(version));
    return payment;
  }
}

/** Los pagos vistos desde el lead: resumen y activación del diagnóstico. */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('leads/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class LeadPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Total confirmado por moneda, pago pendiente y diagnóstico del lead. */
  @Get('payment-summary')
  @AuditRoute({ action: 'LEAD_PAYMENT_SUMMARY_VIEWED', entity: 'Lead' })
  async summary(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const summary = await this.payments.leadSummary(id);
    res.setHeader('ETag', etag(summary.confirmedCount));
    return summary;
  }

  /**
   * Activa el diagnóstico con pago. Responde el enlace una sola vez, para
   * copiarlo; `emailSent: false` si el correo no salió.
   */
  @Post('diagnostic-activation')
  @ApiHeader(SUMMARY_IF_MATCH)
  @AuditRoute({ byService: true })
  async activate(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, 'de los pagos del lead');
    const created = await this.payments.activateDiagnostic(
      id,
      expected,
      req.user.id,
    );
    res.location(`/api/v1/diagnostics/${encodeURIComponent(created.id)}`);
    return created;
  }
}
