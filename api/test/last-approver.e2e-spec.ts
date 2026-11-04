import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { AuditService } from './../src/audit/audit.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

/**
 * "Queda un Aprobador activo" es una regla sobre toda la tabla, y los demás e2e
 * corren en paralelo creando Aprobadores en la misma base. Por eso este usa una
 * base propia, creada y borrada aquí.
 */
// En CI las variables ya vienen del workflow; en local, del `.env`.
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_last_approver_${process.pid}`;

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

describe('Último Aprobador activo (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let prisma: PrismaClient;
  let users: UsersService;

  const approver = (name: string) =>
    prisma.user.create({
      data: {
        name,
        email: `${name}@test.local`,
        passwordHash: 'x',
        role: 'ADMIN',
      },
    });

  const activeApprovers = () =>
    prisma.user.count({ where: { role: 'ADMIN', active: true } });

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DATABASE}`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl(DATABASE) },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl(DATABASE) }),
    });
    const service = prisma as unknown as PrismaService;
    users = new UsersService(service, new AuditService(service));
  }, 60_000);

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.$disconnect();
  });

  it('no deja pasar a Revisor al único Aprobador activo', async () => {
    const only = await approver('unico');

    await expect(
      users.update(only.id, { role: 'REVIEWER' }, only.id),
    ).rejects.toThrow('Debe quedar al menos un Aprobador activo.');
    expect(await activeApprovers()).toBe(1);
  });

  it('no deja desactivar al único Aprobador activo', async () => {
    const only = await approver('unico');

    await expect(users.deactivate(only.id, 'otro')).rejects.toThrow(
      'Debe quedar al menos un Aprobador activo.',
    );
    expect(await activeApprovers()).toBe(1);
  });

  it('un Aprobador inactivo no cuenta como el que queda', async () => {
    const [active, inactive] = [await approver('a'), await approver('b')];
    await prisma.user.update({
      where: { id: inactive.id },
      data: { active: false },
    });

    await expect(
      users.update(active.id, { role: 'REVIEWER' }, active.id),
    ).rejects.toThrow('Debe quedar al menos un Aprobador activo.');
  });

  it('con peticiones simultáneas siempre queda exactamente uno', async () => {
    for (let round = 0; round < 10; round++) {
      await prisma.user.deleteMany();
      const [a, b, c, d] = [
        await approver('a'),
        await approver('b'),
        await approver('c'),
        await approver('d'),
      ];

      const results = await Promise.allSettled([
        users.update(a.id, { role: 'REVIEWER' }, 'r'),
        users.deactivate(b.id, 'r'),
        users.update(c.id, { role: 'REVIEWER' }, 'r'),
        users.deactivate(d.id, 'r'),
      ]);

      // Tres pasan y el último choca con la regla; un deadlock daría otro error.
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
        'Debe quedar al menos un Aprobador activo.',
      );
      expect(await activeApprovers()).toBe(1);
    }
  }, 30_000);
});
