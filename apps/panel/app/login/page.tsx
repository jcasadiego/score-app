import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HOME_ROUTE } from "@/lib/auth/constants";
import { CenteredScreen } from "@/components/centered-screen";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión — Panel SCORE",
};

/** Avisos que llegan por `?notice=` desde la recuperación o el CRUD. */
const NOTICES: Record<string, string> = {
  "password-reset": "Listo, tu contraseña cambió. Inicia sesión con la nueva.",
  "password-changed": "Cambiaste tu contraseña. Inicia sesión de nuevo con la nueva.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getSession();
  if (session) {
    redirect(HOME_ROUTE);
  }

  const { notice: noticeKey } = await searchParams;
  // `hasOwn`: la clave viene de la URL y `constructor` o `__proto__` no son
  // avisos, aunque el objeto los herede.
  const notice =
    typeof noticeKey === "string" && Object.hasOwn(NOTICES, noticeKey)
      ? NOTICES[noticeKey]
      : undefined;

  return (
    <CenteredScreen>
      <LoginForm notice={notice} />
    </CenteredScreen>
  );
}
