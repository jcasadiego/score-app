# Almacenamiento de objetos: bucket de R2 (PF-85)

Los audios de las respuestas por voz (P3, épica PF-84) viven en un bucket
privado de **Cloudflare R2**, compatible con S3. La API lo usa a través de
`src/storage` (puerto `StoragePort` y `StorageService`) y lo elige con
`STORAGE_DRIVER`. Aprobado por José el 2026-11-24.

| Ambiente | Cuenta | Bucket | Datos |
|---|---|---|---|
| Desarrollo y tests | — | — (`STORAGE_DRIVER=memory`, en el proceso) | De prueba |
| QA | Cloudflare de José | `score-voice-qa` | **Solo de prueba** |
| PROD | Cloudflare a nombre de Music Finance Pro, con DPA | Por crear junto a PF-74 | Reales |

## Crear el bucket (QA, y PROD con la cuenta de MFP)

1. En dash.cloudflare.com → **R2**. Para activar R2, Cloudflare pide un método
   de pago aunque se use la capa gratis (10 GB, sin costo de salida).
2. **Create bucket**: `score-voice-qa` (PROD: `score-voice-prod`). Ubicación
   automática o *North America* (cerca de Render en Virginia). La región que
   quede se anota en `docs/compliance/data-inventory.md`.
3. En el bucket → *Settings*:
   - **Public access**: desactivado, y la URL `r2.dev` **deshabilitada**. Sin
     dominio público. El navegador solo lee con una URL firmada de la API.
   - **CORS**: ninguno por ahora (la subida pasa por la API). Si PF-86 elige
     subida directa, se agrega solo el origen de `apps/diagnostico`.
   - **Object lifecycle rules** (respaldo de PF-90): regla *Delete objects*
     con prefijo `voice/` a los **365 días** desde la subida. La API borra
     antes (90 días tras entregar el informe o sin actividad, y los huérfanos
     al día). La regla cuenta desde la subida y no desde la entrega, por eso
     es más larga: con 120 días podía borrar antes de tiempo el audio de un
     caso lento (decidido por José el 2026-11-25). Solo atrapa lo que la
     aplicación no borró.
4. R2 cifra en reposo siempre (AES-256); no hay que activarlo.
5. **R2 → Manage API tokens → Create API token**:
   - Permiso **Object Read & Write**, aplicado **solo** a ese bucket.
   - Sin TTL o con el que se decida en la rotación de secretos (PF-57).
   - Copiar *Access Key ID*, *Secret Access Key* y el endpoint
     `https://<account-id>.r2.cloudflarestorage.com`. El secreto se muestra
     una sola vez.

## Un bucket por base de datos

La conservación de la voz (PF-90) borra los objetos de `voice/` que su base no
conoce (huérfanos). Si dos bases comparten un bucket, cada API borraría los
audios de la otra. Por eso cada ambiente tiene su bucket, y **la API local
nunca apunta al bucket de QA** con `STORAGE_DRIVER=s3`: en desarrollo se usa
`memory` (vacío). Para probar contra R2 en local, `pnpm storage:test` (no
necesita la base) o un bucket propio de desarrollo.

## Cargar las variables en Render

En la API del ambiente → *Environment* (nunca en el repo ni en el chat):

| Variable | Valor |
|---|---|
| `STORAGE_DRIVER` | `s3` (ya en `render.yaml`) |
| `STORAGE_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `STORAGE_S3_BUCKET` | `score-voice-qa` (ya en `render.yaml`) |
| `STORAGE_S3_ACCESS_KEY_ID` | La del token |
| `STORAGE_S3_SECRET_ACCESS_KEY` | La del token |

`STORAGE_S3_REGION` queda en `auto`. Con `STORAGE_DRIVER=s3` y alguna de
estas vacía, la API no arranca y dice cuál falta. **Cargarlas antes de
desplegar** el cambio que las exige.

## Verificar

- **Sin acceso anónimo:** `curl -I https://<account-id>.r2.cloudflarestorage.com/score-voice-qa/`
  debe responder `400` o `403`, nunca un listado ni `200`.
- **Con la llave:** en local, con las variables en `api/.env` (no se sube al
  repo), `pnpm storage:test` guarda, lee, firma, descarga y borra un objeto de
  prueba, y comprueba que sin firma el bucket rechaza leer y listar.

## Al recrear la base de QA (PF-70)

La base se recrea cada mes y pierde los registros de las grabaciones, pero el
bucket no. Esos objetos quedan huérfanos y la conservación de la voz (PF-90)
los borra en la primera pasada pasadas 24 horas. Para no esperar, vaciar el
bucket de QA en el mismo paso (*R2 → score-voice-qa → Delete objects*).
