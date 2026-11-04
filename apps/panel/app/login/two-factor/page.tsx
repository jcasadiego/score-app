import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CenteredScreen } from "@/components/centered-screen";
import { getMfaChallenge } from "@/lib/auth/session";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Verificación en dos pasos — Panel SCORE",
};

export default async function TwoFactorPage() {
  if (!(await getMfaChallenge())) {
    redirect("/login?notice=mfa-expired");
  }

  return (
    <CenteredScreen>
      <VerifyForm />
    </CenteredScreen>
  );
}
