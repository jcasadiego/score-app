import "server-only";
import { callApi, type ResourceMessages } from "./client";

export type UserRole = "ADMIN" | "REVIEWER";

export interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: UserRole;
  /** Nulo si todavía no configuró la verificación en dos pasos. */
  mfaEnabledAt: string | null;
  /**
   * Nulo mientras espera que su dueño defina la contraseña con el enlace del
   * correo: al crear la cuenta o tras restablecerla.
   */
  passwordSetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Respuesta de las acciones que mandan un enlace para definir la contraseña. */
export interface UserWithLinkSent extends User {
  /** `false` si el correo no salió: hay que reenviar el enlace. */
  linkSent: boolean;
}

export interface PaginatedUsers {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserFilters {
  page: number;
  pageSize: number;
  search?: string;
}

export interface CreateUserData {
  name: string;
  email: string;
  role: UserRole;
}

export interface UpdateUserData {
  name?: string;
  email?: string;
  /** Cambiarlo cierra las sesiones abiertas del usuario. */
  role?: UserRole;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese usuario.",
  conflict: "Ese correo ya está en uso.",
};

/** Una página de usuarios; el filtro y el conteo los resuelve la API. */
export function listUsers(
  token: string,
  { page, pageSize, search }: UserFilters,
): Promise<PaginatedUsers> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  return callApi<PaginatedUsers>(token, `/users?${params}`, MESSAGES);
}

export function createUser(
  token: string,
  data: CreateUserData,
): Promise<UserWithLinkSent> {
  return callApi<UserWithLinkSent>(token, "/users", MESSAGES, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateUser(
  token: string,
  id: string,
  data: UpdateUserData,
): Promise<User> {
  return callApi<User>(token, `/users/${encodeURIComponent(id)}`, MESSAGES, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function activateUser(token: string, id: string): Promise<User> {
  return callApi<User>(token, `/users/${encodeURIComponent(id)}/activate`, MESSAGES, {
    method: "PATCH",
  });
}

export function deactivateUser(token: string, id: string): Promise<User> {
  return callApi<User>(token, `/users/${encodeURIComponent(id)}/deactivate`, MESSAGES, {
    method: "PATCH",
  });
}

export function resetUserMfa(
  token: string,
  id: string,
): Promise<UserWithLinkSent> {
  return callApi<UserWithLinkSent>(
    token,
    `/users/${encodeURIComponent(id)}/reset-mfa`,
    MESSAGES,
    { method: "PATCH" },
  );
}

/** Invalida su contraseña y le manda un enlace para definir otra (o reenvía el de activación). */
export function resetUserPassword(
  token: string,
  id: string,
): Promise<UserWithLinkSent> {
  return callApi<UserWithLinkSent>(
    token,
    `/users/${encodeURIComponent(id)}/password-reset`,
    MESSAGES,
    { method: "POST" },
  );
}
