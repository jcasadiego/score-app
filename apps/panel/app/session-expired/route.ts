import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { deleteSession } from "@/lib/auth/session";
import { HOME_ROUTE } from "@/lib/auth/constants";

/**
 * Un Server Component no puede borrar cookies: cuando la API rechaza el
 * token, la página redirige aquí. Sin borrarla habría un bucle, porque el
 * proxy solo lee la cookie y la seguiría viendo válida.
 *
 * Es un GET, así que otro sitio podría enlazarlo: desde fuera no se cierra
 * la sesión de nadie.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    redirect(HOME_ROUTE);
  }

  await deleteSession();
  redirect("/login?notice=session-expired");
}
