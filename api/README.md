# api (P4)

Base de datos, motor de cálculo de SCORE, CRM, pagos y bitácora de
auditoría. La consumen `apps/diagnostico` y `apps/panel` por HTTP. Ver
`../CLAUDE.md` para el contexto completo del monorepo.

Stack: NestJS 12 + TypeScript + Prisma 7 sobre PostgreSQL, con `pnpm` como
gestor de paquetes.

## Cómo correr en local

```bash
pnpm install
cp .env.example .env         # ajustar si hace falta
docker compose up -d         # levanta Postgres local
pnpm prisma migrate dev      # aplica el schema
pnpm prisma db seed          # crea el primer ADMIN (ADMIN_* en .env) y, fuera de producción, el cuestionario de prueba
pnpm start:dev                # http://localhost:3000
```

`GET /health` confirma que el servicio y la conexión a Postgres están
vivos (fuera del prefijo `/api` y del versionado, a propósito — es la
ruta que usa cualquier orquestador/healthcheck de infraestructura).

Con `NODE_ENV` en `development` o `test`, `GET /docs` sirve Swagger UI
con todos los endpoints documentados automáticamente — rutas, DTOs de
entrada (tipos, campos requeridos, tal como los valida
`class-validator`) y seguridad, sin decorar nada a mano por endpoint;
el plugin de compilación `@nestjs/swagger` (`nest-cli.json`) es lo que
genera esa documentación a partir del código en cada build. Tiene el
botón "Authorize" para pegar un JWT (de `POST /auth/login`) y probar
también las rutas protegidas. Con cualquier otro valor, `/docs` y
`/docs-json` devuelven 404 — no queda expuesto. `NODE_ENV` es obligatoria: sin
ella, la API no arranca.

En producción la API tampoco arranca sin `TRUST_PROXY_HOPS` (el número exacto
de proxies delante de ella; 0 si no hay ninguno) ni con un `CORS_ORIGINS` que
no sea una lista de orígenes `https` exactos. Esa lista lleva `apps/diagnostico`
y `score-sitio`, que llaman desde el navegador; el panel llama desde su servidor.

## Segundo factor del panel

Obligatorio para todos los usuarios de `apps/panel` (TOTP, RFC 6238):

1. `POST /auth/login` con la contraseña correcta devuelve `{ mfaToken, mfaStatus }`,
   un reto de 5 minutos que **no** abre sesión.
2. Si `mfaStatus` es `ENROLLMENT_REQUIRED`: `POST /auth/mfa/enrollment` entrega el
   secreto, y `POST /auth/mfa/enrollment/confirmation` lo activa, abre la sesión y
   devuelve 10 códigos de recuperación, que no se vuelven a mostrar.
3. Si es `CHALLENGE_REQUIRED`: `POST /auth/mfa/verification` con el código o
   `POST /auth/mfa/recovery` con uno de recuperación abren la sesión.

Cada código incorrecto cuenta para el bloqueo de 5 intentos (15 minutos), el
mismo de la contraseña. Al bloquearse, el dueño de la cuenta recibe un correo
(`ACCOUNT_LOCKED_NOTICE`) con el enlace a "¿Olvidaste tu contraseña?"; el login
responde igual que cualquier otro fallo y no espera ese envío. Una cuenta
desactivada no recibe el aviso.

Restablecer la contraseña deja el contador en 0 y levanta el bloqueo
(`ACCOUNT_UNLOCKED` en la bitácora), **salvo** que se haya rechazado un código de
MFA en los últimos 15 minutos (`users.last_failed_mfa_at`). Con esa regla el
restablecimiento nunca da más que esperar a que el bloqueo venza: quien controle
el buzón no puede alternar restablecer y probar códigos. En ese caso la
contraseña cambia igual y el bloqueo vence solo.

Quien pierda el
autenticador y los códigos necesita que **otro** ADMIN use
`PATCH /users/:id/reset-mfa`. Si el único ADMIN queda fuera, se restablece en la
base con acceso de operación, y se deja constancia del motivo.

`MFA_ENCRYPTION_KEY` es obligatoria en todo entorno. Sin rotación todavía:
perderla o cambiarla obliga a restablecer el MFA de todos.

## Scripts

- `pnpm start:dev` — servidor con recarga en caliente.
- `pnpm build` — compila a `dist/`.
- `pnpm lint` — ESLint + Prettier.
- `pnpm test` — pruebas unitarias.
- `pnpm test:e2e` — pruebas end-to-end (requieren Postgres corriendo).
- `pnpm prisma migrate dev` — aplica cambios de `prisma/schema.prisma`.
- `pnpm prisma studio` — explorador visual de la base de datos.

## Estructura

