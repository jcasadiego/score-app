import { Module } from '@nestjs/common';
import { ReglasService } from './reglas.service';

@Module({
  providers: [ReglasService],
  exports: [ReglasService],
})
export class ReglasModule {}
