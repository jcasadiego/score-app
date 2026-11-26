# Respaldos y restauración de la base (PF-56)

Procedimiento para la base de PROD, que todavía no existe (PF-74). Hasta que
exista y se haga una restauración de verdad, este documento es el plan, no la
evidencia: lo marcado **Por comprobar** se cierra en el simulacro de la última
sección. Datos de los proveedores: `investigacion-despliegue.md`, sección 4.4.

## Qué se respalda y qué no

| Qué | Dónde vive | Respaldo |
|---|---|---|
| Base de datos: leads, diagnósticos, respuestas, informes, usuarios, `audit_logs` | Render Postgres (PROD, workspace del cliente) | Tendrá restauración a un punto en el tiempo (PITR) de Render, de 7 días con el plan Pro previsto (PF-74) |
| Audio de las respuestas por voz | Bucket de R2 | **Sin respaldo:** si se borra, se pierde. La regla de ciclo de vida de 365 días es un borrado, no una copia (PF-90) |
| `MFA_ENCRYPTION_KEY` | Variable de la API | Respaldo fuera de Render, en el lugar que acuerde José (PF-74, `rotacion-secretos.md`). Sin ella, un respaldo de la base restaura los usuarios, pero nadie puede usar su MFA |
| Resto de los secretos | Variables de Render | No se respaldan: se generan de nuevo (`rotacion-secretos.md`) |
| Exportación lógica manual (`pg_dump`) antes de una migración *contract* (`investigacion-despliegue.md` 4.2) | La exportación de Render, que la guarda 7 días | Se hace desde Render y queda ahí. Nunca se descarga a GitHub, QA ni un equipo personal. Si hiciera falta guardarla más tiempo, va a un destino cifrado del cliente que antes se anota en `data-inventory.md` |

**Los respaldos contienen datos personales y la bitácora:** se tratan igual que
la base.
- Solo los restauran los miembros nominales del workspace del cliente, con 2FA.
- Lo borrado en la base, incluido lo borrado por plazo o a pedido del titular
  (PF-49), sigue en el PITR hasta 7 días: es el plazo máximo de los respaldos.
- Una copia de PROD nunca sale del workspace del cliente, y nunca va a QA ni a
  GitHub. Hasta que haya un procedimiento de anonimización que corra dentro de
  ese workspace, no se usan datos de PROD para pruebas.

## Estado por entorno

- **QA:** la base gratuita de Render no tiene respaldos. Si se pierde, se
  recrea con `recreacion-base-qa.md`: solo tiene datos de prueba.
- **PROD:** según el plan previsto (PF-74), base de pago de Render en el
  workspace del cliente, con PITR de 7 días y cifrado AES-256 en reposo según
  la documentación de Render. **Por comprobar** al crearla:
  - Que el plan incluye PITR y que está activo.
  - Que el cifrado en reposo cubre también los respaldos. Guardar como
    evidencia la captura o la página de Render, con fecha.
  - Cómo avisa Render si un respaldo falla, y a quién.

## Objetivos de recuperación (propuesta, pendiente de aprobar)

| | Propuesta | Por qué |
|---|---|---|
| **RPO** (cuántos datos se pueden perder) | 1 hora | El PITR de Render es continuo; queda margen para elegir el momento justo antes del problema |
| **RTO** (cuánto puede tardar volver a operar) | 4 horas en horario laboral | Restaurar a una instancia nueva, verificarla y cambiar la conexión de la API. SCORE no atiende pagos en línea ni tiene uso nocturno crítico |

Límites que se aprueban junto con los números:
- Un daño que se detecte después de 7 días ya no se puede deshacer con el PITR.
- Si se pierde la cuenta de Render o su región, no hay copia fuera del
  proveedor (ver "Pendiente de decidir").

Los aprueba José, con el cliente, y se anotan aquí con la fecha. Si el
simulacro tarda más que el RTO, se revisa el número o el procedimiento.

## Cuándo restaurar

- Pérdida o corrupción de datos (una migración que salió mal, un borrado por
  error). Antes de restaurar, intentar corregir con una migración o con los
  pasos de `investigacion-despliegue.md` 4.3: restaurar pierde todo lo escrito
  desde el punto elegido.
