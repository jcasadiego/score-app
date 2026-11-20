"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken, renewSessionIfNeeded } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import type { IssuedLink } from "@/lib/api/diagnostics";
import {
  activateDiagnostic,
  confirmPayment,
  registerPayment,
  voidPayment,
} from "@/lib/api/payments";
import {
  AMOUNT_PATTERN,
  REFERENCE_MAX,
  VOID_REASON_MAX,
  VOID_REASON_MIN,
  isCurrency,
  isPaymentMethod,
  normalizeAmount,
  type CurrencyCode,
  type PaymentMethod,
} from "@/lib/payments/labels";

export interface PaymentActionResult {
  ok: boolean;
  error?: string;
  /** `code` de la API (RFC 9457): la pantalla decide con él, no con el texto. */
  code?: string;
  /** 412: otro cambió el dato; la pantalla recarga sin cerrar el formulario. */
  stale?: boolean;
}

/**
 * El enlace solo viaja en la respuesta de la acción, al navegador que la pidió:
 * no se guarda en la URL, en logs ni en el servidor.
 */
export interface ActivationResult extends PaymentActionResult {
  diagnosticId?: string;
  link?: IssuedLink;
}

export interface RegisterPaymentInput {
  leadId: string;
  amount: string;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
}

async function sessionToken(): Promise<string> {
  await verifySession();
  const token = await getToken();
  if (!token) {
    throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
  }
  await renewSessionIfNeeded();
  return token;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function refresh() {
  revalidatePath("/payments");
  revalidatePath("/leads");
}

async function failure(
  error: unknown,
  fallback: string,
): Promise<PaymentActionResult> {
  await redirectIfSessionExpired(error);
  if (!(error instanceof ApiError)) return { ok: false, error: fallback };
  if (error.status === 412) refresh();
  return {
    ok: false,
    error:
      error.status === 412
        ? "Alguien más cambió estos pagos. Recargamos los datos: revísalos e intenta de nuevo."
        : error.message,
    code: error.code,
    stale: error.status === 412,
  };
}

/** Solo Aprobador (lo valida la API). Queda pendiente. */
export async function registerPaymentAction(
  input: RegisterPaymentInput,
): Promise<PaymentActionResult> {
  try {
    const token = await sessionToken();
    // Una Server Action es un endpoint público: no confiar en los tipos.
    const amount =
      typeof input?.amount === "string" ? normalizeAmount(input.amount) : "";
    const reference =
      typeof input?.reference === "string" ? input.reference.trim() : "";
    const paidAt = typeof input?.paidAt === "string" ? input.paidAt : "";
    if (
      !isId(input?.leadId) ||
      !AMOUNT_PATTERN.test(amount) ||
      !isCurrency(input.currency) ||
      !isPaymentMethod(input.method) ||
      reference.length === 0 ||
      reference.length > REFERENCE_MAX ||
      Number.isNaN(Date.parse(paidAt))
    ) {
      throw new ApiError(400, "Revisa los datos del pago e intenta de nuevo.");
    }
    await registerPayment(token, {
      leadId: input.leadId,
      amount,
      currency: input.currency,
      method: input.method,
      reference,
      paidAt,
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos registrar el pago. Intenta de nuevo.");
  }
}

/** Verifica el cobro. No crea el diagnóstico. */
export async function confirmPaymentAction(
  id: string,
  version: number,
): Promise<PaymentActionResult> {
  try {
    const token = await sessionToken();
    if (!isId(id) || !isVersion(version)) {
      throw new ApiError(400, "No pudimos identificar el pago.");
    }
    await confirmPayment(token, id, version);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos confirmar el pago. Intenta de nuevo.");
  }
}

export async function voidPaymentAction(
  id: string,
  version: number,
  reason: string,
): Promise<PaymentActionResult> {
  try {
    const token = await sessionToken();
    const cleanReason =
      typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
    if (
      !isId(id) ||
      !isVersion(version) ||
      cleanReason.length < VOID_REASON_MIN ||
      cleanReason.length > VOID_REASON_MAX
    ) {
      throw new ApiError(400, "Revisa el motivo e intenta de nuevo.");
    }
    await voidPayment(token, id, version, cleanReason);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos anular el pago. Intenta de nuevo.");
  }
}

/**
 * Crea el diagnóstico pagado, envía el enlace y pasa el lead a convertido.
 * `confirmedCount` son los cobros que el Aprobador vio: si otro se confirmó
 * después, la API responde 412.
 */
export async function activateDiagnosticAction(
  leadId: string,
  confirmedCount: number,
): Promise<ActivationResult> {
  try {
    const token = await sessionToken();
    if (!isId(leadId) || !isVersion(confirmedCount)) {
      throw new ApiError(400, "No pudimos identificar el lead.");
    }
    const created = await activateDiagnostic(token, leadId, confirmedCount);
    refresh();
    revalidatePath("/diagnostics");
    return {
      ok: true,
      diagnosticId: created.id,
      link: { accessLink: created.accessLink, emailSent: created.emailSent },
    };
  } catch (error) {
    return failure(
      error,
      "No pudimos activar el diagnóstico. Intenta de nuevo.",
    );
  }
}