- `src/bootstrap.ts` — configuración transversal de la app (helmet,
  CORS, `ValidationPipe`, filtro de errores, prefijo `/api` +
  versionado por URI, Swagger). La usan tanto `main.ts` como el e2e test,
  para que las pruebas ejerciten la misma configuración que producción.
- `src/config/` — validación de variables de entorno al boot (Zod) y
  parseo de `CORS_ORIGINS`.
- `src/common/` — `GlobalExceptionFilter`, forma de error única para
  toda la API: RFC 9457 (`application/problem+json`), catálogo en
  `docs/errores.md`. Un error que no
  es `HttpException` va al log y responde un 500 genérico.
- `src/prisma/` — `PrismaService` global, conecta vía driver adapter
  (`@prisma/adapter-pg`), requerido por Prisma 7.
- `src/scoring-engine/` — el motor de cálculo de SCORE queda detrás de
  `ScoringEnginePort` (`scoring-engine.port.ts`). Ningún módulo llama al motor
  directo, y la API nunca calcula por su cuenta.
  - `SCORING_ENGINE_DRIVER` elige el motor al arrancar. Cambiarlo es cambiar la
    variable y reiniciar, sin desplegar.
    - `disabled`: los cálculos quedan `PENDING`.
    - `stub`: `SimulatedScoringEngineAdapter`, determinístico, con la forma del
      brief (Potencial 0–100, Madurez 1–4, Confianza 0–1, D1–D8). Sus
      resultados quedan marcados como simulados.
    - El motor real llega con PF-26.
  - Con `APP_ENV=production` no se admite `stub`. Con `NODE_ENV=production`,
    `APP_ENV` y `SCORING_ENGINE_DRIVER` son obligatorias.
  - El simulado registra y activa una versión de reglas simulada si no hay
    ninguna activa.
- `src/ai/` — servicio compartido de IA (PF-32). Sin rutas: lo usan otros
  módulos (Flags, Delivery) con `AiService.run(task)`.
  - **La tarea:** un prompt versionado del repo (`src/ai/prompts/`), los datos
    y un esquema zod de la respuesta. El módulo no sabe qué proveedor hay
    detrás.
  - **Proveedores** (`AiProviderAdapter`): `claude` (SDK oficial de
    Anthropic, salida estructurada) y `stub` (ejemplo que cumple el esquema,
    sin costo). Agregar otro es escribir un adapter nuevo.
  - **Configuración:** `AI_PROVIDER`/`AI_MODEL` por defecto, y
    `AI_FLAGS_*`/`AI_REPORT_*` por uso. `disabled` apaga la IA.
    - Modelo por defecto: `claude-opus-5-5`, con el fallback del servidor si
      declina por seguridad.
    - Con `APP_ENV=production` no se admite `stub`.
    - Con `claude`, `ANTHROPIC_API_KEY` es obligatoria.
  - **Seguridad:**
    - Los datos se minimizan antes de salir (`minimize.ts`): rechaza claves de
      contacto y enmascara correos, teléfonos y los textos de `redact`.
    - Van como JSON dentro de `<client_data>`, separados de las instrucciones,
      con reglas fijas contra la inyección (`prompt-envelope.ts`, OWASP LLM01).
    - La respuesta se valida con zod; si no cumple, `invalid_output` (LLM05).
  - **Resultado:** `run` nunca lanza por un fallo del proveedor; devuelve
    `ok: false` con el motivo (`disabled`, `timeout`, `rate_limited`,
    `provider_error`, `refused`, `invalid_output`).
  - **Registro:** cada llamada queda en `ai_call_logs` (proveedor, modelo,
    versión de prompt, tokens, costo aproximado de `pricing.ts`, duración,
    resultado), sin contenido, y como `AI_TASK_RUN` en la bitácora.
  - **Prueba:** `pnpm ai:test` corre una tarea de prueba con la
    configuración local (con `claude` gasta tokens reales).