- Base caída sin recuperación del lado de Render.
- Incidente de seguridad que alteró datos: primero se preserva la evidencia
  (la base afectada no se borra mientras dure el incidente) y se sigue el plan
  de incidentes (PF-63).

## Procedimiento de restauración (PROD)

1. **Decidir el punto:** la hora justo antes del problema, en UTC. Para una
   migración, la hora anotada antes de aprobar el despliegue
   (`investigacion-despliegue.md` 4.2). Anotar quién decide y por qué.
2. **Detener las escrituras.** Suspender la API en Render, para que no escriba
   en la base vieja mientras se restaura. El panel y el diagnóstico muestran
   error mientras tanto.
3. **Restaurar a una instancia nueva**, desde la base en Render → *Recovery*,
   con el punto elegido. Render no restaura en el sitio: crea otra base en la
   misma región.
4. **Revisar la base nueva** antes de usarla, con conteos, ids y fechas
   (`created_at`), nunca con columnas de contenido:
   - Que estén los últimos registros esperados antes del punto (por ejemplo, el
     último id y la última fecha de `leads` y de `audit_logs`).
   - Que `_prisma_migrations` esté en la versión esperada.
   - Que existan los roles. **Por comprobar:** si el rol de la API (PF-58) y su
     contraseña vienen en la restauración. Si no, correr
     `scripts/db-app-role.ts` desde el job de migraciones contra la base nueva.
   - Si para revisar hay que abrir el acceso externo a una IP, abrirlo solo a
     esa IP, cerrarlo al terminar y anotarlo en el registro del paso 8
     (`investigacion-despliegue.md` 11.2). Al final, el acceso externo debe
     quedar cerrado.
5. **Volver a aplicar los borrados** hechos después del punto restaurado, que
   la restauración trajo de vuelta:
   - Audio de voz: la siguiente pasada de `VoiceRetentionService` borra lo que
     esté vencido. Las grabaciones cuyo objeto ya no existe en R2 se ven en la
     bitácora de la base vieja (`VOICE_AUDIO_DELETED` después del punto) y se
     marcan con `audio_deleted_at`.
   - Borrados a pedido del titular (cuando exista PF-49): repetirlos a partir
     de la bitácora de la base vieja.
6. **Cambiar la conexión:** `DATABASE_URL` de la API y
   `MIGRATION_DATABASE_URL` del job de migraciones a la base nueva. Volver a
   levantar la API y comprobar `GET /health`, el login del panel y un
   diagnóstico abierto.
7. **Conservar la base vieja**, sin conexiones:
   - Si no hubo incidente, al menos 7 días.
   - Si hubo incidente, hasta que lo cierre el plan de incidentes (PF-63).
   - Antes de borrarla, exportar dentro del workspace del cliente los
     `audit_logs` escritos después del punto restaurado, con la misma custodia
     que un respaldo: son la evidencia de lo que pasó. Después, borrarla.
8. **Registrar:** hora de inicio y de fin, punto restaurado, qué se perdió, qué
   borrados se repitieron, accesos externos abiertos y cerrados, quién lo hizo
   y el resultado. Avisar a José, y al cliente si hubo pérdida de datos de sus
   clientes.

## Simulacro (antes del primer release y una vez al año)

Hacer los pasos 1, 3 y 4 sobre PROD, sin detener la API ni cambiar la
conexión. La restauración queda en una instancia temporal del mismo workspace,
que se cobra por el tiempo que exista.

- [ ] PITR activo y cifrado en reposo confirmados, con evidencia guardada.
- [ ] Restauración a una instancia temporal: anotar cuánto tardó.
- [ ] Revisión del paso 4 completa, incluidos los roles, solo con conteos, ids
  y fechas.
- [ ] Instancia temporal borrada el mismo día y acceso externo cerrado.
- [ ] Duración comparada con el RTO; RTO y RPO aprobados por José.
- [ ] `docs/compliance/control-matrix.md` actualizado con la fecha y el
  resultado.

## Pendiente de decidir

- Si se quiere además una copia fuera de Render (exportación lógica periódica
  y cifrada a un bucket del cliente). Sería otro control, otro costo y otro
  destino de datos personales que habría que anotar en el inventario. Hoy no
  se hace.
- Cuánto tiempo se conservan los respaldos por obligación legal: depende de
  PF-49.
