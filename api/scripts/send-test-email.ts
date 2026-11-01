/**
 * Prueba manual del servicio de correo (`pnpm mail:test tu@email.com`).
 * Levanta la API sin HTTP y envía los dos correos iniciales con un enlace
 * de ejemplo, usando el adaptador que diga `MAIL_DRIVER` en `.env`. Con
 * `log` el correo aparece en la consola; con `resend` llega de verdad.
 * Necesita Postgres arriba: cada envío queda en la bitácora de auditoría.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Uso: pnpm mail:test tu@email.com');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const mail = app.get(MailService);
    const recipient = {
      to,
      name: 'Persona de prueba',
      link: 'http://localhost:3001/e/enlace-de-prueba',
    };
    const context = { entity: 'EmailTest' };

    console.log(
      'Tu diagnóstico SCORE →',
      await mail.sendDiagnosticLink(recipient, context),
    );
    console.log(
      'Recupera tu enlace →',
      await mail.sendLinkRecovery(recipient, context),
    );
  } finally {
    await app.close();
  }
}

main();
