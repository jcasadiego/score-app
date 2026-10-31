import type { Metadata } from "next";
import { Alert } from "antd";
import { verificarSesion } from "@/lib/auth/dal";
import { obtenerToken } from "@/lib/auth/session";
import { listarLeads, type PaginaLeads } from "@/lib/api/leads";
import { ErrorApi } from "@/lib/api/errors";
import { esEstadoLead, esFamilia } from "@/lib/leads/etiquetas";
import { TAMANO_PAGINA } from "@/lib/usuarios/limites";
import { LeadsScreen } from "@/components/leads/leads-screen";

export const metadata: Metadata = {
  title: "Leads · Panel SCORE",
};

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await verificarSesion();
  const params = await searchParams;

  const paginaPedida = Number(primerValor(params.pagina));
  const pagina =
    Number.isInteger(paginaPedida) && paginaPedida > 0 ? paginaPedida : 1;
  const q = primerValor(params.q)?.trim().slice(0, 100) || undefined;
  // Valores desconocidos en la URL se ignoran en vez de mandarle un 400 a
  // la API.
  const familiaPedida = primerValor(params.familia);
  const familia = esFamilia(familiaPedida) ? familiaPedida : undefined;
  const estadoPedido = primerValor(params.estado);
  const estado = esEstadoLead(estadoPedido) ? estadoPedido : undefined;

  let resultado: PaginaLeads;
  const token = await obtenerToken();
  try {
    if (!token) {
      throw new ErrorApi(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    resultado = await listarLeads(token, {
      page: pagina,
      pageSize: TAMANO_PAGINA,
      search: q,
      family: familia,
      status: estado,
    });
  } catch (error) {
    const mensaje =
      error instanceof ErrorApi
        ? error.message
        : "No pudimos cargar los leads. Intenta de nuevo.";
    return <Alert type="error" showIcon title={mensaje} />;
  }

  return (
    <LeadsScreen pagina={resultado} filtros={{ q: q ?? "", familia, estado }} />
  );
}
