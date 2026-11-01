import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

const EMAIL = 'renovacion.e2e@example.com';
const PASSWORD = 'clave-renovacion-123';

describe('Renovación de sesión (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.user.create({
      data: {
        name: 'Renovación E2E',
        email: EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
      },
    });
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  async function login(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    return response.body.accessToken;
  }

  function refresh(token: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${token}`);
  }

  const decode = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

  it('devuelve un token que sirve y conserva el momento del login', async () => {
    const token = await login();

    const response = await refresh(token).expect(200);

    expect(decode(response.body.accessToken).authAt).toBe(decode(token).authAt);
    await refresh(response.body.accessToken).expect(200);
  });

  it('rechaza una petición sin token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .expect(401);
  });

  it('rechaza un token de una cuenta desactivada', async () => {
    const token = await login();
    await prisma.user.update({
      where: { email: EMAIL },
      data: { active: false },
    });

    await refresh(token).expect(401);
  });

  it('rechaza un token anterior al último cambio de contraseña', async () => {
    const token = await login();
    await prisma.user.update({
      where: { email: EMAIL },
      data: { sessionVersion: { increment: 1 } },
    });

    await refresh(token).expect(401);
  });

  describe('cierre de sesión', () => {
    function logout(token: string) {
      return request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);
    }

    function checkSession(token: string) {
      return request(app.getHttpServer())
        .get('/api/v1/auth/session')
        .set('Authorization', `Bearer ${token}`);
    }

    it('revoca el token aunque no haya vencido', async () => {
      const token = await login();
      await checkSession(token).expect(204);

      await logout(token).expect(204);

      await checkSession(token).expect(401);
      await refresh(token).expect(401);
    });

    it('revoca también un token renovado antes del logout', async () => {
      const token = await login();
      const renewed = (await refresh(token).expect(200)).body.accessToken;

      await logout(token).expect(204);

      await checkSession(renewed).expect(401);
    });

    it('un login nuevo cierra la sesión anterior', async () => {
      const first = await login();
      const renewed = (await refresh(first).expect(200)).body.accessToken;

      const second = await login();

      await checkSession(first).expect(401);
      await checkSession(renewed).expect(401);
      await refresh(first).expect(401);
      await checkSession(second).expect(204);
    });

    it('con logins simultáneos queda una sola sesión', async () => {
      const tokens = await Promise.all([login(), login(), login()]);

      const { id: userId } = await prisma.user.findUniqueOrThrow({
        where: { email: EMAIL },
      });
      expect(await prisma.userSession.count({ where: { userId } })).toBe(1);

      const statuses = await Promise.all(
        tokens.map(async (token) => (await checkSession(token)).status),
      );
      expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    });

    it('reactivar una cuenta no revive sus tokens anteriores', async () => {
      const token = await login();
      const users = app.get(UsersService);
      const { id } = await prisma.user.findUniqueOrThrow({
        where: { email: EMAIL },
      });

      await users.deactivate(id);
      await users.activate(id);

      await checkSession(token).expect(401);
      await checkSession(await login()).expect(204);
    });

    it('rechaza un token firmado sin sesión', async () => {
      const token = await login();
      const { sub, email, role, ver, authAt } = decode(token);
      const noSession = await app
        .get(JwtService)
        .signAsync(
          { sub, email, role, ver, authAt },
          { secret: process.env.JWT_SECRET, expiresIn: '1h' },
        );

      await checkSession(noSession).expect(401);
    });
  });
});
