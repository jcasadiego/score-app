import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DiagnosticFamily,
  QuestionnaireVersionStatus,
} from '../../../generated/prisma/enums';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../../users/dto/list-users.dto';

export class ListQuestionnaireVersionsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ enum: DiagnosticFamily, enumName: 'DiagnosticFamily' })
  @IsOptional()
  @IsEnum(DiagnosticFamily)
  family?: DiagnosticFamily;

  @ApiPropertyOptional({
    enum: QuestionnaireVersionStatus,
    enumName: 'QuestionnaireVersionStatus',
  })
  @IsOptional()
  @IsEnum(QuestionnaireVersionStatus)
  status?: QuestionnaireVersionStatus;
}
