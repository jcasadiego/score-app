import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { EXTERNAL_LINK_MAX } from '../external-link-rules';

export class ExternalLinkDto {
  /** Solo https; las plataformas exigen su dominio. Lo valida el servicio. */
  @ApiProperty({
    maxLength: EXTERNAL_LINK_MAX,
    example: 'https://open.spotify.com/artist/x',
  })
  @IsString()
  @MaxLength(EXTERNAL_LINK_MAX)
  url!: string;
}
