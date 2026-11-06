import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DiagnosticFamily } from '../../../generated/prisma/enums';

export class CreateQuestionnaireVersionDto {
  @ApiProperty({ enum: DiagnosticFamily, enumName: 'DiagnosticFamily' })
  @IsEnum(DiagnosticFamily)
  family!: DiagnosticFamily;
}
