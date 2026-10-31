import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { LeadStatus } from '../../../generated/prisma/enums';

/** Lo único del lead que se edita desde el panel — sus datos no. */
export class CambiarEstadoLeadDto {
  @ApiProperty({ enum: LeadStatus, enumName: 'LeadStatus' })
  @IsEnum(LeadStatus)
  status!: LeadStatus;
}
