// Antes de importar AppModule: ConfigModule valida el entorno al cargarse.
vi.hoisted(() => {
  process.env.THROTTLE_STORAGE = 'postgres';
});

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';

const LOGIN_LIMIT = 5;

/**
 * Límite de peticiones en Postgres (PF-60): dos instancias de la API comparten
 * los contadores, como pasaría al escalar en producción.
 */
describe('Límite de peticiones compartido (e2e)', () => {
  const apps: INestApplication[] = [];
  let prisma: PrismaService;

  async function startInstance(): Promise<INestApplication> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    apps.push(app);
    return app;
  }

  beforeAll(async () => {
    await startInstance();
    await startInstance();
    prisma = apps[0].get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.throttleCounter.deleteMany();
  });

  afterAll(async () => {
    await prisma?.throttleCounter.deleteMany();
    await Promise.all(apps.map((app) => app.close()));
  });

  const badLogin = (app: INestApplication) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nadie@example.com', password: 'incorrecta' });

  it('con dos instancias, el límite de login se mantiene', async () => {
    const [a, b] = apps;
    // Repartidos entre las dos: en memoria, cada una contaría solo la mitad.
    for (let i = 0; i < LOGIN_LIMIT; i++) {
      await badLogin(i % 2 ? b : a).expect(401);
    }

    await badLogin(a).expect(429);
    const blocked = await badLogin(b).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('guarda la clave con hash, nunca la IP en claro', async () => {
    await badLogin(apps[0]).expect(401);

    const counters = await prisma.throttleCounter.findMany();
    expect(counters.length).toBeGreaterThan(0);
    for (const counter of counters) {
      expect(counter.key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('una ventana vencida vuelve a empezar', async () => {
    for (let i = 0; i < LOGIN_LIMIT; i++) await badLogin(apps[0]).expect(401);
    await badLogin(apps[0]).expect(429);

    // Se adelanta el reloj de los contadores en vez de esperar un minuto.
    await prisma.$executeRaw`
      UPDATE throttle_counters
         SET window_ends_at = now() - interval '1 second',
             blocked_until = now() - interval '1 second'`;

    await badLogin(apps[1]).expect(401);
  });
});
