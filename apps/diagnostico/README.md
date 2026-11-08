# apps/diagnostico (P2 + P3)

App donde el cliente final de Music Finance Pro responde el cuestionario
SCORE, por enlace único, sin crear contraseña. El modo de voz (P3,
opcional) será parte de esta misma app. Ver `../../CLAUDE.md` para el
contexto completo del monorepo.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind, con `pnpm`. Sin Ant
Design: es una app para móvil y conviene que pese poco.

## Cómo correr en local

```bash
pnpm install
cp .env.example .env.local
pnpm dev   # http://localhost:3001 (3000 lo usa la api)
```

Para entrar hace falta un enlace real: se genera desde el panel
(Diagnósticos → Generar) y llega por correo como
`http://localhost:3001/access#token=…`. La CSP con nonce solo se comporta como
en producción con `pnpm build && pnpm exec next start -p 3001`.

## Flujo (PF-17)

| Ruta | Qué hace |
|---|---|
| `/access#token=…` | Bienvenida. El enlace se canjea al pulsar "Comenzar", no al abrir la página, para que un antivirus o la vista previa del correo no lo usen. Al entrar, la navegación reemplaza esta entrada del historial: el token sale de la URL. |
| `/diagnostic` | Una pregunta por paso, con su ayuda, barra de progreso y guardado automático; luego los enlaces externos (Spotify, YouTube, Instagram, TikTok, sitio web) y la revisión antes de enviar. Al volver, retoma en la primera pregunta sin responder. |
| `/recover` | "¿Perdiste tu enlace?": siempre el mismo mensaje, exista o no el correo. Llegan aquí un enlace inválido, vencido o reemplazado (`?reason=invalid`) y una sesión que terminó (`?reason=session`). |
| `/submitted` | Confirmación tras enviar, o aviso de que ya se había enviado (`?state=already`). |
| `/session-ended` | Borra la cookie cuando la API rechaza la sesión y lleva a `/recover`. |

## Seguridad

- **El navegador nunca habla con la API.** Todo pasa por Server Actions y
  Server Components (`lib/api/client.ts`), así que `connect-src 'self'`.
- **Sesión:** cookie `score_diagnostic_session`, `httpOnly`, `Secure` en
  producción y `SameSite=Strict` (`lib/session/cookie.ts`). Ni la sesión ni
  las respuestas van a `localStorage`. "Salir" borra la cookie del dispositivo.
- **CSP con nonce por petición** en `proxy.ts`, sin `'unsafe-inline'` en
  producción (scripts ni estilos). Por eso todas las páginas son dinámicas.
- **IP real del cliente:** con `DIAGNOSTIC_API_SECRET` (el mismo valor en la
  api), la app informa la IP del cliente al canjear o recuperar el enlace, y
  la API cuenta sus límites por cliente y no por este servidor.
- Todo lo que escribe el cliente se muestra con el escapado de React.

## Diseño y accesibilidad

- Colores y tipografía como tokens en `app/globals.css` (`@theme`) y
  `app/layout.tsx`. Hoy es un tema neutro: cambiar la marca es cambiar esos
  valores.
- WCAG 2.2 AA: foco visible y llevado al título de cada paso, etiquetas en
  cada campo, errores anunciados (`role="alert"`), áreas táctiles de 44 px y
  contraste AA en cada par de colores. Revisado con axe-core en todas las
  pantallas.
