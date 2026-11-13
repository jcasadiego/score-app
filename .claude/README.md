# Claude Prompts — Tickets Jira para SCORE (score-app / score-sitio)

## Estructura

- **plantilla-tickets-jira-score.md** → Prompt principal: estructura
  obligatoria de los tickets, contexto del proyecto, regla crítica del
  motor de cálculo, módulos bloqueados, y ejemplo aplicado.
- **prompts.json** → Índice y metadatos (stack, módulos, reglas críticas,
  keywords que activan el prompt).

Copia ambos archivos en `.claude/` dentro del repo (`score-app` y, si
quieres, `score-sitio` también), junto al `CLAUDE.md` que ya tiene cada
repo.

## Cómo funciona

Cuando pidas algo como:

```
Necesito un ticket Jira para el módulo de Leads de SCORE
```

Claude Code (o cualquier sesión de Claude que tenga este archivo a la
vista) debe detectar que es una **tarea de generación de ticket SCORE** y
usar el prompt de `.claude/plantilla-tickets-jira-score.md`.

## Cómo pedirlo

### Opción A: Directo (recomendado)

```
Necesito el ticket Jira para el módulo de Pagos de SCORE — confirmación
manual, sin pasarela automática.
```

### Opción B: Explícito

```
Usa el prompt de .claude/plantilla-tickets-jira-score.md para generar el
ticket de: [módulo o tarea]
```

### Opción C: Con contexto adicional

```
Repo: score-app
Módulo: Flags / Contradicciones
Detalle: [lo que ya se definió sobre el alcance]
```

## Resultado esperado

Un ticket listo para copiar a Jira (proyecto `PF`) o crear directo si la
sesión tiene Jira conectado, con:

- ✅ Título: `[Stack] Componente — Descripción breve`
- ✅ Descripción general (3-4 líneas)
- ✅ Alcance funcional (1️⃣ 2️⃣ 3️⃣)
- ✅ Fuera de alcance (a propósito)
- ✅ Requerimientos técnicos (qué piezas del stack intervienen, no cómo
  construirlas por dentro)
- ✅ Datos, API y seguridad (reglas de integridad, contrato y estándar aplicable)
- ✅ Criterios de aceptación
- ✅ Manejo de errores
- ✅ Definition of Done
- ✅ Dependencias (con clave de ticket y enlace "Blocks" en Jira)
- ✅ Prompt para Claude Code (o "No aplica, ya implementado" con el PR)

## Reglas que este prompt siempre respeta

- El motor de cálculo nunca se llama directo — siempre vía
  `ScoringEnginePort`.
- CRM, Voz/Transcripción y el adapter real del motor quedan marcados como
  **bloqueados** hasta que el cliente responda — no se detallan como
  tareas accionables.
- Ningún ticket ni prompt dicta el diseño interno de la implementación —
  solo el qué y el por qué; el cómo lo decide quien lo ejecuta.
- `apps/panel` usa Ant Design, funcional y amigable, sin diseño a la
  medida.
- Datos, API y seguridad siguen estándares internacionales: normalización,
  RFC 9110, RFC 9457, RFC 3339, OWASP y WCAG 2.2 AA.
- Los nombres técnicos que mencione un ticket o su prompt van en inglés;
  el texto del ticket y los textos de pantalla, en español.

## Hooks y subagentes

`settings.json` registra dos hooks (scripts en `hooks/`, requieren `jq`):

- **`protect-files.sh`** (antes de editar): bloquea `.env` y `.env.*` (salvo
  `.env.example`), los `pnpm-lock.yaml` y las migraciones de Prisma que ya
  están en `origin/develop`. No cubre lo que se haga por Bash: es una red de
  seguridad, no un control.
- **`format-lint.sh`** (después de editar): sobre el archivo editado corre
  Prettier + `eslint --fix` en `api` (`src/` y `test/`) y `eslint --fix` en
  `apps/panel` y `apps/diagnostico`. Si quedan errores, se los muestra a
  Claude para que los corrija. Sin `node_modules` no hace nada.

`agents/compliance-reviewer.md` revisa el diff de la rama contra las reglas
propias de SCORE (CLAUDE.md 5.2, 5.3, 6 y 9). Se pide con "usa el
compliance-reviewer sobre esta rama", antes del PR y junto a
`/security-review`. Solo lee y reporta.

## Nota

`settings.json` permite las herramientas de Jira con los dos nombres que
puede tener el MCP de Atlassian: `mcp__atlassian__*` (servidor MCP local)
y `mcp__claude_ai_Atlassian__*` (conector de claude.ai). Si sumas otra
herramienta, agrégala con ambos prefijos. Los permisos personales van en
`settings.local.json`, que no se versiona.
