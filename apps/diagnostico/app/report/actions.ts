"use server";

import { callApiFile } from "@/lib/api/client";
import type { ActionResult } from "@/lib/api/types";

/** Un token de 32 bytes en base64url mide 43; la API acepta hasta 128. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Pide el PDF del informe con el token del enlace, en el cuerpo de un POST
 * (nunca en la URL). No guarda nada: ni cookie ni sesión. La API registra la
 * descarga y responde 401 con el mismo mensaje si el enlace es inválido,
 * venció o fue reemplazado.
 */
export async function downloadReport(
  token: string,
): Promise<ActionResult<Uint8Array>> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_REPORT_LINK",
      message: "El enlace no es válido.",
    };
  }
  return callApiFile("/report-downloads", {
    body: { token },
    contentType: "application/pdf",
  });
}
