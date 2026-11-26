# Errores de la API

Todos los errores siguen RFC 9457, con `Content-Type: application/problem+json`.

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
| `VALIDATION_FAILED` | 400 | Datos que no pasan la validación; `errors` trae cada campo. Una contraseña filtrada trae `errors[].field = password` y `errors[].code = PASSWORD_BREACHED` (PF-60). |
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
| `CRM_SYNC_EVENT_NOT_FAILED` | 409 | Se pidió reintentar un envío al CRM que no está fallido: ya está en cola o ya salió. |
| `TOO_MANY_REQUESTS` | 429 | Se pasó un límite de intentos. |
| `INTERNAL_ERROR` | 500 | Error no controlado; la causa queda en el log. |
| `DIAGNOSTIC_NOT_COMPLETED` | 409 | Se pidió calcular un diagnóstico que el cliente todavía no envió. |
| `CALCULATION_IN_PROGRESS` | 409 | El diagnóstico ya tiene un cálculo pendiente o en curso. |
| `VOICE_NOT_ALLOWED` | 409 | La pregunta no acepta respuestas por voz (PF-86). Al crear o editar una pregunta de selección con `allowsVoice`, llega como `errors[].code` de un `VALIDATION_FAILED`. |
| `VOICE_CONSENT_REQUIRED` | 409 | El cliente todavía no aceptó el uso de su voz (`POST /diagnostic-sessions/current/voice-consent`). |
| `RECORDING_TOO_LARGE` | 413 | La grabación supera los 5 MB. |
| `RECORDING_UNSUPPORTED_TYPE` | 415 | El audio no es WebM (Opus) ni MP4 (AAC), o su contenido no coincide con el tipo declarado. |
| `RECORDING_NOT_FOUND` | 404 | La respuesta no tiene grabación, o el audio ya no está disponible. |
| `TRANSCRIPTION_NOT_FOUND` | 404 | Se pidió reintentar la transcripción de una respuesta sin grabación. |
| `RECORDING_AUDIO_DELETED` | 410 | La grabación existe, pero su audio se borró por plazo (PF-90). La transcripción se conserva. |
| `TRANSCRIPTION_AUDIO_DELETED` | 409 | Se pidió reintentar una transcripción cuyo audio ya se borró por plazo. |
| `TRANSCRIPTION_NOT_FAILED` | 409 | Se pidió reintentar una transcripción que no está fallida: está pendiente o ya terminó. |
| `STORAGE_UNAVAILABLE` | 503 | El almacenamiento de audios no responde; no se guardó nada y se puede reintentar. Las respuestas escritas siguen funcionando. |
| `NO_CURRENT_CALCULATION` | 404 | El diagnóstico todavía no tiene un cálculo exitoso. |
| `SCORING_ENGINE_DISABLED` | 503 | El motor está desactivado (`SCORING_ENGINE_DRIVER=disabled`): los cálculos quedan pendientes. |
| `CALCULATION_NOT_SUCCEEDED` | 409 | Se pidió el análisis de flags de un cálculo que no terminó bien. |
| `FLAG_ANALYSIS_NOT_RETRYABLE` | 409 | El análisis de flags ya terminó bien o sigue en curso. |
| `AI_DISABLED` | 503 | La IA está desactivada para este uso (`AI_*_PROVIDER=disabled`): los análisis quedan pendientes y el informe no se redacta. |
| `REVIEW_ALREADY_TAKEN` | 409 | Otra persona activa ya tomó el caso. |
| `REVIEW_TAKEN_BY_OTHER` | 403 | El caso es de otra persona: solo ella lo corrige, y solo un Aprobador lo libera. |
| `REVIEW_NOT_TAKEN` | 409 | Hay que tomar el caso antes de corregirlo. |
| `REVIEW_APPROVED` | 409 | El caso está aprobado: no admite correcciones, cambios en sus alertas, otro análisis de IA, otra aprobación ni (si no lo pide un Aprobador) un recálculo hasta reabrirlo. |
| `REVIEW_NOT_APPROVED` | 409 | El caso no tiene una aprobación vigente: se pidió reabrirlo, o redactar, aprobar, entregar o reenviar su informe. |
| `APPROVAL_REQUIREMENTS_NOT_MET` | 409 | El caso no se puede aprobar; `errors` trae lo que falta (`NO_CALCULATION`, `LATEST_CALCULATION_NOT_SUCCEEDED`, `CORRECTIONS_NOT_CALCULATED`, `FLAG_ANALYSIS_NOT_SUCCEEDED`, `OPEN_FLAGS`, `SIMULATED_RESULT`). |
| `REVIEW_VERSION_MISMATCH` | 412 | El caso cambió desde que se leyó (`If-Match` con una versión vieja): hay que volver a cargarlo. |
| `IF_MATCH_REQUIRED` | 428 | Falta `If-Match` con el ETag del caso (`GET /reviews/:id`), del informe (`GET /reviews/:id/report`), del pago (`GET /payments/:id`) o del resumen de pagos del lead (`GET /leads/:id/payment-summary`). No se acepta `*` ni un ETag débil. |
| `REPORT_ALREADY_EXISTS` | 409 | El caso ya tiene un informe: para redactarlo de nuevo, `POST /reviews/:id/report/regenerations`. |
| `REPORT_APPROVED` | 409 | El informe está aprobado: no admite ediciones, regeneraciones ni otra aprobación hasta que un Aprobador lo reabra. |
| `REPORT_NOT_APPROVED` | 409 | El informe está en borrador: se pidió reabrirlo o entregarlo. |
| `REPORT_DELIVERED` | 409 | El informe ya se entregó al cliente: no admite cambios ni se reabre. |
| `REPORT_DELIVERY_BLOCKED` | 409 | El caso tiene pendientes y el informe no se puede enviar; `errors` trae cuáles (los mismos de `APPROVAL_REQUIREMENTS_NOT_MET`). |
| `REPORT_EMAIL_FAILED` | 503 | El correo con el informe no salió: no quedó entregado y se puede reintentar. |
| `INVALID_REPORT_LINK` | 401 | Enlace de descarga del informe inválido, vencido o revocado. |
| `REPORT_PDF_INTEGRITY_FAILED` | 500 | El PDF generado no coincide con la huella anotada al entregarlo: no se entrega. |
| `REPORT_OUTDATED` | 409 | El borrador se redactó con una aprobación del caso que ya no es la vigente: hay que regenerarlo completo. |
| `REPORT_DIMENSIONS_MISSING` | 409 | El resultado aprobado no trae dimensiones con que redactar el informe. |
| `REPORT_VERSION_MISMATCH` | 412 | El informe cambió desde que se leyó (`If-Match` con una versión vieja): hay que volver a cargarlo. |
| `PAYMENT_PENDING_EXISTS` | 409 | El lead ya tiene un pago pendiente: hay que confirmarlo o anularlo antes de registrar otro. |
| `PAYMENT_REFERENCE_DUPLICATE` | 409 | Ya hay un pago no anulado con ese método y esa referencia (sin distinguir mayúsculas). |
| `PAYMENT_NOT_PENDING` | 409 | El pago ya está confirmado o anulado: no se confirma, anula ni edita. |
| `PAYMENT_VERSION_MISMATCH` | 412 | El pago cambió desde que se leyó (`If-Match` con una versión vieja): hay que volver a cargarlo. |
| `NO_CONFIRMED_PAYMENT` | 409 | Se pidió activar el diagnóstico de un lead sin pagos confirmados. |
| `LEAD_PAYMENTS_CHANGED` | 412 | Se confirmó otro pago del lead desde que se leyó su resumen: hay que volver a cargarlo antes de activar. |
| `AI_TASK_FAILED` | 503 | La IA no respondió o respondió algo que no cumple la forma pedida. No se guardó nada; queda en `ai_call_logs` y se puede reintentar. |
| `SERVICE_UNAVAILABLE` | 503 | La API o una dependencia no está disponible. |

Otro estado HTTP sin código propio recibe su frase en `UPPER_SNAKE_CASE`.
