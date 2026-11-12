# Matriz de controles

Estado al 2026-11-06. **Implementado:** existe en el repo y tiene prueba o
configuración verificable. **Parcial:** existe con una limitación indicada.
**Pendiente:** falta, con su responsable o ticket.

ISO 27001 cita el Anexo A de la edición 2022; SOC 2, los Trust Services Criteria.

## Acceso e identidad

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Contraseñas con argon2id, sin revelar qué cuentas existen | A.5.17, A.8.5 | CC6.1 | Implementado | `api/src/auth/auth.service.ts` |
| Política de contraseñas: 12 a 128 caracteres, también en el seed | A.5.17 | CC6.1 | Implementado | `api/src/users/dto/limits.ts`, `dtos.spec.ts`. Falta rechazar contraseñas filtradas (PF-60) |
| Bloqueo: 5 intentos fallidos (contraseña o código MFA), 15 minutos, auditado, con aviso por correo al dueño de la cuenta | A.5.15, A.8.5, A.8.15 | CC6.1, CC7.2 | Implementado | `test/login-lockout.e2e-spec.ts`. Restablecer la contraseña lo levanta (`ACCOUNT_UNLOCKED`) solo si no se rechazó un código de MFA en los últimos 15 minutos, para no dar más intentos de MFA por ventana: `test/mfa.e2e-spec.ts`, `test/password-reset.e2e-spec.ts` (PF-65) |
| Límite de peticiones en login y rutas públicas | A.8.5, A.8.6 | CC6.6 | Parcial | `app-throttler.guard.ts`. Contadores en memoria: con varias instancias hace falta un almacén compartido (PF-60) |
| Sesión revocable, única y con límite absoluto | A.8.5 | CC6.1 | Implementado | `sessions.service.ts`, `test/auth-refresh.e2e-spec.ts` |
| Segundo factor (TOTP) obligatorio en el panel, con códigos de recuperación y aviso por correo | A.8.2, A.8.5 | CC6.1 | Implementado | `api/src/auth/mfa.service.ts`, `test/mfa.e2e-spec.ts`. Lo configura solo quien definió la contraseña con el enlace de su correo: restablecerlo también invalida la contraseña (PF-59) |
| Secreto TOTP cifrado (AES-256-GCM); códigos de recuperación como hash | A.8.24 | CC6.1 | Implementado | `api/src/auth/mfa/secret-cipher.ts` y su spec. Falta rotar la llave (PF-57) |
| Vencimiento de sesión por inactividad | A.8.5 | CC6.1 | Parcial | 1 día (`JWT_EXPIRES_IN`). Valorar un plazo menor; decisión de José |
| Mínimo privilegio y roles | A.5.15, A.5.18, A.8.2, A.8.3 | CC6.3 | Implementado | Revisor y Aprobador validados en cada petición, sin rol por defecto y con un Aprobador activo garantizado. Los avisos por correo llegan solo al rol que actúa (PF-38). `CLAUDE.md` 5.3, `api/test/roles.e2e-spec.ts` |
| Cambios de rol trazables y con cierre de sesión | A.5.18, A.8.15 | CC6.2, CC7.2 | Implementado | `USER_ROLE_CHANGED` en la misma transacción, con el rol anterior y el nuevo. `users.service.ts` |
| Separación de funciones: quien corrige un caso no lo aprueba | A.5.3 | CC6.3 | Riesgo aceptado | El Aprobador puede aprobar lo que corrigió: decisión de José del 2026-11-04, por el tamaño del equipo. Un auditor lo va a objetar. Compensa la bitácora: `REVIEW_APPROVED` registra quién aprobó, quién corrigió (`correctedByIds`) y si fue la misma persona (`approverCorrected`), en la misma transacción (PF-39, `api/test/reviews.e2e-spec.ts`); revisar al crecer el equipo |
| Nadie conoce la contraseña de otra cuenta: el dueño la define con un enlace de un solo uso al crearla y cuando un Aprobador la restablece | A.5.17 | CC6.2 | Implementado | `users.service.ts`, `password-link.service.ts`, `test/account-activation.e2e-spec.ts` (PF-59). Quien controla el correo del dueño controla la cuenta, como en toda recuperación por correo |
| Alta y baja de usuarios; la baja corta el acceso al instante | A.5.16, A.5.18 | CC6.2, CC6.3 | Implementado | `users.service.ts`, `jwt.strategy.ts`. La revisión periódica de accesos es de la organización |
| Enlace del cliente final registrado y revocable | A.8.5 | CC6.1 | Implementado | Token opaco de 256 bits, solo su hash en `access_links`, vence en `ACCESS_LINK_TTL_DAYS`. La sesión corta (12 h) revisa el enlace en cada petición: revocarlo, reenviarlo o enviar el diagnóstico la corta. `access-links.service.ts`, `test/diagnostics.e2e-spec.ts` (PF-16) |
| Un cliente final solo alcanza su propio diagnóstico (OWASP API1) | A.5.15, A.8.3 | CC6.1, CC6.3 | Implementado | El diagnóstico sale de la sesión, nunca de la URL; FK compuestas garantizan en la base que pregunta y opción sean de su versión. `AccessLinkGuard`, `test/diagnostics.e2e-spec.ts` |
| Recuperación del enlace sin delatar quién tiene un diagnóstico ni dejar fuera al cliente | A.8.5 | CC6.1, P4.1 | Implementado | 202 siempre, envío en segundo plano, 3/min por IP y 3/hora por correo destino; el enlace anterior vale hasta que se usa el nuevo |

