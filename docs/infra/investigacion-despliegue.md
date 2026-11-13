# Investigación de despliegue de SCORE (QA y PROD)

- **Fecha de verificación de precios y límites:** 2026-11-13. Todo dato de
  proveedor sale de su página oficial (sección 12). Los precios están en USD,
  sin impuestos.
- **Alcance:** solo investigación. No se creó ninguna cuenta, no se desplegó
  nada y no se tocó código. Alimenta PF-30 (hosting sin definir) y PF-56
  (cifrado y respaldos).
- **Supuestos confirmados por José:** región EE. UU. (este); QA solo con datos
  de prueba; PROD sin tope de costo (lo más simple de mantener).
- **Cómo leer las marcas:** "no confirmado" = la página oficial no lo dice o no
  se pudo leer; "estimación" = cálculo nuestro a partir de precios unitarios
  oficiales.

> **Aviso sobre los precios de Render.** La página `render.com/pricing` carga
> sus tablas con JavaScript y no se pudo leer directamente. Sus precios vienen
> de extractos del buscador sobre páginas de `render.com`, y hay un conflicto
> ($6 o $7 para la base más pequeña). Hay que **reconfirmarlos en pantalla
> antes de presentarle la propuesta al cliente**. Los de Railway, Fly.io,
> Neon, Vercel, Supabase y DigitalOcean sí se leyeron directamente.

## 0. Lo que el código exige del hosting

Se revisó el código antes de comparar plataformas. Varias necesidades del
pedido original resultan distintas a lo esperado:

| Necesidad supuesta | Lo que hay en el código | Consecuencia |
|---|---|---|
| El PDF necesita navegador headless | No. Usa `pdfkit` (`api/src/reports/pdf/report-pdf.ts`), JavaScript puro | Ninguna plataforma queda descartada por el PDF |
| Guardar los PDF generados | **No se guardan.** Se regeneran a pedido desde la aprobación y deben dar la misma huella (`ReportDelivery.pdfSha256`) | **Hoy no hace falta almacenamiento de archivos.** Se deja evaluado para el futuro (sección 2.5) |
| Tareas programadas (abandono a 7 días, vencimiento de enlaces) | No hay ninguna. "Abandonado" se calcula al leer (`api/src/diagnostics/diagnostic-status.ts`) y los enlaces vencen por `expiresAt` | Hoy no hace falta cron. Hará falta para la retención automática de PF-49 |
| Procesos en segundo plano (motor, IA, correos) | Corren **dentro del proceso de la API**, sin cola ni Redis (`void this.process(...)` en `calculations.service.ts`, `flags.service.ts`, `notifications.service.ts`). Lo pendiente se retoma al arrancar (`onApplicationBootstrap`) | La API necesita un **proceso de larga duración**: no sirve como funciones serverless. Una plataforma que la duerma o la detenga corta el trabajo a medias (se retoma al volver a arrancar). Las llamadas de IA duran hasta 60 s (`AI_TIMEOUT_MS`) |

Otras restricciones que salen del código y de PF-30:

- **Una sola instancia de la API.** El límite de intentos y los contadores
  viven en memoria; escalar a más instancias exige PF-60.
- **`TRUST_PROXY_HOPS` exacto.** La API no arranca en producción sin el número
  exacto de proxies delante. Ningún proveedor lo documenta: se mide en QA
  (ya es un criterio de PF-30).
- **El navegador nunca llama a la API** desde el panel ni desde el diagnóstico:
  todo pasa por el servidor de Next. CORS solo importa para `score-sitio`.
- **No hay Dockerfile** en ninguna pieza. Las plataformas con build nativo de
  Node no lo necesitan; Fly.io y un VPS sí.
- **Prisma 7.10** con `@prisma/adapter-pg`; 26 migraciones en
  `api/prisma/migrations`; el CI ya corre `prisma migrate deploy`.
- **El repositorio es público** y de una cuenta personal. Eso habilita gratis
  las reglas de protección de ambientes de GitHub (sección 3).

## 1. Resumen y recomendación

**Recomendación: todo en Render** (panel, diagnóstico, API y PostgreSQL), en la
región de Virginia, con la misma configuración en QA y en PROD y solo el plan
como diferencia.

| Pieza | QA (cuenta nuestra) | PROD (cuenta del cliente) |
|---|---|---|
| Workspace | Hobby, $0 | Pro, $25/mes fijo, miembros ilimitados |
| `apps/panel` | Web service Starter (0,5 CPU / 512 MB), ~$7 | Igual, ~$7 |
| `apps/diagnostico` | Web service Starter, ~$7 | Igual, ~$7 |
| `api` | Web service Starter, ~$7, siempre encendida, 1 instancia | Starter ~$7, o Standard (1 CPU / 2 GB, precio no confirmado) si la memoria no alcanza |
| PostgreSQL | Render Postgres 256 MB, ~$6 + $0,30/GB | Render Postgres 1 GB, ~$19 + $0,30/GB |
| Segundo plano | Dentro de la API (como hoy) | Igual |
| Tareas programadas | No hacen falta hoy | Cron de Render (mínimo $1/mes) cuando llegue PF-49 |
| Archivos | No hacen falta hoy | Cloudflare R2 si algún día se guardan PDF |
| Restauración a un punto en el tiempo | 3 días (plan Hobby) | 7 días (plan Pro) |
| **Total estimado** | **~$27/mes** | **~$67/mes** (con la API en Starter) |

Aparte del hosting, en ambos ambientes: Resend (gratis hasta 3.000
correos/mes; Pro $20), Sentry (gratis para 1 usuario; Team $29; pendiente de
que José lo apruebe, pregunta 4) y un monitor de caídas (UptimeRobot,
gratis). La API de Anthropic se paga por uso.

**Por qué esta opción:**

1. **Un solo proveedor, un solo panel, una sola factura y un solo contrato de
   datos.** Es lo más simple de mantener y de entregarle al cliente.
2. **Cumple lo que el código exige:** servicios de larga duración que no se
   duermen (en plan de pago), una instancia, despliegue sin cortes y hasta
   300 s de espera al apagar para terminar trabajos en curso.
3. **Base gestionada de verdad:** cifrado AES-256 en reposo, restauración a un
   punto en el tiempo en todos los planes de pago y PgBouncer sin costo.
4. **Mismas herramientas en QA y en PROD.** Lo que se ensaya en QA es lo que
   corre en PROD.
5. **Documentación de seguridad disponible:** informa SOC 2 Tipo 2 e ISO 27001
   propios y ofrece DPA a todo workspace (esto describe al proveedor, no a
   SCORE; ver CLAUDE.md 5.2).

**Por qué no un plan gratuito para QA.** Ninguno sirve como "muestra estable":

- Render gratis: el servicio se duerme a los 15 minutos y tarda cerca de un
  minuto en despertar; la base gratuita **se borra** a los 30 días (más 14 de
  gracia). Su documentación dice "Do not use them for production applications".
- Vercel Hobby: sus términos lo limitan a "personal or non-commercial use"
  (sección 2.4). No aplica a un producto para un cliente.
- Fly.io: ya no tiene plan gratuito para organizaciones nuevas.
- Supabase gratis: pausa el proyecto tras 1 semana sin actividad.
- Railway gratis: $1 de crédito al mes y 0,5 GB por servicio; no alcanza.

