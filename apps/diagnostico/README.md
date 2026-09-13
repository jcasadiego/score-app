# apps/diagnostico (P2 + P3)

App donde el cliente final de Music Finance Pro responde el cuestionario
SCORE, por enlace único, sin crear contraseña. El modo de voz (P3,
opcional) es parte de esta misma app. Ver `../../CLAUDE.md` para el
contexto completo del monorepo.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind, con `pnpm`.

## Cómo correr en local

```bash
pnpm install
cp .env.example .env.local
pnpm dev   # http://localhost:3001 (3000 lo usa la api)
```

## Pendiente a propósito (no construir todavía)

El flujo real del cuestionario (las 4 familias: Proyecto, B2B,
Profesional, Catálogo) no se construye todavía — depende de la
especificación completa que sigue pendiente (ver `CLAUDE.md` sección 3).
Por ahora la app solo tiene el scaffold base de Next.js y una página de
aviso.
