import type { ReactNode } from "react";

/** Contenedor de las pantallas públicas (login y recuperación). */
export function CenteredScreen({ children }: { children: ReactNode }) {
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
      <div style={{ width: "100%", maxWidth: 380 }}>{children}</div>
    </main>
  );
}
