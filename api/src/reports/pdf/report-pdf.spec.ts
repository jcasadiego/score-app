import {
  CURRENT_TEMPLATE_VERSION,
  renderReportPdf,
  type ReportPdfData,
  sha256Hex,
} from './report-pdf';

const DATA: ReportPdfData = {
  recipientName: 'Valentina Quiroga',
  family: 'PROJECT',
  approvedAt: new Date('2026-11-12T15:30:00.000Z'),
  dimensions: ['D1', 'D2'].map((code) => ({
    code,
    parts: [
      { part: 'FINDING', body: `Hallazgo de ${code}.\nSegundo párrafo.` },
      { part: 'IMPLICATION', body: 'Implicación con acentos: áéíóú ñ ¿? ¡!' },
      { part: 'RECOMMENDATION', body: 'Recomendación.' },
      { part: 'NEXT_STEP', body: 'Próximo paso.' },
    ],
  })),
};

describe('renderReportPdf', () => {
  it('genera un PDF', async () => {
    const pdf = await renderReportPdf(DATA);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it('con los mismos datos da los mismos bytes, aunque pase el tiempo', async () => {
    const first = await renderReportPdf(DATA);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await renderReportPdf(DATA, CURRENT_TEMPLATE_VERSION);
    expect(sha256Hex(second)).toBe(sha256Hex(first));
  });

  it('un cambio en el texto, el nombre o la fecha cambia la huella', async () => {
    const base = sha256Hex(await renderReportPdf(DATA));
    const variants: ReportPdfData[] = [
      { ...DATA, recipientName: 'Otra Persona' },
      { ...DATA, approvedAt: new Date('2026-11-13T15:30:00.000Z') },
      {
        ...DATA,
        dimensions: [
          {
            code: 'D1',
            parts: [{ part: 'FINDING', body: 'Otro texto.' }],
          },
        ],
      },
    ];
    for (const variant of variants) {
      expect(sha256Hex(await renderReportPdf(variant))).not.toBe(base);
    }
  });

  it('un informe largo ocupa varias páginas sin fallar', async () => {
    const long = 'Texto largo del informe. '.repeat(150);
    const pdf = await renderReportPdf({
      ...DATA,
      dimensions: Array.from({ length: 8 }, (_, i) => ({
        code: `D${i + 1}`,
        parts: DATA.dimensions[0].parts.map((p) => ({ ...p, body: long })),
      })),
    });
    expect(
      pdf.toString('latin1').match(/\/Type \/Page\b/g)!.length,
    ).toBeGreaterThan(8);
  });

  it('rechaza una plantilla que no existe', async () => {
    await expect(renderReportPdf(DATA, 99)).rejects.toThrow(/plantilla/);
  });
});