- `src/flags/` — alertas para el revisor (PF-34). Nunca cambian el resultado
  ni las respuestas. En un caso aprobado no se pueden revisar, descartar ni
  reabrir (409 `REVIEW_APPROVED`) hasta que un Aprobador reabra el caso
  (PF-64); se bloquea la revisión antes que el flag, como al aprobar.
  - **Al terminar bien un cálculo**, en la misma transacción, se crean:
    - el flag de baja confianza (`ENGINE`), si la Confianza del motor queda
      bajo `FLAG_LOW_CONFIDENCE_THRESHOLD` (0.5);
    - el `FlagAnalysis` pendiente.
  - **Análisis con IA:** corre en segundo plano con el prompt versionado
    `flags.contradictions` (`src/ai/prompts/`).
    - Crea un flag `AI` por cada posible contradicción, con sus preguntas en
      `flag_questions` y su severidad.
    - Si la IA nota respuestas que intentan darle instrucciones, crea un flag
      aparte, para que quede rastro.
    - Si la IA nombra una pregunta que no es de la versión del diagnóstico, el
      análisis falla (`invalid_question`) y no crea ningún flag.
  - **Estado del análisis:** cero flags solo significa "sin alertas" si el
    análisis está `SUCCEEDED`. Al arrancar se retoman los pendientes. Con la IA
    desactivada, quedan pendientes.
  - **Rutas** (Revisor y Aprobador):
    - `GET /diagnostics/:id/flags?calculationId=` (por defecto, el cálculo
      vigente; trae el análisis y `openCount`).
    - `PATCH /flags/:id` (`REVIEWED`, `DISMISSED` con nota, u `OPEN` para
      reabrir).
    - `GET` y `POST /calculations/:id/flag-analysis`. El `POST` reintenta un
      fallido o crea el de un cálculo anterior a los flags: 202, 409 si ya
      terminó o sigue en curso, 503 con la IA desactivada.
    - `GET /diagnostics` trae en cada fila `openFlagCount`: los flags
      abiertos del cálculo vigente, en una sola consulta para toda la página.
- `src/reviews/` — revisión humana antes de cualquier entrega (PF-39). "Caso"
  es el texto de pantalla; la entidad es `Review`, una por diagnóstico, creada
  con su primer cálculo.
  - **Bandeja:** `GET /reviews?page&pageSize&assignment=unassigned|mine&status=`.
    Solo diagnósticos con un cálculo exitoso, paginada en la base, con los flags
    abiertos del cálculo vigente en una sola consulta. `unassigned` incluye los
    casos tomados por alguien desactivado.
  - **Detalle:** `GET /reviews/:id` trae el estado, quién lo tiene, la
    aprobación vigente, el último intento de cálculo y `approvalBlockers` (lo
    que falta para aprobar). Responde con `ETag`.
  - **Tomar y liberar:** `PUT` y `DELETE /reviews/:id/assignment`. Con la fila
    bloqueada: dos tomas simultáneas dan una 200 y una 409. Si quien lo tiene
    está desactivado, otro puede tomarlo. Liberar uno ajeno es solo del
    Aprobador.
  - **Correcciones:** `POST /reviews/:id/corrections` (`answerId`, `text` u
    `optionIds`, `reason`), solo quien tiene el caso y sin aprobación vigente.
    `answer_corrections` es de solo inserción (trigger) y cada corrección lleva
    un número correlativo en su caso. La respuesta efectiva es la última
    corrección o, si no hay, la original; el motor recibe siempre las
    efectivas. `GET` lista cada corrección con el valor original.
  - **Recalcular:** por `POST /diagnostics/:id/calculations`. Al encolar, el
    cálculo guarda en `correctionSequence` la última corrección que incluye y
    anula la aprobación vigente (`RECALCULATED`). Anularla equivale a reabrir,
    así que en un caso aprobado solo recalcula el Aprobador (409
    `REVIEW_APPROVED` para el Revisor).
  - **Notas:** `GET` y `POST /reviews/:id/notes` (`body`, `dimension`
    opcional, texto libre hasta confirmar D1–D8).
  - **Aprobar:** `POST /reviews/:id/approval`, solo el Aprobador, haya tomado
    o no el caso. Exige que el último intento sea exitoso, que incluya la
    última corrección, que su análisis de IA haya terminado bien (o una
    excepción con `aiExceptionReason`), que no queden flags abiertos y, con
    `APP_ENV=production`, que no sea simulado. Si falta algo, 409 con la
    lista en `errors`. La aprobación queda atada a ese cálculo; a lo sumo una
    vigente por caso (índice único parcial) y solo se anula una vez (trigger).
  - **Reabrir:** `POST /reviews/:id/reopenings` con `reason`, solo el
    Aprobador. Si el caso tenía el informe aprobado o entregado, vuelve a
    borrador (`src/reports`). Si ya se había entregado, además se revocan los
    enlaces de descarga del cliente y el informe queda pendiente de entregar
    (`redeliveryPending` en `GET .../report`) hasta que se ponga al día, se
    apruebe y se entregue de nuevo. Recalcular hace lo mismo.
  - **Concurrencia:** corregir y aprobar exigen `If-Match` con el ETag
    (`"<version>"`): 428 si falta, 412 si el caso cambió. Tomar, liberar,
    corregir, aprobar, reabrir y encolar un cálculo suben la versión.
  - **Bitácora:** tomar, liberar, corregir, notas, aprobar, reabrir y la
    anulación por recálculo se registran en la misma transacción, sin
    valores, motivos ni texto de las notas. `REVIEW_APPROVED` lleva
    `correctedByIds` y `approverCorrected`: quién corrigió y quién aprobó
    (riesgo aceptado A.5.3, CLAUDE.md 5.3).
