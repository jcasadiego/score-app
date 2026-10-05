import type { Metadata } from "next";
import { Alert } from "antd";
import { verificarSesion } from "@/lib/auth/dal";
import { obtenerToken } from "@/lib/auth/session";
import { listarUsuarios, type Usuario } from "@/lib/api/usuarios";
import { ErrorApi } from "@/lib/api/errors";
import { UsuariosScreen } from "@/components/usuarios/usuarios-screen";

export const metadata: Metadata = {
  title: "Usuarios · Panel SCORE",
};

export default async function UsuariosPage() {
  const sesion = await verificarSesion();
  const token = await obtenerToken();

  let usuarios: Usuario[];
  try {
    if (!token) {
      throw new ErrorApi(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    usuarios = await listarUsuarios(token);
  } catch (error) {
    const mensaje =
      error instanceof ErrorApi
        ? error.message
        : "No pudimos cargar los usuarios. Intenta de nuevo.";
    return <Alert type="error" showIcon title={mensaje} />;
  }

  return (
    <UsuariosScreen usuariosIniciales={usuarios} usuarioActualId={sesion.id} />
  );
}
