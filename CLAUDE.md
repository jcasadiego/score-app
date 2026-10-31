# SCORE — App, Panel y API (P2, P4, P5) · Guía de trabajo del repo

Este archivo lo lee tanto una persona como Claude Code cuando trabajas en este
repo. El sitio público (P1) vive en otro repo: `score-sitio`.

## 1. Qué estamos construyendo aquí

Monorepo con las tres piezas de SCORE que no son el sitio público:

- **`apps/diagnostico`** (P2 + P3) — la app donde el cliente final de Music
  Finance Pro responde el cuestionario, por enlace único, sin crear
  contraseña. El modo de voz (P3, opcional) es parte de esta misma app, no
  una app aparte.
- **`apps/panel`** (P5) — el panel interno donde el equipo de Music Finance
  Pro revisa cada caso, corrige con trazabilidad, aprueba y genera el
  informe. Tiene login y permisos — nunca comparte código ni build con
  `apps/diagnostico`.
- **`api`** (P4) — la base de datos, la integración con el motor de cálculo
  de SCORE, el CRM, los pagos y la bitácora de auditoría. La consumen
  `diagnostico` y `panel` por HTTP.

El alcance detallado de cada producto (qué incluye y qué no) está en
`Propuesta_MVP_SCORE.docx`, sección 02. Si algo pedido no aparece ahí, es
señal de alcance — se le avisa a José antes de construirlo.

## 2. Quién hace qué

Por ahora este repo lo lleva **José en solitario** (diagnóstico, API, motor
de cálculo, base de datos y despliegue). El sitio (`score-sitio`) lo lleva el
compañero no-developer, en su propio repo — no tiene acceso a este.

Si en algún momento se suma alguien más a este repo, sigue el mismo reparto
de responsabilidades del proyecto: nadie decide alcance ni stack nuevo por su
cuenta, y todo pasa por PR y revisión antes de llegar a `main`.

## 3. Pendientes que bloquean empezar a programar

- **Escenario del motor de cálculo:** confirmar si es software ejecutable,
  una hoja de cálculo, está solo documentado, o parcialmente definido (ver
  `Alcance_Preliminar_MVP_SCORE.docx`, sección 03). En `api`, el motor
  queda detrás de `MotorCalculoPort` (`api/src/motor-calculo/`) para no
  bloquear el resto por esto — hoy solo hay un adaptador de ejemplo.
- **Especificación completa del cuestionario** de las cuatro familias
  (Proyecto, B2B, Profesional, Catálogo), con su lógica. Bloquea el
  dominio real de `api` (modelos de caso/respuestas, detección de
  contradicciones) y el flujo de `apps/diagnostico`.
- **Modelo de permisos de `apps/panel`:** el modelo real de roles y
  permisos todavía no está definido. El login ya funciona de punta a
  punta (JWT en `api` + pantalla de login y sesión en `apps/panel`) y
  hay CRUD de usuarios, pero todo contra un `Usuario` con un solo rol
  placeholder (`ADMIN`) — ver TODO en `api/prisma/schema.prisma`. No
  agregar roles nuevos ni permisos por caso sin confirmarlo con José.

## 3.1. Estado actual del código

Las tres piezas ya están inicializadas como scaffold — sin la lógica de
negocio que depende de los pendientes de la sección 3. Gestor de paquetes:
`pnpm` en las tres, cada una con su propio lockfile (sin workspaces).

Lo que ya existe, además del scaffold, es todo lo que no depende de esos
pendientes:

- **`api`:** seguridad HTTP (helmet, CORS con allowlist por entorno,
  validación global, rate limiting, también en login), versionado de
  rutas (`/api/v1`, Swagger autogenerado en `/docs` fuera de
  producción), bitácora de auditoría con actor tipado
  (`USUARIO_PANEL`/`CLIENTE_FINAL`/`SISTEMA`) vía `AuditoriaInterceptor`,
  versión de reglas en `jsonb`, auth JWT + `RolesGuard`/`@Roles()`, CRUD
  de usuarios internos (`/usuarios`, solo ADMIN; `activo: false` revoca
  el acceso sin borrar historial; un usuario no puede desactivarse a sí
  mismo), seed del primer ADMIN, el token de enlace stateless de
  `apps/diagnostico` y el servicio de correo transaccional
  (`src/correo`, Resend detrás de `CorreoPort`; en local `CORREO_MODO=log`
  no envía nada). Detalle en `api/README.md`.
