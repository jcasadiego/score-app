import type { ThemeConfig } from "antd";

/**
 * Tema único del panel. Todo color/radio/tipografía sale de aquí — nada
 * de hex sueltos en `style` — para poder ajustar la marca en un solo
 * lugar y habilitar modo oscuro más adelante con `theme.darkAlgorithm`.
 *
 * TODO(José): `colorPrimary` es provisional; reemplazar por el color de
 * marca de Music Finance Pro cuando esté definido.
 */
export const tema: ThemeConfig = {
  token: {
    colorPrimary: "#3a4fd8",
    borderRadius: 8,
    // Fuente del sistema: ya trae ajuste óptico y tracking por tamaño.
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      siderBg: "#111827",
      headerBg: "#ffffff",
      headerPadding: "0 24px",
    },
    Menu: {
      darkItemBg: "#111827",
      darkItemSelectedBg: "#3a4fd8",
    },
  },
};

export const ETIQUETAS_ROL: Record<string, string> = {
  ADMIN: "Administrador",
};
