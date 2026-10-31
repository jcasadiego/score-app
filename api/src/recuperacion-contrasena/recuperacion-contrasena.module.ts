import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CorreoModule } from '../correo/correo.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { RecuperacionContrasenaController } from './recuperacion-contrasena.controller';
import { RecuperacionContrasenaService } from './recuperacion-contrasena.service';

@Module({
  imports: [UsuariosModule, CorreoModule, AuditoriaModule],
  controllers: [RecuperacionContrasenaController],
  providers: [RecuperacionContrasenaService],
})
export class RecuperacionContrasenaModule {}