- `src/reports/` — informe del diagnóstico (PF-42): la IA redacta el
  borrador, una persona lo edita y un Aprobador lo aprueba. La IA nunca calcula
  ni cambia el puntaje. Después se entrega por correo con un enlace de descarga
  del PDF. Estados: `DRAFT` → `APPROVED` → `DELIVERED`. Rutas del panel bajo
  `/reviews/:reviewId/report`; la descarga del cliente, `POST /report-downloads`.
  - **Generar:** `POST /reviews/:id/report`, ambos roles, solo con la revisión
    aprobada (409 `REVIEW_NOT_APPROVED`) y una vez por caso (409
    `REPORT_ALREADY_EXISTS`). La IA (`AI_REPORT_*`, prompt `report.draft`)
    redacta Hallazgo, Implicación, Recomendación y Próximo paso por cada
    dimensión del cálculo aprobado, con las respuestas de ese cálculo y las
    notas del revisor. Nunca recibe nombre, correo ni teléfono del lead: su
    nombre se tacha si aparece en un texto libre o en una nota. La respuesta
    debe traer exactamente esas dimensiones; si no, o si la IA falla, 503
    `AI_TASK_FAILED` sin guardar nada (queda en `ai_call_logs`).
  - **Ver:** `GET /reviews/:id/report` con el texto vigente de cada sección y
    el ETag. `outdated: true` si la aprobación del caso con que se redactó ya
    no es la vigente.
  - **Editar y regenerar:** `PUT .../sections/:sectionId` con `body` (hasta
    4000), `POST .../sections/:sectionId/regenerations` (rehace una parte con
    las otras como contexto) y `POST .../regenerations` (todo el borrador con
    la aprobación vigente: así se pone al día uno desactualizado). Ambos roles,
    con `If-Match` (428/412 `REPORT_VERSION_MISMATCH`) y solo en borrador (409
    `REPORT_APPROVED`, o `REPORT_DELIVERED` si ya se entregó).
  - **Historial:** `GET .../sections/:sectionId/revisions`. Cada cambio es una
    fila de `report_section_revisions` (solo inserción, trigger) con su origen:
    `AI` con la llamada de `ai_call_logs`, o `HUMAN`; siempre con autor (quien
    editó o pidió la redacción) y fecha.
  - **Aprobar:** `POST /reviews/:id/report/approval`, solo el Aprobador, con
    `If-Match`. Exige que el caso siga aprobado con la misma aprobación del
    borrador (409 `REPORT_OUTDATED` si no). Guarda qué versión de cada sección
    se aprobó (`report_approval_revisions`). Reabrir o recalcular el caso anula
    la aprobación del informe con la misma causa y lo devuelve a borrador.
  - **Reabrir el informe:** `POST .../reopenings` con `reason`, solo el
    Aprobador, con `If-Match`. Devuelve a borrador un informe aprobado que
    todavía no se entregó, sin tocar la aprobación del caso: se corrige y se
    vuelve a aprobar sin regenerarlo. 409 `REPORT_NOT_APPROVED` en borrador y
    `REPORT_DELIVERED` si ya se entregó (un informe entregado no cambia).
  - **PDF** (`src/reports/pdf`): PDFKit con Noto Sans (OFL, en
    `assets/fonts`; el despliegue debe incluir esa carpeta). No se guarda el
    archivo: se genera a pedido y es determinista (fechas internas = la de la
    aprobación), así que la misma versión aprobada da siempre los mismos bytes.
    La plantilla 1 es provisional, solo texto y sin puntajes. Para cambiarla
    se agrega una versión nueva en `TEMPLATES` y se sube
    `CURRENT_TEMPLATE_VERSION`, dejando las anteriores mientras tengan enlaces
    vigentes. `GET .../pdf` (ambos roles) muestra el PDF tal como está hoy.
    Noto Sans no cubre escrituras como la china o la árabe: esos caracteres
    salen como recuadros.
  - **Entregar y reenviar:** `POST .../deliveries`, solo el Aprobador, con
    `If-Match`. Exige el informe aprobado (409 `REPORT_NOT_APPROVED`), el caso
    aprobado con la misma aprobación (409 `REVIEW_NOT_APPROVED` /
    `REPORT_OUTDATED`) y sin nada que hoy impediría aprobarlo (409
    `REPORT_DELIVERY_BLOCKED` con la lista en `errors`). Envía al lead un
    correo con el enlace de descarga, que vence en `REPORT_LINK_TTL_DAYS` (30),
    y deja el informe en `DELIVERED`. Llamarla de nuevo reenvía: enlace nuevo
    y el anterior revocado en la misma transacción (a lo sumo uno sin revocar
    por informe, índice único parcial). Si el informe ya se había entregado y
    volvió a borrador porque el caso cambió, la entrega nueva lleva un correo
    de "informe actualizado" y queda como `REPORT_REDELIVERED` (`updated: true`
    en la respuesta). Si el correo no sale, 503
    `REPORT_EMAIL_FAILED` y no queda nada marcado. Cada envío es una fila de
    `report_deliveries` (solo inserción): a qué nombre y correo, quién, cuándo,
    la plantilla y el SHA-256 del PDF. `GET .../deliveries` las lista con el
    estado del enlace y sus descargas.
  - **Descarga del cliente:** `POST /report-downloads` con `{ token }` en el
    cuerpo (nunca en la URL), pública y con límite de 10 por minuto. Del token
    solo se guarda el SHA-256. Responde el PDF con `Cache-Control: no-store` y
    `Content-Disposition: attachment`; 401 `INVALID_REPORT_LINK` con el mismo
    mensaje si el enlace es inválido, venció o fue revocado. El PDF se vuelve a
    generar desde la versión aprobada y solo se entrega si da la huella de la
    entrega (500 `REPORT_PDF_INTEGRITY_FAILED` si no). Cada descarga queda en
    `report_downloads` y en la bitácora con actor `END_CLIENT`. El enlace del
    correo apunta a `DIAGNOSTIC_URL/report#token=...`, pantalla de PF-44.
  - **Bitácora:** generar, regenerar, editar, aprobar, reabrir, entregar,
    reenviar, descargar y la anulación, en la misma transacción y sin texto
    del informe, motivo, correo del cliente ni token.
