# Contrato: formulario de precalificación (`score-sitio` → `api`)

Único punto de contacto entre `score-sitio` y este repo (ver `CLAUDE.md`
sección 7). Cualquier cambio de campos, tipos, límites o códigos de
respuesta se coordina con José **antes** de mergear.

## Endpoint

```
POST {API_URL}/api/v1/leads/precalificacion
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
| `nombre`      | string | sí        | 2–120 caracteres. Se recortan y colapsan los espacios.                  |
| `email`       | string | sí        | Email válido, máx. 254. Se guarda recortado y en minúsculas.            |
| `telefono`    | string | no        | 7–20 caracteres: dígitos, espacios, `-`, `(`, `)` y `+` inicial.        |
| `familia`     | string | sí        | Uno de `PROYECTO`, `B2B`, `PROFESIONAL`, `CATALOGO`.                    |
| `utmSource`   | string | no        | Máx. 200 caracteres.                                                    |
| `utmMedium`   | string | no        | Máx. 200 caracteres.                                                    |
| `utmCampaign` | string | no        | Máx. 200 caracteres.                                                    |

No se aceptan campos fuera de esta lista: si llega uno de más, la
respuesta es 400. Los campos opcionales que no tengan valor se **omiten**;
no se mandan como `""` (un teléfono vacío no pasa la validación).

```json
{
  "nombre": "Ana Pérez",
  "email": "ana@example.com",
  "telefono": "+52 55 1234 5678",
  "familia": "B2B",
  "utmSource": "instagram",
  "utmMedium": "social",
  "utmCampaign": "lanzamiento-2026"
}
```

## Respuestas

**201 Created**: lead registrado.

```json
{ "id": "cmvvrjrnl0000pbu0f2n0vkol", "estado": "NUEVO" }
```

No se devuelven los datos enviados, y la respuesta es la misma aunque el
email ya haya precalificado antes. El `id` es el que usarán después
Pagos y Diagnóstico.

**400 Bad Request**: faltan datos o están mal formados. Si los datos no
pasan la validación, `mensaje` es una lista con un texto por cada
problema encontrado. Si el body ni siquiera es JSON válido, `mensaje` es
un solo texto. El sitio tiene que aceptar los dos casos.

```json
{
  "statusCode": 400,
  "mensaje": [
    "email must be an email",
    "familia must be one of the following values: PROYECTO, B2B, PROFESIONAL, CATALOGO"
  ]
}
```

**429 Too Many Requests**: se pasó el límite. Mostrar un aviso del tipo
"Intenta de nuevo en un minuto".

```json
{ "statusCode": 429, "mensaje": "ThrottlerException: Too Many Requests" }
```

**5xx**: error de la api. Mostrar un error genérico y permitir reintentar.

## Ejemplo (navegador)

```ts
const res = await fetch(`${API_URL}/api/v1/leads/precalificacion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(datos),
});
if (res.status === 201) {
  const { id } = await res.json();
} else if (res.status === 400) {
  const { mensaje } = await res.json(); // string[] | string
} else if (res.status === 429) {
  // límite de envíos
}
```

Fuera de producción, el esquema también se puede ver en Swagger
(`/docs`, sección `leads`).
