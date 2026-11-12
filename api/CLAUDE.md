# api — lecciones de PRs anteriores (no repetir)

Errores que ya costaron un PR de corrección. Antes de tocar estas zonas,
revisar la regla correspondiente. Reglas generales del repo: `CLAUDE.md` raíz.

- **Tests con Vitest, no Jest** (NestJS 12 es ESM, #18): `vi.fn()`,
  `vi.mock()`, tipo `Mock` de `vitest`. Detalle en `api/README.md`.
- Un e2e con base propia la borra con `DROP DATABASE ... WITH (FORCE)`: un
  trabajo en segundo plano puede seguir conectado tras `app.close()` y la suite
  fallaba al azar (#58). No se arregla bajando `maxWorkers`.
- **El entrypoint del build es `dist/src/main`**, no `dist/main` (`tsc`
  incluye `prisma.config.ts` y `generated/`). No mover `rootDir`: rompe
  los imports del cliente de Prisma generado (#14). Si cambia la
  estructura del build, comprobar `pnpm build && pnpm start:prod`.
- **Bitácora de auditoría:** toda ruta que cambia datos declara
  `@AuditRoute()`, y solo se guardan los campos declarados, también pasados
  por `redactSensitiveData()` — el login quedó guardando passwords en claro
  (#4). `audit_logs` es de solo inserción: los tests no pueden limpiarla. Un
  evento crítico pasa su `tx` a `AuditService.record` (PF-47). El actor sale de `request.user` (panel) o
  `request.accessLink` (cliente final), nunca de un campo que ningún guard
  setea (#5).
- **Auth:** desactivar un usuario debe cortar los JWT ya emitidos — el
  chequeo de `active` vive en `JwtStrategy.validate`, no solo en el login
  (#7). El login verifica siempre contra un hash (real o de relleno) para
  no filtrar por tiempo qué emails existen (#4). Ids de quien hace la
  acción, del JWT (`req.user.id`), nunca del cliente.
- Listados paginados y filtrados en la base (página + conteo en una
  transacción, orden estable), nunca en memoria (#13).
- **Bloqueo y restablecimiento (PF-65):** restablecer la contraseña solo levanta
  el bloqueo si no hubo un código de MFA rechazado en los últimos 15 minutos
  (`UsersService.unlockAfterPasswordReset`). No relajar esa condición: quien
  controle el buzón podría alternar restablecer y probar códigos sin límite. El
  aviso de bloqueo por correo tampoco se espera.
- **Login:** contar un intento fallido de contraseña nunca se espera (`await`):
  el tiempo de respuesta delataría qué emails existen. La contraseña correcta no
  limpia el contador, solo `completeLogin`; si no, se podrían probar códigos MFA
  sin fin. Solo `AuthService.completeLogin` abre sesión, tras el segundo factor.
- **Migraciones de renombre:** Prisma resuelve un rename como DROP +
  CREATE. Escribirlas a mano con `RENAME` y revisar siempre el SQL antes
  de aplicarlo (#26).
- **Migraciones con varios pasos:** Prisma no las envuelve en una transacción;
  un fallo deja aplicado lo anterior. Escribir `BEGIN`/`COMMIT` en el SQL y
  probarlo con un fallo forzado sobre una base aparte (PF-46).
