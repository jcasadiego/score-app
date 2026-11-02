export function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Un origen exacto con https: sin ruta, sin barra final y sin comodines. */
export function isSecureOrigin(origin: string): boolean {
  // `URL` acepta un asterisco en el host, y `https://*.dominio` no es un origen.
  if (origin.includes('*')) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
}
