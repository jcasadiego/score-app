"use server";

import { redirect } from "next/navigation";
import { iniciarSesion } from "@/lib/api/auth";
import { ErrorApi } from "@/lib/api/errors";
import { crearSesion } from "@/lib/auth/session";

export interface EstadoLogin {
  error?: string;
}

export async function accionLogin(
  _estadoPrevio: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y tu contraseña." };
  }

  let accessToken: string;
  try {
    accessToken = await iniciarSesion(email, password);
  } catch (error) {
    const mensaje =
      error instanceof ErrorApi
        ? error.message
        : "No pudimos iniciar sesión. Intenta de nuevo en unos minutos.";
    return { error: mensaje };
  }

  await crearSesion(accessToken);
  redirect("/");
}
