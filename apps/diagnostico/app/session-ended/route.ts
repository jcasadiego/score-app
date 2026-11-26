import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "@/lib/api/client";
import { deleteSession, getSession } from "@/lib/session/cookie";
import { recoverUrl, ROUTES } from "@/lib/routes";

/**
 * La API rechazó la sesión (venció, o el enlace fue reemplazado o revocado). Un
 * Server Component no puede borrar cookies, así que pasa por aquí.
 *
 * Es un GET, así que cualquier sitio podría enlazarlo. Por eso solo borra la
 * cookie de una sesión que la API de verdad rechaza: si la sigue aceptando, el
 * enlace no cierra nada y se vuelve al cuestionario (como `/session-expired`
 * del panel; auditoría de seguridad, corrida 1).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session) {
    const result = await callApi("/diagnostic-sessions/current", { session });
    const rejected =
      !result.ok && (result.status === 401 || result.status === 403);
    if (!rejected) {
      return NextResponse.redirect(new URL(ROUTES.questionnaire, request.url));
    }
  }

  await deleteSession();
  return NextResponse.redirect(new URL(recoverUrl("session"), request.url));
}
