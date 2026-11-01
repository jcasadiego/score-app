import type {
  UserFilters,
  PaginatedUsers,
  User,
} from "@/lib/api/users";

/**
 * Datos de prueba para estresar la pantalla de Usuarios (skill `break-ui`).
 * Solo se usan en desarrollo, vía `?data=worst|empty|one|many` — nunca en
 * producción. Los valores son realistas y respetan los límites de la API
 * (`name` 2–120, `email` hasta 254). `testPage` imita el filtro y la
 * paginación del servidor para que la pantalla reciba la misma forma.
 */

export const TEST_SCENARIOS = ["worst", "empty", "one", "many"] as const;
export type TestScenario = (typeof TEST_SCENARIOS)[number];

function user(
  id: string,
  name: string,
  email: string,
  active = true,
  createdAt = "2026-03-14T15:22:00.000Z",
): User {
  return {
    id,
    name,
    email,
    active,
    role: "ADMIN",
    createdAt,
    updatedAt: createdAt,
  };
}

function worstCase(currentId: string): User[] {
  return [
    user(
      "p1",
      "Aleksandra Wiśniewska-Kowalczyk",
      "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
    ),
    user(
      "p2",
      "Christopher Alexander Montgomery III",
      "first.last+billing-notifications@example.com",
      false,
    ),
    user("p3", "Jo", "a@b.co"),
    // El usuario de la sesión, para probar el caso "no puedes desactivarte".
    user(currentId, "María José de la Cruz y Fernández", "ops@sub.department.region.example.co.uk"),
    user("p5", "Đặng Thị Ngọc Hân", "dang.thi.ngoc.han@example.com", false),
    user("p6", "王秀英", "wang.xiuying@example.com"),
    user("p7", "نور الهدى عبد الرحمن", "nour@example.com"),
    user("p8", "👩🏽‍💻 Priya", "priya@example.com"),
    user("p9", "Sam Lee", "sam.lee@example.com"),
    user("p10", "<script>alert(1)</script> &amp;", "escape@example.com"),
    user(
      "p11",
      "Konstantin Oberhauser-Wettstein Benachrichtigungseinstellungen",
      "konstantin.oberhauser-wettstein.benachrichtigungseinstellungen@example.com",
    ),
    user("p12", "Jo", "jo.duplicado@example.com"),
  ];
}

function many(currentId: string): User[] {
  return Array.from({ length: 1284 }, (_, i) =>
    user(
      i === 0 ? currentId : `m${i}`,
      `Usuario de prueba ${i + 1}`,
      `usuario.${i + 1}@example.com`,
      i % 7 !== 0,
    ),
  );
}

function testData(
  scenario: TestScenario,
  currentId: string,
): User[] {
  switch (scenario) {
    case "worst":
      return worstCase(currentId);
    case "empty":
      return [];
    case "one":
      return [user(currentId, "Admin SCORE", "admin@example.com")];
    case "many":
      return many(currentId);
  }
}

export function testPage(
  scenario: TestScenario,
  currentId: string,
  { page, pageSize, search }: UserFilters,
): PaginatedUsers {
  const term = search?.toLocaleLowerCase();
  const filtered = testData(scenario, currentId).filter(
    (u) =>
      !term ||
      u.name.toLocaleLowerCase().includes(term) ||
      u.email.toLocaleLowerCase().includes(term),
  );
  return {
    data: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}
