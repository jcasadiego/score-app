# Cambio del formulario de leads al de SCORE (PF-83)

Guía paso a paso para pasar del formulario actual de Funnel Up al formulario
del sitio nuevo sin perder leads y sin que dejen de funcionar las
automatizaciones comerciales. Está escrita para que la siga cualquier persona
del equipo, sin conocimientos técnicos.

> No anotar aquí datos personales reales (nombres, correos, teléfonos), tokens
> ni identificadores de la cuenta de Funnel Up. Los resultados se anotan en el
> ticket PF-83 de Jira.

## 1. Qué cambia

| | Hoy | Después del cambio |
|---|---|---|
| Dónde llena el lead sus datos | Formulario de Funnel Up en `musicfinance.pro/form-aplic-3026` | Formulario del sitio nuevo (`score-sitio`) |
| Quién guarda el lead | Funnel Up, directo | SCORE, que lo envía a Funnel Up en segundos |
| Qué dispara las automatizaciones de Funnel Up | "Formulario enviado" | La etiqueta `score-lead` en el contacto |
| La dirección vieja | Muestra el formulario viejo | Redirige al formulario nuevo |

SCORE le manda a Funnel Up el nombre, el correo, el teléfono, la familia, los
UTM y el estado del recorrido (campo "Estado SCORE"), y le pone etiquetas:

- `score-lead`: al llegar el lead. **Es la que dispara las automatizaciones.**
- `score-informe-entregado`: cuando se entrega el informe, para el seguimiento.
- `score-qa`: solo en los leads de prueba que salen de QA.

Funnel Up nunca recibe las respuestas del diagnóstico, los resultados ni el
informe. La sincronización va en una sola dirección: lo que se cambie en Funnel
Up no vuelve a SCORE.

## 2. Quién hace qué

| Rol | Persona | Hace |
|---|---|---|
| Responsable del cambio | José | Coordina, hace las pruebas y decide si se avanza o se vuelve atrás |
| Proveedor de Funnel Up | El proveedor del cliente | Cambia los disparadores de las automatizaciones y la redirección |
| Responsable del sitio | El responsable de `score-sitio` | Publica el formulario nuevo y confirma los puntos de la sección 3.3 |
| Equipo comercial de MFP | Music Finance Pro | Confirma que los avisos y el seguimiento les llegan igual que antes |

## 3. Antes del cambio

### 3.1. Inventario (José, con el proveedor)

Completar en el ticket PF-83 (no aquí) qué pasa hoy cuando alguien envía el
formulario viejo:

| Automatización o flujo | Qué hace (aviso al equipo, correo o WhatsApp al lead, asignación a un vendedor, etc.) | Se dispara con | Nuevo disparador |
|---|---|---|---|
| (completar) | | Formulario enviado | Etiqueta `score-lead` |

Y qué campos pide el formulario viejo, para ver si alguno no existe en el nuevo:

| Campo del formulario viejo | ¿Lo pide el formulario nuevo? | Si no, qué se hace |
|---|---|---|
| Nombre | Sí | |
| Correo | Sí | |
| Teléfono | Sí (opcional) | |
| (completar) | | |

El formulario nuevo pide nombre, correo, teléfono (opcional) y familia
(Artista o proyecto, Empresa, Profesional, Catálogo o Evento), y toma los UTM
de la dirección por la que llegó el visitante. Un campo del formulario viejo
que no esté en el nuevo se pierde; si hace falta, se pide como cambio aparte.

### 3.2. Pedido al proveedor (por escrito)

Mandarlo por correo o por el canal del proveedor, y guardar su respuesta como
evidencia en PF-83. Texto sugerido:

