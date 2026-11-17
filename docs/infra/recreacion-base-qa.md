# Recreación mensual de la base de QA (PF-70)

La base gratuita de Render (`score-qa-db`) **vence a los 30 días** de creada.
Después hay 14 días de gracia y luego Render la borra. El workspace admite una
sola base gratuita, así que cada mes se borra la vieja y se crea otra. QA pierde
todos sus datos en cada recreación: se aceptó así (PF-70, fuera de alcance), y
la salida, si recrearla resulta molesto, es la base de $6/mes
(`investigacion-despliegue.md`, secciones 1 y 10).

QA solo tiene datos de prueba. **Nunca se carga una copia de PROD** (PF-56).

## Cuándo

- Fecha de vencimiento: en el panel de Render, `score-qa-db` → *Info*. Se anota
  en PF-70 y en el calendario del equipo, con un recordatorio unos días antes.
  Render también avisa por correo.
- Conviene recrearla antes de que venza: si vence, la API no arranca y el
  panel y el diagnóstico quedan sin datos hasta terminar estos pasos. No hay
  nada que recuperar.

## Qué se pierde y qué se conserva

| Se pierde (vive en la base) | Se conserva (vive en Render) |
|---|---|
| Usuarios, su MFA y sus sesiones | Variables de la API: secretos JWT, `MFA_ENCRYPTION_KEY`, Resend, `ADMIN_*` |
| Leads, diagnósticos, revisiones, informes y bitácora | Los tres servicios, sus deploy hooks y el ambiente `qa` de GitHub |
| Cuestionarios (el de prueba se vuelve a sembrar) | El código: el arranque migra y siembra solo |

## Pasos

Los pasos en Render los hace el dueño de la cuenta. Ninguna credencial pasa por
GitHub, por un chat ni por un archivo del repo.

1. **Borrar la base vieja.** Render → `score-qa-db` → *Settings* → *Delete
   Database*.
2. **Crear la nueva**, con la misma configuración que `render.yaml`. Con el
   Blueprint: *Blueprints* → el de `score-app` → *Manual sync* y aplicar (la
   vuelve a crear). Si no aparece, crearla a mano:
   - Nombre `score-qa-db`, base `score`, usuario `score`.
   - Región Virginia, PostgreSQL 16, plan Free.
   - *Access Control*: sin IPs permitidas (solo red privada).
3. **Armar las dos URLs** a partir de la *Internal Database URL* de la base
   nueva (`postgresql://score:<clave>@<host>/score`). A las dos se les agrega
   `?sslmode=require&uselibpqcompat=true`; sin `uselibpqcompat`, `pg` rechaza el
   certificado de la red interna.
   - `MIGRATION_DATABASE_URL`: la URL interna tal cual, más esos parámetros.
     Es el dueño del esquema.
   - `DATABASE_URL`: el mismo host y la misma base, pero con el rol de la API
     (sin DDL, PF-58). El arranque crea ese rol con el usuario y la contraseña
     que lleve esta URL. Usuario: el de siempre (por ejemplo `score_api`).
     Contraseña nueva en cada recreación: `openssl rand -hex 24` (hexadecimal
     para no tener que codificarla en la URL).
4. **Cargarlas en la API.** Render → `score-api-qa` → *Environment* → cambiar
   las dos variables → *Save, rebuild, and deploy*.
5. **Verificar el arranque.** En los logs de `score-api-qa` deben aparecer, en
   orden: `aplicando migraciones`, `aplicando los permisos del rol de la API`,
   `sembrando el primer Aprobador y el cuestionario de prueba` y
   `levantando la API`. Luego `GET https://score-api-qa.onrender.com/health`
   responde `{"status":"ok","commit":"<sha de develop>"}`.
6. **Entrar como Aprobador.** En el panel, con `ADMIN_EMAIL` y
   `ADMIN_PASSWORD`: configurar el MFA de nuevo (la base no lo recuerda) y
   guardar los códigos de recuperación. Después cambiar la contraseña con
   *¿Olvidaste tu contraseña?*, porque `ADMIN_PASSWORD` vive en Render.
7. **Comprobar los datos sembrados.** En *Cuestionario* aparece el cuestionario
   de prueba publicado.
8. **Volver a dar de alta al equipo.** Panel → *Usuarios* → crear cada usuario
   con su rol. Cada uno recibe por correo el enlace para elegir su contraseña y
   configura su MFA al entrar. Mientras QA envíe desde `onboarding@resend.dev`,
   Resend solo entrega al dueño de la cuenta de Resend: hace falta un dominio
   verificado para el resto (PF-72).
9. **Anotar el próximo vencimiento** (30 días después de hoy) en PF-70 y en el
   calendario.

## Si algo falla

- **La API no arranca y el log dice que falta una variable o que no exige TLS:**
  revisar que las dos URLs lleven `sslmode=require&uselibpqcompat=true`.
- **`password authentication failed` con el rol de la API:** la contraseña de
  `DATABASE_URL` tiene caracteres que hay que codificar. Generarla otra vez en
  hexadecimal.
- **La siembra rechaza `ADMIN_PASSWORD`:** la contraseña está en la lista de
  contraseñas filtradas o no cumple el largo. Cambiarla en Render y redesplegar.
- **El panel dice que la API está iniciando:** la instancia gratuita tarda unos
  80 segundos en despertar y migrar. Esperar y reintentar.

## Historial

| Fecha | Qué | Vence (más 14 días de gracia) |
|---|---|---|
| 2026-11-15 | Primera carga (PF-68, PF-69) | 2026-12-15 |
| 2026-11-17 | Recreación de prueba del procedimiento (PF-70): arranque con las cuatro líneas de `start-qa:`, Aprobador con MFA nuevo y cuestionario de prueba visible en el panel | 2026-12-17 (estimado: confirmar en *Info* de la base) |
