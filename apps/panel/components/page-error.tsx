import { redirect } from "next/navigation";
import { Alert } from "antd";
import { ApiError } from "@/lib/api/errors";
import { SESSION_EXPIRED_ROUTE } from "@/lib/auth/constants";
import { ForbiddenScreen } from "./forbidden-screen";

interface PageErrorProps {
  error: unknown;
  /** Mensaje si el error no vino de la API. */
  fallback: string;
}

/** Qué mostrar cuando una pantalla no pudo cargar sus datos de la API. */
export function PageError({ error, fallback }: PageErrorProps) {
  if (error instanceof ApiError && error.status === 401) {
    redirect(SESSION_EXPIRED_ROUTE);
  }
  if (error instanceof ApiError && error.status === 403) {
    return <ForbiddenScreen />;
  }

  const message = error instanceof ApiError ? error.message : fallback;
  return <Alert type="error" showIcon title={message} />;
}
