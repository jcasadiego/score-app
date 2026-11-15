import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';

/**
 * Separación de roles de la base (PF-58).
 *
 * - El rol de migraciones (`MIGRATION_DATABASE_URL`) es dueño del esquema y
 *   solo se usa al desplegar.
 * - El rol de la API (`DATABASE_URL`) no tiene DDL: lee y escribe datos, y en
 *   las tablas de solo inserción solo puede leer e insertar. Como no es dueño
 *   de nada, no puede quitar el trigger de `audit_logs` ni alterar tablas.
 *
 * El despliegue aplica los permisos tras cada migración
 * (`scripts/db-app-role.ts`), y la API comprueba al arrancar en producción que
 * su rol cumple (`assertLeastPrivilege`).
 */

/**
 * Tablas en las que la API solo puede leer e insertar: la bitácora y los
 * historiales que un trigger ya declara de solo inserción. El permiso se quita
 * además del trigger, para no depender solo de él.
 */
export const APPEND_ONLY_TABLES = [
  'audit_logs',
  'answer_corrections',
  'answer_correction_selections',
  'report_section_revisions',
  'report_approval_revisions',
  'report_deliveries',
  'report_downloads',
] as const;

/** Tablas internas de Prisma: la API no las toca. */
export const INTERNAL_TABLES = ['_prisma_migrations'] as const;

export interface DatabaseUser {
  user: string;
  password: string;
  schema: string;
}

/** Usuario, contraseña y esquema de una URL de conexión de Postgres. */
export function databaseUserFromUrl(databaseUrl: string): DatabaseUser {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!user || !password) {
    throw new Error('La URL de la base no trae usuario y contraseña');
  }
  return {
    user,
    password,
    schema: url.searchParams.get('schema') || 'public',
  };
}

/** Comillas de identificador de Postgres, igual que `quote_ident`. */
export function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Verificador SCRAM-SHA-256 de una contraseña, en el formato que guarda
 * Postgres (RFC 5802 y 7677). Va en `CREATE/ALTER ROLE ... PASSWORD` en lugar
 * de la contraseña: así nunca viaja en claro ni queda en un log de sentencias
 * del servidor.
 */
