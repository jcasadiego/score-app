import {
  assertLeastPrivilege,
  databaseUserFromUrl,
  privilegeProblems,
  quoteIdent,
  quoteLiteral,
  type QueryRows,
} from './database-roles';

const ROLE_OK = {
  rolsuper: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolbypassrls: false,
  can_create: false,
};

const table = (tablename: string, overrides: Record<string, boolean> = {}) => ({
  tablename,
  can_select: true,
  can_insert: true,
  can_update: true,
  can_delete: true,
  can_truncate: false,
  ...overrides,
});

/** Responde en orden: rol, tablas propias, permisos por tabla. */
function fakeQuery(role: object, owned: object[], tables: object[]): QueryRows {
  const answers = [[role], owned, tables];
  return (() => Promise.resolve(answers.shift())) as QueryRows;
}

describe('databaseUserFromUrl', () => {
  it('saca usuario, contraseña y esquema, decodificados', () => {
    expect(
      databaseUserFromUrl(
        'postgresql://score_app:p%40ss%2Fw@db:5432/score?schema=core&sslmode=require',
      ),
    ).toEqual({ user: 'score_app', password: 'p@ss/w', schema: 'core' });
  });

  it('usa el esquema public si la URL no lo trae', () => {
    expect(databaseUserFromUrl('postgresql://a:b@db/score').schema).toBe(
      'public',
    );
  });

  it('rechaza una URL sin contraseña', () => {
    expect(() => databaseUserFromUrl('postgresql://a@db/score')).toThrow(
      'usuario y contraseña',
    );
  });
});

describe('comillas de Postgres', () => {
  it('duplica las comillas dobles del identificador', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it('duplica las comillas simples del literal y deja la barra tal cual', () => {
    expect(quoteLiteral("x'; DROP ROLE y; --\\")).toBe(
      "'x''; DROP ROLE y; --\\'",
    );
  });
});

describe('privilegeProblems', () => {
  it('no reporta nada si el rol tiene justo sus permisos', async () => {
    const query = fakeQuery(
      ROLE_OK,
      [],
      [
        table('users'),
        table('audit_logs', { can_update: false, can_delete: false }),
        table('_prisma_migrations', { can_select: false, can_insert: false }),
      ],
    );
    expect(await privilegeProblems(query, 'public')).toEqual([]);
  });

  it('reporta al dueño de las tablas y al superusuario', async () => {
    const query = fakeQuery(
      { ...ROLE_OK, rolsuper: true, can_create: true },
      [{ tablename: 'audit_logs' }],
      [],
    );
    expect(await privilegeProblems(query, 'public')).toEqual([
      'es superusuario',
      'puede crear objetos en public',
      'es dueño de tablas (puede alterarlas): audit_logs',
    ]);
  });

  it('reporta poder modificar la bitácora y la falta de un permiso', async () => {
    const query = fakeQuery(
      ROLE_OK,
      [],
      [
        table('audit_logs', { can_delete: false }),
        table('reports', { can_delete: false }),
        table('users', { can_truncate: true }),
      ],
    );
    expect(await privilegeProblems(query, 'public')).toEqual([
      'puede modificar audit_logs, que es de solo inserción',
      'no puede modificar reports',
      'puede vaciar users',
    ]);
  });

  it('assertLeastPrivilege falla con la lista de problemas', async () => {
    const query = fakeQuery({ ...ROLE_OK, rolcreaterole: true }, [], []);
    await expect(assertLeastPrivilege(query, 'public')).rejects.toThrow(
      'puede crear roles',
    );
  });
});
