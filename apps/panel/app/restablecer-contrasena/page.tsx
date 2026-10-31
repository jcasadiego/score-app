import type { Metadata } from "next";
import { PantallaCentrada } from "@/components/pantalla-centrada";
import { EnlaceInvalido, FormularioRestablecer } from "./restablecer-form";

export const metadata: Metadata = {
  title: "Restablecer contraseña — Panel SCORE",
  // El token viaja en la URL: que no se filtre a otros sitios por Referer.
  referrer: "no-referrer",
};

export default async function RestablecerContrasenaPage({
  searchParams,
}: PageProps<"/restablecer-contrasena">) {
  const { token } = await searchParams;
  const valor = Array.isArray(token) ? token[0] : token;

  return (
    <PantallaCentrada>
      {valor ? (
        <FormularioRestablecer token={valor} />
      ) : (
        <EnlaceInvalido mensaje="Al enlace le falta el código. Ábrelo de nuevo desde el correo o pide uno nuevo." />
      )}
    </PantallaCentrada>
  );
}
