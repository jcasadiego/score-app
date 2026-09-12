import { Injectable } from '@nestjs/common';
import {
  EvaluarDiagnosticoInput,
  EvaluarDiagnosticoResultado,
  MotorCalculoPort,
} from '../motor-calculo.port';

/**
 * TODO: reemplazar cuando se confirme el escenario del motor real
 * (API ya ejecutable / hoja de cálculo a portar / construir desde cero —
 * ver CLAUDE.md sección 3). Devuelve un resultado de ejemplo para que el
 * resto de la API se pueda construir y probar contra el puerto ya
 * definido.
 */
@Injectable()
export class MotorCalculoStubAdapter implements MotorCalculoPort {
  async evaluarDiagnostico(
    input: EvaluarDiagnosticoInput,
  ): Promise<EvaluarDiagnosticoResultado> {
    return {
      resultado: {
        familiaId: input.familiaId,
        puntaje: null,
        pendiente: 'motor real no implementado',
      },
      versionReglasNumero: 0,
    };
  }
}
