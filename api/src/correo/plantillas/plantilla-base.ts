export const MARCA = 'Music Finance Pro';

export interface CorreoRenderizado {
  asunto: string;
  html: string;
  texto: string;
}

export interface ContenidoBase {
  asunto: string;
  titulo: string;
  parrafos: string[];
  boton?: { texto: string; url: string };
  /** Texto chico bajo el botón (ej. "si no lo pediste, ignora este correo"). */
  nota?: string;
}

export interface OpcionesMarca {
  /** URL pública y absoluta del logo; sin ella el encabezado va en texto. */
  logoUrl?: string;
}

export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plantilla común de todos los correos: encabezado con logo, cuerpo y pie.
 * HTML de tablas con estilos en línea porque es lo único que respetan
 * todos los clientes de correo. Todo lo variable pasa por `escaparHtml`.
 */
export function renderizarPlantillaBase(
  contenido: ContenidoBase,
  marca: OpcionesMarca = {},
): CorreoRenderizado {
  const encabezado = marca.logoUrl
    ? `<img src="${escaparHtml(marca.logoUrl)}" alt="${MARCA}" height="40" style="display:block;border:0;height:40px;">`
    : `<span style="font-size:20px;font-weight:700;color:#111827;">${MARCA}</span>`;

  const parrafosHtml = contenido.parrafos
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#374151;">${escaparHtml(p)}</p>`,
    )
    .join('');

  const botonHtml = contenido.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:6px;background:#111827;">
<a href="${escaparHtml(contenido.boton.url)}" style="display:inline-block;padding:12px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${escaparHtml(contenido.boton.texto)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#6b7280;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${escaparHtml(contenido.boton.url)}" style="color:#374151;word-break:break-all;">${escaparHtml(contenido.boton.url)}</a></p>`
    : '';

  const notaHtml = contenido.nota
    ? `<p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">${escaparHtml(contenido.nota)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(contenido.asunto)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;">${encabezado}</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#111827;">${escaparHtml(contenido.titulo)}</h1>
${parrafosHtml}${botonHtml}${notaHtml}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#9ca3af;">
${MARCA} · SCORE<br>Recibes este correo porque se solicitó desde la plataforma SCORE. Si respondes, le llega al equipo de ${MARCA}.
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const texto = [
    contenido.titulo,
    '',
    ...contenido.parrafos.flatMap((p) => [p, '']),
    ...(contenido.boton
      ? [`${contenido.boton.texto}: ${contenido.boton.url}`, '']
      : []),
    ...(contenido.nota ? [contenido.nota, ''] : []),
    '--',
    `${MARCA} · SCORE`,
  ].join('\n');

  return { asunto: contenido.asunto, html, texto };
}
