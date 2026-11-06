import { DiagnosticStatus } from '../../generated/prisma/enums';
import { abandonmentCutoff, viewStatus } from './diagnostic-status';

const now = new Date('2026-11-10T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('viewStatus', () => {
  it('tras 7 días sin actividad, un diagnóstico sin completar está abandonado', () => {
    for (const status of [
      DiagnosticStatus.ACTIVE,
      DiagnosticStatus.IN_PROGRESS,
    ]) {
      expect(viewStatus({ status, lastActivityAt: daysAgo(8) }, now)).toBe(
        'ABANDONED',
      );
      expect(viewStatus({ status, lastActivityAt: daysAgo(6) }, now)).toBe(
        status,
      );
    }
  });

  it('uno completado nunca está abandonado', () => {
    expect(
      viewStatus(
        { status: DiagnosticStatus.COMPLETED, lastActivityAt: daysAgo(30) },
        now,
      ),
    ).toBe(DiagnosticStatus.COMPLETED);
  });

  it('el corte es exactamente 7 días antes', () => {
    expect(abandonmentCutoff(now)).toEqual(daysAgo(7));
  });
});
