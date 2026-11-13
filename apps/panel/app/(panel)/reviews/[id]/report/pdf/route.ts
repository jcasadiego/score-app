import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { SESSION_EXPIRED_ROUTE } from "@/lib/auth/constants";
import { apiUrl } from "@/lib/api/client";
import { reportPath } from "@/lib/api/reports";

/**
 * Vista previa del PDF del informe tal como está hoy. El navegador no tiene el
 * token (la cookie es httpOnly y la API está en otro origen), así que el panel
 * lo pide con la sesión y lo devuelve tal cual, sin guardarlo en caché.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/reviews/[id]/report/pdf">,
) {
  await verifySession();
  const token = await getToken();
  if (!token) redirect(SESSION_EXPIRED_ROUTE);
  const { id } = await ctx.params;

  let response: Response;
  try {
    response = await fetch(apiUrl(`${reportPath(id)}/pdf`), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return text(502, "No pudimos conectar con el servidor. Intenta de nuevo.");
  }
  if (response.status === 401) redirect(SESSION_EXPIRED_ROUTE);
  if (response.status === 403) {
    return text(403, "No tienes permiso para ver este informe.");
  }
  if (response.status === 404) {
    return text(404, "Este caso todavía no tiene informe.");
  }
  if (!response.ok || !response.body) {
    return text(502, "No pudimos generar la vista previa. Intenta de nuevo.");
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="informe-score.pdf"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function text(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
