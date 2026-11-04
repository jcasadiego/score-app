# Cumplimiento de SCORE: SOC 2, ISO 27001 e ISO 27701

SCORE se construye y se mantiene conforme a estas tres normas. Esta carpeta
registra qué controles existen, cuáles faltan y con qué se comprueban.

| Norma | Versión de referencia | Qué se obtiene |
|---|---|---|
| SOC 2 | Trust Services Criteria (AICPA, 2017, puntos de enfoque de 2022): seguridad, disponibilidad, confidencialidad y privacidad | Informe de atestación de un CPA. Tipo I: diseño en una fecha. Tipo II: operación durante un periodo |
| ISO/IEC 27001 | 2022 | Certificado del sistema de gestión (SGSI) |
| ISO/IEC 27701 | 2025, ahora certificable por sí sola o integrada con 27001 | Certificado del sistema de gestión de privacidad (PIMS) |

## Qué se puede afirmar hoy

**SCORE no está certificado ni tiene informe SOC 2.** Ninguna de las tres se
obtiene solo con código: se evalúa a la organización que opera el producto, sus
políticas, sus proveedores y la evidencia acumulada en el tiempo, y lo hace un
auditor externo. Este repo aporta los controles técnicos y su evidencia.

No escribir "certificado", "SOC 2 compliant" ni nada parecido en el sitio, en
contratos o en material comercial hasta tener el certificado o el informe.

## Documentos

- [`control-matrix.md`](control-matrix.md): cada control, su estado y su evidencia.
- [`data-inventory.md`](data-inventory.md): datos personales, finalidad,
  conservación y proveedores. Es el borrador del registro de tratamiento.

## Cómo se mantiene

Es parte del flujo normal (ver `CLAUDE.md`, sección 5.2): el PR que cambia un
control o un dato personal actualiza estos documentos, y su plantilla lo recuerda.
Antes de cada release `develop` → `main` se revisa la matriz junto con la
auditoría de seguridad de la sección 5.1. El historial de PRs, los resultados de
CI y la bitácora son la evidencia que pedirá el auditor.

Las referencias a controles orientan el trabajo y deben confirmarse contra las
normas licenciadas y con el auditor. En ISO 27701 se cita el tema y no el número,
porque la edición 2025 renumeró sus controles.