## Registro y monitoreo

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Bitácora de escrituras e intentos denegados | A.8.15 | CC7.2 | Implementado | `api/src/audit/`, `test/audit.e2e-spec.ts` |
| Bitácora de solo inserción | A.5.33, A.8.15 | CC7.2 | Parcial | Trigger en la base. La API es dueña de la tabla y podría quitarlo: en producción, las migraciones deben usar otro rol (PF-58) |
| Registro de quién consulta datos personales | A.8.15 | CC7.2, P6 | Parcial | Leads, con `LEADS_LISTED` y `LEAD_VIEWED`. Cada módulo nuevo con datos personales debe declararlo |
| Id de petición en respuesta, log y bitácora | A.8.15 | CC7.2 | Implementado | `api/src/common/request-context.ts` |
| Logs en JSON, sin URLs ni valores de consultas | A.8.11, A.8.15 | CC7.2, C1.1 | Implementado | `main.ts`, `problem-details.ts` |
| Alertas sobre eventos de seguridad | A.8.16 | CC7.2, CC7.3 | **Pendiente** | Requiere la plataforma de producción (PF-55) |
| Conservación de logs y bitácora | A.8.15 | CC7.2 | **Pendiente** | Plazo por definir (PF-49 y PF-55) |

## Criptografía y secretos

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Cifrado en tránsito: la API no arranca sin `sslmode` ni con enlaces http | A.8.20, A.8.24 | CC6.7 | Implementado | `validate-env.ts` y su spec. TLS público: HSTS en los dos frontends y el proveedor (PF-30) |
| Cifrado en reposo de base y respaldos | A.8.24 | CC6.1, C1.1 | **Pendiente** | Elegir un proveedor que lo garantice (PF-56) |
| Tokens guardados solo como hash | A.8.24 | CC6.1 | Implementado | `common/link-token.ts`: recuperación y activación del panel, y enlace del cliente final |
| Secretos fuera del repo, con longitud mínima | A.8.24 | CC6.1 | Implementado | `validate-env.ts`, gitleaks en CI |
| Gestor de secretos y rotación | A.8.24 | CC6.1 | **Pendiente** | Procedimiento de rotación de JWT y API keys (PF-57) |

