import { NextResponse, type NextRequest } from "next/server";
import { deleteSession } from "@/lib/session/cookie";
import { recoverUrl } from "@/lib/routes";

/**
 * La API rechazó la sesión (venció, o el enlace fue reemplazado o revocado). Un
 * Server Component no puede borrar cookies, así que pasa por aquí.
 */
export async function GET(request: NextRequest) {
  await deleteSession();
  return NextResponse.redirect(new URL(recoverUrl("session"), request.url));
}
