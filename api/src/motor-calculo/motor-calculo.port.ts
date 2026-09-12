export const MOTOR_CALCULO_PORT = Symbol('MOTOR_CALCULO_PORT');

export interface EvaluarDiagnosticoInput {
  familiaId: string;
  respuestas: Record<string, unknown>;
}

export interface EvaluarDiagnosticoResultado {
  resultado: Record<string, unknown>;
  versionReglasNumero: number;
}

/**
 * Límite entre la API y el motor de cálculo de SCORE. Qué hay detrás de
 * esta interfaz depende del escenario del motor (API ya ejecutable, hoja
 * de cálculo a portar, o a construir desde cero) — mientras eso se
 * confirma, `MotorCalculoStubAdapter` la implementa con un resultado de
 * ejemplo para no bloquear el resto de la API.
 */
export interface MotorCalculoPort {
  evaluarDiagnostico(
    input: EvaluarDiagnosticoInput,
  ): Promise<EvaluarDiagnosticoResultado>;
}
