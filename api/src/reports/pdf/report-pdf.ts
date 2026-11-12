import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as pdfkit from 'pdfkit';
import { DiagnosticFamily, ReportPart } from '../../../generated/prisma/enums';
import { FAMILY_LABEL } from '../../mail/templates/emails';

// El paquete exporta la clase con `export =` en sus tipos y con nombre en sus
// dos builds (CommonJS y ESM): así sirve igual compilado y en los tests.
const { PDFDocument } = pdfkit as unknown as {
  PDFDocument: typeof import('pdfkit');
};
type Doc = InstanceType<typeof PDFDocument>;

/** Todo lo que el PDF muestra. Nada de aquí puede cambiar tras la entrega. */
export interface ReportPdfData {
  recipientName: string;
  family: DiagnosticFamily;
  /** Fecha del informe y fechas internas del PDF: la de su aprobación. */
  approvedAt: Date;
  /** En el orden del informe. */
  dimensions: {
    code: string;
    parts: { part: ReportPart; body: string }[];
  }[];
}

/**
 * Versión de la plantilla con que se generan los PDF nuevos. Cada entrega anota
 * la suya: para cambiar el diseño se agrega una versión a `TEMPLATES` y se sube
 * este número, sin tocar las anteriores mientras tengan enlaces vigentes (el
 * PDF de una entrega se vuelve a generar con su plantilla y debe dar la misma
 * huella).
 */
export const CURRENT_TEMPLATE_VERSION = 1;

const PART_LABEL: Record<ReportPart, string> = {
  FINDING: 'Hallazgo',
  IMPLICATION: 'Implicación',
  RECOMMENDATION: 'Recomendación',
  NEXT_STEP: 'Próximo paso',
};

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Fecha larga en UTC, sin depender de los datos de idioma de Node. */
function longDate(date: Date): string {
  return `${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}

/** Saltos de línea normalizados y sin caracteres de control. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
}

let fonts: { regular: Buffer; bold: Buffer } | undefined;

/**
 * Noto Sans (OFL) vive en `api/assets/fonts`. Se busca subiendo desde este
 * archivo hasta el `package.json`: la ruta es la misma compilado (`dist/src`)
 * que en los tests (`src`).
 */
function loadFonts() {
  if (fonts) return fonts;
  let dir = __dirname;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('No se encontró la raíz de la API');
    dir = parent;
  }
  const file = (name: string) =>
    readFileSync(join(dir, 'assets', 'fonts', name));
  fonts = {
    regular: file('NotoSans-Regular.ttf'),
    bold: file('NotoSans-Bold.ttf'),
  };
  return fonts;
}

const MARGIN = 56;
const INK = '#1a1a1a';
const MUTED = '#666666';
const RULE = '#cccccc';

/**
 * Plantilla 1: provisional y neutra, solo texto. El diseño y el contenido
 * metodológico fijo (escalas, explicación de cada dimensión) los aporta el
 * cliente; por eso no muestra puntajes.
 */
function templateV1(doc: Doc, data: ReportPdfData): void {
  const width = doc.page.width - MARGIN * 2;

  doc.font('bold').fontSize(9).fillColor(MUTED);
  doc.text('SCORE · MUSIC FINANCE PRO', { characterSpacing: 1 });
  doc.moveDown(1.5);
  doc.fontSize(22).fillColor(INK).text('Informe de diagnóstico');
  doc.moveDown(0.6);
  doc.font('regular').fontSize(10.5).fillColor(INK);
  doc.text(`Preparado para: ${clean(data.recipientName)}`);
  doc.text(`Tipo de diagnóstico: ${FAMILY_LABEL[data.family]}`);
  doc.text(`Fecha: ${longDate(data.approvedAt)}`);
  doc.moveDown(1);
  rule(doc, width);

  for (const dimension of data.dimensions) {
    // Un título no queda solo al pie de la página.
    if (doc.y > doc.page.height - MARGIN - 140) doc.addPage();
    doc.moveDown(1.2);
    doc.font('bold').fontSize(14).fillColor(INK);
    doc.text(`Dimensión ${dimension.code}`);
    for (const { part, body } of dimension.parts) {
      if (doc.y > doc.page.height - MARGIN - 70) doc.addPage();
      doc.moveDown(0.7);
      doc.font('bold').fontSize(10).fillColor(MUTED).text(PART_LABEL[part]);
      doc.moveDown(0.2);
      doc.font('regular').fontSize(10.5).fillColor(INK);
      doc.text(clean(body), { width, align: 'left', paragraphGap: 5 });
    }
  }

  // Pie con el número de página, ya con todas las páginas escritas.
  const { count } = doc.bufferedPageRange();
  for (let page = 0; page < count; page++) {
    doc.switchToPage(page);
    // Sin margen inferior: escribir en él no debe abrir una página nueva.
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(8).fillColor(MUTED);
    doc.text(
      `Documento confidencial · Página ${page + 1} de ${count}`,
      MARGIN,
      doc.page.height - 36,
      { width, align: 'center', lineBreak: false },
    );
  }
}

function rule(doc: Doc, width: number): void {
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke();
}

const TEMPLATES: Record<number, (doc: Doc, data: ReportPdfData) => void> = {
  1: templateV1,
};

export function hasTemplate(version: number): boolean {
  return version in TEMPLATES;
}

/**
 * El PDF del informe. Determinista: con los mismos datos y la misma plantilla
 * salen los mismos bytes (las fechas internas son la de la aprobación y la
 * fuente va en el repo), así que no se guarda el archivo sino su SHA-256.
 */
export function renderReportPdf(
  data: ReportPdfData,
  templateVersion = CURRENT_TEMPLATE_VERSION,
): Promise<Buffer> {
  const template = TEMPLATES[templateVersion];
  if (!template) {
    return Promise.reject(
      new Error(`No existe la plantilla de informe ${templateVersion}`),
    );
  }
  const { regular, bold } = loadFonts();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      bufferPages: true,
      lang: 'es',
      displayTitle: true,
      info: {
        Title: 'Informe de diagnóstico SCORE',
        Author: 'Music Finance Pro',
        Creator: `SCORE (plantilla ${templateVersion})`,
        Producer: 'SCORE',
        CreationDate: data.approvedAt,
        ModDate: data.approvedAt,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      doc.registerFont('regular', regular);
      doc.registerFont('bold', bold);
      template(doc, data);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