**Sobre alinear con `score-sitio` (Vercel).** No conviene mover estas tres
piezas a Vercel: la API no puede ir ahí (necesita proceso de larga duración),
así que igual habría un segundo proveedor, y Vercel exige el plan Pro ($20/mes)
también para QA. **Pregunta abierta importante:** si `score-sitio` está hoy en
el plan Hobby, ese uso probablemente tampoco encaja en los términos de Vercel
(sección 7).

## 2. Comparativa de combinaciones

### 2.1. Tabla comparativa

| | **A. Render todo en uno** (recomendada) | **B. Railway + Neon** | **C. Vercel + Fly.io + Neon** | **D. VPS + Coolify** (solo referencia) |
|---|---|---|---|---|
| Proveedores | 1 | 2 | 3 | 1 + operación propia |
| Costo QA / mes | ~$27 | ~$16 (estimación) | ~$24 | ~$29–31 |
| Costo PROD / mes | ~$67 | ~$40 (estimación) | ~$46 (+$29 si se quiere soporte por correo en Fly) | ~$29–31 + nuestro tiempo |
| Precios leídos directamente | No (ver aviso) | Sí | Sí | Sí |
| ¿La API se duerme? | No en plan de pago | No, salvo que se active "Serverless" | No, si se desactiva `auto_stop_machines` | No |
| Base de datos | Gestionada, PITR 3/7 días, AES-256 | Neon: PITR 7 días (Launch) o 30 (Scale), ramas | Igual que B | Postgres propio; respaldos `pg_dump` a S3; PITR hay que montarlo |
| Migraciones | Comando previo al despliegue o paso en Actions | Igual; además ramas de Neon para probar contra copia | `release_command` de Fly o paso en Actions; ramas de Neon | Paso en Actions |
| Vistas previas por PR | Solo en plan Pro | Sí (plan no confirmado) | Vercel sí; Fly con una action aparte | No confirmado |
| Rollback de código | Botón; reutiliza el build | Botón; ventana de 72 h (Hobby) o 120 h (Pro) | Vercel instantáneo; Fly redespliega una imagen anterior | No confirmado en detalle |
| Logs | 7 días (Hobby), 14 (Pro) | 7 días (Hobby), 30 (Pro) | Vercel: 1 hora (Hobby), 1 día (Pro); Fly: 7 días | Los que configuremos |
| Mantenimiento | Bajo | Bajo | Medio: tres paneles, tres facturas, Dockerfile para la API | **Alto:** parches del sistema, Postgres, respaldos, TLS, monitoreo |
| Portabilidad | Alta: Node estándar + PostgreSQL estándar | Alta | Media-alta: Next.js corre fuera de Vercel; la API ya en Docker | Máxima |
| Riesgo principal | Precios por reconfirmar; número de proxies sin documentar | Hobby pensado para "personal projects"; Railway no informa ISO 27001 | Más piezas que coordinar; Fly no tiene ISO 27001 | Todo el riesgo operativo es nuestro; choca con PF-56 |

### 2.2. Detalle de costos

**A. Render** (precios por reconfirmar)

| Pieza | QA | PROD |
|---|---|---|
| Workspace | Hobby $0 | Pro $25 |
| 3 web services Starter | 3 × $7 = $21 | 3 × $7 = $21 |
| PostgreSQL | $6 + 1 GB × $0,30 = $6,30 | $19 + 5 GB × $0,30 = $20,50 |
| **Total** | **$27,30** | **$66,50** |

Incluido: 5 GB de salida y 500 minutos de build en Hobby; 25 GB y 1.000 en
Pro. Salida adicional a $0,15/GB. Precio del minuto de build adicional y de
la instancia Standard: no confirmados.

**B. Railway + Neon** (precios leídos; el consumo es estimación)

Railway cobra por uso: $10 por GB de RAM al mes y $20 por vCPU al mes.
Supuesto: API 0,5 GB + dos apps Next de 0,4 GB = 1,3 GB ($13) y 0,15 vCPU
en total ($3) = $16 de uso.

| Pieza | QA | PROD |
|---|---|---|
| Railway | Hobby: $5 (incluye $5 de uso) + $11 = $16 | Pro: $20 por workspace (incluye $20 de uso, asientos ilimitados) = $20 |
| Neon | Free: $0 | Launch, 0,25 CU siempre encendida: 182,5 h × $0,106 + 1 GB × $0,35 = $19,70 |
| **Total** | **~$16** | **~$40** |

Con Neon Scale (PITR de 30 días, lista de IP permitidas): $40,87 en vez de
$19,70, total ~$61.

**C. Vercel + Fly.io + Neon**

| Pieza | QA | PROD |
|---|---|---|
| Vercel Pro (panel + diagnóstico, 2 proyectos) | $20 (incluye 1 asiento y $20 de crédito de uso) | $20 |
| Fly.io, 1 máquina para la API | 512 MB: $3,69 | 1 GB: $6,70 |
| Neon | Free: $0 | Launch: $19,70 |
| **Total** | **~$24** | **~$46** |

Notas: las dos páginas de precios de Fly listan combinaciones distintas de
CPU y memoria; se usó la de la documentación. Fly exonera facturas menores
de $5. El soporte por correo de Fly cuesta $29/mes aparte. El Postgres
gestionado de Fly empieza en $38/mes, por eso aquí se usa Neon.

**D. VPS + Coolify** (referencia)

- DigitalOcean, 2 vCPU / 4 GB: $24/mes; respaldos del servidor +20 % (semanal)
  o +30 % (diario): $28,80–$31,20 por ambiente.
- Coolify autogestionado: gratis. Coolify Cloud: $5/mes (hasta 2 servidores).
- Hetzner en Ashburn: CPX11 (2 vCPU / 2 GB) €17,99; su página mostraba los
  planes compartidos como "currently unavailable" al revisarla.
- El costo real es nuestro tiempo: sistema operativo, Postgres, respaldos y su
  prueba, TLS, monitoreo. Para datos financieros de terceros y con PF-56
  pendiente, no se recomienda.

### 2.3. Límites de los planes gratuitos

| Plataforma | Límite real | ¿Uso comercial o con clientes? |
|---|---|---|
| **Vercel Hobby** | 100 GB de transferencia, 1 M de invocaciones, 4 h de CPU, 100 despliegues/día, logs de 1 hora, 1 asiento. Al pasarse hay que esperar 30 días | **No.** Términos, sección 4: "You shall only use the Services under a Hobby plan for your personal or non-commercial use". El DPA solo cubre Pro y Enterprise. Tampoco conecta repos privados de organizaciones |
| **Render gratis** | Web: se duerme a los 15 min, despierta en ~1 min, 750 horas/mes, 0,1 CPU / 512 MB. Postgres: 1 GB, **vence a los 30 días**, sin respaldos, 100 conexiones | No hay prohibición expresa encontrada, pero "Do not use them for production applications" |
| **Fly.io** | Sin plan gratuito. Prueba: $1 de crédito, 7 días, máquinas que se detienen a los 5 minutos | — |
| **Railway Free** | $1 de crédito al mes, 0,5 GB por servicio, 3 servicios, 1 proyecto. Puede suspender recursos a clientes Free | Sin restricción encontrada en la política de uso; los términos completos no se leyeron |
| **Neon Free** | 100 CU-hora por proyecto al mes, 1 GB por proyecto, 10 ramas, historial de 6 horas, se suspende a los 5 min sin actividad (no se puede desactivar). No pausa proyectos por inactividad | Sin restricción encontrada |
| **Supabase Free** | 500 MB, 2 proyectos, **pausa tras 1 semana sin actividad**, sin respaldos | No confirmado |
| **Koyeb gratis** | 1 instancia (512 MB, 0,1 vCPU), se duerme tras 1 hora; Postgres con 5 horas de cómputo al mes | "Should not be used for production". Koyeb anuncia que se une a Mistral AI |
| **DigitalOcean App Platform** | Gratis solo para sitios estáticos | — |
| **UptimeRobot Free** | 50 monitores, cada 5 minutos | **Sí:** "Good for personal and commercial projects" |
| **Sentry Developer** | 1 usuario, 5.000 errores/mes, alertas solo por correo | "For solo devs"; no confirmado |
| **Better Stack Free** | 10 monitores, 3 GB de logs por 3 días | "Free for personal projects": no usar |

