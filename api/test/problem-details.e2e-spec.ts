import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

const PROBLEM_MEMBERS = {
  type: expect.stringMatching(/^urn:score:problem:/),
  title: expect.any(String),
  status: expect.any(Number),
  detail: expect.any(String),
  instance: expect.any(String),
  code: expect.any(String),
};

describe('Errores RFC 9457 (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => app.close());

  it('responde 401 como problem+json', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/leads')
      .expect(401);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.body).toMatchObject({
      ...PROBLEM_MEMBERS,
      status: 401,
      code: 'UNAUTHORIZED',
      instance: '/api/v1/leads',
    });
  });

  it('no repite la query en `instance`', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/no-existe?token=secreto')
      .expect(404);

    expect(response.body).toMatchObject({
      ...PROBLEM_MEMBERS,
      code: 'NOT_FOUND',
      instance: '/api/v1/no-existe',
    });
    expect(JSON.stringify(response.body)).not.toContain('secreto');
  });

  it('un error de validación trae campo y motivo', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'no-es-email', password: 'x' })
      .expect(400);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.body).toMatchObject({
      ...PROBLEM_MEMBERS,
      code: 'VALIDATION_FAILED',
    });
    expect(response.body.errors).toContainEqual({
      field: 'email',
      message: expect.any(String),
    });
    expect(response.body.message).toBeUndefined();
  });

  it('un JSON mal formado también responde con la misma forma', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{no-es-json')
      .expect(400);

    expect(response.body).toMatchObject({ ...PROBLEM_MEMBERS, status: 400 });
  });

  it('la precalificación mantiene `message` para `score-sitio`', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/leads/prequalification')
      .send({})
      .expect(400);

    expect(response.body).toMatchObject({
      ...PROBLEM_MEMBERS,
      code: 'VALIDATION_FAILED',
      message: expect.any(Array),
    });
    expect(response.body.errors).toContainEqual({
      field: 'email',
      message: expect.any(String),
    });
  });

  it('la ruta legacy conserva exactamente su formato', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/leads/precalificacion')
      .send({})
      .expect(400);

    expect(response.headers['content-type']).toContain('application/json');
    expect(Object.keys(response.body).sort()).toEqual([
      'mensaje',
      'statusCode',
    ]);
    expect(response.body.statusCode).toBe(400);
    expect(response.body.mensaje).toEqual(expect.any(Array));
  });
});