- `src/calculations/` — cálculos del motor (PF-24).
  - **Cuándo se calcula:** al enviar el diagnóstico, el `Calculation` pendiente
    se crea en la misma transacción y se procesa en segundo plano; el cliente
    no espera al motor.
  - **Reinicios:** al arrancar se retoman los pendientes y los que quedaron en
    `RUNNING` (se supone una sola instancia de la API).
  - **Qué se guarda:** cada cálculo queda aparte con entrada (respuestas por
    `code`/`value`), salida, versión de reglas, motor y estado. Nunca se
    sobrescribe.
  - **Último intento y vigente:** último intento = el más reciente. Cálculo
    vigente = el más reciente `SUCCEEDED`.
  - **Base de datos:** a lo sumo un cálculo `PENDING`/`RUNNING` por diagnóstico
    y una `RuleSetVersion` activa, ambos con índices únicos parciales.
  - **Rutas** (Revisor y Aprobador, matriz 5.3):
    - `POST /diagnostics/:id/calculations`: 202 con `Location`; 503 con el
      motor apagado; 409 si no está enviado o ya hay uno en curso.
    - `GET /diagnostics/:id/calculations`: historial, último intento primero.
    - `GET .../calculations/current` y `GET .../calculations/:calculationId`
      (el detalle trae lo enviado).
    - `GET /scoring-engine/status`.
  - **Privacidad:** las lecturas se auditan, y las respuestas nunca van a la
    bitácora ni a los logs. Si el motor falla, el panel ve un mensaje
    genérico.
- `src/common/app-throttler.guard.ts` — límite de peticiones. Cuenta por usuario
  si el JWT del panel tiene firma válida, por diagnóstico si trae una sesión de
  cliente final válida, por la IP que informa el panel o `apps/diagnostico` en
  rutas sin sesión (`x-client-ip`, solo con `x-panel-secret` igual a
  `PANEL_API_SECRET` o `x-diagnostic-secret` igual a `DIAGNOSTIC_API_SECRET`) y,
  si no, por IP de conexión. Cada contador es por ruta y vive en memoria, así que con
  varias instancias de la API hará falta un almacén compartido.
- `src/audit/` — bitácora de auditoría (requisito duro). Cada evento
  guarda actor tipado (`PANEL_USER` / `END_CLIENT` / `SYSTEM` + id
  cuando aplica), acción, entidad afectada por referencia (tipo + id,
  sin llave foránea) y un detalle libre en `data` (tabla `audit_logs`). El
  `AuditInterceptor` registra toda request exitosa que cambia datos, con la
  acción, la entidad y los campos que declara su `@AuditRoute()`; el actor sale
  de `request.user` (JWT de panel) o `request.accessLink` (sesión del cliente final).
  `auditFailures` registra los intentos fallidos o denegados, sin guardar el
  body. Un evento crítico se registra desde su servicio, pasando el `tx` a
  `AuditService.record(...)`, para que ambos se confirmen o se reviertan juntos.
  La base rechaza `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs`.
