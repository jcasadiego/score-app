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
| Sesión e intentos fallidos | Equipo interno | `user_sessions`, `users` | Seguridad de la cuenta | Por definir | La sesión, hasta 7 días |
| Secreto TOTP cifrado y códigos de recuperación (solo hash) | Equipo interno | `users`, `user_recovery_codes` | Segundo factor del panel | Por definir | Mientras la cuenta tenga MFA |
| Enlace de recuperación o activación (solo hash) | Equipo interno | `password_reset_tokens` | Recuperar el acceso o definir la primera contraseña | Por definir | Vence en 1 hora (recuperación) o 72 horas (activación o restablecido por un Aprobador); la fila no se borra todavía |
| Actor, acción, entidad, id de petición; correo enmascarado en los envíos | Equipo y clientes | `audit_logs` | Trazabilidad | Por definir | Por definir. Solo inserción: el borrado deberá respetarlo |
| Método, ruta, estado, duración, actor | Equipo y clientes | Logs de la API | Operación y seguridad | Por definir | Por definir |
| Respuestas del diagnóstico (texto libre y opciones), posible información financiera | Cliente final | `answers`, `answer_selections` | Diagnóstico | Por definir | Por definir (PF-49) |
| Enlaces a sus perfiles públicos (Spotify, YouTube, Instagram, TikTok, sitio web) | Cliente final | `external_links` | Diagnóstico | Por definir | Por definir (PF-49) |
| Estado, actividad y fechas del diagnóstico; quién lo generó y el motivo de generarlo sin pago | Cliente final y equipo interno | `diagnostics` | Seguimiento del diagnóstico y control del acceso sin pago | Por definir | Por definir (PF-49) |
| Enlace de acceso del cliente (solo hash), uso y revocación | Cliente final | `access_links` | Acceso sin contraseña | Por definir | Vence en 30 días (`ACCESS_LINK_TTL_DAYS`); la fila no se borra todavía |

La IP no se guarda en logs ni en bitácora; solo se usa en memoria para el límite
de peticiones. Si una investigación de seguridad la requiere, hay que decidirlo y
anotarlo aquí, porque también es un dato personal.

## Proveedores que reciben datos

| Proveedor | Qué recibe | Para qué | Región | Contrato (DPA) | Estado |
|---|---|---|---|---|---|
| Resend | Correo y nombre del destinatario, y el enlace de acceso del cliente. En los avisos al equipo, nombre, familia y UTM del lead | Correo transaccional | Por confirmar | Por firmar | En uso con cuenta de desarrollo. Falta la cuenta y el dominio del cliente |
| Hosting y base de datos | Todo lo anterior | Operar SCORE | Por definir | Por firmar | Por elegir (PF-30) |
| Proveedor de IA | Texto de respuestas | Flags y borrador del informe | Por definir | Por firmar | Sin integrar (PF-32). Revisar sus condiciones de retención y de entrenamiento |
| Pasarela de pagos y CRM | Por definir | Pagos y CRM | Por definir | Por firmar | Sin delimitar |

GitHub aloja el código. No debe recibir datos de clientes: ni en fixtures ni en
logs de CI.
