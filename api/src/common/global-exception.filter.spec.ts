import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Mock } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';
import { validationExceptionFactory } from './validation-exception.factory';

function run(exception: unknown, path = '/api/v1/recurso') {
  const response = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: `${path}?token=secreto` }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);

  return {
    response,
    body: (response.json as Mock).mock.calls[0][0] as Record<string, unknown>,
  };
}

describe('GlobalExceptionFilter', () => {
  it.each([
    [new BadRequestException('Dato inválido'), 400, 'BAD_REQUEST'],
    [new UnauthorizedException('Sin sesión'), 401, 'UNAUTHORIZED'],
    [new ForbiddenException('Sin permiso'), 403, 'FORBIDDEN'],
    [new NotFoundException('No existe'), 404, 'NOT_FOUND'],
    [new ConflictException('Ya existe'), 409, 'CONFLICT'],
  ])('responde RFC 9457 en %s', (exception, status, code) => {
    const { response, body } = run(exception);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(body).toEqual({
      type: `urn:score:problem:${code.toLowerCase().replace('_', '-')}`,
      title: expect.any(String),
      status,
      detail: exception.message,
      instance: '/api/v1/recurso',
      code,
    });
  });

  it('no repite la query del 404 de una ruta inexistente', () => {
    const { body } = run(new NotFoundException('Cannot GET /x?token=secreto'));

    expect(body).toMatchObject({ detail: 'Not Found' });
    expect(JSON.stringify(body)).not.toContain('secreto');
  });

  it('respeta el código propio de la excepción', () => {
    const { body } = run(
      new BadRequestException({ message: 'Enlace vencido', code: 'LINK_DEAD' }),
    );

    expect(body).toMatchObject({
      code: 'LINK_DEAD',
      type: 'urn:score:problem:link-dead',
      detail: 'Enlace vencido',
    });
  });

  it('no nombra a la librería en un 429', () => {
    const { body } = run(new ThrottlerException());

    expect(body).toMatchObject({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      detail: 'Too Many Requests',
    });
  });

  it('no expone detalles internos en un error no controlado', () => {
    const { body } = run(new Error('SELECT * FROM users falló en /srv/app'));

    expect(body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('SELECT');
    expect(JSON.stringify(body)).not.toContain('/srv/app');
  });

  it('usa el `detail` propio de la excepción', () => {
    const { body } = run(
      new ServiceUnavailableException({ detail: 'sin conexión a la base' }),
    );

    expect(body).toMatchObject({
      status: 503,
      detail: 'sin conexión a la base',
    });
  });

  it('da un código a cualquier otro estado HTTP', () => {
    const { body } = run(new HttpException('Caído', 503));

    expect(body).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('lista cada campo inválido con su motivo, también los anidados', () => {
    const { body } = run(
      validationExceptionFactory([
        {
          property: 'email',
          constraints: { isEmail: 'email must be an email' },
        },
        {
          property: 'lead',
          children: [
            {
              property: 'name',
              constraints: { isString: 'name must be a string' },
            },
          ],
        },
      ]),
    );

    expect(body).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [
        { field: 'email', message: 'email must be an email' },
        { field: 'lead.name', message: 'lead.name must be a string' },
      ],
    });
  });
});
