# 🎯 PROMPT — Plantilla de Tickets Jira (SCORE / score-app)

*Estructura para generar tickets consistentes en el tablero Jira (proyecto
PF) de la plataforma SCORE, para Music Finance Pro.*

Copia este archivo en `.claude/plantilla-tickets-jira-score.md` dentro del
repo `score-app` (y opcionalmente `score-sitio`), para que cualquier sesión
de Claude Code que trabaje en el proyecto lo use al redactar un ticket
nuevo.

---

## 📋 CONTEXTO DEL PROYECTO

**Proyecto:** SCORE — MVP para Music Finance Pro
**Cliente:** Music Finance Pro
**Tablero Jira:** proyecto `PF`, tipos disponibles: Epic, Historia, Tarea,
Error, Subtarea

**Repos:**
- `score-sitio` (P1 — sitio público): Next.js (App Router), TypeScript,
  Tailwind CSS, Vercel. Diseño entregado por el cliente en Figma — este
  repo maqueta, no diseña.
- `score-app` (monorepo P2/P4/P5):
  - `apps/diagnostico` — Next.js. Cuestionario del cliente final, acceso
    por enlace único sin contraseña.
  - `apps/panel` — Next.js + **Ant Design**. Panel interno del equipo,
    con login JWT. UI funcional y amigable, sin diseño a la medida.
  - `api` — NestJS/TypeScript + **Prisma** (PostgreSQL, ids `cuid`).

**Regla de alcance:** lo que incluye/excluye cada producto (P1–P6) está en
`Propuesta_MVP_SCORE.docx` y `Alcance_Preliminar_MVP_SCORE.docx`. Si algo
pedido no aparece ahí, es señal de alcance — se avisa antes de construirlo,
no se decide sobre la marcha.

---

## 📦 MÓDULOS DEL SISTEMA

1. Auditoría
2. Usuarios y permisos
3. Leads / Precalificación
4. Cuestionario (configuración)
5. Diagnósticos
6. Motor de cálculo (interfaz + resultados)
7. Flags / Contradicciones
8. Revisión / Aprobación
9. Delivery / Informe
10. Pagos
11. CRM — **bloqueado**, falta que el cliente confirme cuál CRM usa
12. Voz / Transcripción (P3, opcional) — **bloqueado**, falta que el
    cliente confirme si entra en el alcance final
13. Adapter real del motor de cálculo — **bloqueado**, falta confirmar en
    cuál de los 4 escenarios técnicos está el motor (ver
    `Alcance_Preliminar_MVP_SCORE.docx`, sección 03)

Más un Epic transversal: **Infraestructura y DevEx** (Swagger, shell del
panel, y cualquier otra herramienta de desarrollo/pruebas que no sea un
módulo de negocio del cliente).

---

## ⚠️ REGLA CRÍTICA DEL PROYECTO

**El motor de cálculo nunca se llama directo.** Toda tarea relacionada con
el cálculo del diagnóstico pasa por `MotorCalculoPort` (interfaz propia).
Mientras el escenario real del motor no esté confirmado, se usa un adapter
simulado — nunca se bloquea el resto del sistema por esto, y nunca se
construye lógica de cálculo propia.

**Los módulos bloqueados (11, 12, 13) no se inician** aunque Claude Code
lo sugiera — primero necesitan respuesta del cliente. Un ticket de estos
módulos existe en el tablero para que quede visible, pero permanece en
"Por hacer" hasta que se desbloquee explícitamente.

---

## 🎯 ESTRUCTURA OBLIGATORIA DEL TICKET

Al crear un ticket (Epic o Tarea) para `score-app` o `score-sitio`, usa
siempre esta estructura:

```
[NestJS/Next.js] Componente — Descripción breve

DESCRIPCIÓN GENERAL:
[3-4 líneas: qué es, por qué hace falta, en qué repo/carpeta vive]

ALCANCE FUNCIONAL:
1️⃣ [Punto del alcance]
2️⃣ [Punto del alcance]
...

FUERA DE ALCANCE (a propósito):
- [Lo que esta tarea deliberadamente NO cubre]

REQUERIMIENTOS TÉCNICOS:
[Piezas del stack ya decidido que aplican — Prisma, NestJS, Next.js,
Ant Design, JWT, MotorCalculoPort, etc. Describe QUÉ interviene, no CÓMO
construirlo por dentro — esa decisión es de quien lo implemente.]

CRITERIOS DE ACEPTACIÓN:
[ ] ...
[ ] ...

MANEJO DE ERRORES:
[Casos esperados y cómo debe responder el sistema — códigos, mensajes]

DEFINITION OF DONE:
✅ ...

DEPENDENCIAS:
[Otros tickets/módulos de los que depende, o "Ninguna"]

---
PROMPT PARA CLAUDE CODE (copiar y pegar):
```
[Prompt que describe QUÉ hace falta y QUÉ NO, nunca el diseño interno —
la implementación concreta la decide quien la ejecuta. Si la tarea ya
está implementada, esta sección dice "No aplica, ya implementado — PR #N".]
```
```

