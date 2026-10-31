/**
 * Prueba manual del servicio de correo (`pnpm correo:probar tu@email.com`).
 * Levanta la API sin HTTP y envía los dos correos iniciales con un enlace
 * de ejemplo, usando el adaptador que diga `CORREO_MODO` en `.env`. Con
 * `log` el correo aparece en la consola; con `resend` llega de verdad.
 * Necesita Postgres arriba: cada envío queda en la bitácora de auditoría.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CorreoService } from '../src/correo/correo.service';

async function main() {
  const para = process.argv[2];
  if (!para) {
    console.error('Uso: pnpm correo:probar tu@email.com');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const correo = app.get(CorreoService);
    const datos = {
      para,
      nombre: 'Persona de prueba',
      enlace: 'http://localhost:3001/e/enlace-de-prueba',
    };
    const contexto = { entity: 'EmailTest' };

    console.log(
      'Tu diagnóstico SCORE →',
      await correo.enviarEnlaceDiagnostico(datos, contexto),
    );
    console.log(
      'Recupera tu enlace →',
      await correo.enviarRecuperacionEnlace(datos, contexto),
    );
  } finally {
    await app.close();
  }
}

main();
