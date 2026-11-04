# Matriz de controles

Estado al 2026-11-04. **Implementado:** existe en el repo y tiene prueba o
configuración verificable. **Parcial:** existe con una limitación indicada.
**Pendiente:** falta, con su responsable o ticket.

ISO 27001 cita el Anexo A de la edición 2022; SOC 2, los Trust Services Criteria.

## Acceso e identidad

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Contraseñas con argon2id, sin revelar qué cuentas existen | A.5.17, A.8.5 | CC6.1 | Implementado | `api/src/auth/auth.service.ts` |
| Política de contraseñas: 12 a 128 caracteres, también en el seed | A.5.17 | CC6.1 | Implementado | `api/src/users/dto/limits.ts`, `dtos.spec.ts`. Falta rechazar contraseñas filtradas |
| Bloqueo: 5 intentos fallidos, 15 minutos, auditado | A.8.5 | CC6.1 | Implementado | `test/login-lockout.e2e-spec.ts` |
| Límite de peticiones en login y rutas públicas | A.8.5, A.8.6 | CC6.6 | Parcial | `app-throttler.guard.ts`. Contadores en memoria: con varias instancias hace falta un almacén compartido |
| Sesión revocable, única y con límite absoluto | A.8.5 | CC6.1 | Implementado | `sessions.service.ts`, `test/auth-refresh.e2e-spec.ts` |
| Segundo factor (MFA) para el panel | A.8.2, A.8.5 | CC6.1 | **Pendiente** | Sin ticket. Decisión de José. Lo esperará cualquier auditor en cuentas con acceso a datos personales |
| Vencimiento de sesión por inactividad | A.8.5 | CC6.1 | Parcial | 1 día (`JWT_EXPIRES_IN`). Valorar un plazo menor junto con MFA |
| Mínimo privilegio y roles | A.5.15, A.5.18, A.8.2, A.8.3 | CC6.3 | Parcial | Solo existe `ADMIN`. PF-48 (Revisor y Aprobador) |
| Alta y baja de usuarios; la baja corta el acceso al instante | A.5.16, A.5.18 | CC6.2, CC6.3 | Implementado | `users.service.ts`, `jwt.strategy.ts`. La revisión periódica de accesos es de la organización |
| Enlace del cliente final registrado y revocable | A.8.5 | CC6.1 | Parcial | Sin estado todavía: PF-16. La ruta de pruebas no existe fuera de desarrollo y test |

## Registro y monitoreo

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Bitácora de escrituras e intentos denegados | A.8.15 | CC7.2 | Implementado | `api/src/audit/`, `test/audit.e2e-spec.ts` |
| Bitácora de solo inserción | A.5.33, A.8.15 | CC7.2 | Parcial | Trigger en la base. La API es dueña de la tabla y podría quitarlo: en producción, las migraciones deben usar otro rol (PF-30) |
| Registro de quién consulta datos personales | A.8.15 | CC7.2, P6 | Parcial | Leads, con `LEADS_LISTED` y `LEAD_VIEWED`. Cada módulo nuevo con datos personales debe declararlo |
| Id de petición en respuesta, log y bitácora | A.8.15 | CC7.2 | Implementado | `api/src/common/request-context.ts` |
| Logs en JSON, sin URLs ni valores de consultas | A.8.11, A.8.15 | CC7.2, C1.1 | Implementado | `main.ts`, `problem-details.ts` |
| Alertas sobre eventos de seguridad | A.8.16 | CC7.2, CC7.3 | **Pendiente** | Requiere la plataforma de producción (PF-30) |
| Conservación de logs y bitácora | A.8.15 | CC7.2 | **Pendiente** | Plazo por definir (PF-49 y PF-30) |

## Criptografía y secretos

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Cifrado en tránsito: la API no arranca sin `sslmode` ni con enlaces http | A.8.20, A.8.24 | CC6.7 | Implementado | `validate-env.ts` y su spec. TLS público: HSTS en los dos frontends y el proveedor (PF-30) |
| Cifrado en reposo de base y respaldos | A.8.24 | CC6.1, C1.1 | **Pendiente** | Elegir un proveedor que lo garantice (PF-30) |
| Tokens guardados solo como hash | A.8.24 | CC6.1 | Implementado | `password-reset.service.ts` |
| Secretos fuera del repo, con longitud mínima | A.8.24 | CC6.1 | Implementado | `validate-env.ts`, gitleaks en CI |
| Gestor de secretos y rotación | A.8.24 | CC6.1 | **Pendiente** | Procedimiento de rotación de JWT y API keys (PF-30) |

## Seguridad de la aplicación

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Validación estricta de entrada; errores sin detalles internos | A.8.26, A.8.28 | CC6.6 | Implementado | `bootstrap.ts`, `global-exception.filter.ts` |
| Encabezados de seguridad, CORS por lista, sin caché en la API | A.8.26 | CC6.6, C1.1 | Implementado | `bootstrap.ts`, `test/security-config.e2e-spec.ts` |
| CSP del panel con nonce por petición | A.8.26 | CC6.6 | Implementado | `apps/panel/proxy.ts` |
| CSP de `apps/diagnostico` | A.8.26 | CC6.6 | Parcial | Línea base con `'unsafe-inline'` en scripts. Pasar a nonce con el flujo real (PF-17) |
| Prueba de penetración antes del primer release | A.8.29 | CC4.1, CC7.1 | **Pendiente** | Corrida propuesta antes de PF-30, más una externa si el auditor la pide |

