"use server";

import { redirect } from "next/navigation";
import { eliminarSesion } from "./session";

export async function accionCerrarSesion(): Promise<void> {
  await eliminarSesion();
  redirect("/login");
}
