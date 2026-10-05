import type {
  FiltroUsuarios,
  PaginaUsuarios,
  Usuario,
} from "@/lib/api/usuarios";

/**
 * Datos de prueba para estresar la pantalla de Usuarios (skill `break-ui`).
 * Solo se usan en desarrollo, vía `?data=peor|vacio|uno|mil` — nunca en
 * producción. Los valores son realistas y respetan los límites de la API
 * (`nombre` 2–120, `email` hasta 254). `paginaPrueba` imita el filtro y la
 * paginación del servidor para que la pantalla reciba la misma forma.
 */

export const ESCENARIOS_PRUEBA = ["peor", "vacio", "uno", "mil"] as const;
export type EscenarioPrueba = (typeof ESCENARIOS_PRUEBA)[number];

function usuario(
  id: string,
  nombre: string,
  email: string,
  activo = true,
  creadoEn = "2026-03-14T15:22:00.000Z",
): Usuario {
  return {
    id,
    nombre,
    email,
    activo,
    rol: "ADMIN",
    creadoEn,
    actualizadoEn: creadoEn,
  };
}

function peorCaso(idActual: string): Usuario[] {
  return [
    usuario(
      "p1",
      "Aleksandra Wiśniewska-Kowalczyk",
      "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
    ),
    usuario(
      "p2",
      "Christopher Alexander Montgomery III",
      "first.last+billing-notifications@example.com",
      false,
    ),
    usuario("p3", "Jo", "a@b.co"),
    // El usuario de la sesión, para probar el caso "no puedes desactivarte".
    usuario(idActual, "María José de la Cruz y Fernández", "ops@sub.department.region.example.co.uk"),
    usuario("p5", "Đặng Thị Ngọc Hân", "dang.thi.ngoc.han@example.com", false),
    usuario("p6", "王秀英", "wang.xiuying@example.com"),
    usuario("p7", "نور الهدى عبد الرحمن", "nour@example.com"),
    usuario("p8", "👩🏽‍💻 Priya", "priya@example.com"),
    usuario("p9", "Sam Lee", "sam.lee@example.com"),
    usuario("p10", "<script>alert(1)</script> &amp;", "escape@example.com"),
    usuario(
      "p11",
      "Konstantin Oberhauser-Wettstein Benachrichtigungseinstellungen",
      "konstantin.oberhauser-wettstein.benachrichtigungseinstellungen@example.com",
    ),
    usuario("p12", "Jo", "jo.duplicado@example.com"),
  ];
}

function muchos(idActual: string): Usuario[] {
  return Array.from({ length: 1284 }, (_, i) =>
    usuario(
      i === 0 ? idActual : `m${i}`,
      `Usuario de prueba ${i + 1}`,
      `usuario.${i + 1}@example.com`,
      i % 7 !== 0,
    ),
  );
}

function datosPrueba(
  escenario: EscenarioPrueba,
  idActual: string,
): Usuario[] {
  switch (escenario) {
    case "peor":
      return peorCaso(idActual);
    case "vacio":
      return [];
    case "uno":
      return [usuario(idActual, "Admin SCORE", "admin@example.com")];
    case "mil":
      return muchos(idActual);
  }
}

export function paginaPrueba(
  escenario: EscenarioPrueba,
  idActual: string,
  { pagina, tamano, q }: FiltroUsuarios,
): PaginaUsuarios {
  const termino = q?.toLocaleLowerCase();
  const filtrados = datosPrueba(escenario, idActual).filter(
    (u) =>
      !termino ||
      u.nombre.toLocaleLowerCase().includes(termino) ||
      u.email.toLocaleLowerCase().includes(termino),
  );
  return {
    datos: filtrados.slice((pagina - 1) * tamano, pagina * tamano),
    total: filtrados.length,
    pagina,
    tamano,
  };
}