## Seguridad de la aplicación

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Validación estricta de entrada; errores sin detalles internos | A.8.26, A.8.28 | CC6.6 | Implementado | `bootstrap.ts`, `global-exception.filter.ts` |
| Encabezados de seguridad, CORS por lista, sin caché en la API | A.8.26 | CC6.6, C1.1 | Implementado | `bootstrap.ts`, `test/security-config.e2e-spec.ts` |
| CSP del panel con nonce por petición | A.8.26 | CC6.6 | Implementado | `apps/panel/proxy.ts` |
| CSP de `apps/diagnostico` con nonce por petición, sin `'unsafe-inline'` en producción | A.8.26 | CC6.6 | Implementado | `apps/diagnostico/proxy.ts` (PF-17). El navegador no habla con la API: `connect-src 'self'` |
| Sesión del cliente final fuera del alcance de JavaScript | A.8.5, A.8.26 | CC6.1 | Implementado | Cookie `httpOnly`, `Secure` y `SameSite=Strict` (`apps/diagnostico/lib/session/cookie.ts`); el token del enlace sale de la URL y del historial al entrar (PF-17) |
| El resultado simulado del motor no llega a producción, y cada cálculo queda trazable | A.8.25, A.8.29 | PI1.3, CC8.1 | Implementado | `validate-env.ts` (con `APP_ENV=production`, `SCORING_ENGINE_DRIVER=stub` no arranca); `calculations` guarda entrada, salida, versión de reglas y motor, y marca lo simulado (PF-24) |
| IA: datos minimizados, contenido del cliente aislado de las instrucciones, salida validada y registro de uso sin contenido | A.5.34, A.8.11, A.8.26 | C1.1, P4.1, CC6.6 | Implementado | `src/ai` (PF-32): `minimize.ts`, `prompt-envelope.ts` (OWASP LLM01), validación con zod (LLM05), `ai_call_logs`; con `APP_ENV=production` no arranca con `stub` |
| Revisión humana obligatoria y atada a lo aprobado | A.5.8, A.8.25 | PI1.3, CC8.1 | Implementado | Solo el Aprobador aprueba, y solo sobre el último cálculo exitoso, con las correcciones incluidas, el análisis de IA terminado (o una excepción con motivo, registrada) y sin flags abiertos; en producción, nunca un resultado simulado. Recalcular anula la aprobación. `src/reviews/approval-rules.ts`, `test/reviews.e2e-spec.ts` (PF-39) |
| Correcciones a datos del cliente sin perder el original | A.5.33, A.8.15 | PI1.4, CC7.2 | Implementado | `answer_corrections` de solo inserción (trigger), con motivo, autor y fecha; una aprobación solo se anula una vez. Cambios concurrentes con `If-Match` (412/428). Como la bitácora, el trigger depende de que la API no sea dueña de las tablas en producción (PF-58) |
| Informe redactado por IA con aprobación humana atada al contenido | A.5.8, A.8.25, A.8.15 | PI1.3, CC8.1, CC7.2 | Implementado (aprobación); entrega pendiente | La IA solo redacta (OWASP LLM06/LLM09): el borrador exige la revisión aprobada, cada cambio queda en un historial de solo inserción (trigger) con su origen y autor, y la aprobación del Aprobador guarda qué versión de cada sección aprobó. Si se anula la aprobación del caso, también la del informe. `src/reports`, `test/reports.e2e-spec.ts` (PF-42) |
| Prueba de penetración antes del primer release | A.8.29 | CC4.1, CC7.1 | **Pendiente** | PF-61, antes del primer release; una externa si el auditor la pide |

