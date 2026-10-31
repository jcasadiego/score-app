import "server-only";
import { llamarApi, type MensajesRecurso } from "./cliente";

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  rol: string;
  creadoEn: string;
  actualizadoEn: string;
}

export interface PaginaUsuarios {
  datos: Usuario[];
  total: number;
  pagina: number;
  tamano: number;
}

export interface FiltroUsuarios {
  pagina: number;
  tamano: number;
  q?: string;
}

export interface DatosCrearUsuario {
  nombre: string;
  email: string;
  password: string;
}

export interface DatosActualizarUsuario {
  nombre?: string;
  email?: string;
}

const MENSAJES: MensajesRecurso = {
  noEncontrado: "No encontramos ese usuario.",
  conflicto: "Ese correo ya está en uso.",
};

/** Una página de usuarios; el filtro y el conteo los resuelve la API. */
export function listarUsuarios(
  token: string,
  { pagina, tamano, q }: FiltroUsuarios,
): Promise<PaginaUsuarios> {
  const params = new URLSearchParams({
    pagina: String(pagina),
    tamano: String(tamano),
  });
  if (q) params.set("q", q);
  return llamarApi<PaginaUsuarios>(token, `/usuarios?${params}`, MENSAJES);
}

export function crearUsuario(
  token: string,
  datos: DatosCrearUsuario,
): Promise<Usuario> {
  return llamarApi<Usuario>(token, "/usuarios", MENSAJES, {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function actualizarUsuario(
  token: string,
  id: string,
  datos: DatosActualizarUsuario,
): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/usuarios/${encodeURIComponent(id)}`, MENSAJES, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

export function activarUsuario(token: string, id: string): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/usuarios/${encodeURIComponent(id)}/activar`, MENSAJES, {
    method: "PATCH",
  });
}

export function desactivarUsuario(token: string, id: string): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/usuarios/${encodeURIComponent(id)}/desactivar`, MENSAJES, {
    method: "PATCH",
  });
}
