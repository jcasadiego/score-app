import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';

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
});
