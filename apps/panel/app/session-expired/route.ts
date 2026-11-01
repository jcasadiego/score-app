import { redirect } from "next/navigation";
import { isTokenRejected } from "@/lib/api/auth";
import { HOME_ROUTE } from "@/lib/auth/constants";
import { decodeToken } from "@/lib/auth/jwt";
import { deleteSession, getToken } from "@/lib/auth/session";

/**
 * Un Server Component no puede borrar cookies: cuando la API rechaza el
 * token, la página redirige aquí. Sin borrarla habría un bucle, porque el
 * proxy solo lee la cookie y la seguiría viendo válida.
 *
 * Es un GET, así que cualquier sitio podría enlazarlo. Por eso solo borra la
 * cookie de una sesión que de verdad se perdió: si la API sigue aceptando el
 * token, el enlace no cierra nada y se vuelve a la pantalla de inicio.
 */
export async function GET() {
  const token = await getToken();
  const session = token ? decodeToken(token) : null;
  const isLive = !!session && session.exp * 1000 > Date.now();

  if (token && isLive && !(await isTokenRejected(token))) {
    redirect(HOME_ROUTE);
  }

  await deleteSession();
  redirect("/login?notice=session-expired");
}
