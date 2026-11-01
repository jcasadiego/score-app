import Link from "next/link";

/**
 * Selector solo de desarrollo para alternar entre los datos reales y los
 * escenarios de `users-test-data.ts`. Es "chrome" de prueba, no parte
 * del diseño: por eso no usa Ant Design ni el tema del panel.
 */
const OPTIONS = [
  { value: undefined, label: "Demo" },
  { value: "worst", label: "Peor caso" },
  { value: "empty", label: "Vacío" },
  { value: "one", label: "Uno" },
  { value: "many", label: "1.284 filas" },
] as const;

export function TestDataSelector({ current }: { current?: string }) {
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
      {OPTIONS.map(({ value, label }) => {
        const active = current === value;
        return (
          <Link
            key={label}
            href={value ? `?data=${value}` : "?"}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              color: "#111",
              textDecoration: "none",
              background: active ? "#fff" : "transparent",
              fontWeight: active ? 600 : 400,
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
