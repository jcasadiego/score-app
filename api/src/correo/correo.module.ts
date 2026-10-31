import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EnvValidado } from '../config/validar-env';
import { CorreoLogAdapter } from './adapters/correo-log.adapter';
import { CorreoResendAdapter } from './adapters/correo-resend.adapter';
import { CORREO_PORT } from './correo.port';
import { CorreoService } from './correo.service';

@Module({
  imports: [AuditoriaModule],
  providers: [
    CorreoService,
    {
      // `validarEnv` ya garantiza que con `resend` están las tres variables.
      provide: CORREO_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvValidado, true>) =>
        config.get('CORREO_MODO', { infer: true }) === 'resend'
          ? new CorreoResendAdapter({
              apiKey: config.get('RESEND_API_KEY', { infer: true }),
              remitente: config.get('CORREO_REMITENTE', { infer: true }),
              replyTo: config.get('CORREO_REPLY_TO', { infer: true }),
            })
          : new CorreoLogAdapter(),
    },
  ],
  exports: [CorreoService],
})
export class CorreoModule {}
