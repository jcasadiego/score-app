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
  queda detrás de `ScoringEnginePort` (`api/src/scoring-engine/`) para no
  bloquear el resto por esto. Hoy hay un adapter simulado y el modo
  `disabled` (PF-24); el real es PF-26.
- **Especificación completa del cuestionario** de las cuatro familias
  (Proyecto, B2B, Profesional, Catálogo), con su lógica. Bloquea el
  dominio real de `api` (modelos de diagnóstico/respuestas, detección de
  contradicciones) y el flujo de `apps/diagnostico`.

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
  (`PANEL_USER`/`END_CLIENT`/`SYSTEM`) vía `AuditInterceptor`,
  versión de reglas en `jsonb`, auth JWT + `RolesGuard`/`@Roles()` (matriz en la sección 5.3), CRUD
  de usuarios internos (`/users`, solo Aprobador; `active: false` revoca
  el acceso sin borrar historial; un usuario no puede desactivarse a sí
  mismo; cambiar la contraseña cierra sus sesiones), renovación de sesión
  (`POST /auth/refresh`: 1 día sin uso, 7 días como máximo), cierre de sesión
  que revoca el token (`POST /auth/logout`), una sola sesión por usuario (un
  login nuevo cierra la anterior), recuperación de
  contraseña del panel por correo, política de contraseñas (12 a 128) y
  bloqueo tras 5 intentos, segundo factor TOTP obligatorio con códigos de
  recuperación (`POST /auth/login` ya no abre sesión; ver `api/README.md`),
  seed del primer ADMIN, versiones del cuestionario
  (`src/questionnaire`: borrador por familia, versión publicada inmutable, con
  un cuestionario de prueba que el seed carga fuera de producción), los
  diagnósticos (`src/diagnostics`: enlace sin contraseña guardado como hash y
  revocable, sesión del cliente, respuestas, enlaces externos, recuperación
  del enlace y abandono calculado) y el servicio de correo transaccional
  (`src/mail`, Resend detrás de `MailPort`; en local `MAIL_DRIVER=log`
  no envía nada) y los cálculos del motor (`src/calculations`: un cálculo
  por envío y por recálculo, nunca sobrescrito, con
  `SCORING_ENGINE_DRIVER` en `disabled` o `stub`). Detalle en `api/README.md`.
- **`apps/panel`:** UI con Ant Design, login contra `api` vía Server
  Action con cookie `httpOnly`, rutas protegidas (`proxy.ts` +
  `app/(panel)/layout.tsx`, verificación en `lib/auth/dal.ts`) y la
  pantalla de Usuarios (`app/(panel)/users/`), Leads, Diagnósticos
  (`app/(panel)/diagnostics/`) y la recuperación de contraseña (`/forgot-password`,
  `/reset-password`). Detalle en
  `apps/panel/README.md`.
- **`apps/diagnostico`:** el flujo del cliente final (PF-17): bienvenida que
  canjea el enlace al pulsar "Comenzar", sesión en cookie `httpOnly`, preguntas
  una por una con guardado automático, enlaces externos, revisión y envío, y
  "¿Perdiste tu enlace?". Muestra el cuestionario publicado que le toque, así
  que funciona con el de prueba hasta tener la especificación real. CSP con
  nonce en `proxy.ts`. Detalle en `apps/diagnostico/README.md`.

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
   los checks requeridos de `develop` no quedan pendientes. Aparte,
   `security.yml` analiza secretos (gitleaks), dependencias y código (CodeQL), y
   Dependabot propone parches. Las actions van fijadas por SHA.

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

## 5.2. Cumplimiento: SOC 2, ISO 27001 e ISO 27701

**Requisito permanente:** SCORE debe cumplir siempre con SOC 2 (seguridad,
disponibilidad, confidencialidad y privacidad), ISO/IEC 27001:2022 e ISO/IEC
27701:2025. Aplica a todo desarrollo, ticket y decisión de diseño, en las tres
piezas, no solo a las tareas de seguridad.

Antes de dar por terminado un cambio:

1. **Acceso:** mínimo privilegio, autorización también por objeto, y un
   permiso nuevo se confirma con José (sección 3).
2. **Trazabilidad:** todo lo que cambia datos o lee datos personales se declara
   con `@AuditRoute()`, y nada de esos datos entra a la bitácora ni a los logs.
3. **Privacidad:** se guarda solo lo necesario, con finalidad y plazo. Un dato
   personal nuevo se anota en `docs/compliance/data-inventory.md`.
4. **Proveedores:** un servicio externo que reciba datos se avisa a José antes
   de integrarlo y se anota en el inventario.
5. **Cifrado y secretos:** todo en tránsito va cifrado, los tokens como hash y
   los secretos fuera del repo.
6. **Evidencia:** todo pasa por PR y CI. Si cambia un control, se actualiza
   `docs/compliance/control-matrix.md` en el mismo PR.

Si un pedido contradice estas normas, se avisa antes de construirlo; no se
resuelve en silencio en ninguna dirección.