> Vamos a reemplazar el formulario `/form-aplic-3026` por el del sitio nuevo.
> Los leads van a entrar a la misma subcuenta desde nuestra integración, ya no
> por el formulario. Necesitamos:
>
> 1. Que las automatizaciones que hoy se disparan con "formulario enviado" en
>    `/form-aplic-3026` (lista adjunta) se disparen con **la etiqueta
>    `score-lead` agregada al contacto**.
> 2. Que **ninguna** automatización se dispare si el contacto tiene la etiqueta
>    `score-qa` (son leads de prueba).
> 3. Que el seguimiento posterior a la entrega del informe se enganche a la
>    etiqueta `score-informe-entregado`.
> 4. Que el día del cambio, que acordamos con anticipación, la dirección
>    `/form-aplic-3026` redirija al formulario nuevo (les pasamos la dirección).
> 5. Que no borren ni renombren los campos "Estado SCORE", "Familia SCORE",
>    "UTM Source", "UTM Medium" y "UTM Campaign": la integración los usa.
>
> Por favor confírmennos por escrito cuando estén listos los puntos 1 a 3.

Los campos "Estado SCORE", "Familia SCORE" y los tres de UTM ya están creados
(2026-11-28).

**No se hace el cambio sin la confirmación escrita del proveedor.** Es el
riesgo principal: si las automatizaciones siguen esperando "formulario
enviado", los leads llegan al CRM pero nadie recibe el aviso.

### 3.3. Confirmar con el sitio (José, con el responsable de `score-sitio`)

- [ ] Si SCORE no responde o da error, el formulario muestra un mensaje de
      error con otra forma de contacto (correo o WhatsApp). **Nunca** dice
      "enviado" si no se envió.
- [ ] El aviso de privacidad del formulario dice que los datos van al CRM de
      Music Finance Pro para el seguimiento comercial.

### 3.4. Lista de requisitos

- [ ] Producción de SCORE funcionando (PF-74) y checklist del primer
      despliegue (PF-30).
- [ ] En la API de producción: Funnel Up activo, con su token propio de
      producción (otro distinto al de QA) y **sin** la etiqueta `score-qa`.
      Se carga a mano en Render y se prueba con `pnpm crm:check`.
- [ ] El origen del sitio nuevo está permitido en la API de producción
      (`CORS_ORIGINS`).
- [ ] Sitio nuevo publicado, con el formulario apuntando a la API de
      producción.
- [ ] Confirmación escrita del proveedor (3.2) y del sitio (3.3).
- [ ] Contrato de tratamiento de datos (DPA) de Funnel Up con Music Finance
      Pro firmado.
- [ ] Fecha y hora del cambio acordadas con el proveedor, en un horario de
      poco tráfico, con José disponible las dos horas siguientes.

## 4. Prueba en QA

QA escribe en la subcuenta real de Funnel Up: cada lead de prueba lleva la
etiqueta `score-qa`. Usar un correo propio, nunca uno de un cliente.

1. Abrir el formulario del sitio en QA con UTM de prueba (por ejemplo
   `?utm_source=prueba&utm_medium=qa&utm_campaign=corte-crm`) y enviarlo.
2. En el panel de SCORE de QA (Leads), abrir el lead: la sección CRM debe decir
   **Enviado** en menos de un minuto.
3. En Funnel Up, buscar el contacto por correo y revisar:
   - nombre y apellido, correo, teléfono;
   - "Estado SCORE" = Lead, "Familia SCORE" y los tres UTM;
   - etiquetas `score-lead` y `score-qa`.
4. Revisar que **no** se disparó ninguna automatización (por el punto 2 del
   pedido al proveedor).
5. Para probar el disparo: el proveedor quita por un momento la exclusión de
   `score-qa` en **una** automatización de aviso interno (nunca una que le
   escriba al lead), se repite el paso 1 con otro correo propio y se confirma
   que el aviso llegó. Luego el proveedor vuelve a poner la exclusión.
6. Borrar los contactos de prueba en Funnel Up.
7. Anotar el resultado en PF-83 (fecha, qué se probó, si pasó), sin correos.

