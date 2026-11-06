import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PasswordLinkService } from './password-link.service';

/** Aparte de `PasswordResetModule` para que `users` y `auth` lo usen sin ciclos. */
@Module({
  imports: [MailModule],
  providers: [PasswordLinkService],
  exports: [PasswordLinkService],
})
export class PasswordLinkModule {}
