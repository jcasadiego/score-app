"use client";

import "./globals.css";
import { Card, buttonClass } from "@/components/ui";

/**
 * Último recurso, si falla el layout raíz. Reemplaza la pantalla por defecto
 * de Next, en inglés (PF-73). Sin estilos en línea: la CSP no los permite.
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 sm:py-10">
          <h1 className="text-2xl font-semibold sm:text-3xl">
            No pudimos cargar tu diagnóstico
          </h1>
          <Card>
            <p className="text-base leading-relaxed">
              Recarga la página para seguir. Las respuestas que ya guardaste no
              se pierden. Si sigue fallando, intenta en unos minutos.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className={buttonClass.primary}
                onClick={() => window.location.reload()}
              >
                Recargar la página
              </button>
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => retry()}
              >
                Reintentar
              </button>
            </div>
          </Card>
        </main>
      </body>
    </html>
  );
}
