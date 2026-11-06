import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserRole } from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { PrismaService } from './../src/prisma/prisma.service';

const USERS = '/api/v1/users';
const LEADS = '/api/v1/leads';
const STAMP = Date.now();
const email = (name: string) => `${name}.${STAMP}@roles-e2e.test.local`;

describe('Roles Revisor y Aprobador (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reviewer: { id: string; token: string };
  let approver: { id: string; token: string };

  const server = () => request(app.getHttpServer());

  /** Usuario y sesión directos en la base, como en los demás e2e. */
  async function signedIn(name: string, role: UserRole) {
    const user = await prisma.user.create({
      data: { name, email: email(name), passwordHash: 'x', role },
    });
    const session = await prisma.userSession.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const token = await app
      .get(JwtService)
      .signAsync(
        { sub: user.id, ver: user.sessionVersion, sid: session.id },
        { secret: process.env.JWT_SECRET },
      );
    return { id: user.id, token };
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    approver = await signedIn('aprobador', UserRole.ADMIN);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: email('revisor') } });
    reviewer = await signedIn('revisor', UserRole.REVIEWER);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: `.${STAMP}@roles-e2e.test.local` } },
    });
    await app.close();
    vi.restoreAllMocks();
  });

  describe('matriz sobre las rutas existentes', () => {
    it.each([
      ['get', USERS],
      ['post', USERS],
      ['get', `${USERS}/cualquiera`],
      ['patch', `${USERS}/cualquiera`],
      ['patch', `${USERS}/cualquiera/reset-mfa`],
      ['post', `${USERS}/cualquiera/password-reset`],
      ['patch', `${USERS}/cualquiera/deactivate`],
      ['patch', `${USERS}/cualquiera/activate`],
      ['post', '/api/v1/access-links'],
    ] as const)('Revisor recibe 403 en %s %s', async (method, path) => {
      const response = await server()
        [method](path)
        .set(bearer(reviewer.token))
        .send({})
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('Revisor ve los leads', async () => {
      await server().get(LEADS).set(bearer(reviewer.token)).expect(200);
    });

    it('Revisor puede cambiar el estado de un lead: llega a la lógica de la ruta', async () => {
      await server()
        .patch(`${LEADS}/no-existe/status`)
        .set(bearer(reviewer.token))
        .send({ status: 'CONTACTED' })
        .expect(404);
    });

    it('Aprobador entra a usuarios y a leads', async () => {
      await server().get(USERS).set(bearer(approver.token)).expect(200);
      await server().get(LEADS).set(bearer(approver.token)).expect(200);
    });

    it('un 403 queda en la bitácora con quién lo intentó', async () => {
      const since = new Date();
      await server().get(USERS).set(bearer(reviewer.token)).expect(403);

      const log = await vi.waitFor(() =>
        prisma.auditLog
          .findFirst({
            where: {
              action: 'ACCESS_DENIED',
              actorId: reviewer.id,
              createdAt: { gte: since },
            },
          })
          .then((found) => {
            expect(found).not.toBeNull();
            return found;
          }),
      );
      expect(log).not.toBeNull();
    });
  });

  describe('asignar el rol', () => {
    const NEW_USER = { name: 'Nuevo' };

    it('crear exige el rol', async () => {
      await server()
        .post(USERS)
        .set(bearer(approver.token))
        .send({ ...NEW_USER, email: email('sinrol') })
        .expect(400);
    });

    it('crea con el rol elegido y lo devuelve', async () => {
      const { body } = await server()
        .post(USERS)
        .set(bearer(approver.token))
        .send({ ...NEW_USER, email: email('nuevo'), role: 'REVIEWER' })
        .expect(201);

      expect(body.role).toBe('REVIEWER');
    });

    it('rechaza un rol que no existe', async () => {
      await server()
        .patch(`${USERS}/${reviewer.id}`)
        .set(bearer(approver.token))
        .send({ role: 'SUPERADMIN' })
        .expect(400);
    });
  });

  describe('cambiar el rol', () => {
    it('corta el token anterior en la siguiente petición y queda en la bitácora', async () => {
      await server().get(LEADS).set(bearer(reviewer.token)).expect(200);

      await server()
        .patch(`${USERS}/${reviewer.id}`)
        .set(bearer(approver.token))
        .send({ role: 'ADMIN' })
        .expect(200);

      await server().get(LEADS).set(bearer(reviewer.token)).expect(401);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_ROLE_CHANGED', entityId: reviewer.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(log.actorId).toBe(approver.id);
      expect(log.data).toEqual({ from: 'REVIEWER', to: 'ADMIN' });
    });

    it('un Revisor no puede subirse el rol a sí mismo', async () => {
      await server()
        .patch(`${USERS}/${reviewer.id}`)
        .set(bearer(reviewer.token))
        .send({ role: 'ADMIN' })
        .expect(403);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: reviewer.id },
      });
      expect(user.role).toBe('REVIEWER');
    });

    it('reenviar el mismo rol no cierra la sesión', async () => {
      await server()
        .patch(`${USERS}/${reviewer.id}`)
        .set(bearer(approver.token))
        .send({ role: 'REVIEWER' })
        .expect(200);

      await server().get(LEADS).set(bearer(reviewer.token)).expect(200);
    });
  });
});
