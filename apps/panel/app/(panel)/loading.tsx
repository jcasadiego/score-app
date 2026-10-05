import { Skeleton } from "antd";

/**
 * Respuesta inmediata al navegar entre módulos: el shell (menú y header)
 * queda fijo y el contenido muestra un esqueleto mientras el Server
 * Component trae los datos de la API.
 */
export default function CargandoPanel() {
  return <Skeleton active title={{ width: 160 }} paragraph={{ rows: 8 }} />;
}
