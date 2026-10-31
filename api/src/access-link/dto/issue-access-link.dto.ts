import { IsString, MinLength } from 'class-validator';

export class IssueAccessLinkDto {
  @IsString()
  @MinLength(1)
  /** Id de lo que abre el enlace (hoy genérico; luego, el Caso). */
  subjectId!: string;
}
