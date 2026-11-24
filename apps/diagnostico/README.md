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

## Despliegue en Render (QA)

Definido en `../../render.yaml`. Node 22, desde `apps/diagnostico/`:

- **Build:** `pnpm install --frozen-lockfile --prod=false && pnpm build`.
- **Arranque:** `pnpm start` (`next start` toma el `PORT` de Render).
- `NEXT_PUBLIC_API_URL` es la URL pública de la API y queda fija en el build:
  cambiarla exige recompilar. `DIAGNOSTIC_API_SECRET` sale del servicio de la
  API.
- `CLIENT_IP_HEADER=cf-connecting-ip` en Render: la IP del usuario que se le
  informa a la API sale de ese encabezado: Cloudflare rechaza con 403 la
  petición que lo trae del cliente (verificado en QA). Contar proxies en `x-forwarded-for` no daba
  una IP estable en Render y el límite de intentos se repartía entre IPs de
  proxies (PF-73). Sin la variable (local) se usa `TRUST_PROXY_HOPS`: la
  entrada de `x-forwarded-for` que está esas posiciones desde el final.

## Flujo (PF-17)

| Ruta | Qué hace |
|---|---|
| `/access#token=…` | Bienvenida. El enlace se canjea al pulsar "Comenzar", no al abrir la página, para que un antivirus o la vista previa del correo no lo usen. Al entrar, la navegación reemplaza esta entrada del historial: el token sale de la URL. |
| `/diagnostic` | Una pregunta por paso, con su ayuda, barra de progreso y guardado automático; luego los enlaces externos (Spotify, YouTube, Instagram, TikTok, sitio web) y la revisión antes de enviar. Al volver, retoma en la primera pregunta sin responder. |
| `/recover` | "¿Perdiste tu enlace?": siempre el mismo mensaje, exista o no el correo. Llegan aquí un enlace inválido, vencido o reemplazado (`?reason=invalid`) y una sesión que terminó (`?reason=session`). |
| `/submitted` | Confirmación tras enviar, o aviso de que ya se había enviado (`?state=already`). |
| `/session-ended` | Borra la cookie cuando la API rechaza la sesión y lleva a `/recover`. |

## Responder por voz (PF-87)

En las preguntas de texto libre con `allowsVoice`, bajo el campo de texto:
grabar, detener, escuchar, volver a grabar y borrar (`voice-recorder.tsx`). La
voz es opcional y basta sola para responder; vaciar el texto deja la
respuesta solo con la voz.

- **Consentimiento:** antes de la primera grabación se muestra el texto de
  `voice-consent.ts` y se guarda su versión en la API. Un texto nuevo lleva
  versión nueva (y se agrega en la API): pide aceptar otra vez.
- **Micrófono:** el permiso se pide al tocar "Grabar". Si se niega o el
  navegador no puede grabar, se explica y el texto sigue disponible.
  `Permissions-Policy: microphone=(self)`.
- **Grabar:** WebM/Opus (Chrome, Firefox) o MP4 (Safari), con contador y corte a
  los 3 minutos. Al detener se sube sola; si falla, la grabación queda en
  memoria y se puede reintentar. Si el cliente pasa a otra pregunta mientras
  graba, se detiene y se guarda igual. El audio nunca se guarda en el
  navegador.
- **Subida:** por el Route Handler `PUT /diagnostic/recording/[questionId]`,
  porque las Server Actions aceptan 1 MB. Exige la cookie de sesión y que la
  petición venga del mismo origen (`Sec-Fetch-Site`, o `Origin` en Safari
  anterior a 16.4), y reenvía el audio a la API.
- **Escuchar:** la grabación recién hecha, desde memoria (`blob:`); la ya
  guardada, con una URL firmada de vida corta del bucket privado de R2 que se
  pide al tocar "Escuchar". Por eso `media-src 'self' blob:
  https://*.r2.cloudflarestorage.com`.
- **Accesibilidad:** botones nativos, el estado (grabando, guardando,
  guardado, borrado) en una región `aria-live` y la grabación indicada con
  texto, no solo con color. El foco va al texto de consentimiento al abrirlo.
- Para probarla en local hace falta una versión publicada con una pregunta que
  acepte voz (en el panel llega con PF-89; mientras tanto, por la API) y, para
  escuchar lo guardado, la api con `STORAGE_DRIVER=s3` (con `memory` la URL no
  se puede reproducir).

## Descarga del informe (PF-44)

| Ruta | Qué hace |
|---|---|
| `/report#token=…` | Llega desde el correo de entrega del informe. Un botón descarga el PDF (`informe-score.pdf`) sin salir de la página; se puede volver a descargar mientras el enlace siga vigente. El token se usa al pulsar, no al abrir, para que un antivirus o la vista previa del correo no gasten una descarga. Si el enlace venció o fue reemplazado por uno más nuevo, el mismo mensaje en los dos casos: buscar el correo más reciente o responder al correo para pedir otro (no hay autoservicio: lo reenvía el equipo desde el panel). Con 429, pide esperar un minuto; con otro fallo, ofrece reintentar. |

- No guarda nada del cliente: ni cookie ni almacenamiento del navegador.
- La Server Action `downloadReport` manda el token a `POST /report-downloads` en
  el cuerpo y devuelve los bytes del PDF; el navegador los guarda con un
  enlace `blob:`, sin cambiar la CSP.
- Esta ruta lleva `Referrer-Policy: no-referrer` (`next.config.ts`).
- Para probarla en local hace falta un informe entregado: con la api en
  `MAIL_DRIVER=log`, el enlace sale en su log al entregar o reenviar.

## Seguridad

- **Los tokens de los enlaces** (diagnóstico e informe) llegan en el fragmento
  (`#token=…`): nunca llegan a este servidor ni a sus logs, y viajan a la API
  en el cuerpo de un POST, nunca en una URL.
- **El navegador nunca habla con la API.** Todo pasa por Server Actions,
  Server Components y el Route Handler de la voz (`lib/api/client.ts`), así
  que `connect-src 'self'`. Solo el audio guardado se lee directo del bucket,
  con una URL firmada (`media-src`).
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
