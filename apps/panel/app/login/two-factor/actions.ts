"use server";

import { redirect } from "next/navigation";
import {
  CHALLENGE_EXPIRED_MESSAGE,
  confirmMfaEnrollment,
  startMfaEnrollment,
  verifyMfa,
  type MfaEnrollment,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { HOME_ROUTE } from "@/lib/auth/constants";
import {
  createSession,
  deleteMfaChallenge,
  getMfaChallenge,
} from "@/lib/auth/session";

const GENERIC_ERROR = "Ocurrió un error inesperado. Intenta de nuevo.";

/** El reto venció: ya no hay nada que hacer en esta pantalla. */
async function redirectIfChallengeExpired(error: unknown): Promise<string> {
  const message = error instanceof ApiError ? error.message : GENERIC_ERROR;
  if (message === CHALLENGE_EXPIRED_MESSAGE) {
    await deleteMfaChallenge();
    redirect("/login?notice=mfa-expired");
  }
  return message;
}

async function requireChallenge(): Promise<string> {
  const mfaToken = await getMfaChallenge();
  if (!mfaToken) redirect("/login?notice=mfa-expired");
  return mfaToken;
}

export interface VerifyState {
  error?: string;
}

export async function verifyMfaAction(
  _prevState: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  const recoveryCode = String(formData.get("recoveryCode") ?? "").trim();
  if (!code && !recoveryCode) {
    return { error: "Ingresa el código." };
  }

  const mfaToken = await requireChallenge();
  let accessToken: string;
  try {
    accessToken = await verifyMfa(
      mfaToken,
      recoveryCode ? { recoveryCode } : { code },
    );
  } catch (error) {
    return { error: await redirectIfChallengeExpired(error) };
  }

  await deleteMfaChallenge();
  await createSession(accessToken);
  redirect(HOME_ROUTE);
}

export interface EnrollmentState {
  enrollment?: MfaEnrollment;
  error?: string;
}

export async function startEnrollmentAction(): Promise<EnrollmentState> {
  const mfaToken = await requireChallenge();
  try {
    return { enrollment: await startMfaEnrollment(mfaToken) };
  } catch (error) {
    return { error: await redirectIfChallengeExpired(error) };
  }
}

export interface ConfirmState {
  recoveryCodes?: string[];
  error?: string;
}

/**
 * Abre la sesión y devuelve los códigos de recuperación, que no se vuelven a
 * mostrar. Sin `redirect`: quien entra debe verlos antes de seguir.
 */
export async function confirmEnrollmentAction(
  _prevState: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { error: "Ingresa los 6 dígitos del código." };
  }

  const mfaToken = await requireChallenge();
  try {
    const { accessToken, recoveryCodes } = await confirmMfaEnrollment(
      mfaToken,
      code,
    );
    await deleteMfaChallenge();
    await createSession(accessToken);
    return { recoveryCodes };
  } catch (error) {
    return { error: await redirectIfChallengeExpired(error) };
  }
}
