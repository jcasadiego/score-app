"use server";

import { requestPasswordReset } from "@/lib/api/password-reset";
import { ApiError } from "@/lib/api/errors";

export interface ForgotPasswordResult {
  ok: boolean;
  error?: string;
}

export async function requestPasswordResetAction(
  email: string,
): Promise<ForgotPasswordResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: "Ingresa tu correo." };
  }

  try {
    await requestPasswordReset(trimmed);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ApiError
          ? error.message
          : "Ocurrió un error inesperado. Intenta de nuevo en unos minutos.",
    };
  }
}
