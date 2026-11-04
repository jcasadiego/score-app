import { BadRequestException, ValidationError } from '@nestjs/common';
import { ProblemError, VALIDATION_FAILED_CODE } from './problem-details';

function flatten(errors: ValidationError[], parent = ''): ProblemError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((constraint) => ({
      field,
      // Mismo texto que el `ValidationPipe` por defecto, que lee la ruta legacy.
      message: parent ? `${parent}.${constraint}` : constraint,
    }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/** Conserva el campo de cada error, que el `ValidationPipe` por defecto pierde. */
export function validationExceptionFactory(
  validationErrors: ValidationError[],
): BadRequestException {
  const errors = flatten(validationErrors);
  return new BadRequestException({
    message: errors.map(({ message }) => message),
    code: VALIDATION_FAILED_CODE,
    errors,
  });
}