**No afirmar lo que no existe.** Estas normas las evalúa un auditor externo sobre
la organización completa, no solo sobre el código: hoy SCORE **no** está
certificado ni tiene informe SOC 2. Hasta tenerlos, no escribir "certificado" ni
"compliant" en el sitio, contratos o material comercial. Estado y brechas en
`docs/compliance/`.

## 5.3. Roles y permisos del panel

Dos roles, uno por usuario: `ADMIN` (**Aprobador**, puede hacer todo) y
`REVIEWER` (**Revisor**). Toda ruta nueva del panel declara `@Roles()` según esta
matriz. Un rol nuevo o un permiso por caso se confirma antes con José.

| Área | Revisor | Aprobador |
|---|---|---|
| Usuarios: crear, editar, activar/desactivar, cambiar rol | — | ✅ |
| Leads: ver y cambiar estado | ✅ | ✅ |
| Cuestionario: ver | ✅ | ✅ |
| Cuestionario: crear, editar, publicar | — | ✅ |
| Diagnósticos: ver y reenviar el enlace al cliente | ✅ | ✅ |
| Diagnósticos: generar sin pago (con motivo) | — | ✅ |
| Resultado del motor: ver y recalcular | ✅ | ✅ |
| Alertas: ver y marcar revisada/descartada | ✅ | ✅ |
| Revisión: tomar, liberar el propio, corregir, notas | ✅ | ✅ |
| Revisión: aprobar, reabrir, registrar excepción de IA, liberar un caso tomado por otro | — | ✅ |
| Informe: generar y editar borrador, regenerar sección | ✅ | ✅ |
| Informe: aprobar, entregar, reenviar enlace del informe | — | ✅ |
| Pagos: todo | — | ✅ |

- La API valida el rol en cada petición, leído de la base. El panel solo oculta lo
  que el rol no permite.
- Cambiar el rol cierra las sesiones del usuario. El rol nunca tiene valor por
  defecto: se elige siempre de forma explícita.
- Siempre debe quedar un Aprobador activo (409 si no).
- Ambos roles ven todos los casos. Un Aprobador puede aprobar un caso que él mismo
  corrigió: riesgo aceptado por José el 2026-11-04 (ISO 27001 A.5.3). Por eso
  PF-39 debe dejar en la bitácora quién corrigió y quién aprobó cada caso.

## 6. Convenciones rápidas

**Idioma** (decidido el 2026-10-31; la migración del código anterior ya
terminó):

- **En inglés todo lo técnico:** identificadores (variables, funciones,
  clases, tipos, DTOs), nombres de archivos y carpetas, rutas y campos
  JSON de la api, query params, base de datos (modelos, tablas,
  columnas, enums y sus valores), acciones de la bitácora, variables de
  entorno y las URLs del panel.
- **En español:** los textos que ve el usuario final (UI, correos,
  mensajes de error que muestra el panel), los comentarios de código,
  los nombres de los tests, los commits y los PRs.
- Excepción a propósito: el contrato legacy de precalificación
  (`api/src/leads/legacy/`) sigue en español hasta que se borre (ver
  sección 7).

**Glosario** (usar siempre los mismos términos):

| Español | Inglés |
|---|---|
| Usuario / RolUsuario | User / UserRole (`ADMIN` = Aprobador, `REVIEWER` = Revisor) |
| RegistroAuditoria / ActorAuditoria | AuditLog / AuditActorType (`PANEL_USER`, `END_CLIENT`, `SYSTEM`) |
| VersionReglas | RuleSetVersion |
| TokenRecuperacionContrasena | PasswordResetToken |
| Sesión del panel | UserSession |
| Segundo factor / Código de recuperación | MFA / UserRecoveryCode |
| FamiliaDiagnostico | DiagnosticFamily (`PROJECT`, `B2B`, `PROFESSIONAL`, `CATALOG`) |
| EstadoLead | LeadStatus (`NEW`, `CONTACTED`, `CONVERTED`) |
| Diagnóstico / enlace | Diagnostic / AccessLink |
| Revisión (el "caso" del revisor; "caso" solo en textos de pantalla) | Review |
| Versión de cuestionario / Pregunta / Opción / Respuesta | QuestionnaireVersion / Question / AnswerOption / Answer |
| Cálculo / Último intento / Cálculo vigente | Calculation / latest attempt / current calculation (el último exitoso) |
| correo / auditoría / reglas / motor de cálculo | mail / audit / rules / scoring engine |

**Estándares:**

- **API (REST):** recursos en plural y `kebab-case` (`/users`,
  `/password-reset`), sin verbos salvo acciones que no son CRUD
  (`/users/:id/activate`). Campos JSON y query params en `camelCase`.
  Métodos y códigos según RFC 9110, fechas en RFC 3339. Errores en RFC 9457
  (`application/problem+json`, catálogo en `api/docs/errores.md`).
  Paginación: `?page=1&pageSize=20&search=` → `{ data, total, page,
  pageSize }`.