**Principio que gobierna toda la plantilla:** cada sección dice qué hace
falta y por qué, nunca cómo construirlo internamente — ni en "Requerimientos
técnicos" ni en el prompt final. Las decisiones de diseño de código quedan
para quien implemente (Claude Code).

---

## 🎬 EJEMPLO APLICADO

```
[NestJS] Auth + Usuarios — Login JWT y CRUD de usuarios internos

DESCRIPCIÓN GENERAL:
Da acceso al panel interno (apps/panel) al equipo de Music Finance Pro.
Vive en api/src/auth y api/src/usuarios. Sin esto, nadie entra al panel
ni queda identificado como actor en la auditoría.

ALCANCE FUNCIONAL:
1️⃣ Login JWT (POST /auth/login) con protección anti-enumeración
2️⃣ CRUD de usuarios (/usuarios): crear, listar, editar, activar/desactivar
3️⃣ Un solo rol (ADMIN) por ahora, con RolesGuard ya listo para más
4️⃣ Primer usuario admin vía prisma/seed.ts (idempotente)

FUERA DE ALCANCE (a propósito):
- Recuperación de contraseña — descartada por ahora
- Roles/permisos diferenciados — se agregan si el proyecto lo pide

REQUERIMIENTOS TÉCNICOS:
Prisma (modelo Usuario, ids cuid), NestJS (JwtStrategy, JwtAuthGuard,
RolesGuard), password con hash, nunca se devuelve en respuestas.

CRITERIOS DE ACEPTACIÓN:
[x] Login válido devuelve JWT; inválido devuelve el mismo mensaje
    genérico que una cuenta desactivada (anti-enumeración)
[x] CRUD de /usuarios protegido por JWT + rol ADMIN
[x] Desactivar un usuario revoca también sus JWT ya emitidos
[x] seed.ts crea el primer admin sin pasar por la API

MANEJO DE ERRORES:
401 — credenciales inválidas o cuenta desactivada (mensaje genérico)
409 — email ya existente al crear usuario

DEFINITION OF DONE:
✅ Implementado, PR #7 (sobre scaffold de PR #3/#5)
✅ Tests de servicio y de JwtStrategy
✅ Verificado manualmente end-to-end contra Postgres local

DEPENDENCIAS:
Ninguna — es la base de la que depende Auditoría (actor USUARIO_PANEL)
y toda pantalla del panel.

---
PROMPT PARA CLAUDE CODE: no aplica, ya implementado.
```

---

## 📝 CÓMO USARLO

**Al pedir un ticket nuevo**, basta con describir el módulo o la tarea:

```
Necesito el ticket Jira para [módulo/tarea de SCORE].

[Pega este archivo completo arriba]

Genera el ticket siguiendo la plantilla.
```

El resultado debe tener las 7 secciones + el prompt para Claude Code,
listo para copiar al tablero `PF` sin cambios.

**Al crear el ticket en Jira directamente** (si la sesión tiene conectado
Jira), se crea como:
- **Epic** por módulo de negocio (o "Infraestructura y DevEx" si es
  transversal)
- **Tarea** dentro del Epic por cada pieza entregable (backend, UI, etc.)
- Estado inicial: "Por hacer"; se marca "Listo" solo si ya está
  implementada (con su PR referenciado en Definition of Done)

---

## ⚡ PRINCIPIOS QUE ESTA PLANTILLA GARANTIZA

```
✅ Separa claramente alcance (qué sí / qué no) antes de cualquier detalle técnico
✅ Nunca dicta el diseño interno de la implementación — solo el qué y el por qué
✅ Señala módulos bloqueados por el cliente, para que nadie los empiece por error
✅ Deja un prompt listo para Claude Code en cada tarea pendiente
✅ Referencia el PR cuando una tarea ya está implementada, en vez de dejarlo ambiguo
✅ Respeta el patrón MotorCalculoPort — ninguna tarea llama al motor directo
```
