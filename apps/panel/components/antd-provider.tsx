"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import esES from "antd/locale/es_ES";
import { panelTheme } from "@/lib/theme";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(notify: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

/**
 * ConfigProvider + `App` de antd (para `message`/`modal` con el tema
 * aplicado vía `App.useApp()`), y respeta "reducir movimiento" del
 * sistema apagando las animaciones de antd.
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );

  return (
    <ConfigProvider
      locale={esES}
      theme={{
        ...panelTheme,
        token: { ...panelTheme.token, motion: !reduceMotion },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
