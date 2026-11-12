# Inventario de datos personales

Borrador del registro de tratamiento, según el código al 2026-11-06. Quien
agregue un dato personal o un proveedor lo anota aquí en el mismo PR.

**Por definir** significa que falta una decisión del cliente o de su asesor legal
(PF-49): ley aplicable, base legal y plazos. Este documento no los supone.

## Datos

| Dato | Titular | Dónde vive | Finalidad | Base legal | Conservación |
|---|---|---|---|---|---|
| Nombre, correo, teléfono (opcional), familia y UTM | Lead | `leads` | Contacto comercial tras la precalificación | Por definir | Por definir |
| Nombre, correo, hash de contraseña y cuándo se definió, rol, estado | Equipo interno | `users` | Acceso al panel | Por definir | Por definir |
| Quién creó y quién publicó cada versión del cuestionario | Equipo interno | `questionnaire_versions` | Trazabilidad de cambios al cuestionario | Por definir | Mientras exista la versión: una publicada no se borra |
| Sesión, intentos fallidos y fecha del último código de MFA rechazado | Equipo interno | `user_sessions`, `users` | Seguridad de la cuenta | Por definir | La sesión, hasta 7 días |
| Secreto TOTP cifrado y códigos de recuperación (solo hash) | Equipo interno | `users`, `user_recovery_codes` | Segundo factor del panel | Por definir | Mientras la cuenta tenga MFA |
| Enlace de recuperación o activación (solo hash) | Equipo interno | `password_reset_tokens` | Recuperar el acceso o definir la primera contraseña | Por definir | Vence en 1 hora (recuperación) o 72 horas (activación o restablecido por un Aprobador); la fila no se borra todavía |
| Actor, acción, entidad, id de petición; correo enmascarado en los envíos | Equipo y clientes | `audit_logs` | Trazabilidad | Por definir | Por definir. Solo inserción: el borrado deberá respetarlo |
| Método, ruta, estado, duración, actor | Equipo y clientes | Logs de la API | Operación y seguridad | Por definir | Por definir |
| Respuestas del diagnóstico (texto libre y opciones), posible información financiera | Cliente final | `answers`, `answer_selections` | Diagnóstico | Por definir | Por definir (PF-49) |
| Flags: texto de la IA sobre las respuestas del cliente, preguntas involucradas y nota del revisor | Cliente final (y equipo interno, quién revisó) | `flags`, `flag_questions`, `flag_analyses` | Que un humano revise posibles inconsistencias antes de aprobar | Por definir | Por definir (PF-49); la misma que las respuestas |
| Correcciones del revisor a las respuestas: valor nuevo, motivo, quién y cuándo | Cliente final (y equipo interno, quién corrigió) | `answer_corrections`, `answer_correction_selections` | Corregir con trazabilidad lo que el cliente respondió mal, antes de aprobar | Por definir | Por definir (PF-49); la misma que las respuestas. Solo inserción: el borrado deberá respetarlo |
| Notas del revisor, generales y por dimensión | Cliente final (pueden citarlo) y equipo interno | `review_notes` | Redactar el informe (Delivery) | Por definir | Por definir (PF-49); la misma que las respuestas |
| Revisión del caso: quién lo tomó, quién aprobó y con qué cálculo, excepción de IA, quién reabrió y por qué | Equipo interno | `reviews`, `review_approvals` | Revisión humana obligatoria antes de entregar, y su trazabilidad | Por definir | Por definir (PF-49) |
| Informe del diagnóstico: texto por dimensión (puede citar respuestas y notas), su historial con origen (IA o persona), autor y fecha, y qué versión se aprobó y quién | Cliente final y equipo interno | `reports`, `report_sections`, `report_section_revisions`, `report_approvals`, `report_approval_revisions` | Entregar el diagnóstico (PF-42) | Por definir | Por definir (PF-49); historial de solo inserción, el borrado deberá respetarlo |
| Entregas del informe: copia del nombre y del correo de destino, quién lo envió y cuándo, plantilla y SHA-256 del PDF; enlace de descarga (solo el hash del token, vencimiento y revocación) y fecha de cada descarga, sin IP ni dispositivo. El PDF no se guarda: se genera a pedido | Cliente final | `report_deliveries`, `report_download_links`, `report_downloads` | Entregar el diagnóstico y dejar evidencia de a quién se envió (PF-42) | Por definir | Por definir (PF-49); el enlace vence en `REPORT_LINK_TTL_DAYS` (30 días). Entregas y descargas de solo inserción, el borrado deberá respetarlo |
| Copia de las respuestas enviada al motor y su resultado | Cliente final | `calculations` (`input`, `output`) | Calcular el resultado del diagnóstico y conservar qué se calculó con qué | Por definir | Por definir (PF-49); la misma que las respuestas |
| Enlaces a sus perfiles públicos (Spotify, YouTube, Instagram, TikTok, sitio web) | Cliente final | `external_links` | Diagnóstico | Por definir | Por definir (PF-49) |
| Estado, actividad y fechas del diagnóstico; quién lo generó y el motivo de generarlo sin pago | Cliente final y equipo interno | `diagnostics` | Seguimiento del diagnóstico y control del acceso sin pago | Por definir | Por definir (PF-49) |
| Enlace de acceso del cliente (solo hash), uso y revocación | Cliente final | `access_links` | Acceso sin contraseña | Por definir | Vence en 30 días (`ACCESS_LINK_TTL_DAYS`); la fila no se borra todavía |

La IP no se guarda en logs ni en bitácora; solo se usa en memoria para el límite
de peticiones. Si una investigación de seguridad la requiere, hay que decidirlo y
anotarlo aquí, porque también es un dato personal.

## Proveedores que reciben datos

| Proveedor | Qué recibe | Para qué | Región | Contrato (DPA) | Estado |
|---|---|---|---|---|---|
| Resend | Correo y nombre del destinatario, y el enlace de acceso del cliente o el de descarga de su informe (el PDF no se adjunta). En los avisos al equipo, nombre, familia y UTM del lead | Correo transaccional | Por confirmar | Por firmar | En uso con cuenta de desarrollo. Falta la cuenta y el dominio del cliente |
| Hosting y base de datos | Todo lo anterior | Operar SCORE | Por definir | Por firmar | Por elegir (PF-30) |
| Anthropic (Claude API) | Respuestas del diagnóstico por `code`/`value`, resultado del cálculo y, para el informe, las notas del revisor y el texto vigente de la dimensión que se regenera; minimizado: nunca nombre, correo ni teléfono del lead, y su nombre tachado en los textos libres (`src/ai/minimize.ts`) | Flags y borrador del informe | Por confirmar | Por firmar: cuenta a nombre de Music Finance Pro | Servicio listo (PF-32), sin cuenta real. Condiciones oficiales: borra entradas y salidas en 30 días; hasta 2 años si se marcan por violar su política de uso; no las usa para entrenar (privacy.claude.com, revisado el 2026-11-08). Evaluar un acuerdo de retención cero |
| Pasarela de pagos y CRM | Por definir | Pagos y CRM | Por definir | Por firmar | Sin delimitar |

GitHub aloja el código. No debe recibir datos de clientes: ni en fixtures ni en
logs de CI.
