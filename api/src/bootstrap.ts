import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
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
  app.use(helmet());

  app.enableCors({
    origin: parsearCorsOrigins(process.env.CORS_ORIGINS),
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new FiltroExcepcionesGlobal());

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