- **`apps/panel`:** UI con Ant Design, login contra `api` vía Server
  Action con cookie `httpOnly`, rutas protegidas (`proxy.ts` +
  `app/(panel)/layout.tsx`, verificación en `lib/auth/dal.ts`) y la
  pantalla de Usuarios (`app/(panel)/usuarios/`). Detalle en
  `apps/panel/README.md`.
- **`apps/diagnostico`:** solo scaffold — su flujo depende de la
  especificación del cuestionario.

**`api`** — NestJS 12 + TypeScript + Prisma 7 sobre PostgreSQL:

```bash
pnpm install
docker compose up -d       # Postgres local
pnpm prisma migrate dev
pnpm prisma db seed         # primer usuario ADMIN (ADMIN_* en .env)
pnpm start:dev              # http://localhost:3000
pnpm build
pnpm lint
pnpm test:e2e
```

**`apps/diagnostico`** y **`apps/panel`** — Next.js 16 (App Router) +
TypeScript + Tailwind (`panel` usa además Ant Design):

```bash
pnpm install
pnpm dev     # diagnostico: :3001 · panel: :3002 (3000 lo usa la api)
pnpm build
pnpm lint
```

Detalle de cada pieza en su propio README.

## 4. Cómo se organiza el repo

```
score-app/
  apps/
    diagnostico/   # P2 + P3 — Next.js
    panel/         # P5 — Next.js
  api/             # P4 — NestJS + Prisma + PostgreSQL
  CLAUDE.md
```

Cada pieza se despliega por separado. No se usan herramientas de monorepo
(Turborepo, pnpm workspaces) por ahora — con un MVP y tres despliegues
independientes, carpetas simples alcanzan. Si más adelante `diagnostico` y
`panel` terminan compartiendo mucho código (tipos, componentes de
resultados), se evalúa introducir un `packages/` compartido — no antes.

## 5. Flujo de trabajo

Mismo criterio que `score-sitio`, aunque hoy lo trabajes tú solo. El repo
tiene dos ramas largas con roles distintos:

- **`main`** — estrictamente producción. Solo recibe merges desde `develop`
  cuando se hace un release.
- **`develop`** — rama de integración, es lo que corre en QA. Aquí llegan
  los PR de todo el trabajo en curso.

Flujo del día a día:

1. Rama nueva desde `develop` actualizado (`feature/`, `fix/`).
2. Commits pequeños, en español, en modo instrucción.
3. PR hacia `develop` con 2-3 líneas de qué cambió y por qué — aunque te
   apruebes a ti mismo, deja el registro. Es el mismo hábito que le pides a
   tu compañero en `score-sitio`, y te sirve de bitácora si más adelante se
   suma alguien a este repo.
4. Nunca push directo a `main` ni a `develop`.
5. `develop` → `main` es un paso aparte, deliberado, para subir a prod — no
   ocurre como consecuencia automática de mergear a `develop`.
6. Cada PR corre CI automático (GitHub Actions, `.github/workflows/`):
   lint + build + `pnpm audit --audit-level=high` en las tres piezas, y
   tests unitarios/e2e en `api` (contra un Postgres de servicio). Un
   workflow por pieza; los tres corren siempre, pero un job `changes`
   (`dorny/paths-filter`) salta el job real si la pieza no cambió — así
   los checks requeridos de `develop` no quedan pendientes.

## 5.1. Revisión de seguridad

El repo maneja auth, datos de clientes y (más adelante) pagos, así que la
revisión de seguridad es parte del flujo, en tres niveles según el riesgo:

1. **Cada PR hacia `develop`:** correr `/security-review` (incluido en
   Claude Code) sobre la rama antes de mergear. Los hallazgos HIGH/MEDIUM
   se corrigen en el mismo PR, o se deja anotado en el PR por qué no
   aplican.
