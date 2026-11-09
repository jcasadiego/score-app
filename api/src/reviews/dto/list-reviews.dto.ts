import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ReviewStatus } from '../../../generated/prisma/enums';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../../users/dto/list-users.dto';

/** `unassigned` incluye los casos tomados por alguien desactivado. */
export const REVIEW_ASSIGNMENTS = ['unassigned', 'mine'] as const;
export type ReviewAssignment = (typeof REVIEW_ASSIGNMENTS)[number];

export class ListReviewsDto {
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

  @ApiPropertyOptional({ enum: REVIEW_ASSIGNMENTS })
  @IsOptional()
  @IsIn(REVIEW_ASSIGNMENTS)
  assignment?: ReviewAssignment;

  @ApiPropertyOptional({ enum: ReviewStatus, enumName: 'ReviewStatus' })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}
