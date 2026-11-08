"use server";

import { callApi } from "@/lib/api/client";

export interface RecoverState {
  status: "idle" | "sent" | "error";
  message?: string;
}

const EMAIL_MAX = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pide un enlace nuevo. La API responde siempre lo mismo, exista o no un
 * diagnóstico con ese correo, y aquí se muestra tal cual.
 */
export async function requestNewLink(
  _previous: RecoverState,
  formData: FormData,
): Promise<RecoverState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    return {
      status: "error",
      message: "Escribe un correo válido, por ejemplo nombre@correo.com.",
    };
  }

  const result = await callApi<{ message: string }>("/access-link-recoveries", {
    method: "POST",
    body: { email },
  });
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.status === 400
          ? "Escribe un correo válido, por ejemplo nombre@correo.com."
          : result.message,
    };
  }
  return { status: "sent", message: result.data.message };
}
