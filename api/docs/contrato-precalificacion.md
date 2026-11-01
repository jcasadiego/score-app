# Contrato: formulario de precalificación (`score-sitio` → `api`)

Único punto de contacto entre `score-sitio` y este repo (ver `CLAUDE.md`
sección 7). Cualquier cambio de campos, tipos, límites o códigos de
respuesta se coordina con José **antes** de mergear.

> **Cambio en curso (2026-10-31):** la api pasó a nombres en inglés
> (`CLAUDE.md`, sección 6). La ruta nueva es `POST
> /leads/prequalification`, documentada abajo. La ruta vieja `POST
> /leads/precalificacion` **sigue funcionando igual que antes** (mismos
> campos en español, misma respuesta `{ id, estado: "NUEVO" }` y mismos
> errores `{ statusCode, mensaje }`) hasta que el sitio migre; ver
> [Ruta vieja](#ruta-vieja-mientras-migra-el-sitio) al final.

## Endpoint

```
POST {API_URL}/api/v1/leads/prequalification
Content-Type: application/json
```

- Público: sin autenticación ni cookies (`credentials: 'omit'`).
- Se llama **desde el navegador**: el origen del sitio debe estar en
  `CORS_ORIGINS` de la api en cada entorno (QA y producción).
- Límite: **5 envíos por minuto por IP**. Los envíos con errores de
  validación también cuentan.

## Request

| Campo         | Tipo   | Requerido | Reglas                                                                  |
| ------------- | ------ | --------- | ----------------------------------------------------------------------- |
| `name`        | string | sí        | 2–120 caracteres. Se recortan y colapsan los espacios.                  |
| `email`       | string | sí        | Email válido, máx. 254. Se guarda recortado y en minúsculas.            |
| `phone`       | string | no        | 7–20 caracteres: dígitos, espacios, `-`, `(`, `)` y `+` inicial.        |
| `family`      | string | sí        | Uno de `PROJECT`, `B2B`, `PROFESSIONAL`, `CATALOG`.                     |
| `utmSource`   | string | no        | Máx. 200 caracteres.                                                    |
| `utmMedium`   | string | no        | Máx. 200 caracteres.                                                    |
| `utmCampaign` | string | no        | Máx. 200 caracteres.                                                    |

No se aceptan campos fuera de esta lista: si llega uno de más, la
respuesta es 400. Los campos opcionales que no tengan valor se **omiten**;
no se mandan como `""` (un teléfono vacío no pasa la validación).

```json
{
  "name": "Ana Pérez",
  "email": "ana@example.com",
  "phone": "+52 55 1234 5678",
  "family": "B2B",
  "utmSource": "instagram",
  "utmMedium": "social",
  "utmCampaign": "lanzamiento-2026"
}
```

## Respuestas

**201 Created**: lead registrado.

```json
{ "id": "cmvvrjrnl0000pbu0f2n0vkol", "status": "NEW" }
```

No se devuelven los datos enviados, y la respuesta es la misma aunque el
email ya haya precalificado antes. El `id` es el que usarán después
Pagos y Diagnóstico.

Todos los errores tienen la forma estándar de NestJS:
`{ statusCode, message, error }`.

**400 Bad Request**: faltan datos o están mal formados. Si los datos no
pasan la validación, `message` es una lista con un texto por cada
problema encontrado. Si el body ni siquiera es JSON válido, `message` es
un solo texto. El sitio tiene que aceptar los dos casos.

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "family must be one of the following values: PROJECT, B2B, PROFESSIONAL, CATALOG"
  ],
  "error": "Bad Request"
}
```

**429 Too Many Requests**: se pasó el límite. Mostrar un aviso del tipo
"Intenta de nuevo en un minuto".

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests",
  "error": "Too Many Requests"
}
```

**5xx**: error de la api. Mostrar un error genérico y permitir reintentar.

## Ejemplo (navegador)

```ts
const res = await fetch(`${API_URL}/api/v1/leads/prequalification`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(datos),
});
if (res.status === 201) {
  const { id } = await res.json();
} else if (res.status === 400) {
  const { message } = await res.json(); // string[] | string
} else if (res.status === 429) {
  // límite de envíos
}
```

Fuera de producción, el esquema también se puede ver en Swagger
(`/docs`, sección `leads`).

## Ruta vieja (mientras migra el sitio)

`POST {API_URL}/api/v1/leads/precalificacion` acepta exactamente el
contrato anterior: campos `nombre`, `email`, `telefono`, `familia`
(`PROYECTO`, `B2B`, `PROFESIONAL`, `CATALOGO`) y los UTM, mismo límite de
5 envíos por minuto, respuesta `201 { id, estado: "NUEVO" }` y errores
`{ statusCode, mensaje }`. Por dentro guarda el lead con los valores
nuevos (`CATALOGO` → `CATALOG`).

Para migrar el sitio: cambiar la ruta, renombrar los campos y los
valores de `familia`, leer `status` en vez de `estado` y `message` en vez
de `mensaje`. Cuando el sitio ya no use la ruta vieja, se borra
(`api/src/leads/legacy/`) — avisar a José para coordinarlo.