2. **PR que toca una frontera de confianza** — auth/JWT, sesión y cookies
   de `apps/panel`, token de enlace de `apps/diagnostico`, usuarios y
   permisos, bitácora de auditoría, pagos, CRM o el endpoint que consume
   `score-sitio`: además, pedir una revisión acotada con la skill
   `security-audit` en modo guía (ej. "revisa la seguridad del flujo de
   token de enlace"). No genera archivos ni lanza la auditoría completa.
3. **Antes de cada release `develop` → `main`:** auditoría completa con
   `security-audit` ("audita la seguridad de este repo, perfil quick" o
   `standard`), **siempre con presupuesto explícito** de agentes — sin
   presupuesto lanza decenas de subagentes. El resultado queda fuera del
   repo (`~/security-audit-skill/score-app/run-N`); las corridas siguientes
   reutilizan las anteriores. Un hallazgo `confirmed` bloquea el release;
   los `needs_validation` se revisan y se decide caso por caso.

La skill `security-audit` es de Cloudflare (MIT) y se instala a nivel de
usuario, no vive en este repo: copiar `skills/security-audit/` de
`github.com/cloudflare/security-audit-skill` (revisada en el commit
`c1c8a8c`) a `~/.claude/skills/security-audit/`. Si se actualiza, revisar
el diff antes de reemplazarla.

## 6. Convenciones rápidas

**Idioma** (decidido el 2026-10-31; el código anterior se migra según la
sección 10):

- **En inglés todo lo técnico:** identificadores (variables, funciones,
  clases, tipos, DTOs), nombres de archivos y carpetas, rutas y campos
  JSON de la api, query params, base de datos (modelos, tablas,
  columnas, enums y sus valores), acciones de la bitácora, variables de
  entorno y las URLs del panel.
- **En español:** los textos que ve el usuario final (UI, correos,
  mensajes de error que muestra el panel), los comentarios de código,
  los nombres de los tests, los commits y los PRs.
- Código **nuevo** ya va en inglés aunque el módulo vecino siga en
  español. No se renombra código existente "de paso" en un PR de otra
  cosa: eso va en su fase de la sección 10.

**Estándares:**

- **API (REST):** recursos en plural y `kebab-case` (`/users`,
  `/password-reset`), sin verbos salvo acciones que no son CRUD
  (`/users/:id/activate`). Campos JSON y query params en `camelCase`.
  Error con la forma estándar de NestJS: `{ statusCode, message, error }`.
  Paginación: `?page=1&pageSize=20&search=` → `{ data, total, page,
  pageSize }`.
- **Base de datos (PostgreSQL + Prisma):** modelos en `PascalCase`
  singular y campos en `camelCase` en el schema, mapeados a tablas y
  columnas `snake_case` con `@@map`/`@map` (tablas en plural). Valores
  de enum en `UPPER_SNAKE_CASE`.
- **Código:** convenciones de NestJS (`users.service.ts`,
  `UsersService`) y de Next.js. Archivos en `kebab-case`, componentes en
  `PascalCase`, constantes en `UPPER_SNAKE_CASE`.
- Variables de entorno nuevas van en el `.env.example` de cada app/API
  (sin valores reales), en `UPPER_SNAKE_CASE` y en inglés.

## 7. Relación con score-sitio

Este repo es **independiente** de `score-sitio`. No asumas acceso ni
visibilidad sobre ese código — es otro repo, con otro dueño de cambios (el
compañero no-developer), y no debe tener acceso a este repo.

El único punto de contacto entre los dos es el endpoint que consume el
formulario de precalificación del sitio, dentro de `api`. Si cambias su
forma (campos, tipos, códigos de respuesta), coordínalo con José antes de
mergear — el cambio afecta al otro repo y él es quien ve los dos lados.

## 8. Seguimiento en Jira

El backlog de este repo vive en Jira, proyecto **PF**:

- Timeline: https://team-1623523974970.atlassian.net/jira/software/projects/PF/boards/144/timeline
- Sitio / cloudId para el MCP de Atlassian: `team-1623523974970.atlassian.net`
- Consulta rápida: JQL `project = PF ORDER BY rank ASC`

Estructura: épicas por módulo (ej. Auditoría = módulo M7 de
`Alcance_Preliminar_MVP_SCORE.docx`) con tareas hijas. Cada tarea trae
descripción, alcance, fuera de alcance, criterios de aceptación, DoD y un
"prompt para Claude Code" — ese prompt es el punto de partida al
implementarla. Épicas actuales: **PF-1** Auditoría, **PF-3** Usuarios y
permisos, **PF-6** Infraestructura y DevEx — al abrir un módulo nuevo,
crear su épica antes que sus tareas. Los tickets nuevos se redactan con
`.claude/plantilla-tickets-jira-score.md` (índice en
`.claude/prompts.json`). Al cerrar una tarea, marcar sus
criterios y DoD y pasarla a "Listo" con el número de PR. El estado de cada tarea se consulta en Jira,
no se copia aquí (se desactualiza).

## 9. Lecciones de PRs anteriores (no repetir)

Errores que ya costaron un PR de corrección. Antes de tocar estas zonas,
revisar la regla correspondiente.

**Flujo y CI**

- **No apilar PRs** (rama sobre rama de otro PR abierto). Al mergear el
  de abajo y borrarse su rama, GitHub cerró el de arriba (#12) y hubo que
  rehacerlo (#13). Si es inevitable, cambiar la base del de arriba a
  `develop` antes de mergear el de abajo.
- **`pnpm audit` puede romper el CI sin que el PR tenga la culpa**
  (advisories nuevos). Se corrige en un PR `fix(deps)` aparte, se mergea
  primero y luego se actualizan las ramas abiertas desde `develop` (#11,
  #17). Overrides acotados por rango a la versión parcheada; `ignoreCves`
  solo para lo que no tiene parche y no llega al runtime, y se quita la
  excepción cuando deja de hacer falta (#18).
- **No volver a poner `paths` en el trigger de los workflows:** los checks
  requeridos de `develop` quedaban pendientes para siempre (#6). El filtro
  va en el job `changes`.
- CI usa **Node 22** (Node 20 ya no recibe parches de seguridad, #17).
- No marcar un PR como listo con la prueba manual sin hacer (#10): probar
  contra la api local o en el navegador y anotarlo en el test plan.

**`api`**

- **Tests con Vitest, no Jest** (NestJS 12 es ESM, #18): `vi.fn()`,
  `vi.mock()`, tipo `Mock` de `vitest`. Detalle en `api/README.md`.
- **El entrypoint del build es `dist/src/main`**, no `dist/main` (`tsc`
  incluye `prisma.config.ts` y `generated/`). No mover `rootDir`: rompe
  los imports del cliente de Prisma generado (#14). Si cambia la
  estructura del build, comprobar `pnpm build && pnpm start:prod`.
- **Bitácora de auditoría:** todo lo que se persiste de body/params/query
  pasa por `redactarDatosSensibles()` — el login quedó guardando passwords
  en claro (#4). El actor sale de `request.user` (panel) o
  `request.enlace` (cliente final), nunca de un campo que ningún guard
  setea (#5).
- **Auth:** desactivar un usuario debe cortar los JWT ya emitidos — el
  chequeo de `activo` vive en `JwtStrategy.validate`, no solo en el login
  (#7). El login verifica siempre contra un hash (real o de relleno) para
  no filtrar por tiempo qué emails existen (#4). Ids de quien hace la
  acción, del JWT (`req.user.id`), nunca del cliente.
- Listados paginados y filtrados en la base (página + conteo en una
  transacción, orden estable), nunca en memoria (#13).

**`apps/panel`**

- **Escapar con `encodeURIComponent`** todo id que se interpole en una
  ruta de la api desde una Server Action (`../` apuntaba a otro endpoint
  con el mismo token, #10).
- **Modales con `Form` de Ant Design:** con `destroyOnHidden` el `Form`
  no existe al abrir, así que no llamar a `resetFields`/`setFieldsValue`
  antes de mostrarlo. Los valores van en `initialValues` con
  `preserve={false}`. Descartados: `forceRender` (error de hidratación) y
  `clearOnDestroy` (con StrictMode borra los `initialValues`) (#16).
- No copiar datos del servidor a `useState`: la Server Action +
  `revalidatePath` ya devuelve el RSC actualizado (#13). Colores solo
  desde `lib/tema.ts`, sin hex sueltos.
- Revisar la consola del navegador (avisos de Ant Design, hidratación)
  antes de dar por buena una pantalla — así se detectó #16.

## 10. Plan: migrar el código existente a inglés

Contexto: el código nació en español y se pasa a los estándares de la
sección 6. Como todavía no hay producción, es el momento más barato para
renombrar base de datos y API. **Una fase = un PR desde `develop`**, en
este orden, sin apilar ramas (sección 9) y sin mezclarla con features.
Cada PR pasa lint, build, tests unitarios y e2e, prueba manual en el
navegador y `/security-review` (las fases 1–3 tocan auth y la bitácora:
también `security-audit` en modo guía). Al cerrar una fase, marcarla
aquí.

Glosario de base (usarlo igual en todas las fases):

| Español | Inglés |
|---|---|
| Usuario / RolUsuario | User / UserRole |
| RegistroAuditoria / ActorAuditoria | AuditLog / AuditActorType (`PANEL_USER`, `END_CLIENT`, `SYSTEM`) |
| VersionReglas | RuleSetVersion |
| TokenRecuperacionContrasena | PasswordResetToken |
| FamiliaDiagnostico | DiagnosticFamily (`PROJECT`, `B2B`, `PROFESSIONAL`, `CATALOG`) |
| EstadoLead | LeadStatus (`NEW`, `CONTACTED`, `CONVERTED`) |
| Caso / diagnóstico / enlace | Case / diagnostic / access link |
| correo / auditoría / reglas / motor de cálculo | mail / audit / rules / scoring engine |

- [ ] **Fase 1 — Contrato HTTP (api + panel en el mismo PR).** Rutas y
  campos JSON a inglés, error `{ statusCode, message, error }` (deja de
  existir `mensaje`) y paginación `{ data, total, page, pageSize }`; el
  panel se adapta en el mismo PR para no quedar roto. Rutas:
  `/usuarios` → `/users` (`/activar` → `/activate`, `/desactivar` →
  `/deactivate`), `/leads/:id/estado` → `/leads/:id/status`,
  `/token-enlace/emitir` → `POST /access-links`,
  `/auth/recuperacion/solicitar|restablecer` →
  `/auth/password-reset/request|confirm`. **`POST
  /leads/precalificacion` es el contrato con `score-sitio` (sección
  7):** se publica la ruta y los campos nuevos y la vieja queda como
  alias hasta que el sitio migre; coordinar con José y actualizar
  `api/docs/contrato-precalificacion.md`.
- [ ] **Fase 2 — Base de datos.** Modelos, campos y enums a inglés
  (glosario), con tablas y columnas `snake_case` vía `@@map`/`@map`. La
  migración se escribe a mano con `ALTER TABLE … RENAME` y `ALTER TYPE …
  RENAME VALUE` para no perder datos (Prisma por defecto genera DROP +
  CREATE en un rename: revisar el SQL antes de aplicarlo), más un
  `UPDATE` de las acciones de la bitácora (`CORREO_ENVIADO` →
  `EMAIL_SENT`, `CORREO_FALLIDO` → `EMAIL_FAILED`,
  `RECUPERACION_CONTRASENA_SOLICITADA` → `PASSWORD_RESET_REQUESTED`,
  `CONTRASENA_RESTABLECIDA` → `PASSWORD_RESET_COMPLETED`). Comprobar con
  `prisma migrate diff` que el schema y la base quedan iguales. El
  código que usa el cliente de Prisma se ajusta en el mismo PR (cambian
  los nombres generados).
- [ ] **Fase 3 — Resto del código de `api` y variables de entorno.**
  Carpetas y módulos (`auditoria` → `audit`, `correo` → `mail`,
  `usuarios` → `users`, `recuperacion-contrasena` → `password-reset`,
  `token-enlace` → `access-link`, `motor-calculo` → `scoring-engine`,
  `reglas` → `rules`), clases, métodos, DTOs y constantes. Variables de
  entorno: `JWT_EXPIRACION` → `JWT_EXPIRES_IN`, `ENLACE_JWT_SECRET|
  EXPIRACION` → `ACCESS_LINK_JWT_SECRET|EXPIRES_IN`, `CORREO_MODO` →
  `MAIL_DRIVER`, `CORREO_REMITENTE` → `MAIL_FROM`, `CORREO_REPLY_TO` →
  `MAIL_REPLY_TO`, `CORREO_LOGO_URL` → `MAIL_LOGO_URL`, `ADMIN_NOMBRE` →
  `ADMIN_NAME`. Actualizar en el mismo PR `.env.example`, el workflow de
  CI y los README; avisar a José para que cambie las variables de QA
  antes de mergear.
- [ ] **Fase 4 — `apps/panel`.** Código (`lib/`, `components/`, Server
  Actions, tipos) y URLs: `/usuarios` → `/users`,
  `/recuperar-contrasena` → `/forgot-password`, `/restablecer-contrasena`
  → `/reset-password` (el enlace del correo lo arma `api`: cambiarlo en
  el mismo PR). Los textos de pantalla siguen en español. `lib/tema.ts`
  → `lib/theme.ts`.
- [ ] **Fase 5 — Cierre.** `apps/diagnostico` (hoy solo scaffold) ya
  nace en inglés. Revisar la plantilla de tickets
  (`.claude/plantilla-tickets-jira-score.md`) para que los prompts pidan
  nombres en inglés, actualizar esta sección y borrar el plan cuando
  todas las fases estén hechas.

