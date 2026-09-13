import type { Metadata } from "next";
import { verificarSesion } from "@/lib/auth/dal";
import { PanelHome } from "@/components/panel-home";

export const metadata: Metadata = {
  title: "Panel SCORE",
};

export default async function PanelHomePage() {
  const sesion = await verificarSesion();

  return <PanelHome email={sesion.email} />;
}
