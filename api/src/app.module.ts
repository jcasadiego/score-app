import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { HealthModule } from './health/health.module';
import { MotorCalculoModule } from './motor-calculo/motor-calculo.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReglasModule } from './reglas/reglas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditoriaModule,
    ReglasModule,
    MotorCalculoModule,
    HealthModule,
  ],
})
export class AppModule {}
