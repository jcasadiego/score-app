/**
 * Decodifica el payload del JWT que emite `POST /auth/login` de la API,
 * sin verificar la firma: el panel no conoce `JWT_SECRET` (es un secreto
 * exclusivo de `api`), así que solo lee estos datos para mostrarlos en la
 * UI y para el chequeo optimista del proxy. La autorización real ocurre
 * en la API cuando el panel la consuma con este token como Bearer.
 */
export interface PayloadSesion {
  id: string;
  email: string;
  rol: string;
  exp: number;
}

export function decodificarToken(token: string): PayloadSesion | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(partes[1], "base64url").toString("utf-8"),
    ) as { sub?: string; email?: string; rol?: string; exp?: number };

    if (!payload.sub || !payload.email || !payload.rol || !payload.exp) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
      rol: payload.rol,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
