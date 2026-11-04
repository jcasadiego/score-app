import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { parseCorsOrigins } from './../src/config/cors';

const LOGIN_LIMIT = 5;

describe('Configuración de seguridad (e2e)', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  async function startApp(): Promise<void> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.TRUST_PROXY_HOPS;
    await app.close();
  });

  describe('propiedades no listadas en el DTO', () => {
    it('rechaza un campo de más en un endpoint público', async () => {
      await startApp();

      const response = await request(app.getHttpServer())
        .post('/api/v1/leads/prequalification')
        .send({
          name: 'Ana Pérez',
          email: 'no-listada.e2e@example.com',
          family: 'B2B',
          status: 'CONVERTED',
        })
        .expect(400);

      expect(response.body.errors).toContainEqual({
        field: 'status',
        message: 'property status should not exist',
      });
    });
  });

  describe('CORS', () => {
    it('solo autoriza los orígenes configurados', async () => {
      await startApp();
      const [allowed] = parseCorsOrigins(process.env.CORS_ORIGINS);

      const accepted = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', allowed);
      expect(accepted.headers['access-control-allow-origin']).toBe(allowed);
      expect(
        accepted.headers['access-control-allow-credentials'],
      ).toBeUndefined();

      const rejected = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'https://otro-sitio.example.com');
      expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Swagger', () => {
    it('carga fuera de producción y Helmet no bloquea sus scripts', async () => {
      await startApp();

      const response = await request(app.getHttpServer())
        .get('/docs')
        .expect(200);

      expect(response.headers['content-security-policy']).toContain(
        "script-src 'self'",
      );
      // La política no admite scripts en línea: todos deben ser archivos.
      expect(response.text).toMatch(/<script[^>]*\bsrc=/);
      expect(response.text).not.toMatch(/<script(?![^>]*\bsrc=)/);
    });

    it.each(['production', 'staging'])(
      'no se publica con NODE_ENV=%s',
      async (nodeEnv) => {
        process.env.NODE_ENV = nodeEnv;
        await startApp();

        await request(app.getHttpServer()).get('/docs').expect(404);
        await request(app.getHttpServer()).get('/docs-json').expect(404);
      },
    );
  });

  describe('TRUST_PROXY_HOPS', () => {
    function badLogin(forwardedFor: string) {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', forwardedFor)
        .send({ email: 'nadie@example.com', password: 'incorrecta' });
    }

    it('sin proxies, inventar X-Forwarded-For no salta el límite', async () => {
      await startApp();

      for (let i = 0; i < LOGIN_LIMIT; i++) {
        await badLogin(`203.0.113.${i}`).expect(401);
      }
      await badLogin('203.0.113.200').expect(429);
    });

    it('con un proxy, cuenta por la IP que este informa', async () => {
      process.env.TRUST_PROXY_HOPS = '1';
      await startApp();

      for (let i = 0; i <= LOGIN_LIMIT; i++) {
        await badLogin(`203.0.113.${i}`).expect(401);
      }
    });
  });
});
