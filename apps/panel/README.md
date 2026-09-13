# apps/panel (P5)

Panel interno donde el equipo de Music Finance Pro revisa cada caso,
corrige con trazabilidad, aprueba y genera el informe. Tiene login y
permisos — no comparte código ni build con `apps/diagnostico`. Ver
`../../CLAUDE.md` para el contexto completo del monorepo.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind, con `pnpm`.

## Cómo correr en local

```bash
pnpm install
cp .env.example .env.local
pnpm dev   # http://localhost:3002 (3000 lo usa la api, 3001 diagnostico)
```

## Pendiente a propósito (no construir todavía)

Login, modelo de permisos/roles y el flujo real de revisión/aprobación
no se construyen todavía — dependen de decisiones que siguen pendientes
(ver `CLAUDE.md` sección 3). Por ahora la app solo tiene el scaffold
base de Next.js y una página de aviso.
