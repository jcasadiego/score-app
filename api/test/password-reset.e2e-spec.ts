import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { MAIL_PORT, MailMessage } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';

const BASE = '/api/v1/auth/password-reset';
const EMAIL = 'recuperacion.e2e@example.com';

describe('Recuperación de contraseña (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages: MailMessage[] = [];

  beforeEach(async () => {
    sentMessages.length = 0;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Captura el correo en vez de mandarlo, para sacar el enlace.
      .overrideProvider(MAIL_PORT)
      .useValue({
        send: async (message: MailMessage) => {
          sentMessages.push(message);
          return { sent: true, providerId: 'e2e' };
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.user.create({
      data: {
        name: 'Recuperación E2E',
        email: EMAIL,
        passwordHash: await argon2.hash('clave-vieja-123'),
      },
    });
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  function login(password: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password });
  }

  async function requestLink(): Promise<string> {
    const previousCount = sentMessages.length;
    await request(app.getHttpServer())
      .post(`${BASE}/request`)
      .send({ email: EMAIL })
      .expect(200);
    // El correo sale en segundo plano, después de responder.
    await vi.waitFor(() => {
      if (sentMessages.length === previousCount) throw new Error('sin correo');
    });
    const { text } = sentMessages[sentMessages.length - 1];
    return new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
  }

  it('responde lo mismo exista o no el correo, y solo envía al que existe', async () => {
    const exists = await request(app.getHttpServer())
      .post(`${BASE}/request`)
      .send({ email: EMAIL })
      .expect(200);
    const notExists = await request(app.getHttpServer())
      .post(`${BASE}/request`)
      .send({ email: 'nadie.e2e@example.com' })
      .expect(200);

    expect(notExists.body).toEqual(exists.body);
    await vi.waitFor(() => expect(sentMessages).toHaveLength(1));
    expect(sentMessages[0].to).toBe(EMAIL);
  });

  it('restablece una sola vez, cierra las sesiones y deja entrar con la nueva', async () => {
    const since = new Date();
    const oldSession = (await login('clave-vieja-123').expect(200)).body
      .accessToken;
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${oldSession}`)
      .expect(200);

    const token = await requestLink();
    await request(app.getHttpServer())
      .post(`${BASE}/confirm`)
      .send({ token, password: 'clave-nueva-456' })
      .expect(204);

    await request(app.getHttpServer())
      .post(`${BASE}/confirm`)
      .send({ token, password: 'otra-clave-789' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${oldSession}`)
      .expect(401);
    await login('clave-vieja-123').expect(401);
    await login('clave-nueva-456').expect(200);

    const auditEntries = await prisma.auditLog.findMany({
      where: { createdAt: { gte: since } },
    });
    expect(auditEntries.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_COMPLETED',
      ]),
    );
    expect(JSON.stringify(auditEntries)).not.toContain(token);
    expect(JSON.stringify(auditEntries)).not.toContain('clave-nueva-456');
  });

  it('pedir un enlace nuevo invalida el anterior', async () => {
    const first = await requestLink();
    const second = await requestLink();

    await request(app.getHttpServer())
      .post(`${BASE}/confirm`)
      .send({ token: first, password: 'clave-nueva-456' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${BASE}/confirm`)
      .send({ token: second, password: 'clave-nueva-456' })
      .expect(204);
  });

  it('rechaza una contraseña que no cumple las reglas', async () => {
    const token = await requestLink();

    await request(app.getHttpServer())
      .post(`${BASE}/confirm`)
      .send({ token, password: 'corta' })
      .expect(400);
  });

  it('limita las solicitudes por minuto', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`${BASE}/request`)
        .send({ email: 'nadie.e2e@example.com' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post(`${BASE}/request`)
      .send({ email: 'nadie.e2e@example.com' })
      .expect(429)
      .expect((r) => expect(r.body.error).toBe('Too Many Requests'));
  });
});
