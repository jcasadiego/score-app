import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // En JSON para que el proveedor de logs pueda buscar y alertar por campo.
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });
  // Al desplegar, termina las peticiones en curso y cierra la base de datos.
  app.enableShutdownHooks();
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
