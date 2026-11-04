import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CenteredScreen } from "@/components/centered-screen";
import { getMfaChallenge, getSession } from "@/lib/auth/session";
import { SetupFlow } from "./setup-flow";

export const metadata: Metadata = {
  title: "Configura la verificación en dos pasos — Panel SCORE",
};

/**
 * Confirmar el autenticador crea la sesión y borra el reto, y Next vuelve a
 * renderizar esta página: con sesión no se redirige, porque la pantalla todavía
 * debe mostrar los códigos de recuperación.
 */
export default async function TwoFactorSetupPage() {
  if (!(await getMfaChallenge()) && !(await getSession())) {
    redirect("/login?notice=mfa-expired");
  }

  return (
    <CenteredScreen>
      <SetupFlow />
    </CenteredScreen>
  );
}
