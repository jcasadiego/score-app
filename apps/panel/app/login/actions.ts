"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { saveMfaChallenge } from "@/lib/auth/session";
import { MFA_ROUTE, MFA_SETUP_ROUTE } from "@/lib/auth/constants";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y tu contraseña." };
  }

  let challenge: Awaited<ReturnType<typeof login>>;
  try {
    challenge = await login(email, password);
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "No pudimos iniciar sesión. Intenta de nuevo en unos minutos.";
    return { error: message };
  }

  await saveMfaChallenge(challenge.mfaToken);
  redirect(
    challenge.mfaStatus === "ENROLLMENT_REQUIRED" ? MFA_SETUP_ROUTE : MFA_ROUTE,
  );
}
