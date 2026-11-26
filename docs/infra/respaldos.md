# Respaldos y restauración de la base (PF-56)

Procedimiento para la base de PROD, que todavía no existe (PF-74). Hasta que
exista y se haga una restauración de verdad, este documento es el plan, no la
evidencia: los puntos marcados **Por comprobar** se cierran en el simulacro de
la última sección. Datos de los proveedores: `investigacion-despliegue.md`,
sección 4.4.

## Qué se respalda y qué no

| Qué | Dónde vive | Respaldo |
|---|---|---|
| Base de datos: leads, diagnósticos, respuestas, informes, usuarios, `audit_logs` | Render Postgres (PROD, workspace del cliente) | Restauración a un punto en el tiempo (PITR) de Render, 7 días con el plan Pro |
| Audio de las respuestas por voz | Bucket de R2 | Fuera de este procedimiento: regla de ciclo de vida de 365 días y borrado por plazo (PF-90) |
| `MFA_ENCRYPTION_KEY` | Variable de la API | Respaldo fuera de Render, en el lugar acordado con José (PF-74, `rotacion-secretos.md`). Sin ella, un respaldo de la base restaura los usuarios, pero nadie puede usar su MFA |
| Resto de los secretos | Variables de Render | No se respaldan: se generan de nuevo (`rotacion-secretos.md`) |

**Los respaldos contienen datos personales y la bitácora:** se tratan igual que
la base.
- Solo los restauran los miembros nominales del workspace del cliente, con 2FA.
- No se descargan a equipos personales.
- Una copia de PROD nunca va a QA ni a GitHub. Para probar con datos parecidos,
  se anonimizan antes, fuera de PROD.

## Estado por entorno

- **QA:** la base gratuita de Render no tiene respaldos. Si se pierde, se
  recrea con `recreacion-base-qa.md`: solo tiene datos de prueba.
- **PROD:** base de pago de Render en el workspace del cliente, con PITR de 7
  días y cifrado AES-256 en reposo según la documentación de Render. **Por
  comprobar:**
  - Que el plan contratado incluye PITR y que está activo.
  - Que el cifrado en reposo cubre también los respaldos. Guardar como
    evidencia la captura o la página de Render, con fecha.
  - Cómo avisa Render si un respaldo falla, y a quién.

## Objetivos de recuperación (propuesta, pendiente de aprobar)

| | Propuesta | Por qué |
|---|---|---|
| **RPO** (cuántos datos se pueden perder) | 1 hora | El PITR de Render es continuo; queda margen para elegir el momento justo antes del problema |
| **RTO** (cuánto puede tardar volver a operar) | 4 horas en horario laboral | Restaurar a una instancia nueva, verificarla y cambiar la conexión de la API; SCORE no atiende pagos en línea ni tiene uso nocturno crítico |

Los aprueba José, con el cliente, y se anotan aquí con la fecha. Si el
simulacro tarda más que el RTO, se revisa el número o el procedimiento.

## Cuándo restaurar

- Pérdida o corrupción de datos (una migración que salió mal, un borrado por
  error). Antes de restaurar, intentar corregir con una migración o los pasos
  de `investigacion-despliegue.md` 4.3: restaurar pierde todo lo escrito
  desde el punto elegido.
- Base caída sin recuperación del lado de Render.
- Incidente de seguridad que alteró datos: primero se preserva la evidencia
  (no se borra la base afectada) y se sigue el plan de incidentes (PF-63).

## Procedimiento de restauración (PROD)

1. **Decidir el punto:** la hora justo antes del problema (UTC). Para una
   migración, la hora anotada antes de aprobar el despliegue
   (`investigacion-despliegue.md` 4.2). Anotar quién decide y por qué.
2. **Detener las escrituras.** Suspender la API en Render, para que no escriba
   en la base vieja mientras se restaura. El panel y el diagnóstico muestran
   error mientras tanto.
3. **Restaurar a una instancia nueva**, desde la base en Render → *Recovery*,
   con el punto elegido. Render no restaura en el sitio: crea otra base en la
   misma región.
4. **Revisar la base nueva** antes de usarla:
   - Ver que estén las últimas filas esperadas antes del punto (último lead,
     último registro de `audit_logs`).
   - Ver que `_prisma_migrations` esté en la versión esperada.
   - Ver que los roles existan. **Por comprobar:** si el rol de la API (PF-58)
     y su contraseña vienen en la restauración. Si no, correr
     `scripts/db-app-role.ts` desde el job de migraciones contra la base nueva.
   - Ver que el acceso externo siga cerrado (sin IP permitidas).
5. **Cambiar la conexión:** `DATABASE_URL` de la API y
   `MIGRATION_DATABASE_URL` del job de migraciones a la base nueva. Volver a
   levantar la API y comprobar `GET /health`, el login del panel y un
   diagnóstico abierto.
6. **Conservar la base vieja** al menos 7 días, sin conexiones, por si hace
   falta comparar o como evidencia de un incidente. Después, borrarla.
7. **Registrar:** hora de inicio y de fin, punto restaurado, qué se perdió,
   quién lo hizo y el resultado. Avisar a José, y al cliente si hubo pérdida
   de datos de sus clientes.

## Simulacro (antes del primer release y una vez al año)

Hacer los pasos 1, 3 y 4 sobre PROD, sin detener la API ni cambiar la
conexión. La restauración queda en una instancia temporal del mismo workspace;
se cobra por el tiempo que exista.

- [ ] PITR activo y cifrado en reposo confirmados, con evidencia guardada.
- [ ] Restauración a una instancia temporal: anotar cuánto tardó.
- [ ] Revisión del paso 4 completa, incluidos los roles.
- [ ] Instancia temporal borrada el mismo día.
- [ ] Duración comparada con el RTO; RTO y RPO aprobados por José.
- [ ] `docs/compliance/control-matrix.md` actualizado con la fecha y el
  resultado.

## Pendiente de decidir

- Si se quiere además una copia fuera de Render (exportación lógica periódica
  y cifrada a un bucket del cliente). Sería otro control y otro costo; hoy no
  se hace.
- Cuánto tiempo se conservan los respaldos por obligación legal: depende de
  PF-49.
