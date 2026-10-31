const CLAVES_SENSIBLES = [
  'password',
  'passwordhash',
  'contrasena',
  'accesstoken',
  'token',
  'secret',
];

const MARCADOR = '[REDACTADO]';

function esClaveSensible(clave: string, clavesExtra: string[]): boolean {
  const normalizada = clave.toLowerCase();
  return (
    CLAVES_SENSIBLES.includes(normalizada) ||
    clavesExtra.some((extra) => extra.toLowerCase() === normalizada)
  );
}

/**
 * Recorre recursivamente un valor (body/params/query de una request) y
 * reemplaza el contenido de cualquier clave sensible (password, tokens,
 * secretos) antes de persistirlo en la bitácora de auditoría. Sin esto,
 * `POST /auth/login` guardaría el password en texto plano en
 * `RegistroAuditoria`. `clavesExtra` agrega claves a redactar solo para
 * esa llamada (ver `@RedactarEnAuditoria()`).
 */
export function redactarDatosSensibles(
  valor: unknown,
  clavesExtra: string[] = [],
): unknown {
  if (Array.isArray(valor)) {
    return valor.map((v) => redactarDatosSensibles(v, clavesExtra));
  }

  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([clave, v]) => [
        clave,
        esClaveSensible(clave, clavesExtra)
          ? MARCADOR
          : redactarDatosSensibles(v, clavesExtra),
      ]),
    );
  }

  return valor;
}
