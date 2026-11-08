import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CalculationsService } from './calculations.service';

/** Si el motor está activo y cuál es, para que el panel lo muestre. */
@ApiTags('calculations')
@ApiBearerAuth()
@Controller('scoring-engine')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScoringEngineStatusController {
  constructor(private readonly calculations: CalculationsService) {}

  @Get('status')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  status() {
    return this.calculations.status();
  }
}