**Ojo con Neon Free:** `GET /health` consulta la base. Un monitor que la llame
cada 5 minutos mantendría la base despierta todo el mes (182,5 CU-hora) y
agotaría las 100 incluidas. Solo importa si se elige la opción B o C.

### 2.4. Opciones descartadas

- **Vercel para la API:** funciones con duración máxima (300 s en Hobby, 800 s
  en Pro) y sin proceso persistente; el trabajo en segundo plano se perdería.
- **Cloudflare Workers / Containers para la API:** la documentación no confirma
  que un servidor NestJS de larga duración con trabajo en segundo plano corra
  tal cual; en Containers no está confirmado qué pasa al dormirse.
- **Supabase:** el PITR cuesta $100/mes por 7 días; su informe SOC 2 solo está
  disponible en los planes Team y Enterprise. Trae funciones (auth, storage)
  que SCORE no usa.
- **Postgres de Railway:** es un contenedor con volumen, no una base
  gestionada; cifrado en reposo no confirmado. Por eso la opción B usa Neon.
- **DigitalOcean App Platform + Postgres gestionado:** válida y parecida a
  Render (servicios desde $5, base desde $15,15 con PITR de 7 días incluido,
  cifrado en reposo). Queda como alternativa si Render no convence; no se
  confirmaron sus vistas previas por PR.
- **GoDaddy hosting:** no aplica a este stack. GoDaddy solo se usa para el DNS.

### 2.5. Archivos (para cuando hagan falta)

Hoy no se guardan PDF. Si eso cambia, **Cloudflare R2**: $0,015 por GB al mes,
sin costo de salida, 10 GB gratis, compatible con la API de S3 (URLs
prefirmadas de hasta 7 días), cifrado AES-256 y jurisdicción `us` o `eu`
garantizada por bucket. Sería un proveedor nuevo que recibe datos: se avisa a
José y se anota en el inventario (CLAUDE.md 5.2).

## 3. Pipeline de GitHub Actions (diseño, sin workflows todavía)

Principio: **GitHub Actions decide cuándo se despliega; Render ejecuta la
migración y el despliegue.** El despliegue automático de Render queda apagado.
Así la aprobación vive en GitHub, la migración corre dentro de la red privada
de Render y **ninguna credencial de la base sale de Render** (sección 11.2).
QA ensaya exactamente lo de PROD.

**En cada PR (ya existe, se amplía):**

1. Lint, build, `pnpm audit` y tests por pieza (los tres workflows actuales).
2. Nuevo en `api`: revisión de migraciones (sección 4.2).

**Al fusionar en `develop` → QA (automático):**

1. Job `changes` (el mismo filtro actual) decide qué piezas desplegar.
2. Ambiente `qa` de GitHub → disparar el despliegue de cada pieza cambiada
   con su *deploy hook* de Render (una URL secreta por servicio).
3. En la API, Render corre `prisma migrate deploy` como *pre-deploy command*:
   después del build y antes de publicar. Si falla, el despliegue se cancela
   y sigue la versión anterior.
4. Esperar a que `GET /health` responda 200 y hacer una petición de humo al
   panel y al diagnóstico. Si falla, el workflow falla y Render conserva la
   versión anterior (no pasa tráfico a una instancia que no está sana).

**Al fusionar en `main` → PROD (con aprobación):**

1. Mismo flujo, con el ambiente `production` de GitHub: **revisor requerido**
   (hasta 6; basta uno), restringido a la rama `main`.
2. Antes de disparar el despliegue: anotar la hora exacta (punto de
   restauración del PITR) en el resumen del workflow.
3. Disparar el despliegue (Render migra y publica) y verificar.
4. `concurrency` por ambiente, sin cancelar corridas en curso: nunca dos
   despliegues ni dos migraciones a la vez.

**Detalles:**

- **Secretos.** En GitHub, por ambiente (`qa`, `production`): solo los deploy
  hooks. Las credenciales de la base y los secretos de ejecución (JWT, MFA,
  Resend, Anthropic) viven solo en Render, nunca en GitHub. Las actions siguen fijadas
  por SHA.
- **Protección de ambientes.** Los revisores requeridos solo existen gratis en
  repos **públicos**. Este repo lo es hoy; si pasa a privado, se pierden salvo
  con GitHub Enterprise.
- **Vistas previas por PR.** En Render exigen el plan Pro. En QA (Hobby) no
  habría; se pueden activar en PROD o subir QA a Pro. Una vista previa de la
  API necesita su propia base: no conviene activarlas hasta decidirlo.
- **Tiempos.** Medido en este repo: el CI de `api` tarda hasta ~130 s, el del
  panel ~63 s y el del diagnóstico ~40 s. El build y arranque en Render no se
  midió (no se desplegó nada); estimación: 3 a 6 minutos por servicio, total
  de 5 a 10 minutos de la fusión al aire. Se mide en el primer despliegue.
- **Costo de este diseño frente a PF-58.** El *pre-deploy command* usa las
  variables del propio servicio, así que la credencial del rol de migraciones
  queda en el entorno de la API. Los dos roles siguen separados, pero quien
  comprometa el proceso de la API podría leerla. La alternativa (migrar desde
  GitHub Actions) obliga a abrir la base de PROD a internet, que es peor
  (sección 11.2). Queda como decisión de José (pregunta 5).
- **Alternativa más simple todavía:** que Render despliegue solo "After CI
  Checks Pass", sin workflow. PROD se quedaría sin puerta de aprobación.

## 4. Migraciones y respaldos

### 4.1. Dónde y cuándo se aplican

