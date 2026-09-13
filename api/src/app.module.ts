import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { MotorCalculoModule } from './motor-calculo/motor-calculo.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReglasModule } from './reglas/reglas.module';
import { TokenEnlaceModule } from './token-enlace/token-enlace.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { validarEnv } from './config/validar-env';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
    AuditoriaModule,
    ReglasModule,
    MotorCalculoModule,
    UsuariosModule,
    AuthModule,
    TokenEnlaceModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
