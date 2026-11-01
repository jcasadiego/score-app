import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';

const SECRET = 'secreto-del-panel-de-al-menos-32-caracteres';
const PASSWORD = 'clave-limite-123';
const LOGIN_LIMIT = 5;
const USER_A = 'limite.a.e2e@example.com';
const USER_B = 'limite.b.e2e@example.com';

describe('Límite de peticiones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // App nueva por test: el throttler guarda los contadores en memoria.
  beforeEach(async () => {
    process.env.PANEL_API_SECRET = SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    delete process.env.PANEL_API_SECRET;
    await prisma.user.deleteMany({
      where: { email: { in: [USER_A, USER_B] } },
    });
    await app.close();
  });

  function badLogin(headers: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ email: 'nadie@example.com', password: 'incorrecta' });
  }

  const fromPanel = (ip: string, secret = SECRET) => ({
    'x-panel-secret': secret,
    'x-client-ip': ip,
  });

  async function exhaustLogin(headers: () => Record<string, string>) {
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      await badLogin(headers()).expect(401);
    }
  }

  describe('login desde el panel', () => {
    it('una IP real agotada no bloquea a otra', async () => {
      await exhaustLogin(() => fromPanel('203.0.113.10'));

      await badLogin(fromPanel('203.0.113.10')).expect(429);
      await badLogin(fromPanel('203.0.113.11')).expect(401);
    });

    it.each([
      ['sin secreto', (ip: string) => ({ 'x-client-ip': ip })],
      ['con un secreto incorrecto', (ip: string) => fromPanel(ip, 'otro')],
    ])('%s ignora la IP informada', async (_name, headers) => {
      let n = 0;
      await exhaustLogin(() => headers(`203.0.113.${++n}`));

      await badLogin(headers('203.0.113.200')).expect(429);
    });

    it('ignora un valor que no es una IP', async () => {
      let n = 0;
      await exhaustLogin(() => fromPanel(`no-es-ip-${++n}`));

      await badLogin(fromPanel('no-es-ip-final')).expect(429);
    });

    it('sin PANEL_API_SECRET en la API ignora el encabezado', async () => {
      delete process.env.PANEL_API_SECRET;
      let n = 0;
      await exhaustLogin(() => fromPanel(`203.0.113.${++n}`));

      await badLogin(fromPanel('203.0.113.200')).expect(429);
    });
  });

  describe('peticiones con sesión', () => {
    const LIMIT = Number(process.env.THROTTLE_LIMIT ?? 100);

    async function createAndLogin(email: string): Promise<string> {
      await prisma.user.deleteMany({ where: { email } });
      await prisma.user.create({
        data: {
          name: 'Límite E2E',
          email,
          passwordHash: await argon2.hash(PASSWORD),
        },
      });
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      return response.body.accessToken;
    }

    function listUsers(token: string) {
      return request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${token}`);
    }

    it('cada usuario tiene su contador y una firma falsa no lo gasta', async () => {
      const tokenA = await createAndLogin(USER_A);
      const tokenB = await createAndLogin(USER_B);
      for (let i = 0; i < LIMIT; i++) {
        await listUsers(tokenA).expect(200);
      }

      await listUsers(tokenA).expect(429);
      await listUsers(tokenB).expect(200);

      // Dice ser el usuario A, pero con otra firma: cuenta por IP, no le toca
      // el contador agotado y lo rechaza `JwtAuthGuard`.
      const { sub } = JSON.parse(
        Buffer.from(tokenA.split('.')[1], 'base64url').toString(),
      );
      const forged = await app
        .get(JwtService)
        .signAsync(
          { sub },
          { secret: 'otro-secreto-de-al-menos-32-caracteres' },
        );
      await listUsers(forged).expect(401);

      // Un token vencido con firma válida sigue contando para su usuario.
      const expired = await app
        .get(JwtService)
        .signAsync(
          { sub, exp: Math.floor(Date.now() / 1000) - 60 },
          { secret: process.env.JWT_SECRET },
        );
      await listUsers(expired).expect(429);
    });
  });
});
