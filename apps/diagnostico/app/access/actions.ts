"use server";

import { callApi } from "@/lib/api/client";
import type { ActionResult } from "@/lib/api/types";
import { saveSession } from "@/lib/session/cookie";

/** Un token de 32 bytes en base64url mide 43; la API acepta hasta 128. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Canjea el token del enlace por una sesión y la guarda en la cookie
 * `httpOnly`. La sesión nunca vuelve al navegador.
 */
export async function redeemAccessLink(token: string): Promise<ActionResult> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_ACCESS_LINK",
      message: "El enlace no es válido.",
    };
  }

  const result = await callApi<{ sessionToken: string; expiresAt: string }>(
    "/diagnostic-sessions",
    { method: "POST", body: { token } },
  );
  if (!result.ok) return result;

  await saveSession(result.data.sessionToken, result.data.expiresAt);
  return { ok: true, data: undefined };
}
