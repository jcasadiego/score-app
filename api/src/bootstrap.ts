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
import { parsearCorsOrigins } from './config/cors';
import { FiltroExcepcionesGlobal } from './common/filtro-excepciones-global.filter';

/**
 * Configuración transversal de la app, compartida entre `main.ts` y los
 * tests e2e (`test/app.e2e-spec.ts`), que hasta ahora construían la app
 * sin pasar por `main.ts` y por lo tanto nunca ejercitaban helmet, CORS,
 * validación de DTOs ni versionado.
 */
export function configurarApp(app: INestApplication): void {
  // Necesario para que el throttler (y cualquier lectura de IP) vea la IP
  // real del cliente y no la del proxy/balanceador, una vez desplegado
  // detrás de uno (Vercel, nginx, etc.) — sin esto, el rate limiting
  // termina agrupando a todos los clientes bajo una sola IP.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(helmet());

  app.enableCors({
    origin: parsearCorsOrigins(process.env.CORS_ORIGINS),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new FiltroExcepcionesGlobal());

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

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SCORE API')
      .setDescription(
        'API de SCORE (P4) — diagnóstico, panel y motor de cálculo',
      )
      .setVersion('1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }
}
