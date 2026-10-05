import type { Metadata } from "next";
import { Alert } from "antd";
import { verificarSesion } from "@/lib/auth/dal";
import { obtenerToken } from "@/lib/auth/session";
import { listarUsuarios, type PaginaUsuarios } from "@/lib/api/usuarios";
import { ErrorApi } from "@/lib/api/errors";
import { TAMANO_PAGINA } from "@/lib/usuarios/limites";
import { UsuariosScreen } from "@/components/usuarios/usuarios-screen";
import {
  ESCENARIOS_PRUEBA,
  paginaPrueba,
  type EscenarioPrueba,
} from "@/components/usuarios/datos-prueba-usuarios";
import { SelectorDatosPrueba } from "@/components/usuarios/selector-datos-prueba";

export const metadata: Metadata = {
  title: "Usuarios · Panel SCORE",
};

const ES_DESARROLLO = process.env.NODE_ENV === "development";

function escenarioDePrueba(valor: unknown): EscenarioPrueba | undefined {
  if (!ES_DESARROLLO) return undefined;
  return ESCENARIOS_PRUEBA.find((e) => e === valor);
}

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function UsuariosPage({
  searchParams,
}: PageProps<"/usuarios">) {
  const sesion = await verificarSesion();
  const params = await searchParams;

  const paginaPedida = Number(primerValor(params.pagina));
  const pagina =
    Number.isInteger(paginaPedida) && paginaPedida > 0 ? paginaPedida : 1;
  const q = primerValor(params.q)?.trim().slice(0, 100) || undefined;
  const filtro = { pagina, tamano: TAMANO_PAGINA, q };

  const escenario = escenarioDePrueba(primerValor(params.data));

  let resultado: PaginaUsuarios;
  if (escenario) {
    resultado = paginaPrueba(escenario, sesion.id, filtro);
  } else {
    const token = await obtenerToken();
    try {
      if (!token) {
        throw new ErrorApi(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
      }
      resultado = await listarUsuarios(token, filtro);
    } catch (error) {
      const mensaje =
        error instanceof ErrorApi
          ? error.message
          : "No pudimos cargar los usuarios. Intenta de nuevo.";
      return <Alert type="error" showIcon title={mensaje} />;
    }
  }

  return (
    <>
      <UsuariosScreen
        pagina={resultado}
        busqueda={q ?? ""}
        usuarioActualId={sesion.id}
      />
      {ES_DESARROLLO && <SelectorDatosPrueba actual={escenario} />}
    </>
  );
}
