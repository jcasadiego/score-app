# api (P4)

Base de datos, motor de cálculo de SCORE, CRM, pagos y bitácora de
auditoría. La consumen `apps/diagnostico` y `apps/panel` por HTTP. Ver
`../CLAUDE.md` para el contexto completo del monorepo.

Stack: NestJS 10 + TypeScript + Prisma 7 sobre PostgreSQL, con `pnpm` como
gestor de paquetes.

## Cómo correr en local

```bash
pnpm install
cp .env.example .env         # ajustar si hace falta
docker compose up -d         # levanta Postgres local
pnpm prisma migrate dev      # aplica el schema
pnpm prisma db seed          # crea el primer usuario ADMIN (ver ADMIN_* en .env)
pnpm start:dev                # http://localhost:3000
```

`GET /health` confirma que el servicio y la conexión a Postgres están
vivos (fuera del prefijo `/api` y del versionado, a propósito — es la
ruta que usa cualquier orquestador/healthcheck de infraestructura).

Con `NODE_ENV` distinto de `production`, `GET /docs` sirve Swagger UI
con todos los endpoints documentados.

## Scripts

- `pnpm start:dev` — servidor con recarga en caliente.
- `pnpm build` — compila a `dist/`.
- `pnpm lint` — ESLint + Prettier.
- `pnpm test` — pruebas unitarias.
- `pnpm test:e2e` — pruebas end-to-end (requieren Postgres corriendo).
- `pnpm prisma migrate dev` — aplica cambios de `prisma/schema.prisma`.
- `pnpm prisma studio` — explorador visual de la base de datos.

## Estructura

- `src/bootstrap.ts` — configuración transversal de la app (helmet,
  CORS, `ValidationPipe`, filtro de errores, prefijo `/api` +
  versionado por URI, Swagger). La usan tanto `main.ts` como el e2e test,
  para que las pruebas ejerciten la misma configuración que producción.
- `src/config/` — validación de variables de entorno al boot (Zod) y
  parseo de `CORS_ORIGINS`.
- `src/common/` — `FiltroExcepcionesGlobal`, forma de error única para
  toda la API.
- `src/prisma/` — `PrismaService` global, conecta vía driver adapter
  (`@prisma/adapter-pg`), requerido por Prisma 7.
- `src/motor-calculo/` — el motor de cálculo de SCORE queda detrás de
  `MotorCalculoPort` (`motor-calculo.port.ts`). Hoy solo existe
  `MotorCalculoStubAdapter`, un adaptador de ejemplo — se reemplaza
  cuando se confirme el escenario real del motor (API ya ejecutable,
  hoja de cálculo a portar, o construir desde cero; ver `CLAUDE.md`
  sección 3).
- `src/auditoria/` — bitácora de auditoría (requisito duro). Cada evento
  guarda actor tipado (`USUARIO_PANEL` / `CLIENTE_FINAL` / `SISTEMA` +
  id cuando aplica), acción, entidad afectada por referencia (tipo + id,
  sin llave foránea) y un detalle libre en `datos`. El
  `AuditoriaInterceptor` registra automáticamente toda request mutante
  (POST/PUT/PATCH/DELETE) resolviendo el actor desde `request.user`
  (JWT de panel) o `request.enlace` (token de enlace de diagnóstico); los
  servicios de dominio pueden llamar a `AuditoriaService.registrar(...)`
  directamente para un registro más específico.
- `src/reglas/` — versión de reglas aplicada a cada caso (requisito
  duro). El contenido de las reglas vive en una columna `jsonb`, no en
  código.
- `src/usuarios/` + `src/auth/` — login JWT y guards de roles para
  `apps/panel`. `UsuariosController` (`/usuarios`) es el CRUD interno de
  cuentas (nombre, email, `activo`) — sin autoservicio, lo administra el
  propio equipo y exige estar ya autenticado como ADMIN. `activo: false`
  revoca el acceso de inmediato (login y JWT ya emitidos), sin borrar el
  usuario ni su historial. `prisma/seed.ts` (`pnpm prisma db seed`) crea
  el primer ADMIN a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
  `ADMIN_NOMBRE`, porque sin un usuario ya autenticado no se puede llegar
  a `POST /usuarios`. `Usuario.rol` es un placeholder de un solo valor
  (`ADMIN`) hasta que se defina el modelo real de permisos (ver
  "Pendiente a propósito" abajo).
- `src/token-enlace/` — token de vida corta para `apps/diagnostico`
  (firmar/verificar, sin persistencia). Ver TODO en
  `token-enlace.service.ts`.
- `src/health/` — `GET /health`.

## Pendiente a propósito (no construir todavía)

- Modelos de dominio del cuestionario (`Caso`, respuestas, etc.) y la
  detección de contradicciones — dependen de la especificación completa
  del cuestionario de las 4 familias (Proyecto, B2B, Profesional,
  Catálogo), que todavía no existe. Mientras tanto, `TokenEnlaceService`
  no persiste enlaces ni los invalida tras un solo uso — eso depende de
  la forma de `Caso`.
- El motor de cálculo real detrás de `MotorCalculoPort`.
- El modelo real de roles/permisos de `apps/panel` — `RolUsuario` hoy
  solo tiene `ADMIN` (ver TODO en `prisma/schema.prisma`); el mecanismo
  de auth (`JwtAuthGuard`, `RolesGuard`, `@Roles()`) ya está listo para
  cuando existan más roles.
- Aislamiento de datos por caso a nivel de Postgres (RLS): la convención
  acordada es que toda tabla de dominio nueva lleve una columna
  `casoId`/`tenantId` y que el filtrado se resuelva primero a nivel de
  aplicación (servicio), ya que `diagnostico`/`panel` nunca tocan
  Postgres directamente. Evaluar RLS como segunda capa de defensa recién
  cuando exista el dominio real.

## Nota de versiones

`@nestjs/cli@11` falla en Node 22 por un bug conocido de ciclo
ESM/CJS en su dependencia `ora@9` (`ERR_REQUIRE_CYCLE_MODULE`). Por eso
el proyecto quedó en Nest 10 (estable, sin ese problema). Revisar si
sigue vigente antes de subir de major.
