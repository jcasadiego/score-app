"use server";

import { redirect } from "next/navigation";
import { revokeSession } from "@/lib/api/auth";
import { deleteSession, getToken } from "./session";

export async function logoutAction(): Promise<void> {
  // Borrar la cookie no basta: el token seguiría valiendo hasta vencer.
  const token = await getToken();
  if (token) await revokeSession(token);

  await deleteSession();
  redirect("/login");
}
