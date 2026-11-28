# Secretos: dónde viven, quién los ve y cómo se rotan (PF-57)

Ningún secreto vive en el repo, que es público (decisión de José del
2026-11-04, `docs/compliance/control-matrix.md`): `render.yaml` solo declara las
variables (`sync: false` o `generateValue`) y gitleaks lo revisa en cada PR.

## Dónde viven y quién tiene acceso

| Entorno | Gestor | Quién accede |
|---|---|---|
| Local | `.env` de cada pieza (en `.gitignore`) | Quien desarrolla |
| QA | Variables de entorno de los servicios en Render (cifradas por Render) | La cuenta de Render de José |
| PROD | Variables de entorno en el workspace de Render del cliente (PF-74) | Miembros nominales del workspace, con 2FA; el cliente como Admin |

- Cada entorno tiene **sus propios valores**: nunca se copia un secreto de QA a PROD.
- `MFA_ENCRYPTION_KEY` de PROD además se respalda **fuera de Render**, en el
  lugar acordado con José (PF-74): si se pierde, todos deben reconfigurar su MFA.
- En PROD, ver un secreto en Render debe quedar en la bitácora de accesos del
  workspace, que trae el plan Pro: se activa y se comprueba con PF-74. La cuenta
  de QA no la tiene.

## Antes de rotar

- Generar el valor nuevo en una máquina de confianza y no pegarlo en chats,
  tickets ni PRs. `openssl rand -base64 32` para las llaves y secretos de firma.
- Rotar primero en QA, comprobar, y después en PROD.
- Anotar la rotación (fecha, secreto, motivo, quién) en el registro de cambios
  que se defina en PF-63. El valor nunca se anota.

## Cómo se rota cada uno

En Render, cambiar una variable redespliega el servicio. Donde dice "los dos
servicios", cambiarlos en la misma ventana de tiempo.

| Secreto | Servicios | Qué pasa al rotarlo |
|---|---|---|
| `MFA_ENCRYPTION_KEY` | api | Nadie pierde su MFA si se sigue el procedimiento de abajo |
| `JWT_SECRET` | api | Se cierran todas las sesiones del panel: cada persona vuelve a entrar con contraseña y código. También cambian las claves del límite de peticiones (los contadores arrancan de cero) |
| `ACCESS_LINK_JWT_SECRET` | api | Se cierran las sesiones de los clientes que están respondiendo. Las respuestas ya están guardadas: vuelven a abrir el mismo enlace del correo (el enlace se puede usar más de una vez mientras esté vigente) |
| `PANEL_API_SECRET` | api y panel | Mientras los dos no coinciden, la API no confía en la IP que informa el panel y cuenta el límite de login por la IP del servidor del panel: unos minutos de límite compartido, sin cortar el acceso. En Render el panel lo toma de la API (`fromService`): redesplegar el panel después de la API |
| `DIAGNOSTIC_API_SECRET` | api y diagnóstico | Igual que el anterior, para `apps/diagnostico` |
| `RESEND_API_KEY` | api | Crear la key nueva en Resend (solo envío, limitada al dominio), cargarla, comprobar un envío (`EMAIL_SENT` en la bitácora) y **después** revocar la vieja en Resend |
| `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | api | Igual que Resend: token nuevo de R2 limitado al bucket, cargar los dos valores, comprobar (`pnpm storage:test` o una grabación) y revocar el viejo |
| `CRM_FUNNELUP_TOKEN` | api | Cada 90 días (lo recomienda Funnel Up). En Funnel Up, Settings → Private Integrations → la integración → **Rotate and expire this token later**: el viejo sigue sirviendo 7 días. Cargar el nuevo, comprobar con `pnpm crm:check` y un lead de prueba, y si se filtró, **Rotate and expire this token now**. Mientras el token no sirve, los envíos fallan con `AUTH_FAILED` y quedan para reintentar desde el panel |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | api | Igual que Resend: key nueva, cargar, comprobar, revocar la vieja |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | api | Cambiar la contraseña del rol en Postgres (`ALTER ROLE ... PASSWORD`) y actualizar la URL en la misma ventana: entre medio, la API no conecta |

### `MFA_ENCRYPTION_KEY` sin afectar a nadie

Los secretos TOTP guardados llevan el id de la llave que los cifró (formato
`v2`). La API descifra con la llave actual o con una de
`MFA_ENCRYPTION_PREVIOUS_KEYS`, y al arrancar recifra todo con la actual
(`MfaKeyRotationService`).

1. Generar la llave nueva y respaldarla fuera de Render (PROD).
2. En la API, en un solo cambio:
   - `MFA_ENCRYPTION_PREVIOUS_KEYS` = la llave actual (si ya había anteriores,
     agregarla separada por coma).
   - `MFA_ENCRYPTION_KEY` = la llave nueva.
3. Al arrancar, el log dice `Secretos MFA recifrados con la llave actual: N` y
   queda `MFA_SECRETS_REENCRYPTED` en la bitácora con la cantidad.
4. Comprobar que un usuario con MFA entra normal.
5. Si el log no muestra `Secretos MFA que no se pudieron descifrar`, quitar
   `MFA_ENCRYPTION_PREVIOUS_KEYS` (vaciarla). Desde ahí la llave vieja ya no
   sirve: destruir su respaldo.

Si ese mensaje aparece, esos usuarios tienen un secreto cifrado con una llave
que no está configurada: el login con MFA les falla (nunca les da acceso) y un
Aprobador debe restablecerles el MFA desde el panel.

Los secretos en el formato anterior (`v1`, sin id de llave) se pasan a `v2` en
el primer arranque con esta versión, sin hacer nada.

## Si un secreto se filtra

1. **Rotarlo ya** en el entorno afectado, sin esperar a la ventana habitual.
   Para una key de un proveedor, revocarla en el proveedor de inmediato.
2. **Cortar lo que permitía:**
   - `JWT_SECRET` o `ACCESS_LINK_JWT_SECRET`: rotarlos ya cierra todas las
     sesiones.
   - `MFA_ENCRYPTION_KEY`: rotarla no basta, porque quien tenga la llave y una
     copia de la base puede descifrar los secretos TOTP. Restablecer el MFA de
     todos los usuarios.
   - `DATABASE_URL`: cambiar la contraseña del rol y revisar los accesos a la
     base en Render.
3. **Revisar el uso:** la bitácora (`audit_logs`) del periodo expuesto, los
   logs de Render y el panel del proveedor (envíos de Resend, uso de la key de
   IA, accesos al bucket).
4. **Avisar a José** y registrar el incidente según el plan de PF-63: qué se
   filtró, desde cuándo, qué se hizo y si hubo acceso a datos personales (puede
   obligar a notificar a los titulares).
5. Si el secreto llegó al repo: rotarlo igual (el historial público ya lo
   expuso) y no reescribir la historia de `main` sin acordarlo.

## Comprobar en QA (una vez por cada cambio de procedimiento)

- [ ] `MFA_ENCRYPTION_KEY`: rotar con los pasos de arriba, entrar con un
  usuario con MFA, quitar la llave anterior y volver a entrar.
- [ ] `JWT_SECRET`: tras rotar, la sesión abierta del panel pide volver a entrar.
- [ ] `ACCESS_LINK_JWT_SECRET`: tras rotar, el cliente vuelve a entrar con su
  enlace y ve sus respuestas.
- [ ] `PANEL_API_SECRET`: tras rotar en la API y redesplegar el panel, el login
  funciona.
- [ ] `RESEND_API_KEY`: con la key nueva sale un correo; la vieja quedó revocada.
