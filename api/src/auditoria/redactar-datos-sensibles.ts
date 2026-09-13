const CLAVES_SENSIBLES = [
  'password',
  'passwordhash',
  'contrasena',
  'accesstoken',
  'token',
  'secret',
];

const MARCADOR = '[REDACTADO]';

function esClaveSensible(clave: string): boolean {
  return CLAVES_SENSIBLES.includes(clave.toLowerCase());
}

/**
 * Recorre recursivamente un valor (body/params/query de una request) y
 * reemplaza el contenido de cualquier clave sensible (password, tokens,
 * secretos) antes de persistirlo en la bitácora de auditoría. Sin esto,
 * `POST /auth/login` guardaría el password en texto plano en
 * `RegistroAuditoria`.
 */
export function redactarDatosSensibles(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(redactarDatosSensibles);
  }

  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([clave, v]) => [
        clave,
        esClaveSensible(clave) ? MARCADOR : redactarDatosSensibles(v),
      ]),
    );
  }

  return valor;
}
