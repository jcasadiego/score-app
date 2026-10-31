import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/session";
import { RUTA_INICIO } from "@/lib/auth/constants";
import { PantallaCentrada } from "@/components/pantalla-centrada";
import { FormularioLogin } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión — Panel SCORE",
};

/** Avisos que llegan por `?contrasena=` desde la recuperación o el CRUD. */
const AVISOS: Record<string, string> = {
  restablecida: "Listo, tu contraseña cambió. Inicia sesión con la nueva.",
  cambiada: "Cambiaste tu contraseña. Inicia sesión de nuevo con la nueva.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sesion = await obtenerSesion();
  if (sesion) {
    redirect(RUTA_INICIO);
  }

  const { contrasena } = await searchParams;
  const aviso = typeof contrasena === "string" ? AVISOS[contrasena] : undefined;

  return (
    <PantallaCentrada>
      <FormularioLogin aviso={aviso} />
    </PantallaCentrada>
  );
}
