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
- **Modelo de login/permisos de `apps/panel`:** todavía sin definir.

## 3.1. Estado actual del código

Las tres piezas ya están inicializadas como scaffold — sin la lógica de
negocio que depende de los pendientes de la sección 3. Gestor de paquetes:
`pnpm` en las tres, cada una con su propio lockfile (sin workspaces).

**`api`** — NestJS 10 + TypeScript + Prisma 7 sobre PostgreSQL:

```bash
pnpm install
docker compose up -d       # Postgres local
pnpm prisma migrate dev
pnpm start:dev              # http://localhost:3000
pnpm build
pnpm lint
pnpm test:e2e
```

**`apps/diagnostico`** y **`apps/panel`** — Next.js 16 (App Router) +
TypeScript + Tailwind:

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

## 6. Convenciones rápidas

- Idioma de commits, PRs y comentarios de código: **español**
- Variables de entorno nuevas van en el `.env.example` de cada app/API
  (sin valores reales)
- Nombres de archivos y componentes: `PascalCase` para componentes,
  `kebab-case` para el resto

## 7. Relación con score-sitio

Este repo es **independiente** de `score-sitio`. No asumas acceso ni
visibilidad sobre ese código — es otro repo, con otro dueño de cambios (el
compañero no-developer), y no debe tener acceso a este repo.

El único punto de contacto entre los dos es el endpoint que consume el
formulario de precalificación del sitio, dentro de `api`. Si cambias su
forma (campos, tipos, códigos de respuesta), coordínalo con José antes de
mergear — el cambio afecta al otro repo y él es quien ve los dos lados.
