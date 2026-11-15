#!/usr/bin/env sh
# Arranque de la API en QA (Render, instancia gratuita): migra, siembra y
# levanta el servidor. Las instancias gratuitas no tienen comando previo al
# despliegue ni consola, así que todo pasa aquí. PROD no usa este script: allí
# la migración la hace un cron job aparte (PF-75).
#
# Si la migración o la siembra fallan, el proceso sale con código distinto de
# cero y Render conserva la versión anterior.
set -eu

# La siembra automática solo corre en QA; nunca con APP_ENV=production.
if [ "${APP_ENV:-}" != "qa" ]; then
  echo "start-qa: APP_ENV debe ser 'qa' (es '${APP_ENV:-}'); no se migra ni se siembra" >&2
  exit 1
fi

# Migraciones con el rol dueño del esquema; la API, con su rol sin DDL (PF-58).
if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
  echo "start-qa: falta MIGRATION_DATABASE_URL (rol de migraciones)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "start-qa: aplicando migraciones"
./node_modules/.bin/prisma migrate deploy

echo "start-qa: aplicando los permisos del rol de la API"
node dist/scripts/db-app-role.js

# Con el rol de la API (DATABASE_URL). Idempotente: no duplica el Aprobador
# ni el cuestionario de prueba.
echo "start-qa: sembrando el primer Aprobador y el cuestionario de prueba"
node dist/prisma/seed.js

# La API no hereda la credencial de migraciones: el proceso que atiende
# peticiones solo conoce su rol sin DDL.
unset MIGRATION_DATABASE_URL

# exec: el servidor reemplaza al shell y recibe SIGTERM directo de Render.
echo "start-qa: levantando la API"
exec node dist/src/main
