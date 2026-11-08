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

- El acceso tiene dos pasos, ambos desde Server Actions: `POST /auth/login`
  entrega un reto de 5 minutos, que se guarda en una cookie `httpOnly`, y
  `/login/two-factor` (o `/login/two-factor/setup`, la primera vez) lo cambia por
  la sesión con un código TOTP o de recuperación. El MFA es obligatorio.
- Completar ese paso devuelve un `accessToken` (JWT). El panel
  lo pide desde una Server Action (`app/login/actions.ts`, nunca desde
  el navegador) y lo guarda como cookie de sesión `httpOnly` — ver
  `lib/auth/session.ts`.
- `proxy.ts` hace un chequeo optimista (solo lee la cookie) para
  redirigir a `/login` sin sesión, o a `HOME_ROUTE`
  (`lib/auth/constants.ts`, hoy `/leads`) si ya hay una. `/` también
  redirige ahí mientras no exista la bandeja de casos. La
  verificación real ocurre en `api` en cada llamada autenticada;
  `lib/auth/dal.ts` (`verifySession`) es el punto único para exigirla
  en Server Components de este repo.
- Login y recuperación envían la IP del cliente a la API (`lib/api/client-ip.ts`)
  para que su límite de intentos no junte a todo el equipo. Requiere
  `PANEL_API_SECRET`, igual en ambos lados, y un solo proxy delante del panel.
- La sesión se renueva sola con `POST /auth/refresh` pasada la mitad de la
  vida del token: en `proxy.ts` al navegar y con `renewSessionIfNeeded` en las
  Server Actions. Vence tras 1 día sin usar el panel y, en cualquier caso, a
  los 7 días del login.
- Cerrar sesión revoca el token en la API (`POST /auth/logout`) y luego borra la
  cookie; si la API no responde, el usuario sale igual y el error queda en el log.
- Cada usuario tiene una sola sesión: entrar en otro dispositivo cierra la
  anterior.
- Si la API rechaza el token (401: cuenta desactivada, contraseña cambiada, login
  en otro dispositivo o token vencido), la sesión se cierra y se vuelve al login con un aviso.
  Una página no puede borrar la cookie, así que pasa por
  `app/session-expired/route.ts`; sin borrarla habría un bucle con `proxy.ts`,
  que solo lee la cookie. Esa ruta es un GET que cualquier sitio puede enlazar,
  así que primero pregunta a la API: si el token sigue valiendo, no borra nada.
  Las Server Actions lo hacen con
  `redirectIfSessionExpired` (`lib/auth/expire-session.ts`). `proxy.ts` no
  redirige las Server Actions sin sesión, porque el formulario quedaría
  cargando para siempre; las frena `verifySession` dentro de la acción. Si la API
  responde 403, la pantalla muestra `components/forbidden-screen.tsx` con un
  botón para volver.
- Recuperación de contraseña, pantallas públicas (fuera de la
  protección de `proxy.ts`): `/forgot-password` pide el enlace y
  muestra siempre el mismo aviso; `/reset-password?token=` es
  adonde lleva el correo — saca el token de la URL al cargar, pide la
  contraseña dos veces y, al terminar, vuelve a `/login` con un aviso.
  Las llamadas van por `lib/api/password-reset.ts`. En local el enlace
  aparece en el log de `api` (`MAIL_DRIVER=log`). Si un admin cambia su
  propia contraseña desde Usuarios, la api cierra también su sesión y
  el panel lo manda al login.
- El JWT se decodifica sin verificar firma (`lib/auth/jwt.ts`) solo para
  leer `email`/`role` a mostrar en la UI y el `exp` para expirar la
  cookie — el panel no tiene `JWT_SECRET` (es un secreto exclusivo de
  `api`).
- Todas las pantallas autenticadas cuelgan de `app/(panel)/layout.tsx`,
  que arma el layout con Ant Design (`components/app-shell.tsx`). Las
  pantallas de cada módulo se agregan ahí: Usuarios
  (`app/(panel)/users/`), Leads (`app/(panel)/leads/`, lista con
  filtros, detalle en un `Drawer` y cambio de estado), Diagnósticos
  (`app/(panel)/diagnostics/`, PF-18) y Cuestionario
  (`app/(panel)/questionnaire/`, PF-14). Las llamadas a la api pasan por
  `lib/api/client.ts`; un 400 o 409 conserva el `code` y la lista `errors`
  de la api en `ApiError`.
