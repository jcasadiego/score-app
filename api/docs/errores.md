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
| `FORBIDDEN` | 403 | El rol no alcanza. |
| `NOT_FOUND` | 404 | El recurso o la ruta no existe. |
| `CONFLICT` | 409 | Choca con el estado actual del recurso. |
| `TOO_MANY_REQUESTS` | 429 | Se pasó un límite de intentos. |
| `INTERNAL_ERROR` | 500 | Error no controlado; la causa queda en el log. |
| `SERVICE_UNAVAILABLE` | 503 | La API o una dependencia no está disponible. |

Otro estado HTTP sin código propio recibe su frase en `UPPER_SNAKE_CASE`.
