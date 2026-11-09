import {
  CalculationStatus,
  FlagAnalysisStatus,
} from '../../generated/prisma/enums';
import {
  type ApprovalState,
  approvalBlockers,
  reviewStatusFor,
  usedAiException,
} from './approval-rules';

function state(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    latest: {
      status: CalculationStatus.SUCCEEDED,
      isSimulated: false,
      correctionSequence: 0,
      analysisStatus: FlagAnalysisStatus.SUCCEEDED,
      openFlags: 0,
    },
    lastCorrectionSequence: 0,
    production: false,
    ...overrides,
  };
}

const codes = (s: ApprovalState) => approvalBlockers(s).map((b) => b.code);
const latest = (overrides: Partial<NonNullable<ApprovalState['latest']>>) => ({
  ...state().latest!,
  ...overrides,
});

describe('approvalBlockers', () => {
  it('sin bloqueos cuando todo se cumple', () => {
    expect(approvalBlockers(state())).toEqual([]);
  });

  it('sin cálculo', () => {
    expect(codes(state({ latest: null }))).toEqual(['NO_CALCULATION']);
  });

  it.each([
    CalculationStatus.FAILED,
    CalculationStatus.PENDING,
    CalculationStatus.RUNNING,
  ])(
    'el último intento %s bloquea, aunque haya uno exitoso antes',
    (status) => {
      expect(codes(state({ latest: latest({ status }) }))).toEqual([
        'LATEST_CALCULATION_NOT_SUCCEEDED',
      ]);
    },
  );

  it('una corrección que el último cálculo no incluye bloquea', () => {
    expect(
      codes(
        state({
          latest: latest({ correctionSequence: 1 }),
          lastCorrectionSequence: 2,
        }),
      ),
    ).toEqual(['CORRECTIONS_NOT_CALCULATED']);
  });

  it('el cálculo que incluye la última corrección no bloquea', () => {
    expect(
      codes(
        state({
          latest: latest({ correctionSequence: 2 }),
          lastCorrectionSequence: 2,
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    FlagAnalysisStatus.FAILED,
    FlagAnalysisStatus.PENDING,
    FlagAnalysisStatus.RUNNING,
    null,
  ])('el análisis %s bloquea sin excepción', (analysisStatus) => {
    expect(codes(state({ latest: latest({ analysisStatus }) }))).toEqual([
      'FLAG_ANALYSIS_NOT_SUCCEEDED',
    ]);
  });

  it('con excepción y motivo, el análisis fallido no bloquea', () => {
    expect(
      codes(
        state({
          latest: latest({ analysisStatus: FlagAnalysisStatus.FAILED }),
          aiExceptionReason: 'La IA no está disponible hoy',
        }),
      ),
    ).toEqual([]);
  });

  it('un motivo en blanco no sirve de excepción', () => {
    expect(
      codes(
        state({
          latest: latest({ analysisStatus: FlagAnalysisStatus.FAILED }),
          aiExceptionReason: '   ',
        }),
      ),
    ).toEqual(['FLAG_ANALYSIS_NOT_SUCCEEDED']);
  });

  it('flags abiertos bloquean, también con excepción de IA', () => {
    const blockers = approvalBlockers(
      state({
        latest: latest({
          openFlags: 2,
          analysisStatus: FlagAnalysisStatus.FAILED,
        }),
        aiExceptionReason: 'IA caída',
      }),
    );
    expect(blockers).toEqual([
      expect.objectContaining({
        code: 'OPEN_FLAGS',
        message: expect.stringContaining('2 alertas'),
      }),
    ]);
  });

  it('en producción, un resultado simulado bloquea; fuera de producción no', () => {
    const simulated = latest({ isSimulated: true });
    expect(codes(state({ latest: simulated, production: true }))).toEqual([
      'SIMULATED_RESULT',
    ]);
    expect(codes(state({ latest: simulated, production: false }))).toEqual([]);
  });

  it('junta todos los bloqueos del cálculo exitoso', () => {
    expect(
      codes(
        state({
          latest: latest({
            isSimulated: true,
            correctionSequence: 0,
            analysisStatus: FlagAnalysisStatus.FAILED,
            openFlags: 1,
          }),
          lastCorrectionSequence: 1,
          production: true,
        }),
      ),
    ).toEqual([
      'CORRECTIONS_NOT_CALCULATED',
      'FLAG_ANALYSIS_NOT_SUCCEEDED',
      'OPEN_FLAGS',
      'SIMULATED_RESULT',
    ]);
  });
});

describe('usedAiException', () => {
  it('solo se guarda si el análisis no terminó bien', () => {
    expect(usedAiException(state({ aiExceptionReason: 'motivo' }))).toBeNull();
    expect(
      usedAiException(
        state({
          latest: latest({ analysisStatus: FlagAnalysisStatus.FAILED }),
          aiExceptionReason: '  motivo  ',
        }),
      ),
    ).toBe('motivo');
  });
});

describe('reviewStatusFor', () => {
  it('aprobada manda; si no, tomada o pendiente', () => {
    expect(reviewStatusFor(true, null)).toBe('APPROVED');
    expect(reviewStatusFor(true, 'u1')).toBe('APPROVED');
    expect(reviewStatusFor(false, 'u1')).toBe('IN_REVIEW');
    expect(reviewStatusFor(false, null)).toBe('PENDING');
  });
});
