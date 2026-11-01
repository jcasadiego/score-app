"use server";

import { redirect } from "next/navigation";
import {
  confirmPasswordReset,
  INVALID_LINK_STATUS,
} from "@/lib/api/password-reset";
import { ApiError } from "@/lib/api/errors";
import { deleteSession } from "@/lib/auth/session";

export interface ResetPasswordResult {
  error: string;
  invalidLink?: boolean;
}

export async function confirmPasswordResetAction(
  token: string,
  password: string,
): Promise<ResetPasswordResult> {
  try {
    await confirmPasswordReset(token, password);
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error: error.message,
        invalidLink: error.status === INVALID_LINK_STATUS,
      };
    }
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  // La API ya cerró todas las sesiones de la cuenta; si este navegador
  // tenía una abierta, se borra también la cookie.
  await deleteSession();
  redirect("/login?notice=password-reset");
}
