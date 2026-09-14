import "server-only";
import { ErrorApi } from "./errors";

const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  rol: string;
  creadoEn: string;
  actualizadoEn: string;
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

function urlBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

async function llamarApi<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlBase()}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ErrorApi(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }

  if (!respuesta.ok) {
    throw await construirError(respuesta);
  }

  if (respuesta.status === 204) {
    return undefined as T;
  }

  return (await respuesta.json()) as T;
}

async function construirError(respuesta: Response): Promise<ErrorApi> {
  const cuerpo = (await respuesta.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const mensaje = Array.isArray(cuerpo?.message)
    ? cuerpo.message[0]
    : cuerpo?.message;

  if (respuesta.status === 409) {
    return new ErrorApi(409, mensaje ?? "Ese correo ya está en uso.");
  }
  if (respuesta.status === 404) {
    return new ErrorApi(404, "No encontramos ese usuario.");
  }
  if (respuesta.status === 401 || respuesta.status === 403) {
    return new ErrorApi(
      respuesta.status,
      "No tienes permiso para hacer esto, o tu sesión expiró.",
    );
  }
  if (respuesta.status === 400) {
    return new ErrorApi(400, "Revisa los datos ingresados e intenta de nuevo.");
  }

  return new ErrorApi(respuesta.status, MENSAJE_ERROR_GENERICO);
}

export function listarUsuarios(token: string): Promise<Usuario[]> {
  return llamarApi<Usuario[]>(token, "/usuarios");
}

export function crearUsuario(
  token: string,
  datos: DatosCrearUsuario,
): Promise<Usuario> {
  return llamarApi<Usuario>(token, "/usuarios", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

export function actualizarUsuario(
  token: string,
  id: string,
  datos: DatosActualizarUsuario,
): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/usuarios/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

export function activarUsuario(token: string, id: string): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/usuarios/${id}/activar`, {
    method: "PATCH",
  });
}

export function desactivarUsuario(token: string, id: string): Promise<Usuario> {
  return llamarApi<Usuario>(token, `/usuarios/${id}/desactivar`, {
    method: "PATCH",
  });
}