- `src/questionnaire/` — versiones del cuestionario por familia (PF-12):
  `QuestionnaireVersion` → `Question` → `AnswerOption`. Un borrador (`DRAFT`,
  a lo sumo uno por familia) se edita; una versión publicada es inmutable, y un
  trigger lo garantiza también en la base. `code` (pregunta) y `value` (opción)
  son estables entre versiones. Rutas en `/questionnaire-versions`: ver, Revisor y
  Aprobador; crear el borrador, editar preguntas, reordenarlas y publicar, solo
  Aprobador. Crear y editar reciben la pregunta completa con sus opciones, en una
  sola operación. Publicar valida que el borrador esté completo y, si no, responde
  409 con la lista de lo que falta. Un borrador nuevo copia la última versión
  publicada que no sea de prueba.
- `prisma/sample-questionnaire.ts` — cuestionario de **prueba** (5-6 preguntas
  por familia, con `isSample` y el prefijo `[Prueba]`). Lo carga `pnpm prisma db
  seed` solo con `APP_ENV` en `development` o `qa` (o sin `APP_ENV` y con
  `NODE_ENV=development`); es idempotente. Para reemplazarlo, se publica el
  cuestionario oficial como una versión nueva.
- `src/rules/` — versión de reglas aplicada a cada caso (requisito
  duro). El contenido de las reglas vive en una columna `jsonb`, no en
  código.
- `POST /auth/refresh` renueva el JWT de una sesión en uso. El token conserva
  `authAt` (momento del login) y nunca vence después de
  `authAt + JWT_MAX_SESSION_SECONDS`. No hay refresh tokens: `JwtStrategy`
  valida sesión, cuenta y `sessionVersion` en cada petición.
- `POST /auth/logout` borra la fila de `UserSession` que nombra el JWT (`sid`):
  ese token, y los renovados a partir de él, dejan de valer de inmediato. Cada
  usuario tiene una sola sesión, en un solo dispositivo: un login nuevo reemplaza
  la anterior. `GET /auth/session` responde 204 si el token sigue valiendo, sin
  efectos.
- `src/users/` + `src/auth/` — login JWT y guards de roles para
  `apps/panel`. `UsersController` (`/users`) es el CRUD interno de
  cuentas (`name`, `email`, `active`) — sin autoservicio, lo administra el
  propio equipo y exige estar ya autenticado como Aprobador. `active: false`
  revoca el acceso de inmediato (login y JWT ya emitidos), sin borrar el
  usuario ni su historial. Nadie define ni conoce la contraseña de otra
  persona (PF-59): `POST /users` no recibe `password`; la cuenta nace con una
  contraseña aleatoria que no se guarda en ningún lado y `passwordSetAt: null`,
  y su dueño recibe un enlace de un solo uso (72 h) para definirla en
  `/reset-password` antes de configurar el MFA. `POST /users/:id/password-reset`
  (Aprobador, nunca sobre uno mismo ni sobre una cuenta desactivada) invalida la
  contraseña vigente, cierra sus sesiones y le manda un enlace nuevo; también
  sirve para reenviar el de activación. `PATCH /users/:id/reset-mfa` hace lo
  mismo además de quitar el MFA. Las tres respuestas traen `linkSent`: si el
  correo falló, el panel lo avisa. El login rechaza una cuenta con
  `passwordSetAt` nulo. Cambiar la contraseña cierra todas las sesiones
  abiertas: el JWT lleva `ver` (`User.sessionVersion`), y `JwtStrategy`
  rechaza los tokens de una versión anterior. Los enlaces salen de
  `PasswordLinkService` (`src/password-reset/password-link.service.ts`). `GET /users` está paginado en el servidor
  (`?page=1&pageSize=20&search=`, máx. 100 por página) y devuelve
  `{ data, total, page, pageSize }`: página y conteo salen de una sola
  transacción, y la búsqueda (`search`, por nombre o email, sin distinguir
  mayúsculas) se resuelve en la consulta. Los DTOs normalizan espacios y
  limitan `name` a 120 y `email` a 254 caracteres. `prisma/seed.ts` (`pnpm prisma db seed`) crea
  el primer ADMIN a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
  `ADMIN_NAME`, porque sin un usuario ya autenticado no se puede llegar
  a `POST /users`. `User.role` es `ADMIN` (Aprobador) o `REVIEWER` (Revisor), sin
  valor por defecto; la matriz está en `CLAUDE.md`, sección 5.3. Cambiarlo
  cierra las sesiones del usuario y queda como `USER_ROLE_CHANGED`. Siempre
  debe quedar un Aprobador activo: si no, 409.
