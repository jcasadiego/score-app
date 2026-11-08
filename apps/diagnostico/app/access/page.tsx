import { AccessStart } from "./access-start";

export const metadata = { title: "Bienvenida — Diagnóstico SCORE" };

/**
 * Entrada por el enlace del correo (`/access#token=…`). El token va en el
 * fragmento: nunca llega a este servidor, así que lo lee el navegador.
 */
export default function AccessPage() {
  return <AccessStart />;
}