- **Diagnósticos:**
  - `/diagnostics` lista con estado (también "Abandonado", que calcula la
    api), progreso y última actividad; filtros y página en la URL.
  - `/diagnostics/[id]` es el detalle de solo lectura: respuestas, enlaces
    externos (solo `https`, con `rel="noopener noreferrer"`) y enlaces de
    acceso. Es la ruta que usa el aviso de diagnóstico completado.
  - Generar (solo Aprobador, con motivo) se hace desde esta pantalla o desde
    el `Drawer` de un lead sin diagnóstico. Reenviar el enlace (Revisor y
    Aprobador) pide confirmación.
  - El enlace del cliente se muestra una sola vez en el modal
    (`components/diagnostics/issued-link.tsx`): no va a la URL ni se guarda.
    Si el correo falla, el modal lo dice y deja reintentar.
  - **Sección "Resultado"** del detalle (PF-25,
    `components/diagnostics/calculation-section.tsx`):
    - Muestra el cálculo vigente (el último exitoso), con su versión de
      reglas y fecha. La salida del motor se ve legible y como texto.
    - Un resultado del motor de prueba lleva la etiqueta **SIMULADO**.
    - Si el último intento está en curso o falló, lo avisa junto al vigente.
      Debajo va el historial, paginado en la URL (`?calcPage=`).
    - Calcular, recalcular o reintentar pide confirmación. Mientras hay un
      cálculo en curso, la sección consulta solo el último intento, cada vez
      más espaciado, y deja de consultar al terminar o al salir. Al terminar,
      recarga la pantalla una vez.
    - Con el motor desactivado (`GET /scoring-engine/status`), muestra el
      aviso acordado y el botón queda deshabilitado.
    - Un diagnóstico sin enviar dice que todavía no hay resultado.
- **Cuestionario:**
  - `/questionnaire?family=` muestra una pestaña por familia. En cada una
    se ve el borrador y la última versión publicada (`&view=published`),
    con las preguntas en orden. Lo publicado es de solo lectura.
  - Revisor y Aprobador lo ven. Solo el Aprobador ve los botones para crear
    el borrador (copia la última versión publicada que no sea de prueba),
    agregar, editar, quitar y reordenar preguntas, y publicar. Igual quien
    decide es la api.
  - Una pregunta se edita completa en un modal
    (`components/questionnaire/question-modal.tsx`), con sus opciones
    dentro: agregar, quitar y reordenar. Se propone el `code`/`value` a
    partir del texto. Si la api rechaza algo, el modal muestra el motivo y
    conserva lo escrito.
  - Publicar pide confirmación. Si falta algo, se muestra la lista `errors`
    de la api.
- Fechas con `components/local-date.tsx`: se formatean en la zona del
  navegador solo en el cliente, para no romper la hidratación.
- Tema único en `lib/theme.ts` (colores, radio, fuente) aplicado por
  `components/antd-provider.tsx`, que además da `message`/`modal` vía
  `App.useApp()` y apaga las animaciones si el sistema pide reducir
  movimiento. Nada de colores sueltos en `style`: usar `theme.useToken()`.
- `app/(panel)/loading.tsx` muestra un esqueleto al navegar entre
  módulos mientras el Server Component trae los datos.

### Datos y rendimiento

- Las listas se paginan en la API; la página y la búsqueda viven en la
  URL (`?page=&q=`) y el Server Component pide solo esa página.
- Las pantallas no copian los datos a `useState`: las Server Actions
  llaman a `revalidatePath` y el RSC actualizado llega en la misma
  respuesta de la acción — una sola petición del navegador por cambio.

### Datos de prueba (solo desarrollo)

En `pnpm dev`, la pantalla de Usuarios acepta `?data=worst|empty|one|many`
para renderizar con datos del peor caso (nombres largos, emails sin
cortes, CJK/RTL/emoji, 1.284 filas) en vez de la API, con un selector
fijo abajo al centro. Sirve de prueba de regresión visual cada vez que
se toque la tabla. En producción el parámetro se ignora. En ese modo
las acciones de fila llaman a la API real con ids falsos (404).

## Pendiente a propósito (no construido todavía)

El flujo de revisión/aprobación de casos no se construye todavía. Los roles
Revisor y Aprobador ya existen (`CLAUDE.md`, sección 5.3): el panel oculta lo que
el rol no permite, y quien valida el permiso es la API.
