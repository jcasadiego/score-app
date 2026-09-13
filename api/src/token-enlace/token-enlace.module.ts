import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { TokenEnlaceController } from './token-enlace.controller';
import { TokenEnlaceGuard } from './token-enlace.guard';
import { TokenEnlaceService } from './token-enlace.service';

@Module({
  imports: [AuthModule, JwtModule.register({})],
  controllers: [TokenEnlaceController],
  providers: [TokenEnlaceService, TokenEnlaceGuard],
  exports: [TokenEnlaceService, TokenEnlaceGuard],
})
export class TokenEnlaceModule {}
