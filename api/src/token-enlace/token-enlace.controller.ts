import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RolUsuario } from '../../generated/prisma/enums';
import { EmitirEnlaceDto } from './dto/emitir-enlace.dto';
import { TokenEnlaceService } from './token-enlace.service';

/**
 * TODO(pendiente #2): endpoint solo para pruebas manuales/QA mientras no
 * existe `Caso`. Se reemplaza por el flujo real de emisión de enlaces
 * cuando esa entidad se defina (ver token-enlace.service.ts).
 */
@ApiTags('token-enlace')
@ApiBearerAuth()
@Controller('token-enlace')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TokenEnlaceController {
  constructor(private readonly tokenEnlace: TokenEnlaceService) {}

  @Post('emitir')
  @Roles(RolUsuario.ADMIN)
  async emitir(@Body() dto: EmitirEnlaceDto) {
    const token = await this.tokenEnlace.firmar(dto.identificadorId);
    return { token };
  }
}
