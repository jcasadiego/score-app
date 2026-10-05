import { redirect } from "next/navigation";
import { RUTA_INICIO } from "@/lib/auth/constants";

/**
 * `/` todavía no tiene contenido propio: hasta que exista la bandeja de
 * casos, lleva directo al primer módulo real en vez de mostrar una
 * pantalla de bienvenida vacía.
 */
export default function PanelRaiz() {
  redirect(RUTA_INICIO);
}
