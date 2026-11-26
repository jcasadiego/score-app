import {
  ALERT_LOOKBACK_WINDOWS,
  ALERT_WINDOW_MS,
  completedWindows,
  SECURITY_ALERT_RULES,
} from './security-alert-rules';

describe('Ventanas de las alertas de seguridad', () => {
  it('devuelve las últimas ventanas completas, alineadas al reloj', () => {
    const now = Date.parse('2026-11-26T10:07:30Z');

    expect(completedWindows(now)).toEqual([
      {
        start: new Date('2026-11-26T09:50:00Z'),
        end: new Date('2026-11-26T09:55:00Z'),
      },
      {
        start: new Date('2026-11-26T09:55:00Z'),
        end: new Date('2026-11-26T10:00:00Z'),
      },
      {
        start: new Date('2026-11-26T10:00:00Z'),
        end: new Date('2026-11-26T10:05:00Z'),
      },
    ]);
  });

  it('espera el margen antes de dar una ventana por cerrada', () => {
    const windows = completedWindows(Date.parse('2026-11-26T10:05:05Z'));

    expect(windows[ALERT_LOOKBACK_WINDOWS - 1].end).toEqual(
      new Date('2026-11-26T10:00:00Z'),
    );
    expect(windows[0].end.getTime() - windows[0].start.getTime()).toBe(
      ALERT_WINDOW_MS,
    );
  });

  it('cada MFA restablecido alerta, y no hay reglas repetidas', () => {
    expect(
      SECURITY_ALERT_RULES.find((rule) => rule.action === 'MFA_RESET')
        ?.threshold,
    ).toBe(1);
    const actions = SECURITY_ALERT_RULES.map((rule) => rule.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