- **Base de datos (PostgreSQL + Prisma):** modelos en `PascalCase`
  singular y campos en `camelCase` en el schema, mapeados a tablas y
  columnas `snake_case` con `@@map`/`@map` (tablas en plural). Valores
  de enum en `UPPER_SNAKE_CASE`. Normalizada (3NF): sin datos derivados ni
  duplicados sin justificar, tablas puente en vez de arreglos o JSON, e
  integridad garantizada en la base. Índice en cada FK, `onDelete: Restrict`
  en el dominio y `@db.Timestamptz(3)` en toda fecha.
- **Seguridad:** SOC 2, ISO 27001 e ISO 27701 (sección 5.2), OWASP API Top 10,
  OWASP ASVS y, si hay IA, OWASP LLM Top 10.
  Tokens guardados como hash. Datos del cliente fuera de logs y bitácora.
- **Accesibilidad:** WCAG 2.2 AA en `apps/diagnostico`.
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

**Pendiente:** `POST /leads/precalificacion` sigue como alias con el
contrato viejo completo (`src/leads/legacy/`). Borrarlo cuando
`score-sitio` use `POST /leads/prequalification` — coordinar con José (ver
`api/docs/contrato-precalificacion.md`).

## 8. Seguimiento en Jira

El backlog de este repo vive en Jira, proyecto **PF**:

- Timeline: https://team-1623523974970.atlassian.net/jira/software/projects/PF/boards/144/timeline
- Sitio / cloudId para el MCP de Atlassian: `team-1623523974970.atlassian.net`
- Consulta rápida: JQL `project = PF ORDER BY rank ASC`

Estructura: épicas por módulo (ej. Auditoría = módulo M7 de
`Alcance_Preliminar_MVP_SCORE.docx`) con tareas hijas. Cada tarea trae
descripción, alcance, fuera de alcance, criterios de aceptación, DoD y un
"prompt para Claude Code" — ese prompt es el punto de partida al
implementarla. Al abrir un módulo nuevo, crear su épica antes que sus tareas.
Las dependencias van como enlaces "Blocks", no solo como texto. Los tickets nuevos se redactan con
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
- **Bitácora de auditoría:** toda ruta que cambia datos declara
  `@AuditRoute()`, y solo se guardan los campos declarados, también pasados
  por `redactSensitiveData()` — el login quedó guardando passwords en claro
  (#4). `audit_logs` es de solo inserción: los tests no pueden limpiarla. Un
  evento crítico pasa su `tx` a `AuditService.record` (PF-47). El actor sale de `request.user` (panel) o
  `request.accessLink` (cliente final), nunca de un campo que ningún guard
  setea (#5).
- **Auth:** desactivar un usuario debe cortar los JWT ya emitidos — el
  chequeo de `active` vive en `JwtStrategy.validate`, no solo en el login
  (#7). El login verifica siempre contra un hash (real o de relleno) para
  no filtrar por tiempo qué emails existen (#4). Ids de quien hace la
  acción, del JWT (`req.user.id`), nunca del cliente.
- Listados paginados y filtrados en la base (página + conteo en una
  transacción, orden estable), nunca en memoria (#13).
- **Login:** contar un intento fallido de contraseña nunca se espera (`await`):
  el tiempo de respuesta delataría qué emails existen. La contraseña correcta no
  limpia el contador, solo `completeLogin`; si no, se podrían probar códigos MFA
  sin fin. Solo `AuthService.completeLogin` abre sesión, tras el segundo factor.
- **Migraciones de renombre:** Prisma resuelve un rename como DROP +
  CREATE. Escribirlas a mano con `RENAME` y revisar siempre el SQL antes
  de aplicarlo (#26).
- **Migraciones con varios pasos:** Prisma no las envuelve en una transacción;
  un fallo deja aplicado lo anterior. Escribir `BEGIN`/`COMMIT` en el SQL y
  probarlo con un fallo forzado sobre una base aparte (PF-46).

**`apps/panel`**

- **Escapar con `encodeURIComponent`** todo id que se interpole en una
  ruta de la api desde una Server Action (`../` apuntaba a otro endpoint
  con el mismo token, #10).
- **Modales con `Form` de Ant Design:** no compartir `Form.useForm` entre
  aperturas ni confiar en que `destroyOnHidden` desmonte a tiempo: un selector
  mostró el rol de la apertura anterior, y guardar habría degradado a otra
  persona (PF-48). Cada apertura monta un `Form` nuevo con `key`, y el botón lo
  envía con `form={id}`. Los valores van en `initialValues`. Descartados:
  `forceRender` (error de hidratación) y `clearOnDestroy` (con StrictMode borra
  los `initialValues`) (#16).
- No copiar datos del servidor a `useState`: la Server Action +
  `revalidatePath` ya devuelve el RSC actualizado (#13). Colores solo
  desde `lib/theme.ts`, sin hex sueltos.
- **CSP con nonce (`proxy.ts`):** las páginas deben ser dinámicas (por eso
  `force-dynamic` en el layout raíz): una estática queda sin scripts. Los estilos
  no llevan nonce, porque anularía el `'unsafe-inline'` que Ant Design necesita.
  Probar con `pnpm build && next start -p 3002`: sin `-p`, toma el puerto de la api.
- Revisar la consola del navegador (avisos de Ant Design, hidratación)
  antes de dar por buena una pantalla — así se detectó #16.