Si algo falla, no se avanza al cambio: se revisa con el proveedor o se abre un
ticket.

## 5. El día del cambio

| # | Paso | Quién | Cómo se verifica |
|---|---|---|---|
| 1 | Confirmar que la lista 3.4 está completa | José | Todo marcado |
| 2 | Publicar el sitio nuevo con el formulario conectado a SCORE | Responsable del sitio | El formulario carga en la dirección pública |
| 3 | Enviar un lead de prueba real con un correo propio | José | Sección CRM del lead en el panel = Enviado; contacto en Funnel Up con `score-lead` |
| 4 | Confirmar que la automatización se disparó con ese lead | José y equipo comercial | Llegó el aviso al equipo, igual que antes |
| 5 | Activar la redirección de `/form-aplic-3026` | Proveedor | Abrir la dirección vieja en una ventana privada: termina en el formulario nuevo |
| 6 | Avisar al equipo comercial que el cambio está hecho | José | Mensaje enviado |
| 7 | Borrar el contacto de prueba del paso 3 | José | No aparece en Funnel Up |
| 8 | Anotar fecha, hora y resultado en PF-83 | José | Comentario en el ticket |

Si el paso 3 o el 4 fallan, **no** se activa la redirección (paso 5): el
formulario viejo sigue funcionando y no se pierde nada.

## 6. Los días siguientes (una semana)

Una vez al día, José:

1. En el panel de SCORE (Leads), filtrar por **Con error** en el CRM. Si hay
   alguno, abrirlo, ver el código y usar **Reintentar**. Anotar la causa en
   PF-83 (solo el tipo de error, nunca datos del lead). Si el panel dice que
   "SCORE no pudo conectarse con el CRM", el token de Funnel Up venció o se
   rotó: ver `docs/infra/rotacion-secretos.md`.
2. Comparar la **cantidad** de leads nuevos del día en SCORE con la de
   contactos nuevos con la etiqueta `score-lead` en Funnel Up. Deben coincidir
   (un lead que repite su correo actualiza el mismo contacto en vez de crear
   otro). Se comparan cantidades y fechas, sin exportar listas con datos
   personales.
3. Preguntar al equipo comercial si recibió los avisos como siempre.

Al terminar la semana sin diferencias, se cierra PF-83.

## 7. Cómo volver atrás

Si los leads no llegan al CRM o las automatizaciones no se disparan:

1. El proveedor **quita la redirección** de `/form-aplic-3026`: el formulario
   viejo vuelve a recibir leads directo en Funnel Up.
2. El responsable del sitio cambia el botón o el enlace del sitio nuevo para
   que lleve al formulario viejo.
3. El proveedor vuelve a poner el disparador "formulario enviado" en las
   automatizaciones (puede dejar también el de `score-lead`).
4. Los leads que entraron por el formulario nuevo mientras tanto están en
   SCORE: los que tengan error en el CRM se reintentan desde el panel cuando se
   resuelva la causa, y no se pierden.
5. Anotar en PF-83 qué pasó y la nueva fecha.

## 8. Derechos de las personas sobre sus datos

Después del cambio, cada lead está en **dos lugares**: SCORE y Funnel Up. Si
una persona pide ver, corregir o borrar sus datos:

- Se atiende en **los dos**. SCORE no corrige ni borra nada en Funnel Up por sí
  solo, porque la sincronización va en una sola dirección.
- En Funnel Up lo hace el equipo de Music Finance Pro o el proveedor, a mano,
  buscando el contacto por su correo.
- Si se borra en Funnel Up pero sigue en SCORE, un cambio de estado posterior
  lo volvería a crear: primero se resuelve en SCORE.
- Se anota la solicitud y la fecha en que quedó atendida en los dos sistemas,
  sin copiar los datos de la persona en el registro.

Lo que pasa con los datos en SCORE (cuánto tiempo se guardan y cómo se borran)
se define en PF-49.
