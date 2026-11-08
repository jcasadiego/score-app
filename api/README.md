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
pnpm prisma db seed          # crea el primer ADMIN (ADMIN_* en .env) y, fuera de producción, el cuestionario de prueba
pnpm start:dev                # http://localhost:3000
```

`GET /health` confirma que el servicio y la conexión a Postgres están
vivos (fuera del prefijo `/api` y del versionado, a propósito — es la
ruta que usa cualquier orquestador/healthcheck de infraestructura).

Con `NODE_ENV` en `development` o `test`, `GET /docs` sirve Swagger UI
con todos los endpoints documentados automáticamente — rutas, DTOs de
entrada (tipos, campos requeridos, tal como los valida
`class-validator`) y seguridad, sin decorar nada a mano por endpoint;
el plugin de compilación `@nestjs/swagger` (`nest-cli.json`) es lo que
genera esa documentación a partir del código en cada build. Tiene el
botón "Authorize" para pegar un JWT (de `POST /auth/login`) y probar
también las rutas protegidas. Con cualquier otro valor, `/docs` y
`/docs-json` devuelven 404 — no queda expuesto. `NODE_ENV` es obligatoria: sin
ella, la API no arranca.

En producción la API tampoco arranca sin `TRUST_PROXY_HOPS` (el número exacto
de proxies delante de ella; 0 si no hay ninguno) ni con un `CORS_ORIGINS` que
no sea una lista de orígenes `https` exactos. Esa lista lleva `apps/diagnostico`
y `score-sitio`, que llaman desde el navegador; el panel llama desde su servidor.

## Segundo factor del panel

Obligatorio para todos los usuarios de `apps/panel` (TOTP, RFC 6238):

1. `POST /auth/login` con la contraseña correcta devuelve `{ mfaToken, mfaStatus }`,
   un reto de 5 minutos que **no** abre sesión.
2. Si `mfaStatus` es `ENROLLMENT_REQUIRED`: `POST /auth/mfa/enrollment` entrega el
   secreto, y `POST /auth/mfa/enrollment/confirmation` lo activa, abre la sesión y
   devuelve 10 códigos de recuperación, que no se vuelven a mostrar.
3. Si es `CHALLENGE_REQUIRED`: `POST /auth/mfa/verification` con el código o
   `POST /auth/mfa/recovery` con uno de recuperación abren la sesión.

Cada código incorrecto cuenta para el bloqueo de 5 intentos. Quien pierda el
autenticador y los códigos necesita que **otro** ADMIN use
`PATCH /users/:id/reset-mfa`. Si el único ADMIN queda fuera, se restablece en la
base con acceso de operación, y se deja constancia del motivo.

`MFA_ENCRYPTION_KEY` es obligatoria en todo entorno. Sin rotación todavía:
perderla o cambiarla obliga a restablecer el MFA de todos.

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
  toda la API: RFC 9457 (`application/problem+json`), catálogo en
  `docs/errores.md`. Un error que no
  es `HttpException` va al log y responde un 500 genérico.
- `src/prisma/` — `PrismaService` global, conecta vía driver adapter
  (`@prisma/adapter-pg`), requerido por Prisma 7.
- `src/scoring-engine/` — el motor de cálculo de SCORE queda detrás de
  `ScoringEnginePort` (`scoring-engine.port.ts`). Hoy solo existe
  `StubScoringEngineAdapter`, un adaptador de ejemplo — se reemplaza
  cuando se confirme el escenario real del motor (API ya ejecutable,
  hoja de cálculo a portar, o construir desde cero; ver `CLAUDE.md`
  sección 3).
- `src/common/app-throttler.guard.ts` — límite de peticiones. Cuenta por usuario
  si el JWT del panel tiene firma válida, por diagnóstico si trae una sesión de
  cliente final válida, por la IP que informa el panel o `apps/diagnostico` en
  rutas sin sesión (`x-client-ip`, solo con `x-panel-secret` igual a
  `PANEL_API_SECRET` o `x-diagnostic-secret` igual a `DIAGNOSTIC_API_SECRET`) y,
  si no, por IP de conexión. Cada contador es por ruta y vive en memoria, así que con
  varias instancias de la API hará falta un almacén compartido.
- `src/audit/` — bitácora de auditoría (requisito duro). Cada evento
  guarda actor tipado (`PANEL_USER` / `END_CLIENT` / `SYSTEM` + id
  cuando aplica), acción, entidad afectada por referencia (tipo + id,
  sin llave foránea) y un detalle libre en `data` (tabla `audit_logs`). El
  `AuditInterceptor` registra toda request exitosa que cambia datos, con la
  acción, la entidad y los campos que declara su `@AuditRoute()`; el actor sale
  de `request.user` (JWT de panel) o `request.accessLink` (sesión del cliente final).
  `auditFailures` registra los intentos fallidos o denegados, sin guardar el
  body. Un evento crítico se registra desde su servicio, pasando el `tx` a
  `AuditService.record(...)`, para que ambos se confirmen o se reviertan juntos.
  La base rechaza `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs`.
- `src/questionnaire/` — versiones del cuestionario por familia (PF-12):
  `QuestionnaireVersion` → `Question` → `AnswerOption`. Un borrador (`DRAFT`,
  a lo sumo uno por familia) se edita; una versión publicada es inmutable, y un
  trigger lo garantiza también en la base. `code` (pregunta) y `value` (opción)
  son estables entre versiones. Rutas en `/questionnaire-versions`: ver, Revisor y
  Aprobador; crear el borrador, editar preguntas, reordenarlas y publicar, solo
  Aprobador. Crear y editar reciben la pregunta completa con sus opciones, en una
  sola operación. Publicar valida que el borrador esté completo y, si no, responde
  409 con la lista de lo que falta. Un borrador nuevo copia la última versión
  publicada que no sea de prueba.
- `prisma/sample-questionnaire.ts` — cuestionario de **prueba** (5-6 preguntas
  por familia, con `isSample` y el prefijo `[Prueba]`). Lo carga `pnpm prisma db
  seed` solo con `APP_ENV` en `development` o `qa` (o sin `APP_ENV` y con
  `NODE_ENV=development`); es idempotente. Para reemplazarlo, se publica el
  cuestionario oficial como una versión nueva.
- `src/rules/` — versión de reglas aplicada a cada caso (requisito
  duro). El contenido de las reglas vive en una columna `jsonb`, no en
  código.
- `POST /auth/refresh` renueva el JWT de una sesión en uso. El token conserva
  `authAt` (momento del login) y nunca vence después de
  `authAt + JWT_MAX_SESSION_SECONDS`. No hay refresh tokens: `JwtStrategy`
  valida sesión, cuenta y `sessionVersion` en cada petición.
- `POST /auth/logout` borra la fila de `UserSession` que nombra el JWT (`sid`):
  ese token, y los renovados a partir de él, dejan de valer de inmediato. Cada
  usuario tiene una sola sesión, en un solo dispositivo: un login nuevo reemplaza
  la anterior. `GET /auth/session` responde 204 si el token sigue valiendo, sin
  efectos.
- `src/users/` + `src/auth/` — login JWT y guards de roles para
  `apps/panel`. `UsersController` (`/users`) es el CRUD interno de
  cuentas (`name`, `email`, `active`) — sin autoservicio, lo administra el
  propio equipo y exige estar ya autenticado como Aprobador. `active: false`
  revoca el acceso de inmediato (login y JWT ya emitidos), sin borrar el
  usuario ni su historial. Nadie define ni conoce la contraseña de otra
  persona (PF-59): `POST /users` no recibe `password`; la cuenta nace con una
  contraseña aleatoria que no se guarda en ningún lado y `passwordSetAt: null`,
  y su dueño recibe un enlace de un solo uso (72 h) para definirla en
  `/reset-password` antes de configurar el MFA. `POST /users/:id/password-reset`
  (Aprobador, nunca sobre uno mismo ni sobre una cuenta desactivada) invalida la
  contraseña vigente, cierra sus sesiones y le manda un enlace nuevo; también
  sirve para reenviar el de activación. `PATCH /users/:id/reset-mfa` hace lo
  mismo además de quitar el MFA. Las tres respuestas traen `linkSent`: si el
  correo falló, el panel lo avisa. El login rechaza una cuenta con
  `passwordSetAt` nulo. Cambiar la contraseña cierra todas las sesiones
  abiertas: el JWT lleva `ver` (`User.sessionVersion`), y `JwtStrategy`
  rechaza los tokens de una versión anterior. Los enlaces salen de
  `PasswordLinkService` (`src/password-reset/password-link.service.ts`). `GET /users` está paginado en el servidor
  (`?page=1&pageSize=20&search=`, máx. 100 por página) y devuelve
  `{ data, total, page, pageSize }`: página y conteo salen de una sola
  transacción, y la búsqueda (`search`, por nombre o email, sin distinguir
  mayúsculas) se resuelve en la consulta. Los DTOs normalizan espacios y
  limitan `name` a 120 y `email` a 254 caracteres. `prisma/seed.ts` (`pnpm prisma db seed`) crea
  el primer ADMIN a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
  `ADMIN_NAME`, porque sin un usuario ya autenticado no se puede llegar
  a `POST /users`. `User.role` es `ADMIN` (Aprobador) o `REVIEWER` (Revisor), sin
  valor por defecto; la matriz está en `CLAUDE.md`, sección 5.3. Cambiarlo
  cierra las sesiones del usuario y queda como `USER_ROLE_CHANGED`. Siempre
  debe quedar un Aprobador activo: si no, 409.
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
  mensaje para enlace inválido, usado o vencido. La misma confirmación activa
  una cuenta nueva o restablecida por un Aprobador (`passwordSetAt`). La bitácora guarda la
  solicitud y el cambio sin token ni email en claro.
- `src/diagnostics/` — diagnósticos del cliente final (PF-16). Un
  `Diagnostic` por lead, que apunta a la última versión publicada de su
  familia (un trigger exige que esté publicada); la familia sale de la
  versión. Respuestas en `Answer` (texto libre) y `AnswerSelection`
  (opciones), con FK compuestas que garantizan en la base que la pregunta
  sea de la versión y la opción de la pregunta. Enlaces externos en
  `ExternalLink` (Spotify, YouTube, Instagram, TikTok y sitio web; solo
  https y dominios permitidos). Estados `ACTIVE` → `IN_PROGRESS` →
  `COMPLETED`; `ABANDONED` se calcula (7 días sin actividad) y no se guarda.
  - **Enlace sin contraseña** (`AccessLink`): token opaco de 256 bits del
    que solo se guarda el SHA-256; vence en `ACCESS_LINK_TTL_DAYS` (30) y
    sirve varias veces. Va en el fragmento de la URL,
    `DIAGNOSTIC_URL/access#token=`, para que no llegue a los logs de
    `apps/diagnostico`. `POST /diagnostic-sessions` (`{ token }`, 10/min
    por IP) lo canjea por una sesión JWT de 12 h firmada con
    `ACCESS_LINK_JWT_SECRET`, que nombra al enlace: `AccessLinkGuard` revisa
    en cada petición que siga vigente, así que revocarlo corta la sesión.
    Canjear un enlace revoca los emitidos antes que él. Si el diagnóstico ya se
    envió, un enlace no vencido responde 409 `DIAGNOSTIC_COMPLETED` en vez de
    401, para que el cliente sepa que ya terminó.
  - **Cliente** (sesión): `GET /diagnostic-sessions/current` (cuestionario,
    respuestas, enlaces y progreso), `PUT`/`DELETE
    current/answers/:questionId` (`{ text }` o `{ optionIds }`),
    `PUT`/`DELETE current/external-links/:platform` (`{ url }`) y
    `POST current/submission` (201; 409 con las obligatorias que faltan).
    Enviar revoca sus enlaces y dispara `notifyDiagnosticCompleted`.
  - **Panel**: `GET /diagnostics` (paginado; `status` incluye `ABANDONED`,
    `family`, `search` por nombre o email del lead) y `GET /diagnostics/:id`,
    para Revisor y Aprobador, auditados como lecturas. `POST /diagnostics`
    (`{ leadId, reason }`, solo Aprobador: generar sin pago lleva motivo)
    responde 201 con `Location` y el enlace una sola vez; `POST
    /diagnostics/:id/access-links` (Revisor y Aprobador) revoca los vigentes
    y envía uno nuevo. Si el correo falla, la operación queda hecha y la
    respuesta trae `emailSent: false` para copiar el enlace.
  - **Recuperación** (pública): `POST /access-link-recoveries` (`{ email }`)
    responde siempre 202 y envía en segundo plano un enlace nuevo para el
    diagnóstico sin completar más reciente de ese correo, sin revocar el
    anterior. 3/min por IP y 3/hora por correo destino.
  - La bitácora registra cada acción con su actor (`END_CLIENT` = id del
    diagnóstico) y el `accessLinkId` usado, sin el token, el motivo ni las
    respuestas. Como el panel puede copiar el enlace del cliente, ese id
    rastrea cada cambio hasta quién emitió el enlace (`ACCESS_LINK_ISSUED`).
