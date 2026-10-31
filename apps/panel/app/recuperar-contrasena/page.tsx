import type { Metadata } from "next";
import { PantallaCentrada } from "@/components/pantalla-centrada";
import { FormularioSolicitud } from "./solicitud-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña — Panel SCORE",
};

export default function RecuperarContrasenaPage() {
  return (
    <PantallaCentrada>
      <FormularioSolicitud />
    </PantallaCentrada>
  );
}
