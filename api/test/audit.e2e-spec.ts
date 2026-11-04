import { Test } from '@nestjs/testing';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { AUDIT_ROUTE } from './../src/audit/audit-route.decorator';
import { AuditService } from './../src/audit/audit.service';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';

const LOGIN_PATH = '/api/v1/auth/login';

describe('Bitácora de auditoría (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
  });

  afterAll(() => app.close());

  function waitForLog(
    where: { action: string; entity?: string; entityId?: string },
    since: Date,
  ) {
    return vi.waitFor(() =>
      prisma.auditLog
        .findFirst({ where: { ...where, createdAt: { gte: since } } })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );
  }

  it('toda ruta que cambia datos declara cómo se audita', () => {
    const controllers = app.get(DiscoveryService).getControllers();
    const undeclared = controllers.flatMap(({ metatype, name }) => {
      const prototype = (metatype as { prototype: Record<string, object> })
        .prototype;
      return Object.getOwnPropertyNames(prototype)
        .filter(
          (method) =>
            method !== 'constructor' &&
            Reflect.getMetadata(PATH_METADATA, prototype[method]) !==
              undefined &&
            Reflect.getMetadata(METHOD_METADATA, prototype[method]) !==
              RequestMethod.GET &&
            !Reflect.getMetadata(AUDIT_ROUTE, prototype[method]),
        )
        .map((method) => `${name}.${method}`);
    });

    expect(controllers.length).toBeGreaterThan(0);
    expect(undeclared).toEqual([]);
  });

  it('un login exitoso identifica al usuario', async () => {
    const password = 'clave-correcta-123';
    const user = await prisma.user.create({
      data: {
        name: 'Con login',
        email: 'login.audit.e2e@example.com',
        passwordHash: await argon2.hash(password),
      },
    });
    const since = new Date();

    await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: user.email, password })
      .expect(200);
    // El segundo factor lo cubre `mfa.e2e-spec.ts`.
    await app.get(AuthService).completeLogin(user);

    const log = await waitForLog(
      { action: 'LOGIN_SUCCEEDED', entityId: user.id },
      since,
    );
    expect(log).toMatchObject({
      actorType: 'PANEL_USER',
      actorId: user.id,
      entity: 'User',
    });
    expect(JSON.stringify(log.data)).not.toContain(password);
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('no guarda campos no declarados, aunque no sean claves sensibles', async () => {
    const since = new Date();
    const response = await request(app.getHttpServer())
      .post('/api/v1/leads/prequalification')
      .send({
        name: 'Nombre Privado',
        email: 'privado.audit.e2e@example.com',
        phone: '+506 8888 8888',
        family: 'B2B',
      })
      .expect(201);

    const log = await waitForLog(
      { action: 'LEAD_CREATED', entityId: response.body.id },
      since,
    );

    expect(log).toMatchObject({
      entity: 'Lead',
      entityId: response.body.id,
      data: { body: { family: 'B2B' } },
    });
    expect(JSON.stringify(log.data)).not.toMatch(/Privado|privado|8888/);
    await prisma.lead.delete({ where: { id: response.body.id } });
  });

  it('registra un intento denegado sin guardar el body', async () => {
    const since = new Date();
    await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({
        email: 'nadie.audit.e2e@example.com',
        password: 'clave-erronea-1',
      })
      .expect(401);

    const log = await waitForLog(
      { action: 'AUTHENTICATION_FAILED', entity: LOGIN_PATH },
      since,
    );

    expect(log.actorType).toBe('SYSTEM');
    expect(log.data).toEqual({ method: 'POST', status: 401 });
  });

  it('registra un 403 con el actor que lo intentó', async () => {
    const since = new Date();
    const user = await prisma.user.create({
      data: {
        name: 'Sin rol',
        email: 'sin-rol.audit.e2e@example.com',
        passwordHash: 'x',
      },
    });
    const session = await prisma.userSession.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    // ADMIN es el único rol que existe: la negativa se simula en el guard.
    const token = new JwtService().sign(
      { sub: user.id, sid: session.id, ver: 0 },
      { secret: process.env.JWT_SECRET, expiresIn: '1m' },
    );
    const { RolesGuard } = await import('./../src/auth/roles.guard');
    const canActivate = vi
      .spyOn(RolesGuard.prototype, 'canActivate')
      .mockReturnValue(false);

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    canActivate.mockRestore();

    const log = await waitForLog(
      { action: 'ACCESS_DENIED', entity: '/api/v1/users' },
      since,
    );
    expect(log).toMatchObject({ actorType: 'PANEL_USER', actorId: user.id });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('una ruta inexistente no llena la bitácora', async () => {
    const since = new Date();
    await request(app.getHttpServer())
      .post('/api/v1/inventada')
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({
        email: 'marca.audit.e2e@example.com',
        password: 'clave-erronea-2',
      })
      .expect(401);
    await waitForLog({ action: 'AUTHENTICATION_FAILED' }, since);

    const logs = await prisma.auditLog.count({
      where: { entity: { contains: 'inventada' }, createdAt: { gte: since } },
    });
    expect(logs).toBe(0);
  });

  describe('eventos críticos en la misma transacción', () => {
    const lead = {
      name: 'Transacción',
      email: 'transaccion.audit.e2e@example.com',
      family: 'B2B' as const,
    };

    afterEach(() => prisma.lead.deleteMany({ where: { email: lead.email } }));

    it('si falla la operación, no queda el registro', async () => {
      const entityId = `falla-operacion-${Date.now()}`;

      await expect(
        prisma.$transaction(async (tx) => {
          await audit.record(
            { actorType: 'SYSTEM', action: 'E2E', entity: 'Lead', entityId },
            tx,
          );
          throw new Error('falla la operación');
        }),
      ).rejects.toThrow('falla la operación');

      await expect(
        prisma.auditLog.count({ where: { entityId } }),
      ).resolves.toBe(0);
    });

    it('si falla el registro, la operación se revierte', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.lead.create({ data: lead });
          await audit.record(
            { actorType: 'NO_EXISTE' as never, action: 'E2E', entity: 'Lead' },
            tx,
          );
        }),
      ).rejects.toThrow();

      await expect(
        prisma.lead.count({ where: { email: lead.email } }),
      ).resolves.toBe(0);
    });
  });

  describe('solo inserción', () => {
    it('la base rechaza UPDATE, DELETE y TRUNCATE', async () => {
      const log = await audit.record({
        actorType: 'SYSTEM',
        action: 'E2E_APPEND_ONLY',
        entity: 'Test',
      });

      await expect(
        prisma.auditLog.update({
          where: { id: log.id },
          data: { action: 'ALTERADO' },
        }),
      ).rejects.toThrow(/solo inserción/);
      await expect(
        prisma.auditLog.delete({ where: { id: log.id } }),
      ).rejects.toThrow(/solo inserción/);
      await expect(
        prisma.$executeRawUnsafe('TRUNCATE audit_logs'),
      ).rejects.toThrow(/solo inserción/);

      await expect(
        prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } }),
      ).resolves.toMatchObject({ action: 'E2E_APPEND_ONLY' });
    });
  });
});
