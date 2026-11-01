import { verifySession } from "@/lib/auth/dal";
import { AppShell } from "@/components/app-shell";

export default async function PanelLayout({ children }: LayoutProps<"/">) {
  const session = await verifySession();

  return (
    <AppShell user={{ email: session.email, role: session.role }}>
      {children}
    </AppShell>
  );
}
