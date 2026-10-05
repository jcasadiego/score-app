import Link from "next/link";

/**
 * Selector solo de desarrollo para alternar entre los datos reales y los
 * escenarios de `datos-prueba-usuarios.ts`. Es "chrome" de prueba, no parte
 * del diseño: por eso no usa Ant Design ni el tema del panel.
 */
const OPCIONES = [
  { valor: undefined, etiqueta: "Demo" },
  { valor: "peor", etiqueta: "Peor caso" },
  { valor: "vacio", etiqueta: "Vacío" },
  { valor: "uno", etiqueta: "Uno" },
  { valor: "mil", etiqueta: "1.284 filas" },
] as const;

export function SelectorDatosPrueba({ actual }: { actual?: string }) {
  return (
    <nav
      aria-label="Datos de prueba"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2000,
        display: "flex",
        gap: 2,
        padding: 3,
        borderRadius: 999,
        background: "#e5e5e5",
        font: "12px system-ui, sans-serif",
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
      }}
    >
      {OPCIONES.map(({ valor, etiqueta }) => {
        const activo = actual === valor;
        return (
          <Link
            key={etiqueta}
            href={valor ? `?data=${valor}` : "?"}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              color: "#111",
              textDecoration: "none",
              background: activo ? "#fff" : "transparent",
              fontWeight: activo ? 600 : 400,
            }}
          >
            {etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
