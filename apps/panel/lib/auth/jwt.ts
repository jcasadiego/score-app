/**
 * Decodifica el payload del JWT que emite `POST /auth/login` de la API,
 * sin verificar la firma: el panel no conoce `JWT_SECRET` (es un secreto
 * exclusivo de `api`), así que solo lee estos datos para mostrarlos en la
 * UI y para el chequeo optimista del proxy. La autorización real ocurre
 * en la API cuando el panel la consuma con este token como Bearer.
 */
export interface SessionPayload {
  id: string;
  email: string;
  role: string;
  exp: number;
  iat?: number;
}

/**
 * La sesión se renueva pasada la mitad de la vida del token: da margen de
 * sobra para reintentar si la API no responde, sin llamarla en cada petición.
 */
export function shouldRenew(session: SessionPayload): boolean {
  if (!session.iat) return false;
  const halfLife = session.iat + (session.exp - session.iat) / 2;
  return Date.now() / 1000 >= halfLife;
}

export function decodeToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as { sub?: string; email?: string; role?: string; exp?: number; iat?: number };

    if (!payload.sub || !payload.email || !payload.role || !payload.exp) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}
