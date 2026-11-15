import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import {
  APPEND_ONLY_TABLES,
  applyAppRole,
  databaseUserFromUrl,
  privilegeProblems,
  quoteIdent,
  type QueryRows,
} from '../src/prisma/database-roles';

// Base y rol propios: los roles son de todo el servidor, no de una base.
const DATABASE = `score_roles_${process.pid}`;
const ROLE = `score_app_e2e_${process.pid}`;
const PASSWORD = `${randomBytes(12).toString('hex')}'"\\x`;

function urlFor(name: string, user?: { user: string; password: string }) {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  if (user) {
    url.username = encodeURIComponent(user.user);
    url.password = encodeURIComponent(user.password);
  }
  return url.toString();
}

const asQuery =
  (client: Client): QueryRows =>
  async <T>(sql: string, params: unknown[]) =>
    (await client.query(sql, params)).rows as T[];

/** Código SQLSTATE con que falla la sentencia, o null si no falla. */
async function sqlState(client: Client, sql: string): Promise<string | null> {
  try {
    await client.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'sin código';
  }
}

describe('Roles de la base (PF-58)', () => {
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  let owner: Client;
  let app: Client;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: urlFor(DATABASE) },
      stdio: 'pipe',
    });

    owner = new Client({ connectionString: urlFor(DATABASE) });
    await owner.connect();
    const appUser = { user: ROLE, password: PASSWORD, schema: 'public' };
    await applyAppRole(owner, appUser);
    // Dos veces: se aplica en cada despliegue.
    await applyAppRole(owner, appUser);

    app = new Client({ connectionString: urlFor(DATABASE, appUser) });
    await app.connect();
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.end();
  });

  it('el rol de la API cumple el mínimo privilegio y el dueño no', async () => {
    expect(await privilegeProblems(asQuery(app), 'public')).toEqual([]);
    expect(await privilegeProblems(asQuery(owner), 'public')).toContainEqual(
      expect.stringContaining('es dueño de tablas'),
    );
  });

  it('con el rol de la API, ALTER TABLE y DROP TRIGGER fallan', async () => {
    // 42501: permiso denegado (no es dueño).
    expect(
      await sqlState(app, 'ALTER TABLE audit_logs DISABLE TRIGGER ALL'),
    ).toBe('42501');
    expect(
      await sqlState(
        app,
        'DROP TRIGGER audit_logs_no_update_delete ON audit_logs',
      ),
    ).toBe('42501');
    expect(await sqlState(app, 'ALTER TABLE users ADD COLUMN x int')).toBe(
      '42501',
    );
    expect(await sqlState(app, 'CREATE TABLE intrusa (id int)')).toBe('42501');
  });

  it('con el rol de la API, la bitácora solo admite leer e insertar', async () => {
    expect(await sqlState(app, 'SELECT count(*) FROM audit_logs')).toBeNull();
    expect(await sqlState(app, 'UPDATE audit_logs SET action = action')).toBe(
      '42501',
    );
    expect(await sqlState(app, 'DELETE FROM audit_logs')).toBe('42501');
    expect(await sqlState(app, 'TRUNCATE audit_logs')).toBe('42501');
    expect(await sqlState(app, 'SELECT * FROM _prisma_migrations')).toBe(
      '42501',
    );
  });

  it('con el rol de la API, los historiales de solo inserción tampoco se modifican', async () => {
    for (const table of APPEND_ONLY_TABLES) {
      expect(await sqlState(app, `SELECT count(*) FROM ${table}`)).toBeNull();
      expect(await sqlState(app, `DELETE FROM ${table} WHERE false`)).toBe(
        '42501',
      );
    }
  });

  it('detecta si el rol de la API pertenece al dueño, aunque no herede', async () => {
    const {
      rows: [{ user }],
    } = await owner.query<{ user: string }>('SELECT current_user AS user');
    await admin.query(`GRANT ${quoteIdent(user)} TO ${ROLE}`);
    try {
      expect(await privilegeProblems(asQuery(app), 'public')).toContainEqual(
        `pertenece a otros roles: ${user}`,
      );
    } finally {
      await admin.query(`REVOKE ${quoteIdent(user)} FROM ${ROLE}`);
    }
  });

  it('con el rol de la API, el resto de las tablas admite leer y escribir', async () => {
    expect(await sqlState(app, 'SELECT id FROM users FOR UPDATE')).toBeNull();
    expect(
      await sqlState(app, 'UPDATE users SET name = name WHERE false'),
    ).toBeNull();
    expect(await sqlState(app, 'DELETE FROM leads WHERE false')).toBeNull();
  });

  it('rechaza usar el mismo usuario para la API y las migraciones', async () => {
    const { user, password } = databaseUserFromUrl(urlFor(DATABASE));
    await expect(
      applyAppRole(owner, { user, password, schema: 'public' }),
    ).rejects.toThrow('mismo usuario');
  });
});