- `prisma migrate deploy` corre **en el pipeline, antes de publicar el código
  nuevo**, nunca al arrancar la API. Es lo que recomienda Prisma ("as part of
  your CI/CD pipeline").
- Corre con un **rol dueño del esquema** distinto del rol de la API, que no
  tiene DDL (PF-58). Con el diseño de la sección 3, las dos credenciales viven
  en el mismo servicio (ver sección 11.2).
- `migrate deploy` no usa base sombra, no detecta desvíos y **no avisa de
  cambios destructivos**: aplica lo que haya. La protección va antes.

### 4.2. Cómo se evita romper o borrar datos

1. **El SQL se revisa en el PR.** Cada migración es un `migration.sql` en el
   diff. Regla: no se aprueba un PR sin leerlo.
2. **Detección automática de cambios destructivos** en el CI de `api`: un paso
   busca en las migraciones nuevas `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`,
   `ALTER COLUMN ... TYPE`, `SET NOT NULL`, `RENAME` y `DELETE` sin `WHERE`.
   Si aparece alguno, el check falla salvo que el PR lleve una etiqueta
   explícita (por ejemplo `migracion-destructiva`) y la justificación.
   Prisma sugiere además `pgfence` para detectar bloqueos pesados (por
   ejemplo, un índice sin `CONCURRENTLY`); se evalúa al escribir el workflow.
3. **Comprobar que el schema y las migraciones coinciden:**
   `prisma migrate diff --from-migrations ... --to-schema ... --exit-code`
   (código 2 si hay diferencia). No está confirmado si necesita una base
   auxiliar; el CI ya tiene un Postgres de servicio.
4. **Patrón expand/contract** para todo cambio que no sea solo agregar:
   - *Expand:* agregar lo nuevo sin quitar lo viejo y copiar los datos.
   - Desplegar el código que usa lo nuevo.
   - *Contract:* en un release posterior, quitar lo viejo.
   Como la migración se aplica antes que el código, el código anterior debe
   seguir funcionando con el esquema nuevo. Esto también hace posible el
   rollback de código.
5. **Respaldo antes de migrar.** Con PITR continuo, el "respaldo" es anotar la
   hora justo antes. Para una migración *contract* se agrega una exportación
   lógica manual antes de aprobar el despliegue.
6. **Prueba contra una copia de los datos.** Antes de una migración
   destructiva en PROD: restaurar PROD a una instancia temporal **dentro de la
   cuenta del cliente**, correr ahí `migrate deploy`, verificar y borrarla (se
   cobra por segundo). Los datos de PROD nunca van a QA (PF-56). Con Neon
   (opción B) esto es una rama: se crea en segundos y hay actions oficiales
   para crearla y borrarla.

### 4.3. Si una migración falla a mitad

- La migración queda marcada como fallida en `_prisma_migrations` (el error
  está en su columna `logs`) y **`migrate deploy` se niega a continuar** hasta
  resolverla. El código nuevo no se publica: sigue la versión anterior.
- La documentación de Prisma 7 no confirma que cada migración vaya en una
  transacción; hay que asumir que pudo quedar a medias.
- Dos salidas documentadas:
  1. **Deshacer y reintentar:** revertir a mano lo que alcanzó a aplicarse (o
     hacer la migración idempotente), `prisma migrate resolve --rolled-back
     <nombre>`, corregir y volver a desplegar.
  2. **Terminar a mano:** aplicar los pasos que faltan exactamente como están
     en el archivo y `prisma migrate resolve --applied <nombre>`.
- El SQL de vuelta atrás se genera con `prisma migrate diff
  --from-config-datasource --to-migrations ... --script` y se aplica con
  `prisma db execute --file`. No revierte datos, ni vistas o triggers escritos
  a mano.
- **Último recurso:** restaurar la base a la hora anotada antes de migrar. Se
  pierde lo escrito desde entonces.
- `migrate resolve` solo sirve para migraciones fallidas. Una migración que
  terminó bien pero estaba mal se corrige con otra migración.
- **Nota de versión:** la documentación de Prisma ya describe un flujo nuevo
  (`prisma db migrate`, Prisma 8 en versión candidata) que reemplaza a
  `migrate deploy`. El repo fija Prisma 7.10: revisar esta sección al subir de
  versión mayor.

### 4.4. Respaldos y restauración

| | Render Postgres (A) | Neon (B y C) | DigitalOcean | Supabase | Fly MPG |
|---|---|---|---|---|---|
| Frecuencia | Continua (PITR) | Continua (historial) | Diaria + WAL | Diaria; PITR aparte | "Daily snapshots" |
| Ventana de PITR | 3 días (Hobby), 7 (Pro) | 6 h (Free), 7 días (Launch), 30 (Scale) | 7 días | 7 días por $100/mes | No confirmada |
| Costo | Incluido en la base de pago (costo extra no confirmado) | $0,20 por GB-mes de historial | Incluido | $100/mes | Incluido |
| Exportación lógica | Sí, se guarda 7 días; `pg_dump` | `pg_dump`; snapshots programados en plan de pago | — | `supabase db dump` | — |
| Cómo restaura | Instancia nueva | En el sitio, instantánea; deja una rama con el estado previo | — | Reemplaza el proyecto | Cluster nuevo |
| Cifrado en reposo | AES-256 | AES-256 | LUKS | No confirmado | LUKS2 AES-256 |

Pendiente de PF-56, con cualquier opción: definir RTO y RPO con el cliente,
**hacer una restauración de verdad** y anotar cuánto tardó, y decidir si se
quiere una copia fuera del proveedor (exportación periódica cifrada a un
bucket). Las exportaciones contienen datos personales: nunca a GitHub.

### 4.5. Rollback del código

| Plataforma | Cómo | Qué tan rápido |
|---|---|---|
| Render | Botón "Rollback" o API; reutiliza el build anterior | "Much faster" que un despliegue; sin cifra. Desde el panel apaga el despliegue automático |
| Railway | Botón sobre un despliegue anterior | Sin cifra. Ventana: 72 h (Hobby), 120 h (Pro) |
| Vercel | Instant Rollback | "Instantaneously". En Hobby solo al despliegue inmediatamente anterior |
| Fly.io | `fly deploy --image <imagen anterior>` | Sin cifra; no hay comando de rollback y las imágenes no se guardan para siempre |
| DigitalOcean | Botón; los 10 últimos despliegues | Sin cifra |

En todas, el rollback **no revierte la base**. Funciona solo si se respeta
expand/contract.

## 5. Observabilidad

- **Logs.** Render: 7 días (Hobby) o 14 (Pro), con búsqueda en el panel y
  reenvío por syslog o HTTPS si se quiere retenerlos más (el destino sería
  otro proveedor nuevo: se avisa a José y se anota en el inventario). Para un
  equipo pequeño, el panel alcanza al inicio.
- **Alertas de errores.** Sentry en las tres piezas. Plan gratuito: 1 usuario,
  5.000 errores al mes, alertas por correo. Team: $29/mes, usuarios
  ilimitados. **Sentry sería un proveedor nuevo que recibe datos:** hay que
  aprobarlo, anotarlo en `docs/compliance/data-inventory.md` y configurarlo
  para no enviar datos personales (sin cuerpos de petición, sin cookies, sin
  cabeceras de autorización).
- **Caídas.** Render avisa por correo o Slack cuando un despliegue falla o un
  servicio deja de estar sano. Además, un monitor externo sobre `GET /health`
  y las dos apps: UptimeRobot gratis (50 monitores, cada 5 minutos, permite
  uso comercial). Solo recibe las URLs públicas y el correo de alerta del
  equipo, sin datos de clientes; aun así es un servicio externo nuevo y se le
  avisa a José antes de crearlo.
- **Encontrar la causa.** La API ya pone un identificador por petición
  (`requestContext`, y `request_id` en la bitácora). Con Sentry y los logs de
  Render se puede seguir un error de punta a punta. Fly y Railway no traen
  alertas propias sobre métricas.
- Esto cubre lo que pide PF-55; la alerta "No se pudo revocar la sesión" del
  panel sale de sus logs o de Sentry.

## 6. Portabilidad y plan de salida

**Qué nos ataría con Render:** casi nada. Los servicios son Node estándar, la
base es PostgreSQL estándar y la configuración son variables de entorno. Lo
propio de Render son los deploy hooks, el panel y, si se usa, su archivo
`render.yaml`.

**Cómo saldríamos (a otro PaaS o a contenedores):**

1. Escribir un Dockerfile por pieza (hoy no existen). Conviene hacerlo desde
   el principio aunque Render no lo exija: deja la salida lista.
2. Crear los servicios y la base en el proveedor nuevo, misma región.
3. Copiar las variables de entorno. **`MFA_ENCRYPTION_KEY` y los secretos de
   JWT deben ser los mismos**, o se pierde el MFA de todos y se cierran las
   sesiones.
4. Ventana de mantenimiento corta: detener la API, `pg_dump` y `pg_restore` a
   la base nueva, `prisma migrate status` para confirmar que coincide.
5. Cambiar el DNS de los subdominios de `musicfinance.pro` (TTL bajo desde
   días antes) y actualizar `PANEL_URL`, `DIAGNOSTIC_URL` y `CORS_ORIGINS`.
6. Cambiar los deploy hooks en los secretos de GitHub. El resto del pipeline
   no cambia.
7. Mantener el ambiente viejo unos días y borrarlo, con sus respaldos.

Con los subdominios propios, los enlaces ya enviados por correo siguen
funcionando tras la mudanza. Con las URLs por defecto de la plataforma, no.

**Ataduras de las otras opciones:** Neon agrega su proxy de conexiones y sus
ramas (la base sigue siendo PostgreSQL y sale con `pg_dump`); mover un
proyecto de Neon de nuestra cuenta a la del cliente no está confirmado.
Vercel agrega su CLI y sus URLs; Next.js corre fuera de Vercel. Fly exige
Dockerfile y `fly.toml`.

**Cuentas del cliente.** PROD se crea desde el inicio en un workspace a nombre
del cliente, con nosotros como miembros (Render Pro: miembros ilimitados). No
se "transfiere" QA: PROD nace aparte.

## 7. URLs por defecto en QA

- **Cookies de sesión.** No hay problema. Cada app pone su propia cookie en su
  propio dominio (`score_panel_session` con `SameSite=Lax`,
  `score_diagnostic_session` con `Strict`), sin atributo `Domain`, y el
  navegador nunca habla con la API. Como QA corre con `NODE_ENV=production`,
  la cookie sale con `Secure`, y las URLs de la plataforma ya son HTTPS.
- **CORS.** `CORS_ORIGINS` exige orígenes `https` exactos. En QA: la URL de QA
  del diagnóstico y la del sitio (`score-sitio`) que llame a
  `POST /leads/prequalification`. Si el sitio usa URLs de vista previa de
  Vercel que cambian por commit, no entran en una lista exacta: hay que usar
  la URL estable de rama (`<proyecto>-git-<rama>-<equipo>.vercel.app`).
- **Enlaces en los correos.** `PANEL_URL` y `DIAGNOSTIC_URL` apuntan a las
  URLs de la plataforma (por ejemplo `score-panel-qa.onrender.com`). Son
  estables mientras no se renombre el servicio. Al conectar los subdominios
  reales, los enlaces viejos dejan de servir: aceptable en QA.
- **Correo sin dominio propio.** Resend exige un dominio verificado para
  enviar a cualquier destinatario; sin él, la cuenta de desarrollo solo
  entrega a su dueño. **Para que el cliente reciba los correos de la muestra
  hace falta verificar un dominio** aunque el hosting no tenga uno (pregunta
  abierta 3).
- **Proxies.** Hay que medir en QA cuántos saltos pone la plataforma delante
  de cada servicio para fijar `TRUST_PROXY_HOPS` y validar la lectura de
  `x-forwarded-for` en `apps/panel/lib/api/client-ip.ts` y
  `apps/diagnostico/lib/api/client.ts`. Además, las apps Next llaman a la API
  por su URL pública, así que la API ve la IP de la plataforma: por eso ya
  existen `PANEL_API_SECRET` y `DIAGNOSTIC_API_SECRET`.
- **`APP_ENV=qa`.** PF-30 dice `APP_ENV=staging`, pero el código solo acepta
  `development`, `qa` o `production`. Hay que corregir el ticket.

## 8. Región y privacidad

- **Región.** Todo en Virginia (EE. UU. este): los tres servicios y la base en
  la misma región. La región de un servicio de Render **no se puede cambiar**
  después de crearlo; si la ley aplicable (PF-49, PF-62) exige otra, hay que
  recrear y migrar. Render ofrece además Oregón, Ohio, Fráncfort y Singapur,
  y ninguna región en Latinoamérica; la disponibilidad de São Paulo en las
  otras candidatas no se verificó.
- **Otros proveedores que ya reciben datos:** Resend guarda los datos de la
  cuenta y los registros en Estados Unidos sin importar la región de envío;
  Anthropic según lo anotado en el inventario.
- **Contratos.** Render ofrece DPA a todo workspace; su informe SOC 2 y su
  certificado ISO exigen plan Pro y un acuerdo de confidencialidad. Neon
  informa SOC 2, ISO 27001 e ISO 27701. Vercel: DPA solo en Pro y Enterprise.
  Fly: DPA en todos los planes, SOC 2 Tipo 2, sin ISO 27001. Railway: SOC 2
  Tipo II, DPA disponible, ISO 27001 no confirmado.
- **Lo que esto no significa.** Que el proveedor tenga esos informes no hace
  que SCORE cumpla nada por sí solo. Al elegir, se actualizan
  `docs/compliance/data-inventory.md` (fila "Hosting y base de datos") y
  `docs/compliance/control-matrix.md` (cifrado en reposo y respaldos). No se
  tocaron en este PR porque todavía no hay proveedor elegido.
- **QA solo con datos de prueba.** Si el cliente quisiera cargar casos reales
  en la muestra, QA pasaría a necesitar lo mismo que PROD (DPA firmado,
  respaldos probados).

## 9. Cuentas y configuraciones a crear

### QA (cuentas nuestras)

1. **Render:** workspace Hobby con tarjeta. Proyecto `score-qa`, región
   Virginia.
   - Base Postgres (256 MB). Dos roles: dueño del esquema (migraciones) y rol
     de la API sin DDL.
   - Tres web services con *root directory* `api`, `apps/panel` y
     `apps/diagnostico`, despliegue automático apagado, deploy hook por
     servicio, health check en `/health` para la API, y espera de apagado de
     al menos 90 s en la API.
   - Variables de cada `.env.example`. En la API, como mínimo:
     `NODE_ENV=production`, `APP_ENV=qa`, `DATABASE_URL` con
     `sslmode=require`, `TRUST_PROXY_HOPS` (medido), `CORS_ORIGINS`,
     `PANEL_URL`, `DIAGNOSTIC_URL`, `JWT_SECRET`, `ACCESS_LINK_JWT_SECRET`,
     `MFA_ENCRYPTION_KEY`, `PANEL_API_SECRET`, `DIAGNOSTIC_API_SECRET`,
     `MAIL_DRIVER`, `RESEND_API_KEY`, `MAIL_FROM`, `SCORING_ENGINE_DRIVER`,
     `AI_PROVIDER`. En cada app: `NEXT_PUBLIC_API_URL` y su secreto compartido.
   - Notificaciones de fallo por correo o Slack.
2. **GitHub:** ambiente `qa` con los tres deploy hooks como secretos.
3. **Resend:** key de solo envío para QA; dominio verificado (pregunta 3).
4. **UptimeRobot:** tres monitores.
5. **Sentry** (si José lo aprueba): un proyecto por pieza.
6. Primera carga: `prisma migrate deploy` y `prisma db seed` (crea el primer
   Aprobador y, con `APP_ENV=qa`, el cuestionario de prueba).

### PROD (cuentas a nombre del cliente, con acceso para nosotros)

1. **Render:** workspace Pro del cliente; nosotros como miembros. Mismos
   servicios, base de 1 GB. Secretos **nuevos y distintos** de los de QA;
   `MFA_ENCRYPTION_KEY` respaldada fuera de Render.
   `SCORING_ENGINE_DRIVER=disabled` hasta PF-26; `APP_ENV=production`.
2. **GitHub:** ambiente `production` con revisor requerido y solo la rama
   `main`.
3. **DNS en GoDaddy:** subdominios de `musicfinance.pro` para panel,
   diagnóstico y API (registros CNAME hacia Render), más los registros de
   Resend (SPF, DKIM).
4. **Resend** (cuenta y dominio del cliente), **Anthropic** (cuenta de Music
   Finance Pro), **Sentry** (si José lo aprueba) y monitor de caídas.
5. **Contratos:** DPA de cada proveedor firmado o excepción aprobada (PF-63).
6. Restauración de prueba documentada (PF-56) y auditoría de seguridad del
   release (CLAUDE.md 5.1) antes de abrir a clientes reales.

## 10. Riesgos y preguntas abiertas

**Riesgos**

| Riesgo | Mitigación |
|---|---|
| Los precios de Render no se leyeron directamente | Reconfirmar en pantalla antes de la propuesta; la opción B tiene precios verificados y cuesta parecido |
| Ninguna plataforma documenta cuántos proxies pone delante | Medirlo en QA (ya está en PF-30); sin eso, el límite de intentos de login se puede evadir o bloquear a todos |
| Un despliegue corta un cálculo o una llamada de IA en curso | Espera de apagado ≥ 90 s; lo pendiente se retoma al arrancar (ya implementado) |
| 512 MB pueden no alcanzar para la API (PDF + IA) o para Next | Medir en QA; subir a la instancia siguiente |
| Una sola instancia: si cae, la API no responde hasta que reinicia | Aceptado en PF-30; monitor de caídas y alertas |
| La ley aplicable puede exigir otra región | La región no se cambia después: confirmar PF-49 y PF-62 antes de crear PROD |
| Si el repo pasa a privado, se pierde la aprobación manual de PROD | Decidirlo antes; alternativa: disparo manual del workflow |
| El repo es público: cualquiera lee los workflows y el diseño de infraestructura | Los secretos no llegan a PR de forks; reglas de la sección 11.4. Reconsiderar pasarlo a privado antes de PROD |
| Dependencia de un solo proveedor | Plan de salida de la sección 6; Dockerfile desde el inicio |

**Preguntas abiertas para José**

1. ¿En qué plan de Vercel está `score-sitio`? Si es Hobby, sus términos lo
   limitan a uso personal o no comercial; habría que pasarlo a Pro.
2. ¿Se aprueba ~$27/mes para QA, o se prefiere la opción B (~$16/mes, dos
   proveedores)?
3. Dominio para los correos de QA: ¿se verifica un subdominio nuestro, o se le
   pide ya al cliente un registro DNS en `musicfinance.pro`?
4. ¿Se aprueba Sentry como proveedor nuevo? Si no, quedan solo los logs y las
   notificaciones de Render.
5. Migraciones: ¿se acepta que la credencial del rol de migraciones viva en
   el entorno de la API (recomendado, base cerrada a internet), o se prefiere
   migrar desde GitHub Actions con la base abierta a cualquier IP?
   (sección 11.2)
6. ¿Vistas previas por PR? Exigen Render Pro también en QA (+$25/mes) y una
   base por vista previa.
7. RTO y RPO que espera el cliente (PF-56): ¿bastan 7 días de PITR, o se
   quiere además una copia fuera del proveedor?
8. ¿Se crea el ticket de "Dockerfile por pieza" y el de "workflows de
   despliegue" en Jira, bloqueando PF-30?

**No se pudo confirmar** (además de lo marcado en cada sección): el precio de
la instancia Standard de Render y del minuto de build adicional; si el PITR de
Render tiene costo extra; el número de proxies de cada plataforma; la
definición exacta de "uso comercial" de Vercel (el texto solo dice "personal
or non-commercial"); el tiempo real de arranque en frío de Neon (su
documentación da dos cifras); la ventana de PITR del Postgres de Fly y de
Railway; si los términos completos de Railway restringen el uso comercial en
Hobby.

## 11. Seguridad del despliegue

Esta sección cubre la seguridad **de la infraestructura y del pipeline**. La
de la aplicación (auth, MFA, sesiones, bitácora) ya está en el código y en
PF-53. Nada de esto equivale a una certificación (CLAUDE.md 5.2).

### 11.1. Acceso a las cuentas

Quien entra al panel del hosting ve los secretos y la base: es la cuenta más
sensible del sistema.

| Cuenta | Lo verificado | Qué hacer |
|---|---|---|
| **Render** | Permite **exigir 2FA a todos los miembros** desde el workspace (plan requerido no indicado). Roles Admin y Developer en todos los planes; Contributor y Viewer, que no ven secretos ni cadenas de conexión, solo en Scale. **Hobby admite un solo miembro**; invitar exige Pro. Bitácora de accesos exportable desde Pro, con al menos 90 días: registra quién vio variables, quién vio la conexión de la base, quién descargó un respaldo y quién abrió una consola. SSO solo en Scale | 2FA exigido en ambos workspaces. En PROD: el cliente como Admin, nosotros con el rol mínimo que alcance, y el ambiente marcado como protegido. En QA (Hobby) la cuenta es de una sola persona: no compartir la contraseña; si hacen falta dos personas, QA sube a Pro |
| **GitHub** | 2FA obligatorio para quien contribuye código. Métodos: app TOTP, llaves de seguridad, passkeys. En un repo personal, solo el dueño configura ambientes y sus secretos. "Any user with write access to your repository has read access to all secrets" del repositorio | No dar permiso de escritura a nadie que no deba desplegar. Secretos siempre por ambiente, nunca a nivel de repo |
| **Resend** | Las keys pueden ser de **solo envío** y limitarse a **un dominio**. El MFA es por persona: "There is no setting to require MFA for the whole team". Revoca solo las keys que detecta expuestas en código público | Key de solo envío y de un dominio por ambiente (ya lo pide `.env.example`). MFA activado en cada cuenta, revisado en la columna de estado |
| **Anthropic, Sentry, UptimeRobot** | No revisado en esta investigación | MFA en cada cuenta; key de Anthropic distinta por ambiente |

Regla general: cuentas nominales (una por persona), sin usuarios compartidos,
y un registro de quién tiene acceso a qué, revisado al salir alguien del
equipo.

### 11.2. Exposición de la base de datos

- En Render, las conexiones externas a la base se limitan por rango de IP, y
  **el valor por defecto es `0.0.0.0/0`: abierta a cualquier IP**. Se puede
  cerrar del todo; los servicios de la misma región y workspace siguen
  conectando por la URL interna. Disponible en todos los planes.
- Las conexiones externas siempre van con TLS. Las internas lo admiten con
  certificado autofirmado: `sslmode=require` funciona; `verify-full` no. La
  API ya exige `sslmode=require` o más estricto al arrancar, así que usar la
  URL interna con `require` es compatible.
- **No se puede dar acceso solo a GitHub Actions.** GitHub dice de las IP de
  sus runners: "we do not recommend that you use these as allowlists"; son
  muchos rangos, cambian cada semana y las IP fijas exigen un plan de
  organización.

**Recomendación: acceso externo a la base cerrado del todo, en QA y en PROD.**
Por eso la migración corre dentro de Render (sección 3) y no desde GitHub.

| | Migrar dentro de Render (recomendado) | Migrar desde GitHub Actions |
|---|---|---|
| Base expuesta a internet | No | Sí, a cualquier IP, protegida solo por TLS y contraseña |
| Credencial de la base en GitHub | No | Sí |
| Credencial de migraciones en el entorno de la API | Sí (debilita PF-58) | No |

Una tercera vía dejaría las dos cosas bien: un servicio aparte en Render que
solo migre, con su propia credencial, disparado desde el pipeline. No se
verificó si Render lo permite de forma simple; se revisa al escribir los
workflows.

Para trabajo manual sobre la base (una restauración, una consulta de soporte):
abrir temporalmente la IP de quien lo hace, dejar constancia y volver a
cerrar. Con plan Pro, el cambio de la lista queda en la bitácora de Render.

### 11.3. Protección de lo que queda público

Quedan públicos el panel, el diagnóstico y la API (el sitio llama a
`POST /leads/prequalification` desde el navegador).

- **Denegación de servicio:** Render incluye protección en todos los planes,
  sobre la infraestructura de Cloudflare.
- **WAF y límite de peticiones en el borde:** Render **no documenta ninguno**.
  Las reglas de IP de entrada para servicios web solo existen en el plan
  Scale. La única defensa por petición es la de la propia API
  (`@nestjs/throttler`, por IP y en memoria).
- **Consecuencia:** el riesgo de PF-36 (spam al formulario desde muchas IP que
  agota la cuota de correo) no lo resuelve el hosting; hay que resolverlo en
  la API antes de PROD, como ya está previsto.
- **Si hiciera falta más:** con los subdominios de `musicfinance.pro` se puede
  poner Cloudflare delante. Su plan gratuito incluye protección contra
  denegación de servicio, WAF con un conjunto de reglas gestionado y **una**
  regla de límite de peticiones (por IP, ventanas de 10 segundos). Agrega un
  proxy más (cambia `TRUST_PROXY_HOPS`) y un proveedor que ve todo el tráfico:
  se decide con José. No aplica con las URLs por defecto de QA.
- **Red privada:** los servicios de Render de la misma región se hablan por
  una red privada. El panel y el diagnóstico pueden llamar a la API por su
  dirección interna en vez de la pública: menos exposición y menos latencia.
  Cambia qué IP ve la API, así que se prueba junto con `TRUST_PROXY_HOPS`. La
  API no puede ser un servicio privado mientras el sitio la llame desde el
  navegador.
- **TLS:** certificados automáticos y redirección de HTTP a HTTPS. Versión
  mínima de TLS: no confirmada.
- **QA es pública.** Cualquiera con la URL llega al login. Solo datos de
  prueba, contraseñas reales (no "admin123") y MFA igual que en PROD.

### 11.4. Pipeline y repositorio público

El repo es público: cualquiera puede leer los workflows y abrir un PR desde un
fork.

- **Los secretos no llegan a los PR de forks:** "secrets are not passed to the
  runner when a workflow is triggered from a forked repository".
- **Nunca usar `pull_request_target`** en este repo: corre con el contexto de
  la rama base y puede acceder a secretos; es la vía conocida para robarlos.
  Los workflows de CI siguen con `pull_request`; los de despliegue, solo con
  `push` a `develop` y `main`.
- **Ambientes limitados por rama:** `qa` solo desde `develop`, `production`
  solo desde `main`, con revisor requerido en `production`. Los secretos de
  un ambiente no se entregan hasta que el revisor aprueba.
- **Aprobación de workflows de forks:** subir el ajuste a "Require approval
  for all external contributors". El valor por defecto solo cubre a quien
  contribuye por primera vez.
- **Deploy hooks:** quien tenga la URL puede disparar un despliegue (no leer
  datos). Se guardan como secreto de ambiente y se regeneran en Render si se
  filtran; la URL vieja deja de servir.
- **Las API keys de Render son de usuario, no de workspace** (las acotadas
  están en acceso anticipado). El pipeline usa deploy hooks para no guardar
  una key con acceso a todo.
- **El enmascarado de secretos en los logs no está garantizado.** No imprimir
  secretos ni pasarlos por línea de comandos; si uno aparece en un log, se
  borra el log y se rota.
- Ya en uso y se mantiene: actions fijadas por SHA, permisos mínimos del
  `GITHUB_TOKEN`, gitleaks, CodeQL y Dependabot. Conviene agregar `CODEOWNERS`
  sobre `.github/workflows/`.
- No confirmado: si las reglas de rama (rulesets) pueden restringir quién
  edita los workflows en un repo público de cuenta personal.

### 11.5. Secretos y rotación (PF-57)

- **Dónde viven:** variables de entorno de cada servicio en Render. Que Render
  las cifre en reposo: no confirmado en su documentación.
- **Distintos por ambiente**, generados con `openssl rand`, nunca reutilizados
  entre QA y PROD.
- **Cómo se rota cada uno:**

| Secreto | Cómo se rota | Efecto |
|---|---|---|
| Contraseña de la base | Render no rota sola. Crear un usuario nuevo, cambiar la variable, redesplegar y borrar el viejo | Sin corte si se hace en ese orden |
| `JWT_SECRET`, `ACCESS_LINK_JWT_SECRET` | Cambiar la variable y redesplegar | Cierra todas las sesiones del panel o del cliente |
| `PANEL_API_SECRET`, `DIAGNOSTIC_API_SECRET` | Cambiar en la API y en su app a la vez | Entre un despliegue y otro, el límite de intentos cuenta por la IP de la plataforma |
| `MFA_ENCRYPTION_KEY` | **Hoy no se puede rotar** sin reconfigurar el MFA de todos (`api/README.md`) | Respaldarla fuera de Render; su rotación necesita desarrollo |
| `RESEND_API_KEY`, `ANTHROPIC_API_KEY` | Crear la nueva, cambiar la variable, revocar la vieja | Sin corte |
| Deploy hooks | "Regenerate Hook" en Render y actualizar el secreto en GitHub | El pipeline falla hasta actualizarlo |

- En Render, guardar una variable puede redesplegar el servicio o no ("Save
  only"): al rotar, elegir "Save and deploy".
- Frecuencia propuesta: al salir alguien del equipo, ante cualquier sospecha,
  y una vez al año. La frecuencia definitiva se fija en PF-57.

### 11.6. Qué plan hace falta para cada control

| Control | Hobby (QA) | Pro (PROD) | Solo en Scale |
|---|---|---|---|
| Base cerrada a internet, cifrado en reposo, PITR | Sí | Sí | — |
| Exigir 2FA | Sí (plan no indicado) | Sí | — |
| Más de un miembro | No | Sí | — |
| Bitácora de accesos | No | Sí, 90 días | — |
| Informe SOC 2 e ISO del proveedor | No | Sí, con acuerdo de confidencialidad | — |
| Roles sin acceso a secretos, SSO, reglas de IP para servicios web | No | No | Sí |

PROD en Pro cubre lo esencial. Si el cliente exigiera SSO o que nuestro equipo
no pueda ver secretos, haría falta Scale (precio no confirmado).

### 11.7. Tareas de seguridad antes de abrir PROD

1. 2FA exigido en Render; MFA activo en GitHub, Resend, Anthropic y Sentry.
2. Acceso externo a la base cerrado en QA y en PROD.
3. Ambientes `qa` y `production` limitados por rama, con revisor en PROD.
4. Aprobación de workflows para todo colaborador externo.
5. `TRUST_PROXY_HOPS` medido y probado: cinco contraseñas erradas bloquean esa
   conexión y no a las demás (criterio de PF-30).
6. PF-36 resuelto (cuota de correo ante spam).
7. Restauración de un respaldo probada y cronometrada (PF-56).
8. Procedimiento de rotación escrito (PF-57) y `MFA_ENCRYPTION_KEY` respaldada.
9. DPA de cada proveedor firmado (PF-63) e inventario y matriz de controles
   actualizados.
10. Auditoría completa con `security-audit` y decisión sobre el pentest
    dinámico (PF-61), como pide CLAUDE.md 5.1.

## 12. Fuentes

Todas consultadas el 2026-11-13.

**Render** — https://render.com/pricing (no legible; precios por extractos del
buscador) · https://render.com/changelog/updated-plans-for-render-workspaces ·
https://render.com/docs/compute-plans ·
https://render.com/docs/platform-features-by-plan ·
https://render.com/docs/free · https://render.com/docs/postgresql-backups ·
https://render.com/docs/postgresql-creating-connecting ·
https://render.com/docs/postgresql-connection-pooling ·
https://render.com/docs/postgresql-legacy-instance-types ·
https://render.com/docs/deploys · https://render.com/docs/deploy-hooks ·
https://render.com/docs/rollbacks · https://render.com/docs/preview-environments ·
https://render.com/docs/cronjobs · https://render.com/docs/monorepo-support ·
https://render.com/docs/regions · https://render.com/docs/logging ·
https://render.com/docs/log-streams · https://render.com/docs/notifications ·
https://render.com/docs/health-checks · https://render.com/docs/outbound-bandwidth ·
https://render.com/docs/build-pipeline · https://render.com/docs/disks ·
https://render.com/docs/certifications-compliance

**Vercel** — https://vercel.com/pricing · https://vercel.com/legal/terms ·
https://vercel.com/legal/dpa · https://vercel.com/docs/plans/hobby ·
https://vercel.com/docs/plans/pro-plan · https://vercel.com/docs/limits ·
https://vercel.com/docs/limits/fair-use-guidelines ·
https://vercel.com/docs/functions/limitations ·
https://vercel.com/docs/instant-rollback ·
https://vercel.com/docs/deployments/generated-urls ·
https://vercel.com/docs/deployments/environments ·
https://vercel.com/docs/git/vercel-for-github · https://vercel.com/docs/git ·
https://vercel.com/docs/headers/request-headers ·
https://vercel.com/docs/deployment-protection ·
https://vercel.com/docs/security/compliance ·
https://vercel.com/docs/cron-jobs/usage-and-pricing

**Fly.io** — https://fly.io/pricing/ · https://docs.fly.io/about/pricing ·
https://docs.fly.io/about/free-trial ·
https://docs.fly.io/launch/autostop-autostart ·
https://docs.fly.io/blueprints/long-running-tasks · https://docs.fly.io/mpg ·
https://docs.fly.io/reference/regions ·
https://docs.fly.io/launch/continuous-deployment-with-github-actions ·
https://docs.fly.io/reference/configuration ·
https://docs.fly.io/blueprints/rollback-guide ·
https://docs.fly.io/networking/request-headers ·
https://docs.fly.io/monitoring/metrics · https://docs.fly.io/about/support ·
https://fly.io/legal/security-questionnaire.md

**Railway** — https://railway.com/pricing ·
https://docs.railway.com/reference/pricing/plans ·
https://docs.railway.com/reference/pricing/free-trial ·
https://docs.railway.com/reference/app-sleeping ·
https://docs.railway.com/reference/backups ·
https://docs.railway.com/guides/postgresql ·
https://docs.railway.com/reference/deployment-regions ·
https://docs.railway.com/guides/environments ·
https://docs.railway.com/reference/deployments ·
https://docs.railway.com/guides/pre-deploy-command ·
https://docs.railway.com/guides/logs · https://railway.com/legal/fair-use ·
https://docs.railway.com/maturity/compliance

**Neon** — https://neon.com/pricing · https://neon.com/docs/introduction/plans ·
https://neon.com/docs/introduction/scale-to-zero ·
https://neon.com/docs/introduction/branch-restore ·
https://neon.com/docs/introduction/history-window ·
https://neon.com/docs/connect/connection-pooling ·
https://neon.com/docs/guides/prisma ·
https://neon.com/docs/guides/branching-github-actions ·
https://neon.com/docs/introduction/regions ·
https://neon.com/docs/security/compliance ·
https://neon.com/docs/security/security-overview ·
https://neon.com/docs/manage/backups · https://neon.com/terms-of-service

**Supabase** — https://supabase.com/pricing ·
https://supabase.com/docs/guides/platform/backups ·
https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery ·
https://supabase.com/docs/guides/platform/going-into-prod ·
https://supabase.com/docs/guides/security/soc-2-compliance ·
https://supabase.com/docs/guides/platform/project-transfer

**DigitalOcean** — https://www.digitalocean.com/pricing/app-platform ·
https://docs.digitalocean.com/products/app-platform/details/pricing/ ·
https://www.digitalocean.com/pricing/managed-databases ·
https://docs.digitalocean.com/products/databases/postgresql/details/features/ ·
https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/ ·
https://www.digitalocean.com/pricing/droplets ·
https://www.digitalocean.com/pricing/spaces-object-storage

**Cloudflare** — https://developers.cloudflare.com/r2/pricing/ ·
https://developers.cloudflare.com/r2/api/s3/presigned-urls/ ·
https://developers.cloudflare.com/r2/reference/data-location/ ·
https://developers.cloudflare.com/r2/reference/data-security/ ·
https://developers.cloudflare.com/workers/platform/pricing/ ·
https://developers.cloudflare.com/containers/pricing/

**Autogestionado y otros** — https://www.hetzner.com/cloud/regular-performance/ ·
https://coolify.io/pricing · https://coolify.io/docs/databases/postgresql ·
https://www.koyeb.com/pricing · https://www.koyeb.com/docs/reference/instances ·
https://northflank.com/pricing

**Seguridad (Render)** — https://render.com/docs/inbound-ip-rules ·
https://render.com/docs/private-network · https://render.com/docs/ddos-protection ·
https://render.com/docs/login-settings · https://render.com/docs/team-members ·
https://render.com/docs/audit-logs ·
https://render.com/docs/configure-environment-variables ·
https://render.com/docs/postgresql-credentials · https://render.com/docs/api ·
https://render.com/docs/static-outbound-ip-addresses · https://render.com/docs/tls

**Seguridad (GitHub, Resend, Cloudflare)** —
https://docs.github.com/en/actions/reference/security/secure-use ·
https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets ·
https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository ·
https://docs.github.com/en/actions/reference/runners/github-hosted-runners ·
https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/about-two-factor-authentication ·
https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets ·
https://resend.com/docs/api-reference/api-keys/create-api-key ·
https://resend.com/docs/dashboard/settings/team · https://resend.com/security ·
https://resend.com/legal/dpa · https://developers.cloudflare.com/waf/rate-limiting-rules/ ·
https://www.cloudflare.com/plans/

**Observabilidad y correo** — https://sentry.io/pricing/ ·
https://uptimerobot.com/pricing/ · https://betterstack.com/pricing ·
https://resend.com/pricing ·
https://resend.com/docs/dashboard/domains/introduction ·
https://resend.com/docs/dashboard/domains/regions

**Prisma y GitHub** —
https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate ·
https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing ·
https://www.prisma.io/docs/orm/prisma-migrate/workflows/generating-down-migrations ·
https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production ·
https://www.prisma.io/docs/guides/data-migration ·
https://www.prisma.io/docs/orm/reference/prisma-cli-reference ·
https://www.prisma.io/docs/orm/reference/prisma-config-reference ·
https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments ·
https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments ·
https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
