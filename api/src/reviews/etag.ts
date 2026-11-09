import { HttpException, HttpStatus } from '@nestjs/common';

export const IF_MATCH_REQUIRED = 'IF_MATCH_REQUIRED';
export const REVIEW_VERSION_MISMATCH = 'REVIEW_VERSION_MISMATCH';

/** ETag fuerte de una revisión: su `version` entre comillas (RFC 9110 8.8.3). */
export function reviewEtag(version: number): string {
  return `"${version}"`;
}

/**
 * La versión que trae `If-Match`, o 428 si falta. Solo un ETag fuerte de una
 * sola versión: `*` o una lista anularían la protección contra cambios
 * perdidos, y uno débil nunca coincide en `If-Match` (RFC 9110 13.1.1).
 */
export function requireIfMatch(header: string | undefined): number {
  const match = /^\s*"(\d{1,9})"\s*$/.exec(header ?? '');
  if (!match) {
    throw new HttpException(
      {
        message:
          'Falta la versión del caso (If-Match). Vuelve a cargarlo antes de cambiarlo.',
        code: IF_MATCH_REQUIRED,
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  return Number(match[1]);
}

/** 412 si otro cambió el caso desde que se leyó. */
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new HttpException(
      {
        message:
          'El caso cambió desde que lo abriste. Vuelve a cargarlo y revisa los cambios.',
        code: REVIEW_VERSION_MISMATCH,
      },
      HttpStatus.PRECONDITION_FAILED,
    );
  }
}
