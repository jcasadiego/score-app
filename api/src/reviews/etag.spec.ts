import { HttpStatus } from '@nestjs/common';
import { assertVersion, requireIfMatch, reviewEtag } from './etag';

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { getStatus(): number }).getStatus();
  }
  return undefined;
}

describe('ETag de la revisión', () => {
  it('es fuerte y lleva la versión', () => {
    expect(reviewEtag(7)).toBe('"7"');
  });

  it('lee la versión de If-Match', () => {
    expect(requireIfMatch('"7"')).toBe(7);
    expect(requireIfMatch(' "0" ')).toBe(0);
  });

  it.each([undefined, '', '*', 'W/"7"', '7', '"7", "8"', '"abc"'])(
    'sin un ETag fuerte de una versión (%s) responde 428',
    (header) => {
      expect(statusOf(() => requireIfMatch(header))).toBe(
        HttpStatus.PRECONDITION_REQUIRED,
      );
    },
  );

  it('412 si la versión cambió', () => {
    expect(statusOf(() => assertVersion(3, 3))).toBeUndefined();
    expect(statusOf(() => assertVersion(4, 3))).toBe(
      HttpStatus.PRECONDITION_FAILED,
    );
  });
});