export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations = 4096,
): string {
  // Postgres normaliza con SASLprep; con ASCII imprimible no cambia nada.
  if (!/^[\x21-\x7e]+$/.test(password)) {
    throw new Error(
      'La contraseña del rol de la API debe ser ASCII imprimible, sin espacios',
    );
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return (
    `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}` +
    `$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
  );
}

/** Si la URL exige TLS (`sslmode` require, verify-ca o verify-full). */
export function hasEncryptedConnection(databaseUrl: string): boolean {
  try {
    const sslMode = new URL(databaseUrl).searchParams.get('sslmode');
    return ['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '');
  } catch {
    return false;
  }
}

/**
 * Comillas de literal de Postgres. Con `standard_conforming_strings` (activo
 * por defecto desde Postgres 9.1) la barra invertida no escapa nada: basta
 * duplicar la comilla simple.
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Crea o ajusta el rol de la API y deja sus permisos exactos. Corre con la
 * conexión del rol de migraciones (dueño del esquema), en una transacción, y
 * es idempotente: se aplica después de cada migración.
 */
export async function applyAppRole(
  owner: ClientBase,
  app: DatabaseUser,
): Promise<void> {
  const {
    rows: [current],
  } = await owner.query<{ user: string; database: string }>(
    'SELECT current_user AS user, current_database() AS database',
  );
  if (current.user === app.user) {
    throw new Error(
      'DATABASE_URL y MIGRATION_DATABASE_URL usan el mismo usuario: la API quedaría con permisos de dueña',
    );
  }

  const role = quoteIdent(app.user);
  const schema = quoteIdent(app.schema);
  const attributes =
    'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  const password = `PASSWORD ${quoteLiteral(scramSha256Verifier(app.password))}`;

  await owner.query('BEGIN');
  try {
    const { rowCount } = await owner.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [app.user],
    );
    // La contraseña se fija siempre: la URL de la API es la fuente de verdad,
    // y así una rotación solo exige cambiar la variable y volver a desplegar.
    await owner.query(
      rowCount
        ? `ALTER ROLE ${role} WITH ${attributes} ${password}`
        : `CREATE ROLE ${role} WITH ${attributes} ${password}`,
    );

    await owner.query(
      `GRANT CONNECT ON DATABASE ${quoteIdent(current.database)} TO ${role}`,
    );
    await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await owner.query(`REVOKE CREATE ON SCHEMA ${schema} FROM ${role}`);

    // Se parte de cero en cada corrida, para que un permiso de más no quede.
    await owner.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`,
    );
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
    for (const table of APPEND_ONLY_TABLES) {
      await owner.query(
        `REVOKE UPDATE, DELETE ON ${schema}.${quoteIdent(table)} FROM ${role}`,
      );
    }
    for (const table of INTERNAL_TABLES) {
      await owner.query(
        `REVOKE ALL ON ${schema}.${quoteIdent(table)} FROM ${role}`,
      );
    }
    await owner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`,
    );
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}

/** Ejecuta una consulta y devuelve sus filas. */
export type QueryRows = <T>(sql: string, params: unknown[]) => Promise<T[]>;

/**
 * Lista lo que el rol conectado tiene de más o de menos frente a lo que
 * debe tener la API. Vacía si cumple.
 */
export async function privilegeProblems(
  query: QueryRows,
  schema: string,
): Promise<string[]> {
  const problems: string[] = [];

  const [role] = await query<{
    rolsuper: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolbypassrls: boolean;
    can_create: boolean;
    member_of: string[];
  }>(
    `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
            has_schema_privilege(current_user, $1, 'CREATE') AS can_create,
            ARRAY(SELECT g.rolname::text FROM pg_auth_members m
                    JOIN pg_roles g ON g.oid = m.roleid
                   WHERE m.member = r.oid ORDER BY g.rolname) AS member_of
       FROM pg_roles r WHERE r.rolname = current_user`,
    [schema],
  );
  if (role.rolsuper) problems.push('es superusuario');
  if (role.rolcreaterole) problems.push('puede crear roles');
  if (role.rolcreatedb) problems.push('puede crear bases');
  if (role.rolbypassrls) problems.push('ignora RLS');
  if (role.can_create) problems.push(`puede crear objetos en ${schema}`);
  // Con NOINHERIT no hereda permisos, pero podría hacer SET ROLE a esos roles.
  if (role.member_of.length) {
    problems.push(`pertenece a otros roles: ${role.member_of.join(', ')}`);
  }

  // MEMBER y no USAGE: con NOINHERIT, USAGE no ve la membresía.
  const owned = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = $1 AND pg_has_role(current_user, tableowner, 'MEMBER')
      ORDER BY tablename`,
    [schema],
  );
  if (owned.length) {
    problems.push(
      `es dueño de tablas (puede alterarlas): ${owned.map((t) => t.tablename).join(', ')}`,
    );
  }

  const tables = await query<{
    tablename: string;
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
    can_truncate: boolean;
  }>(
    `SELECT tablename,
            has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'SELECT') AS can_select,
            has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'INSERT') AS can_insert,
            has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'UPDATE') AS can_update,
            has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'DELETE') AS can_delete,
            has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'TRUNCATE') AS can_truncate
       FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [schema],
  );
  const appendOnly: readonly string[] = APPEND_ONLY_TABLES;
  const internal: readonly string[] = INTERNAL_TABLES;
  for (const t of tables) {
    if (internal.includes(t.tablename)) continue;
    if (t.can_truncate) problems.push(`puede vaciar ${t.tablename}`);
    if (!t.can_select || !t.can_insert) {
      problems.push(`no puede leer o insertar en ${t.tablename}`);
    }
    if (appendOnly.includes(t.tablename)) {
      if (t.can_update || t.can_delete) {
        problems.push(
          `puede modificar ${t.tablename}, que es de solo inserción`,
        );
      }
    } else if (!t.can_update || !t.can_delete) {
      problems.push(`no puede modificar ${t.tablename}`);
    }
  }
  return problems;
}

/**
 * Falla si el rol de la API no tiene exactamente sus permisos. Se llama al
 * arrancar en producción: un permiso faltante falla ahí y no en una petición,
 * y uno de más (dueña del esquema) deja la API sin arrancar.
 */
export async function assertLeastPrivilege(
  query: QueryRows,
  schema: string,
): Promise<void> {
  const problems = await privilegeProblems(query, schema);
  if (problems.length) {
    throw new Error(
      `El rol de DATABASE_URL no cumple el mínimo privilegio (PF-58): ${problems.join('; ')}. ` +
        'Usar el rol de la API y aplicar sus permisos con scripts/db-app-role.ts',
    );
  }
}
