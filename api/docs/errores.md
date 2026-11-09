# Errores de la API

Todos los errores siguen RFC 9457, con `Content-Type: application/problem+json`.
La excepción es el alias legacy `POST /leads/precalificacion`, que conserva
`{ statusCode, mensaje }` hasta que se retire.

| Campo | Qué es |
| ---------- | --------------------------------------------------------------- |
| `type` | URN que identifica el problema (`urn:score:problem:not-found`). |
| `title` | Frase HTTP del estado. |
| `status` | Código HTTP. |
| `detail` | Explicación de este caso. |
| `instance` | Ruta de la petición, sin query. |
| `code` | Código estable para la lógica de quien consume la API. |
| `errors` | Solo si aplica: lista de `{ field?, code?, message }`. |

Decidir por `code`, nunca por el texto de `detail`.

## Catálogo de `code`

Un código publicado no cambia de significado.

| `code` | Estado | Cuándo |
| -------------------- | ------ | ------------------------------------- |
| `VALIDATION_FAILED` | 400 | Datos que no pasan la validación; `errors` trae cada campo. |
| `BAD_REQUEST` | 400 | Otra petición mal formada, como un JSON inválido. |
| `INVALID_RESET_LINK` | 400 | Enlace de recuperación inválido, usado o vencido. |
| `UNAUTHORIZED` | 401 | Sin sesión, o sesión o enlace no válidos. |
| `INVALID_ACCESS_LINK` | 401 | Enlace del cliente inválido, vencido o revocado. |
| `INVALID_MFA_CODE` | 401 | Código de verificación o de recuperación incorrecto, ya usado, o cuenta bloqueada. |
| `MFA_CHALLENGE_EXPIRED` | 401 | El reto de MFA venció o dejó de valer: hay que volver a iniciar sesión. |
| `FORBIDDEN` | 403 | El rol no alcanza. |
| `NOT_FOUND` | 404 | El recurso o la ruta no existe. |
| `CONFLICT` | 409 | Choca con el estado actual del recurso. |
| `DRAFT_ALREADY_EXISTS` | 409 | La familia ya tiene un borrador de cuestionario abierto. |
| `QUESTIONNAIRE_VERSION_PUBLISHED` | 409 | La versión del cuestionario está publicada: no admite cambios. |
| `QUESTIONNAIRE_VERSION_INCOMPLETE` | 409 | El borrador no se puede publicar; `errors` trae lo que falta (`NO_QUESTIONS`, `NOT_ENOUGH_OPTIONS`, `FREE_TEXT_WITH_OPTIONS`, `MAX_LENGTH_REQUIRED`, `MAX_LENGTH_NOT_ALLOWED`, `DUPLICATE_OPTION_VALUE`). |
| `DUPLICATE_QUESTION_CODE` | 409 | Ya hay una pregunta con ese `code` en la versión. |
| `DIAGNOSTIC_ALREADY_EXISTS` | 409 | El lead ya tiene un diagnóstico. |
| `NO_PUBLISHED_QUESTIONNAIRE` | 409 | La familia del lead no tiene una versión publicada del cuestionario. |
| `DIAGNOSTIC_COMPLETED` | 409 | El diagnóstico ya fue enviado: no admite cambios ni enlaces nuevos, y su enlace no vencido ya no abre sesión. |
| `DIAGNOSTIC_INCOMPLETE` | 409 | Faltan obligatorias por responder; `errors` trae cada una (`field` = id de la pregunta, `code` = `REQUIRED_QUESTION_UNANSWERED`). |
| `TOO_MANY_REQUESTS` | 429 | Se pasó un límite de intentos. |
| `INTERNAL_ERROR` | 500 | Error no controlado; la causa queda en el log. |
| `DIAGNOSTIC_NOT_COMPLETED` | 409 | Se pidió calcular un diagnóstico que el cliente todavía no envió. |
| `CALCULATION_IN_PROGRESS` | 409 | El diagnóstico ya tiene un cálculo pendiente o en curso. |
| `NO_CURRENT_CALCULATION` | 404 | El diagnóstico todavía no tiene un cálculo exitoso. |
| `SCORING_ENGINE_DISABLED` | 503 | El motor está desactivado (`SCORING_ENGINE_DRIVER=disabled`): los cálculos quedan pendientes. |
| `CALCULATION_NOT_SUCCEEDED` | 409 | Se pidió el análisis de flags de un cálculo que no terminó bien. |
| `FLAG_ANALYSIS_NOT_RETRYABLE` | 409 | El análisis de flags ya terminó bien o sigue en curso. |
| `AI_DISABLED` | 503 | La IA está desactivada para este uso (`AI_*_PROVIDER=disabled`): los análisis quedan pendientes. |
| `REVIEW_ALREADY_TAKEN` | 409 | Otra persona activa ya tomó el caso. |
| `REVIEW_TAKEN_BY_OTHER` | 403 | El caso es de otra persona: solo ella lo corrige, y solo un Aprobador lo libera. |
| `REVIEW_NOT_TAKEN` | 409 | Hay que tomar el caso antes de corregirlo. |
| `REVIEW_APPROVED` | 409 | El caso está aprobado: no admite correcciones, otra aprobación ni (si no lo pide un Aprobador) un recálculo hasta reabrirlo. |
| `REVIEW_NOT_APPROVED` | 409 | Se pidió reabrir un caso sin aprobación vigente. |
| `APPROVAL_REQUIREMENTS_NOT_MET` | 409 | El caso no se puede aprobar; `errors` trae lo que falta (`NO_CALCULATION`, `LATEST_CALCULATION_NOT_SUCCEEDED`, `CORRECTIONS_NOT_CALCULATED`, `FLAG_ANALYSIS_NOT_SUCCEEDED`, `OPEN_FLAGS`, `SIMULATED_RESULT`). |
| `REVIEW_VERSION_MISMATCH` | 412 | El caso cambió desde que se leyó (`If-Match` con una versión vieja): hay que volver a cargarlo. |
| `IF_MATCH_REQUIRED` | 428 | Falta `If-Match` con el ETag del caso (`GET /reviews/:id`). No se acepta `*` ni un ETag débil. |
| `SERVICE_UNAVAILABLE` | 503 | La API o una dependencia no está disponible. |

Otro estado HTTP sin código propio recibe su frase en `UPPER_SNAKE_CASE`.