## Desarrollo y cambios

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Código fuente con acceso restringido | A.8.4 | CC6.1 | **Pendiente** | **El repo es público en GitHub.** Decisión de José |
| Cambios por PR, con CI obligatorio en `develop` | A.8.32 | CC8.1 | Implementado | Protección de rama, plantilla de PR |
| CI obligatorio también en `main` | A.8.32 | CC8.1 | **Pendiente** | `main` no exige checks. Ajuste de GitHub, a cargo de José |
| Separación de funciones: quien escribe no aprueba solo | A.5.3, A.8.32 | CC8.1 | **Pendiente** | 0 aprobaciones exigidas con un solo desarrollador. Requiere un segundo revisor o un control compensatorio documentado |
| Análisis de secretos, de dependencias y estático | A.8.8, A.8.28 | CC7.1 | Implementado | `.github/workflows/security.yml`. Revisión de dependencias y CodeQL solo corren con el repo público: al hacerlo privado requieren Advanced Security o un reemplazo |
| `pnpm audit` bloqueante en las tres piezas | A.8.8 | CC7.1 | Implementado | Workflows de CI |
| Actualizaciones automáticas de dependencias | A.8.8 | CC7.1 | Parcial | `.github/dependabot.yml`. Faltan las alertas de Dependabot en el repo |
| Actions fijadas por SHA y permisos mínimos | A.5.21, A.8.28 | CC9.2 | Implementado | `.github/workflows/` |
| Revisión de seguridad por PR y por release | A.8.25, A.8.29 | CC8.1 | Implementado | `CLAUDE.md`, sección 5.1 |
| Entornos separados; sin datos reales en pruebas | A.8.31, A.8.33 | CC8.1 | Parcial | Variables y e2e separados. QA y producción: PF-30 |

## Privacidad

| Control | ISO 27701 (tema) | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|---|
| Datos personales fuera de logs y bitácora | Minimización | A.8.11, A.8.12 | C1.1, P4 | Implementado | `redact-sensitive-data.ts` y su spec |
| Registro de tratamiento | Registros de tratamiento | A.5.34 | P1, P6 | Parcial | `data-inventory.md`, borrador con huecos marcados |
| Consentimiento y aviso de privacidad | Consentimiento, información al titular | A.5.34 | P1, P2 | **Pendiente** | PF-49, bloqueada por ley aplicable y texto legal |
| Conservación y borrado, también en respaldos | Limitación de conservación | A.5.33, A.8.10 | C1.2, P4 | **Pendiente** | PF-49 |
| Acceso, rectificación, portabilidad y borrado | Derechos del titular | A.5.34 | P5 | **Pendiente** | PF-49. La bitácora ya no guarda nombre, correo ni teléfono |
| Evaluación de impacto (DPIA) | Evaluación de impacto | A.5.34 | P1 | **Pendiente** | Antes del release con clientes reales, y al sumar IA (PF-32) |
| Transferencias internacionales | Transferencias | A.5.34 | P6 | **Pendiente** | Depende de la región de los proveedores |

## Disponibilidad y continuidad

| Control | ISO 27001 | SOC 2 | Estado | Evidencia o qué falta |
|---|---|---|---|---|
| Salud de la API y apagado ordenado | A.8.6, A.8.14 | A1.1 | Implementado | `health.controller.ts`, `main.ts` |
| Respaldos con restauración probada | A.8.13 | A1.2, A1.3 | **Pendiente** | PF-30 |
| Plan de continuidad y recuperación (RTO/RPO) | A.5.29, A.5.30 | A1.3, CC7.5 | **Pendiente** | Organización y PF-30 |

## Organización (fuera de este repo)

Nada de esto se resuelve con código, y sin ello no hay certificación:

| Tema | ISO 27001 | SOC 2 |
|---|---|---|
| Alcance del SGSI y PIMS, políticas, responsables y apoyo de la dirección | Cláusulas 4 y 5, A.5.1, A.5.2 | CC1, CC2, CC5 |
| Evaluación de riesgos y Declaración de Aplicabilidad | Cláusula 6 | CC3 |
| Roles de privacidad: quién es responsable y quién encargado | A.5.31, A.5.34 | P1 |
| Contratos y evaluación de proveedores (DPA) | A.5.19 a A.5.23 | CC9.2 |
| Plan de respuesta a incidentes y notificación de brechas | A.5.24 a A.5.28 | CC7.3, CC7.4 |
| Formación, incorporación y salida del personal | A.6.1 a A.6.5 | CC1.4 |
| Auditoría interna y revisión por la dirección | Cláusula 9 | CC4 |
