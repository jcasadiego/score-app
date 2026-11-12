import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuditRoute } from '../audit/audit-route.decorator';
import { DownloadReportDto } from './dto/download-report.dto';
import {
  REPORT_FILENAME,
  ReportDeliveriesService,
} from './report-deliveries.service';

/**
 * Ruta pública con que el cliente final descarga su informe. El token va en el
 * cuerpo, nunca en la URL. 401 con el mismo mensaje si el enlace es inválido,
 * venció o fue revocado. Límite propio contra quien pruebe tokens.
 */
@ApiTags('report-downloads')
@Controller('report-downloads')
export class ReportDownloadsController {
  constructor(private readonly deliveries: ReportDeliveriesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', `attachment; filename="${REPORT_FILENAME}"`)
  @Header('Cache-Control', 'no-store')
  async download(@Body() dto: DownloadReportDto): Promise<StreamableFile> {
    return new StreamableFile(await this.deliveries.download(dto.token));
  }
}
