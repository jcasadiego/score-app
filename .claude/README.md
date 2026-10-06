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
- ✅ Criterios de aceptación
- ✅ Manejo de errores
- ✅ Definition of Done
- ✅ Dependencias
- ✅ Prompt para Claude Code (o "No aplica, ya implementado" con el PR)

## Reglas que este prompt siempre respeta

- El motor de cálculo nunca se llama directo — siempre vía
  `MotorCalculoPort`.
- CRM, Voz/Transcripción y el adapter real del motor quedan marcados como
  **bloqueados** hasta que el cliente responda — no se detallan como
  tareas accionables.
- Ningún ticket ni prompt dicta el diseño interno de la implementación —
  solo el qué y el por qué; el cómo lo decide quien lo ejecuta.
- `apps/panel` usa Ant Design, funcional y amigable, sin diseño a la
  medida.

## Nota

Este set no incluye `settings.json` / `settings.local.json` (permisos de
Claude Code). Esos archivos dependen de los nombres exactos de las
herramientas MCP tal como las ve tu Claude Code local, y conviene
armarlos a partir de lo que tú veas ahí en vez de que se adivinen aquí.
