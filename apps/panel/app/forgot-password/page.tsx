import type { Metadata } from "next";
import { CenteredScreen } from "@/components/centered-screen";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña — Panel SCORE",
};

export default function ForgotPasswordPage() {
  return (
    <CenteredScreen>
      <ForgotPasswordForm />
    </CenteredScreen>
  );
}