- `src/password-reset/` — recuperación de contraseña de
  `apps/panel`, rutas públicas: `POST /auth/password-reset/request`
  (`{ email }`, 3/min por IP) responde siempre el mismo mensaje y hace
  el trabajo en segundo plano (misma respuesta y mismo tiempo exista o
  no el correo); si el usuario existe y está activo, crea un token
  aleatorio de un solo uso que vence en 1 hora, borra los pendientes
  anteriores y manda el enlace `PANEL_URL/reset-password?token=`
  por `MailService`. En la base solo queda el SHA-256 del token
  (`PasswordResetToken`). `POST /auth/password-reset/confirm`
  (`{ token, password }`, 5/min por IP) responde 204, o 400 con un único
  mensaje para enlace inválido, usado o vencido. La misma confirmación activa
  una cuenta nueva o restablecida por un Aprobador (`passwordSetAt`), y levanta
  el bloqueo por intentos fallidos si no hubo códigos de MFA rechazados hace
  poco (ver "Segundo factor del panel"). La bitácora guarda la
  solicitud y el cambio sin token ni email en claro.
- `src/diagnostics/` — diagnósticos del cliente final (PF-16). Un
  `Diagnostic` por lead, que apunta a la última versión publicada de su
  familia (un trigger exige que esté publicada); la familia sale de la
  versión. Respuestas en `Answer` (texto libre) y `AnswerSelection`
  (opciones), con FK compuestas que garantizan en la base que la pregunta
  sea de la versión y la opción de la pregunta. Enlaces externos en
  `ExternalLink` (Spotify, YouTube, Instagram, TikTok y sitio web; solo
  https y dominios permitidos). Estados `ACTIVE` → `IN_PROGRESS` →
  `COMPLETED`; `ABANDONED` se calcula (7 días sin actividad) y no se guarda.
  - **Enlace sin contraseña** (`AccessLink`): token opaco de 256 bits del
    que solo se guarda el SHA-256; vence en `ACCESS_LINK_TTL_DAYS` (30) y
    sirve varias veces. Va en el fragmento de la URL,
    `DIAGNOSTIC_URL/access#token=`, para que no llegue a los logs de
    `apps/diagnostico`. `POST /diagnostic-sessions` (`{ token }`, 10/min
    por IP) lo canjea por una sesión JWT de 12 h firmada con
    `ACCESS_LINK_JWT_SECRET`, que nombra al enlace: `AccessLinkGuard` revisa
    en cada petición que siga vigente, así que revocarlo corta la sesión.
    Canjear un enlace revoca los emitidos antes que él. Si el diagnóstico ya se
    envió, un enlace no vencido responde 409 `DIAGNOSTIC_COMPLETED` en vez de
    401, para que el cliente sepa que ya terminó.
  - **Cliente** (sesión): `GET /diagnostic-sessions/current` (cuestionario,
    respuestas, enlaces y progreso), `PUT`/`DELETE
    current/answers/:questionId` (`{ text }` o `{ optionIds }`),
    `PUT`/`DELETE current/external-links/:platform` (`{ url }`) y
    `POST current/submission` (201; 409 con las obligatorias que faltan).
    Enviar revoca sus enlaces y dispara `notifyDiagnosticCompleted`.
  - **Panel**: `GET /diagnostics` (paginado; `status` incluye `ABANDONED`,
    `family`, `search` por nombre o email del lead) y `GET /diagnostics/:id`,
    para Revisor y Aprobador, auditados como lecturas. El detalle trae el
    `id` de cada respuesta, que el panel usa para corregir (PF-40); la app
    del cliente no lo recibe. `POST /diagnostics`
    (`{ leadId, reason }`, solo Aprobador: generar sin pago lleva motivo)
    responde 201 con `Location` y el enlace una sola vez; `POST
    /diagnostics/:id/access-links` (Revisor y Aprobador) revoca los vigentes
    y envía uno nuevo. Si el correo falla, la operación queda hecha y la
    respuesta trae `emailSent: false` para copiar el enlace.
  - **Recuperación** (pública): `POST /access-link-recoveries` (`{ email }`)
    responde siempre 202 y envía en segundo plano un enlace nuevo para el
    diagnóstico sin completar más reciente de ese correo, sin revocar el
    anterior. 3/min por IP y 3/hora por correo destino.
  - La bitácora registra cada acción con su actor (`END_CLIENT` = id del
    diagnóstico) y el `accessLinkId` usado, sin el token, el motivo ni las
    respuestas. Como el panel puede copiar el enlace del cliente, ese id
    rastrea cada cambio hasta quién emitió el enlace (`ACCESS_LINK_ISSUED`).
