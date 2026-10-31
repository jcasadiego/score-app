import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { ValidatedEnv } from '../config/validate-env';
import { LogMailAdapter } from './adapters/log-mail.adapter';
import { ResendMailAdapter } from './adapters/resend-mail.adapter';
import { MAIL_PORT } from './mail.port';
import { MailService } from './mail.service';

@Module({
  imports: [AuditModule],
  providers: [
    MailService,
    {
      // `validateEnv` ya garantiza que con `resend` están las tres variables.
      provide: MAIL_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ValidatedEnv, true>) =>
        config.get('MAIL_DRIVER', { infer: true }) === 'resend'
          ? new ResendMailAdapter({
              apiKey: config.get('RESEND_API_KEY', { infer: true }),
              from: config.get('MAIL_FROM', { infer: true }),
              replyTo: config.get('MAIL_REPLY_TO', { infer: true }),
            })
          : new LogMailAdapter(),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
