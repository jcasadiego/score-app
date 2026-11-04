## Qué cambió y por qué

<!-- 2-3 líneas. Enlaza el ticket PF-XX. -->

## Prueba manual

<!-- Qué se probó contra la api local o en el navegador. -->

## Cumplimiento (SOC 2, ISO 27001, ISO 27701)

Ver `CLAUDE.md` sección 5.2. Marca lo revisado o explica por qué no aplica.

- [ ] **Acceso:** las rutas nuevas exigen autenticación y permiso, también por objeto.
- [ ] **Bitácora:** lo que cambia datos o lee datos personales queda auditado, sin esos datos.
- [ ] **Datos personales:** son los mínimos, y `docs/compliance/data-inventory.md` está al día.
- [ ] **Proveedores:** un servicio externo nuevo está aprobado y en el inventario.
- [ ] **Secretos:** ninguno en código o logs, y las variables nuevas están en `.env.example`.
- [ ] **Controles:** si cambió un control, `docs/compliance/control-matrix.md` está al día.
- [ ] `/security-review` corrido; revisión acotada si toca una frontera de confianza (5.1).