- `src/leads/` — `POST /api/v1/leads/prequalification`, el endpoint
  público (sin auth, 5 envíos/min por IP) que llama el formulario de
  precalificación de `score-sitio` desde el navegador. Registra un
  `Lead` en estado `NEW` con la familia ya elegida y los UTM; responde
  solo `{ id, status }`. Mientras `score-sitio` migra, `POST
  /leads/precalificacion` (`src/leads/legacy/`) sigue aceptando el
  contrato viejo en español, con su forma de error `{ statusCode,
  mensaje }`. Los datos personales (`nombre`, `email`,
  `telefono`) no entran a la bitácora: `@AuditRoute()` solo guarda lo declarado.
  Es un contrato con otro repo: está en
  [`docs/contrato-precalificacion.md`](docs/contrato-precalificacion.md),
  y cambiarlo se coordina con José. Para `apps/panel` (JWT + ADMIN):
  `GET /leads` (paginado, filtros `family`/`status` y búsqueda `search`
  por nombre/email, en la base; más recientes primero), `GET /leads/:id`
  (con `diagnostic: { id } | null`, para que el panel ofrezca abrirlo)
  y `PATCH /leads/:id/status` (`NEW`/`CONTACTED`/`CONVERTED`). El resto
  de los datos del lead no se edita desde el panel.
- `src/mail/` — correo transaccional. Los módulos llaman a
  `MailService` (`sendDiagnosticLink`, `sendLinkRecovery`, `sendPasswordReset`, `sendPasswordSetup`),
  nunca al proveedor: detrás está `MailPort` (`mail.port.ts`), con
  dos adaptadores elegidos por `MAIL_DRIVER`: `log` (default, no envía
  nada y deja destinatario, asunto, enlaces y texto en el log) y `resend`
  (staging/producción; exige `RESEND_API_KEY`, `MAIL_FROM` y
  `MAIL_REPLY_TO`, y en producción es obligatorio — si falta algo la
  API no arranca y dice qué). Las plantillas viven en
  `mail/templates/` (HTML con estilos en línea, todo lo variable
  escapado; logo por `MAIL_LOGO_URL`, textos provisionales). Un fallo
  del proveedor no lanza: vuelve `{ sent: false, reason }`. Cada
  intento queda en la bitácora (`EMAIL_SENT`/`EMAIL_FAILED`) con el
  tipo y el id o motivo — nunca el destinatario (ni enmascarado), el
  enlace ni el contenido; del motivo del proveedor se quitan las direcciones
  de correo. Tampoco el log de `MailService` lleva la dirección (el driver
  `log`, solo para local, sí imprime destinatario y contenido). Sin colas ni reintentos (fuera de alcance del MVP).
  Prueba manual: `pnpm mail:test tu@email.com` (necesita Postgres);
  con `MAIL_DRIVER=resend` y remitente `onboarding@resend.dev` llega de
  verdad, pero solo al email dueño de la cuenta de Resend.
- `src/notifications/` — avisos por correo al equipo, solo a los usuarios
  activos del rol que tiene que actuar (`NOTICE_RECIPIENTS`, PF-38): lead
  nuevo a los Aprobadores (lo dispara `LeadsService.create`, también desde el
  alias legacy) y diagnóstico completado a Revisores y Aprobadores
  (`notifyDiagnosticCompleted`, al enviar el diagnóstico). Se procesan en segundo plano, así que ni el tiempo de respuesta ni
  un fallo del correo afectan a la operación que los dispara. Cada envío queda
  en la bitácora asociado al lead o al diagnóstico, sin sus datos personales.
  Los enlaces salen de `PANEL_URL`.
- `src/health/` — `GET /health`.

## Pendiente a propósito (no construir todavía)

- La detección de contradicciones. El contenido oficial del cuestionario
  depende de la especificación de las 4 familias (Proyecto, B2B,
  Profesional, Catálogo), que todavía no existe.
- El motor de cálculo real detrás de `ScoringEnginePort`.
- Aislamiento de datos por caso a nivel de Postgres (RLS): la convención
  acordada es que toda tabla de dominio nueva lleve una columna
  `caseId`/`tenantId` y que el filtrado se resuelva primero a nivel de
  aplicación (servicio), ya que `diagnostico`/`panel` nunca tocan
  Postgres directamente. Evaluar RLS como segunda capa de defensa recién
  cuando exista el dominio real.

## Nota de versiones

Desde NestJS 12 los paquetes de Nest se publican como ESM (usan
`import.meta.url`), y Jest en modo CommonJS no puede cargarlos. Por eso
los tests corren con **Vitest** (`vitest.config.mts` y
`vitest.config.e2e.mts`), con `unplugin-swc` para que se emita la
metadata de decoradores que necesita la inyección de dependencias de
Nest (esbuild, el transformador por defecto de Vitest, no la emite). En
los specs se usa `vi.fn()`/`vi.mock()` y el tipo `Mock` de `vitest`. El
código de la app sigue siendo CommonJS: Node 22 carga los paquetes ESM de
Nest vía `require(esm)`.
