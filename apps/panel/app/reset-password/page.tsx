import type { Metadata } from "next";
import { CenteredScreen } from "@/components/centered-screen";
import { InvalidLink, ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Restablecer contraseña — Panel SCORE",
  // El token viaja en la URL: que no se filtre a otros sitios por Referer.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;

  return (
    <CenteredScreen>
      {value ? (
        <ResetPasswordForm token={value} />
      ) : (
        <InvalidLink message="Al enlace le falta el código. Ábrelo de nuevo desde el correo o pide uno nuevo." />
      )}
    </CenteredScreen>
  );
}
