const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'contrasena',
  'accesstoken',
  'token',
  'secret',
];

const REDACTED_MARKER = '[REDACTADO]';

function isSensitiveKey(key: string, extraKeys: string[]): boolean {
  const normalized = key.toLowerCase();
  return (
    SENSITIVE_KEYS.includes(normalized) ||
    extraKeys.some((extra) => extra.toLowerCase() === normalized)
  );
}

/**
 * Recorre recursivamente un valor (body/params/query de una request) y
 * reemplaza el contenido de cualquier clave sensible (password, tokens,
 * secretos) antes de persistirlo en la bitácora de auditoría. Sin esto,
 * `POST /auth/login` guardaría el password en texto plano en
 * `AuditLog`. `extraKeys` agrega claves a redactar solo para
 * esa llamada (ver `@RedactInAudit()`).
 */
export function redactSensitiveData(
  value: unknown,
  extraKeys: string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitiveData(v, extraKeys));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        isSensitiveKey(key, extraKeys)
          ? REDACTED_MARKER
          : redactSensitiveData(v, extraKeys),
      ]),
    );
  }

  return value;
}
