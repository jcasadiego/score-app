import "server-only";
import { llamarApi, type MensajesRecurso } from "./cliente";

export interface Usuario {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginaUsuarios {
  data: Usuario[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FiltroUsuarios {
  page: number;
  pageSize: number;
  search?: string;
}

export interface DatosCrearUsuario {
  name: string;
  email: string;
  password: string;
}

export interface DatosActualizarUsuario {
  name?: string;
  email?: string;
  /** Contraseña nueva; la API cierra las sesiones abiertas del usuario. */
  password?: string;
}

const MENSAJES: MensajesRecurso = {
  noEncontrado: "No encontramos ese usuario.",
  conflicto: "Ese correo ya está en uso.",
};

/** Una página de usuarios; el filtro y el conteo los resuelve la API. */
export function listarUsuarios(
  token: string,
  { page, pageSize, search }: FiltroUsuarios,
): Promise<PaginaUsuarios> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  return llamarApi<PaginaUsuarios>(token, `/users?${params}`, MENSAJES);
}

export function crearUsuario(
  token: string,
  datos: DatosCrearUsuario,
): Promise<Usuario> {
  return llamarApi<Usuario>(token, "/users", MENSAJES, {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function actualizarUsuario(
  token: string,
  id: string,
  datos: DatosActualizarUsuario,
): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/users/${encodeURIComponent(id)}`, MENSAJES, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

export function activarUsuario(token: string, id: string): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/users/${encodeURIComponent(id)}/activate`, MENSAJES, {
    method: "PATCH",
  });
}

export function desactivarUsuario(token: string, id: string): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/users/${encodeURIComponent(id)}/deactivate`, MENSAJES, {
    method: "PATCH",
  });
}
