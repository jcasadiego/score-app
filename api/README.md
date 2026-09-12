# api (P4)

Base de datos, motor de cálculo de SCORE, CRM, pagos y bitácora de
auditoría. La consumen `apps/diagnostico` y `apps/panel` por HTTP. Ver
`../CLAUDE.md` para el contexto completo del monorepo.

Stack: NestJS 10 + TypeScript + Prisma 7 sobre PostgreSQL, con `pnpm` como
gestor de paquetes.

## Cómo correr en local

```bash
pnpm install
cp .env.example .env         # ajustar si hace falta
docker compose up -d         # levanta Postgres local
pnpm prisma migrate dev      # aplica el schema
pnpm start:dev                # http://localhost:3000
```

`GET /health` confirma que el servicio y la conexión a Postgres están
vivos.

## Scripts

- `pnpm start:dev` — servidor con recarga en caliente.
- `pnpm build` — compila a `dist/`.
- `pnpm lint` — ESLint + Prettier.
- `pnpm test:e2e` — pruebas end-to-end (requieren Postgres corriendo).
- `pnpm prisma migrate dev` — aplica cambios de `prisma/schema.prisma`.
- `pnpm prisma studio` — explorador visual de la base de datos.

## Estructura

- `src/prisma/` — `PrismaService` global, conecta vía driver adapter
  (`@prisma/adapter-pg`), requerido por Prisma 7.
- `src/motor-calculo/` — el motor de cálculo de SCORE queda detrás de
  `MotorCalculoPort` (`motor-calculo.port.ts`). Hoy solo existe
  `MotorCalculoStubAdapter`, un adaptador de ejemplo — se reemplaza
  cuando se confirme el escenario real del motor (API ya ejecutable,
  hoja de cálculo a portar, o construir desde cero; ver `CLAUDE.md`
  sección 3).
- `src/auditoria/` — bitácora de auditoría (requisito duro). El
  `AuditoriaInterceptor` registra automáticamente toda request mutante
  (POST/PUT/PATCH/DELETE); los servicios de dominio pueden llamar a
  `AuditoriaService.registrar(...)` directamente para un registro más
  específico.
- `src/reglas/` — versión de reglas aplicada a cada caso (requisito
  duro). El contenido de las reglas vive en una columna `jsonb`, no en
  código.
- `src/health/` — `GET /health`.

## Pendiente a propósito (no construir todavía)

- Modelos de dominio del cuestionario (`Caso`, respuestas, etc.) y la
  detección de contradicciones — dependen de la especificación completa
  del cuestionario de las 4 familias (Proyecto, B2B, Profesional,
  Catálogo), que todavía no existe.
- El motor de cálculo real detrás de `MotorCalculoPort`.
- Auth y permisos para `apps/panel` — el modelo de roles todavía no
  está definido.

## Nota de versiones

`@nestjs/cli@11` falla en Node 22 por un bug conocido de ciclo
ESM/CJS en su dependencia `ora@9` (`ERR_REQUIRE_CYCLE_MODULE`). Por eso
el proyecto quedó en Nest 10 (estable, sin ese problema). Revisar si
sigue vigente antes de subir de major.
