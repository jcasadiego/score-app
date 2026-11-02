const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'contrasena',
  'accesstoken',
  'token',
  'secret',
];

const REDACTED_MARKER = '[REDACTADO]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.includes(key.toLowerCase());
}

/**
 * Recorre recursivamente un valor (body/params/query de una request) y
 * reemplaza el contenido de cualquier clave sensible (password, tokens,
 * secretos) antes de persistirlo en la bitácora de auditoría. Sin esto,
 * `POST /auth/login` guardaría el password en texto plano en
 * `AuditLog`. Es la segunda defensa: lo primero es que `@AuditRoute()` solo
 * deja pasar los campos declarados.
 */
export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitiveData(v));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        isSensitiveKey(key) ? REDACTED_MARKER : redactSensitiveData(v),
      ]),
    );
  }

  return value;
}
