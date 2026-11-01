# api (P4)

Base de datos, motor de cálculo de SCORE, CRM, pagos y bitácora de
auditoría. La consumen `apps/diagnostico` y `apps/panel` por HTTP. Ver
`../CLAUDE.md` para el contexto completo del monorepo.

Stack: NestJS 12 + TypeScript + Prisma 7 sobre PostgreSQL, con `pnpm` como
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
con todos los endpoints documentados automáticamente — rutas, DTOs de
entrada (tipos, campos requeridos, tal como los valida
`class-validator`) y seguridad, sin decorar nada a mano por endpoint;
el plugin de compilación `@nestjs/swagger` (`nest-cli.json`) es lo que
genera esa documentación a partir del código en cada build. Tiene el
botón "Authorize" para pegar un JWT (de `POST /auth/login`) y probar
también las rutas protegidas. Con `NODE_ENV=production`, `/docs` y
`/docs-json` devuelven 404 — no queda expuesto.

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
- `src/common/` — `GlobalExceptionFilter`, forma de error única para
  toda la API: la estándar de NestJS, `{ statusCode, message, error }`
  (`message` es una lista en los errores de validación). Un error que no
  es `HttpException` va al log y responde un 500 genérico.
- `src/prisma/` — `PrismaService` global, conecta vía driver adapter
  (`@prisma/adapter-pg`), requerido por Prisma 7.
- `src/scoring-engine/` — el motor de cálculo de SCORE queda detrás de
  `ScoringEnginePort` (`scoring-engine.port.ts`). Hoy solo existe
  `StubScoringEngineAdapter`, un adaptador de ejemplo — se reemplaza
  cuando se confirme el escenario real del motor (API ya ejecutable,
  hoja de cálculo a portar, o construir desde cero; ver `CLAUDE.md`
  sección 3).
- `src/audit/` — bitácora de auditoría (requisito duro). Cada evento
  guarda actor tipado (`PANEL_USER` / `END_CLIENT` / `SYSTEM` + id
  cuando aplica), acción, entidad afectada por referencia (tipo + id,
  sin llave foránea) y un detalle libre en `data` (tabla `audit_logs`). El
  `AuditInterceptor` registra automáticamente toda request mutante
  (POST/PUT/PATCH/DELETE) resolviendo el actor desde `request.user`
  (JWT de panel) o `request.accessLink` (token de enlace de diagnóstico); los
  servicios de dominio pueden llamar a `AuditService.record(...)`
  directamente para un registro más específico.
- `src/rules/` — versión de reglas aplicada a cada caso (requisito
  duro). El contenido de las reglas vive en una columna `jsonb`, no en
  código.
- `src/users/` + `src/auth/` — login JWT y guards de roles para
  `apps/panel`. `UsersController` (`/users`) es el CRUD interno de
  cuentas (`name`, `email`, `active`) — sin autoservicio, lo administra el
  propio equipo y exige estar ya autenticado como ADMIN. `active: false`
  revoca el acceso de inmediato (login y JWT ya emitidos), sin borrar el
  usuario ni su historial. Cambiar la contraseña (`password` opcional en
  `PATCH /users/:id`, o por recuperación) cierra todas las sesiones
  abiertas: el JWT lleva `ver` (`User.sessionVersion`), y
  `JwtStrategy` rechaza los tokens de una versión anterior. Todo cambio
  de contraseña pasa por `passwordChangeData()` (`users.service.ts`),
  que hashea y sube la versión. `GET /users` está paginado en el servidor
  (`?page=1&pageSize=20&search=`, máx. 100 por página) y devuelve
  `{ data, total, page, pageSize }`: página y conteo salen de una sola
  transacción, y la búsqueda (`search`, por nombre o email, sin distinguir
  mayúsculas) se resuelve en la consulta. Los DTOs normalizan espacios y
  limitan `name` a 120 y `email` a 254 caracteres. `prisma/seed.ts` (`pnpm prisma db seed`) crea
  el primer ADMIN a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
  `ADMIN_NAME`, porque sin un usuario ya autenticado no se puede llegar
  a `POST /users`. `User.role` es un placeholder de un solo valor
  (`ADMIN`) hasta que se defina el modelo real de permisos (ver
  "Pendiente a propósito" abajo).
- `src/password-reset/` — recuperación de contraseña de
  `apps/panel`, rutas públicas: `POST /auth/password-reset/request`
  (`{ email }`, 3/min por IP) responde siempre el mismo mensaje y hace
  el trabajo en segundo plano (misma respuesta y mismo tiempo exista o
  no el correo); si el usuario existe y está activo, crea un token
  aleatorio de un solo uso que vence en 1 hora, borra los pendientes
  anteriores y manda el enlace `PANEL_URL/reset-password?token=`
  por `MailService`. En la base solo queda el SHA-256 del token
  (`PasswordResetToken`). `POST /auth/password-reset/confirm`
  (`{ token, password }`, 5/min por IP) responde 204, o 400 con un único
  mensaje para enlace inválido, usado o vencido. La bitácora guarda la
  solicitud y el cambio sin token ni email en claro.
