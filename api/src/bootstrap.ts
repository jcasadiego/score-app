import {
  ClassSerializerInterceptor,
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { auditFailures } from './audit/audit-failures.middleware';
import { AuditService } from './audit/audit.service';
import { parseCorsOrigins } from './config/cors';
import {
  GlobalExceptionFilter,
  PROBLEM_CONTENT_TYPE,
} from './common/global-exception.filter';
import { validationExceptionFactory } from './common/validation-exception.factory';

/**
 * Configuración transversal de la app, compartida entre `main.ts` y los
 * tests e2e (`test/app.e2e-spec.ts`), que hasta ahora construían la app
 * sin pasar por `main.ts` y por lo tanto nunca ejercitaban helmet, CORS,
 * validación de DTOs ni versionado.
 */
export function configureApp(app: INestApplication): void {
  // Para que el throttler vea la IP real del cliente, no la del proxy. Debe ser
  // el número exacto de proxies: confiar en uno que no existe deja que el cliente
  // invente su IP con `X-Forwarded-For` y se salte el límite de login.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));

  app.use(auditFailures(app.get(AuditService)));

  app.use(helmet());

  app.enableCors({
    origin: parseCorsOrigins(process.env.CORS_ORIGINS),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Defensa en profundidad: si algún controller de dominio futuro
  // devuelve una instancia con campos @Exclude() (ej. un passwordHash),
  // no se filtra en la respuesta aunque nadie lo haga a propósito.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Lista de permitidos: un entorno no reconocido no publica la documentación.
  if (['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    const config = new DocumentBuilder()
      .setTitle('SCORE API')
      .setDescription(
        'API de SCORE (P4) — diagnóstico, panel y motor de cálculo',
      )
      .setVersion('1')
      .addBearerAuth()
      .addGlobalResponse({
        status: 'default',
        description: 'Error (RFC 9457)',
        content: {
          [PROBLEM_CONTENT_TYPE]: {
            schema: {
              type: 'object',
              required: [
                'type',
                'title',
                'status',
                'detail',
                'instance',
                'code',
              ],
              properties: {
                type: {
                  type: 'string',
                  example: 'urn:score:problem:not-found',
                },
                title: { type: 'string', example: 'Not Found' },
                status: { type: 'integer', example: 404 },
                detail: { type: 'string' },
                instance: { type: 'string', example: '/api/v1/leads/abc' },
                code: { type: 'string', example: 'NOT_FOUND' },
                errors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['message'],
                    properties: {
                      field: { type: 'string' },
                      code: { type: 'string' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }
}
