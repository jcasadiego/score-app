import { Client } from 'pg';
import {
  applyAppRole,
  databaseUserFromUrl,
} from '../src/prisma/database-roles';

/**
 * Crea o ajusta el rol de la API y le aplica sus permisos (PF-58). Corre al
 * desplegar, después de `prisma migrate deploy`, con el rol de migraciones:
 * en QA desde `scripts/start-qa.sh`; en PROD, desde el job de migraciones
 * (PF-75).
 *
 * - `MIGRATION_DATABASE_URL`: rol de migraciones, dueño del esquema.
 * - `DATABASE_URL`: rol de la API. El usuario y la contraseña salen de aquí.
 *
 * Exige `standard_conforming_strings` activo (lo está por defecto).
 */
async function main() {
  const ownerUrl = requireEnv('MIGRATION_DATABASE_URL');
  const app = databaseUserFromUrl(requireEnv('DATABASE_URL'));

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const {
      rows: [setting],
    } = await owner.query<{ standard_conforming_strings: string }>(
      'SHOW standard_conforming_strings',
    );
    if (setting.standard_conforming_strings !== 'on') {
      throw new Error('standard_conforming_strings debe estar activo');
    }
    await applyAppRole(owner, app);
    // Sin la contraseña: este log llega a Render.
    console.log(`Rol de la API listo: ${app.user} (esquema ${app.schema})`);
  } finally {
    await owner.end();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

main().catch((error: unknown) => {
  // Solo el mensaje: un error de pg podría traer la sentencia con la contraseña.
  console.error(error instanceof Error ? error.message : 'Error desconocido');
  process.exit(1);
});
