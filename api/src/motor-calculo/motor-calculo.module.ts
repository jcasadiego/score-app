import { Module } from '@nestjs/common';
import { MotorCalculoStubAdapter } from './adapters/motor-calculo-stub.adapter';
import { MOTOR_CALCULO_PORT } from './motor-calculo.port';

@Module({
  providers: [
    {
      provide: MOTOR_CALCULO_PORT,
      useClass: MotorCalculoStubAdapter,
    },
  ],
  exports: [MOTOR_CALCULO_PORT],
})
export class MotorCalculoModule {}