- `src/access-link/` — token de vida corta para `apps/diagnostico`
  (`POST /access-links` con `{ subjectId }`, solo ADMIN, para QA)
  (firmar/verificar, sin persistencia). Ver TODO en
  `access-link.service.ts`.
- `src/leads/` — `POST /api/v1/leads/prequalification`, el endpoint
  público (sin auth, 5 envíos/min por IP) que llama el formulario de
  precalificación de `score-sitio` desde el navegador. Registra un
  `Lead` en estado `NEW` con la familia ya elegida y los UTM; responde
  solo `{ id, status }`. Mientras `score-sitio` migra, `POST
  /leads/precalificacion` (`src/leads/legacy/`) sigue aceptando el
  contrato viejo en español, con su forma de error `{ statusCode,
  mensaje }`. Los datos personales (`nombre`, `email`,
  `telefono`) se redactan en la bitácora con `@RedactInAudit()`.
  Es un contrato con otro repo: está en
  [`docs/contrato-precalificacion.md`](docs/contrato-precalificacion.md),
  y cambiarlo se coordina con José. Para `apps/panel` (JWT + ADMIN):
  `GET /leads` (paginado, filtros `family`/`status` y búsqueda `search`
  por nombre/email, en la base; más recientes primero), `GET /leads/:id`
  y `PATCH /leads/:id/status` (`NEW`/`CONTACTED`/`CONVERTED`). El resto
  de los datos del lead no se edita desde el panel.
- `src/mail/` — correo transaccional. Los módulos llaman a
  `MailService` (`sendDiagnosticLink`, `sendLinkRecovery`, `sendPasswordReset`),
  nunca al proveedor: detrás está `MailPort` (`mail.port.ts`), con
  dos adaptadores elegidos por `MAIL_DRIVER`: `log` (default, no envía
  nada y deja destinatario, asunto, enlaces y texto en el log) y `resend`
  (staging/producción; exige `RESEND_API_KEY`, `MAIL_FROM` y
  `MAIL_REPLY_TO`, y en producción es obligatorio — si falta algo la
  API no arranca y dice qué). Las plantillas viven en
  `mail/templates/` (HTML con estilos en línea, todo lo variable
  escapado; logo por `MAIL_LOGO_URL`, textos provisionales). Un fallo
  del proveedor no lanza: vuelve `{ sent: false, reason }`. Cada
  intento queda en la bitácora (`EMAIL_SENT`/`EMAIL_FAILED`) con el
  tipo, el destinatario enmascarado y el id o motivo — nunca el enlace ni
  el contenido. Sin colas ni reintentos (fuera de alcance del MVP).
  Prueba manual: `pnpm mail:test tu@email.com` (necesita Postgres);
  con `MAIL_DRIVER=resend` y remitente `onboarding@resend.dev` llega de
  verdad, pero solo al email dueño de la cuenta de Resend.
- `src/health/` — `GET /health`.

## Pendiente a propósito (no construir todavía)

- Modelos de dominio del cuestionario (`Case`, respuestas, etc.) y la
  detección de contradicciones — dependen de la especificación completa
  del cuestionario de las 4 familias (Proyecto, B2B, Profesional,
  Catálogo), que todavía no existe. Mientras tanto, `AccessLinkService`
  no persiste enlaces ni los invalida tras un solo uso — eso depende de
  la forma de `Case`.
- El motor de cálculo real detrás de `ScoringEnginePort`.
- El modelo real de roles/permisos de `apps/panel` — `UserRole` hoy
  solo tiene `ADMIN` (ver TODO en `prisma/schema.prisma`); el mecanismo
  de auth (`JwtAuthGuard`, `RolesGuard`, `@Roles()`) ya está listo para
  cuando existan más roles.
- Aislamiento de datos por caso a nivel de Postgres (RLS): la convención
  acordada es que toda tabla de dominio nueva lleve una columna
  `caseId`/`tenantId` y que el filtrado se resuelva primero a nivel de
  aplicación (servicio), ya que `diagnostico`/`panel` nunca tocan
  Postgres directamente. Evaluar RLS como segunda capa de defensa recién
  cuando exista el dominio real.

## Nota de versiones

Desde NestJS 12 los paquetes de Nest se publican como ESM (usan
`import.meta.url`), y Jest en modo CommonJS no puede cargarlos. Por eso
los tests corren con **Vitest** (`vitest.config.mts` y
`vitest.config.e2e.mts`), con `unplugin-swc` para que se emita la
metadata de decoradores que necesita la inyección de dependencias de
Nest (esbuild, el transformador por defecto de Vitest, no la emite). En
los specs se usa `vi.fn()`/`vi.mock()` y el tipo `Mock` de `vitest`. El
código de la app sigue siendo CommonJS: Node 22 carga los paquetes ESM de
Nest vía `require(esm)`.
