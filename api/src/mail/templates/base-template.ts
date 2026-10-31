export const BRAND_NAME = 'Music Finance Pro';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface BaseContent {
  subject: string;
  title: string;
  paragraphs: string[];
  button?: { text: string; url: string };
  /** Texto chico bajo el botón (ej. "si no lo pediste, ignora este correo"). */
  note?: string;
}

export interface BrandOptions {
  /** URL pública y absoluta del logo; sin ella el encabezado va en texto. */
  logoUrl?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plantilla común de todos los correos: encabezado con logo, cuerpo y pie.
 * HTML de tablas con estilos en línea porque es lo único que respetan
 * todos los clientes de correo. Todo lo variable pasa por `escapeHtml`.
 */
export function renderBaseTemplate(
  content: BaseContent,
  brand: BrandOptions = {},
): RenderedEmail {
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${BRAND_NAME}" height="40" style="display:block;border:0;height:40px;">`
    : `<span style="font-size:20px;font-weight:700;color:#111827;">${BRAND_NAME}</span>`;

  const paragraphsHtml = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#374151;">${escapeHtml(p)}</p>`,
    )
    .join('');

  const buttonHtml = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:6px;background:#111827;">
<a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:12px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(content.button.text)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#6b7280;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${escapeHtml(content.button.url)}" style="color:#374151;word-break:break-all;">${escapeHtml(content.button.url)}</a></p>`
    : '';

  const noteHtml = content.note
    ? `<p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">${escapeHtml(content.note)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;">${header}</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#111827;">${escapeHtml(content.title)}</h1>
${paragraphsHtml}${buttonHtml}${noteHtml}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#9ca3af;">
${BRAND_NAME} · SCORE<br>Recibes este correo porque se solicitó desde la plataforma SCORE. Si respondes, le llega al equipo de ${BRAND_NAME}.
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    content.title,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.button
      ? [`${content.button.text}: ${content.button.url}`, '']
      : []),
    ...(content.note ? [content.note, ''] : []),
    '--',
    `${BRAND_NAME} · SCORE`,
  ].join('\n');

  return { subject: content.subject, html, text };
}
