import { ReportDownload } from "./report-download";

export const metadata = { title: "Tu informe — Diagnóstico SCORE" };

/**
 * Descarga del informe desde el correo de entrega (`/report#token=…`). El token
 * va en el fragmento: nunca llega a este servidor, así que lo lee el navegador.
 * `next.config.ts` pone `Referrer-Policy: no-referrer` en esta ruta.
 */
export default function ReportPage() {
  return <ReportDownload />;
}
