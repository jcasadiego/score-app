"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import esES from "antd/locale/es_ES";
import { tema } from "@/lib/tema";

const CONSULTA_MENOS_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

function suscribirMovimiento(avisar: () => void) {
  const consulta = window.matchMedia(CONSULTA_MENOS_MOVIMIENTO);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}

/**
 * ConfigProvider + `App` de antd (para `message`/`modal` con el tema
 * aplicado vía `App.useApp()`), y respeta "reducir movimiento" del
 * sistema apagando las animaciones de antd.
 */
export function ProveedorAntd({ children }: { children: ReactNode }) {
  const reducirMovimiento = useSyncExternalStore(
    suscribirMovimiento,
    () => window.matchMedia(CONSULTA_MENOS_MOVIMIENTO).matches,
    () => false,
  );

  return (
    <ConfigProvider
      locale={esES}
      theme={{
        ...tema,
        token: { ...tema.token, motion: !reducirMovimiento },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