## Desarrollo y cambios

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Código fuente con acceso restringido | A.8.4 | CC6.1 | Riesgo aceptado | El repo es público en GitHub: decisión de José del 2026-11-04. Exige que ningún secreto ni dato real llegue al repo (gitleaks) y que el auditor vea esta decisión justificada |
| Cambios por PR, con CI obligatorio en `develop` | A.8.32 | CC8.1 | Implementado | Protección de rama, plantilla de PR |
| CI obligatorio también en `main` | A.8.32 | CC8.1 | Implementado | Protección de rama: `api`, `diagnostico` y `panel`, con la rama al día. Aplicado por José el 2026-11-04 |
| Separación de funciones: quien escribe no aprueba solo | A.5.3, A.8.32 | CC8.1 | Riesgo aceptado | 0 aprobaciones exigidas con un solo desarrollador: decisión de José del 2026-11-04. Un auditor lo va a objetar; revisar al sumar a alguien al repo |
| Análisis de secretos, de dependencias y estático | A.8.8, A.8.28 | CC7.1 | Implementado | `.github/workflows/security.yml`. Revisión de dependencias y CodeQL solo corren con el repo público |
| `pnpm audit` bloqueante en las tres piezas | A.8.8 | CC7.1 | Implementado | Workflows de CI |
| Actualizaciones y alertas automáticas de dependencias | A.8.8 | CC7.1 | Implementado | `.github/dependabot.yml` y alertas de Dependabot, activadas por José el 2026-11-04 |
| Actions fijadas por SHA y permisos mínimos | A.5.21, A.8.28 | CC9.2 | Implementado | `.github/workflows/` |
| Revisión de seguridad por PR y por release | A.8.25, A.8.29 | CC8.1 | Implementado | `CLAUDE.md`, sección 5.1 |
| Entornos separados; sin datos reales en pruebas | A.8.31, A.8.33 | CC8.1 | Parcial | Variables y e2e separados. El cuestionario de prueba no se carga en producción (`sampleDataAllowed`, `prisma/sample-questionnaire.ts`). QA y producción: PF-30 |
| Cuestionario publicado inmutable y trazable: cada diagnóstico apunta a la versión exacta que respondió | A.8.32, A.5.33 | CC8.1, PI1.2 | Implementado | Trigger en la base y bloqueo de fila al editar o publicar; quién y cuándo publicó en la versión y en la bitácora (`QUESTIONNAIRE_VERSION_PUBLISHED`, `QUESTION_*`). `test/questionnaire-versions.e2e-spec.ts` (PF-12). Un diagnóstico solo apunta a una versión publicada (trigger) y publicar otra no lo altera (PF-16) |

## Privacidad

| Control | ISO 27701 (tema) | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|---|
| Datos personales fuera de logs y bitácora | Minimización | A.8.11, A.8.12 | C1.1, P4 | Implementado | `redact-sensitive-data.ts` y su spec |
| Registro de tratamiento | Registros de tratamiento | A.5.34 | P1, P6 | Parcial | `data-inventory.md`, borrador con huecos marcados |
| Consentimiento y aviso de privacidad | Consentimiento, información al titular | A.5.34 | P1, P2 | **Pendiente** | PF-49, bloqueada por ley aplicable y texto legal |
| Conservación y borrado, también en respaldos | Limitación de conservación | A.5.33, A.8.10 | C1.2, P4 | **Pendiente** | PF-49 |
| Acceso, rectificación, portabilidad y borrado | Derechos del titular | A.5.34 | P5 | **Pendiente** | PF-49. La bitácora ya no guarda nombre, correo ni teléfono |
| Evaluación de impacto (DPIA) | Evaluación de impacto | A.5.34 | P1 | **Pendiente** | PF-62, antes del release con clientes reales y al sumar IA (PF-32) |
| Transferencias internacionales | Transferencias | A.5.34 | P6 | **Pendiente** | PF-62; depende de la región de los proveedores |

## Disponibilidad y continuidad

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Salud de la API y apagado ordenado | A.8.6, A.8.14 | A1.1 | Implementado | `health.controller.ts`, `main.ts` |
| Respaldos con restauración probada | A.8.13 | A1.2, A1.3 | **Pendiente** | PF-56 |
| Plan de continuidad y recuperación (RTO/RPO) | A.5.29, A.5.30 | A1.3, CC7.5 | **Pendiente** | PF-56 y PF-63 |

## Organización (fuera de este repo)

Nada de esto se resuelve con código, y sin ello no hay certificación (PF-63):

| Tema | ISO 27001 | SOC 2 |
|---|---|---|
| Alcance del SGSI y PIMS, políticas, responsables y apoyo de la dirección | Cláusulas 4 y 5, A.5.1, A.5.2 | CC1, CC2, CC5 |
| Evaluación de riesgos y Declaración de Aplicabilidad | Cláusula 6 | CC3 |
| Roles de privacidad: quién es responsable y quién encargado | A.5.31, A.5.34 | P1 |
| Contratos y evaluación de proveedores (DPA) | A.5.19 a A.5.23 | CC9.2 |
| Plan de respuesta a incidentes y notificación de brechas | A.5.24 a A.5.28 | CC7.3, CC7.4 |
| Formación, incorporación y salida del personal | A.6.1 a A.6.5 | CC1.4 |
| Auditoría interna y revisión por la dirección | Cláusula 9 | CC4 |
