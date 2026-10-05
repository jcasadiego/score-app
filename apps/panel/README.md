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
  redirigir a `/login` sin sesión, o a `RUTA_INICIO`
  (`lib/auth/constants.ts`, hoy `/usuarios`) si ya hay una. `/` también
  redirige ahí mientras no exista la bandeja de casos. La
  verificación real ocurre en `api` en cada llamada autenticada;
  `lib/auth/dal.ts` (`verificarSesion`) es el punto único para exigirla
  en Server Components de este repo.
- El JWT se decodifica sin verificar firma (`lib/auth/jwt.ts`) solo para
  leer `email`/`rol` a mostrar en la UI y el `exp` para expirar la
  cookie — el panel no tiene `JWT_SECRET` (es un secreto exclusivo de
  `api`).
- Todas las pantallas autenticadas cuelgan de `app/(panel)/layout.tsx`,
  que arma el layout con Ant Design (`components/app-shell.tsx`). Las
  pantallas de cada módulo se agregan ahí — la primera es Usuarios
  (`app/(panel)/usuarios/`), que consume `UsuariosController` de `api`.
- Tema único en `lib/tema.ts` (colores, radio, fuente) aplicado por
  `components/proveedor-antd.tsx`, que además da `message`/`modal` vía
  `App.useApp()` y apaga las animaciones si el sistema pide reducir
  movimiento. Nada de colores sueltos en `style`: usar `theme.useToken()`.
- `app/(panel)/loading.tsx` muestra un esqueleto al navegar entre
  módulos mientras el Server Component trae los datos.

### Datos y rendimiento

- Las listas se paginan en la API; la página y la búsqueda viven en la
  URL (`?pagina=&q=`) y el Server Component pide solo esa página.
- Las pantallas no copian los datos a `useState`: las Server Actions
  llaman a `revalidatePath` y el RSC actualizado llega en la misma
  respuesta de la acción — una sola petición del navegador por cambio.

### Datos de prueba (solo desarrollo)

En `pnpm dev`, la pantalla de Usuarios acepta `?data=peor|vacio|uno|mil`
para renderizar con datos del peor caso (nombres largos, emails sin
cortes, CJK/RTL/emoji, 1.284 filas) en vez de la API, con un selector
fijo abajo al centro. Sirve de prueba de regresión visual cada vez que
se toque la tabla. En producción el parámetro se ignora. En ese modo
las acciones de fila llaman a la API real con ids falsos (404).

## Pendiente a propósito (no construido todavía)

El modelo real de roles/permisos y el flujo de revisión/aprobación de
casos no se construyen todavía — dependen de decisiones que siguen
pendientes (ver `CLAUDE.md` sección 3). Hoy solo existe el rol `ADMIN`
placeholder.
