import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/session";
import { FormularioLogin } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión — Panel SCORE",
};

export default async function LoginPage() {
  const sesion = await obtenerSesion();
  if (sesion) {
    redirect("/");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <FormularioLogin />
      </div>
    </main>
  );
}
