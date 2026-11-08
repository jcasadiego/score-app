import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Una página estática no puede llevar el nonce de la CSP (`proxy.ts`): sus
// scripts quedarían bloqueados.
export const dynamic = "force-dynamic";

// Tipografía de marca provisional: cambiarla aquí cambia toda la app.
const brandFont = Geist({ variable: "--font-brand", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Diagnóstico SCORE — Music Finance Pro",
  description: "Cuestionario de diagnóstico SCORE de Music Finance Pro",
  // Las páginas del cliente no se indexan.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${brandFont.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-2xl items-center px-4 py-3">
            <span className="text-base font-semibold">
              Music Finance Pro · <span className="text-brand">SCORE</span>
            </span>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:py-10">
          {children}
        </div>
      </body>
    </html>
  );
}
