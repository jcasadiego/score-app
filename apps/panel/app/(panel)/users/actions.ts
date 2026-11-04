"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import {
  deleteSession,
  getToken,
  renewSessionIfNeeded,
} from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import {
  updateUser,
  activateUser,
  createUser,
  deactivateUser,
  resetUserMfa,
  type UpdateUserData,
  type CreateUserData,
  type User,
} from "@/lib/api/users";

export interface UserActionResult {
  ok: boolean;
  error?: string;
  user?: User;
}

/**
 * `verifySession` exige sesión activa (redirige si no la hay) y
 * `getToken` da el JWT crudo para llamar a la API como Bearer — la
 * cookie es httpOnly, así que esto solo puede pasar por una Server Action.
 */
async function authenticatedToken(): Promise<string> {
  await verifySession();
  const token = await getToken();
  if (!token) {
    throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
  }
  await renewSessionIfNeeded();
  return token;
}

async function handleError(error: unknown): Promise<UserActionResult> {
  await redirectIfSessionExpired(error);
  const message =
    error instanceof ApiError
      ? error.message
      : "Ocurrió un error inesperado. Intenta de nuevo.";
  return { ok: false, error: message };
}

export async function createUserAction(
  data: CreateUserData,
): Promise<UserActionResult> {
  try {
    const token = await authenticatedToken();
    const user = await createUser(token, data);
    revalidatePath("/users");
    return { ok: true, user };
  } catch (error) {
    return await handleError(error);
  }
}

export async function updateUserAction(
  id: string,
  data: UpdateUserData,
): Promise<UserActionResult> {
  let user: User;
  let closedOwnSession: "password-changed" | "role-changed" | null = null;
  try {
    const session = await verifySession();
    const token = await authenticatedToken();
    user = await updateUser(token, id, data);
    if (session.id === id) {
      if (data.password) closedOwnSession = "password-changed";
      else if (data.role && data.role !== session.role) {
        closedOwnSession = "role-changed";
      }
    }
  } catch (error) {
    return await handleError(error);
  }

  // Cambiar la contraseña o el rol cierra todas las sesiones de esa cuenta en
  // la API, también la de quien lo cambió si es la suya: se lo manda al login.
  if (closedOwnSession) {
    await deleteSession();
    redirect(`/login?notice=${closedOwnSession}`);
  }

  revalidatePath("/users");
  return { ok: true, user };
}

export async function activateUserAction(
  id: string,
): Promise<UserActionResult> {
  try {
    const token = await authenticatedToken();
    const user = await activateUser(token, id);
    revalidatePath("/users");
    return { ok: true, user };
  } catch (error) {
    return await handleError(error);
  }
}

export async function deactivateUserAction(
  id: string,
): Promise<UserActionResult> {
  try {
    const token = await authenticatedToken();
    const user = await deactivateUser(token, id);
    revalidatePath("/users");
    return { ok: true, user };
  } catch (error) {
    return await handleError(error);
  }
}

export async function resetUserMfaAction(
  id: string,
): Promise<UserActionResult> {
  try {
    const token = await authenticatedToken();
    const user = await resetUserMfa(token, id);
    revalidatePath("/users");
    return { ok: true, user };
  } catch (error) {
    return await handleError(error);
  }
}
