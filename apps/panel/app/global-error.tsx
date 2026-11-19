"use client";

/**
 * Último recurso, si falla el layout raíz: va sin Ant Design, que vive en ese
 * layout. Reemplaza la pantalla por defecto de Next, en inglés (PF-73).
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="es">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <main style={{ textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 20 }}>No pudimos cargar el panel</h1>
          <p>Recarga la página; si sigue fallando, intenta en unos minutos.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Recargar la página
          </button>{" "}
          <button type="button" onClick={() => retry()}>
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
