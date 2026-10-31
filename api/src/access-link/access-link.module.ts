import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { AccessLinkController } from './access-link.controller';
import { AccessLinkGuard } from './access-link.guard';
import { AccessLinkService } from './access-link.service';

@Module({
  imports: [AuthModule, JwtModule.register({})],
  controllers: [AccessLinkController],
  providers: [AccessLinkService, AccessLinkGuard],
  exports: [AccessLinkService, AccessLinkGuard],
})
export class AccessLinkModule {}
