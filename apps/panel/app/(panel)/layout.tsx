import { verificarSesion } from "@/lib/auth/dal";
import { AppShell } from "@/components/app-shell";

export default async function PanelLayout({ children }: LayoutProps<"/">) {
  const sesion = await verificarSesion();

  return (
    <AppShell usuario={{ email: sesion.email, rol: sesion.rol }}>
      {children}
    </AppShell>
  );
}