- `src/leads/` — `POST /api/v1/leads/prequalification`, el endpoint
  público (sin auth, 5 envíos/min por IP) que llama el formulario de
  precalificación de `score-sitio` desde el navegador. Registra un
  `Lead` en estado `NEW` con la familia ya elegida y los UTM; responde
  solo `{ id, status }`. Mientras `score-sitio` migra, `POST
  /leads/precalificacion` (`src/leads/legacy/`) sigue aceptando el
  contrato viejo en español, con su forma de error `{ statusCode,
  mensaje }`. Los datos personales (`nombre`, `email`,
  `telefono`) no entran a la bitácora: `@AuditRoute()` solo guarda lo declarado.
  Es un contrato con otro repo: está en
  [`docs/contrato-precalificacion.md`](docs/contrato-precalificacion.md),
  y cambiarlo se coordina con José. Para `apps/panel` (JWT + ADMIN):
  `GET /leads` (paginado, filtros `family`/`status` y búsqueda `search`
  por nombre/email, en la base; más recientes primero), `GET /leads/:id`
  (con `diagnostic: { id } | null`, para que el panel ofrezca abrirlo)
  y `PATCH /leads/:id/status` (`NEW`/`CONTACTED`/`CONVERTED`). El resto
  de los datos del lead no se edita desde el panel.
- `src/mail/` — correo transaccional. Los módulos llaman a
  `MailService` (`sendDiagnosticLink`, `sendLinkRecovery`, `sendPasswordReset`, `sendPasswordSetup`),
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
- `src/notifications/` — avisos por correo al equipo, a todos los usuarios
  activos del panel: lead nuevo (lo dispara `LeadsService.create`, también
  desde el alias legacy) y diagnóstico completado
  (`notifyDiagnosticCompleted`, al enviar el diagnóstico). Se procesan en segundo plano, así que ni el tiempo de respuesta ni
  un fallo del correo afectan a la operación que los dispara. Cada envío queda
  en la bitácora asociado al lead o al diagnóstico, sin sus datos personales.
  Los enlaces salen de `PANEL_URL`.
- `src/health/` — `GET /health`.

## Pendiente a propósito (no construir todavía)

- La detección de contradicciones. El contenido oficial del cuestionario
  depende de la especificación de las 4 familias (Proyecto, B2B,
  Profesional, Catálogo), que todavía no existe.
- El motor de cálculo real detrás de `ScoringEnginePort`.
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
