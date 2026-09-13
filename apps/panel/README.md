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

## Autenticación

- `POST /auth/login` de `api` devuelve un `accessToken` (JWT). El panel
  lo pide desde una Server Action (`app/login/actions.ts`, nunca desde
  el navegador) y lo guarda como cookie de sesión `httpOnly` — ver
  `lib/auth/session.ts`.
- `proxy.ts` hace un chequeo optimista (solo lee la cookie) para
  redirigir a `/login` sin sesión, o a `/` si ya hay una. La
  verificación real ocurre en `api` en cada llamada autenticada;
  `lib/auth/dal.ts` (`verificarSesion`) es el punto único para exigirla
  en Server Components de este repo.
- El JWT se decodifica sin verificar firma (`lib/auth/jwt.ts`) solo para
  leer `email`/`rol` a mostrar en la UI y el `exp` para expirar la
  cookie — el panel no tiene `JWT_SECRET` (es un secreto exclusivo de
  `api`).
- Todas las pantallas autenticadas cuelgan de `app/(panel)/layout.tsx`,
  que arma el layout con Ant Design (`components/app-shell.tsx`). Las
  pantallas de cada módulo (la siguiente es Usuarios) se agregan ahí.

## Pendiente a propósito (no construido todavía)

El modelo real de roles/permisos y el flujo de revisión/aprobación de
casos no se construyen todavía — dependen de decisiones que siguen
pendientes (ver `CLAUDE.md` sección 3). Hoy solo existe el rol `ADMIN`
placeholder.
