import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';

const PATH = '/api/v1/leads/prequalification';

const VALID = {
  name: 'Ana Pérez',
  email: 'ana.e2e@example.com',
  phone: '+52 55 1234 5678',
  family: 'CATALOG',
  utmSource: 'instagram',
  utmMedium: 'social',
  utmCampaign: 'lanzamiento',
};

describe('LeadsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdIds: string[] = [];

  // App nueva por test: el throttler guarda los contadores en memoria por
  // instancia, así cada test arranca con el límite limpio.
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await prisma.lead.deleteMany({ where: { id: { in: createdIds } } });
      createdIds.length = 0;
    }
    await app.close();
  });

  it('crea el lead y responde solo id y estado', async () => {
    const response = await request(app.getHttpServer())
      .post(PATH)
      .send(VALID)
      .expect(201);

    expect(Object.keys(response.body).sort()).toEqual(['id', 'status']);
    expect(response.body.status).toBe('NEW');
    createdIds.push(response.body.id);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(lead).toMatchObject({ ...VALID, status: 'NEW' });
  });

  it('responde los errores con la forma estándar { statusCode, message, error }', async () => {
    const response = await request(app.getHttpServer())
      .post(PATH)
      .send({ ...VALID, family: 'OTRA' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: expect.arrayContaining([
        expect.stringContaining('family must be one of'),
      ]),
    });
  });

  describe('ruta legacy de score-sitio (POST /leads/precalificacion)', () => {
    const RUTA_LEGACY = '/api/v1/leads/precalificacion';
    const VALID_LEGACY = {
      nombre: 'Ana Pérez',
      email: 'ana.legacy.e2e@example.com',
      telefono: '+52 55 1234 5678',
      familia: 'CATALOGO',
      utmSource: 'instagram',
    };

    it('acepta el payload viejo y responde { id, estado: NUEVO }', async () => {
      const response = await request(app.getHttpServer())
        .post(RUTA_LEGACY)
        .send(VALID_LEGACY)
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual(['estado', 'id']);
      expect(response.body.estado).toBe('NUEVO');
      createdIds.push(response.body.id);

      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(lead).toMatchObject({
        name: 'Ana Pérez',
        phone: '+52 55 1234 5678',
        family: 'CATALOG',
        status: 'NEW',
      });
    });

    it('mantiene la forma de error vieja { statusCode, mensaje }', async () => {
      const response = await request(app.getHttpServer())
        .post(RUTA_LEGACY)
        .send({ ...VALID_LEGACY, familia: 'CATALOG' })
        .expect(400);

      expect(Object.keys(response.body).sort()).toEqual([
        'mensaje',
        'statusCode',
      ]);
      expect(response.body.mensaje).toEqual([
        'familia must be one of the following values: PROYECTO, B2B, PROFESIONAL, CATALOGO',
      ]);
    });
  });

  it('no guarda los datos personales del lead en la bitácora', async () => {
    const since = new Date();
    const response = await request(app.getHttpServer())
      .post(PATH)
      .send(VALID)
      .expect(201);
    createdIds.push(response.body.id);

    // La auditoría se escribe sin bloquear la respuesta.
    const auditEntry = await vi.waitFor(() =>
      prisma.auditLog
        .findFirst({ where: { entity: PATH, createdAt: { gte: since } } })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );

    expect(auditEntry.actorType).toBe('SYSTEM');
    expect(auditEntry.data).toMatchObject({
      body: {
        name: '[REDACTADO]',
        email: '[REDACTADO]',
        phone: '[REDACTADO]',
        family: 'CATALOG',
      },
    });
    await prisma.auditLog.delete({ where: { id: auditEntry.id } });
  });

  it.each([
    ['falta el email', { ...VALID, email: undefined }],
    ['email mal formado', { ...VALID, email: 'no-es-email' }],
    ['family desconocida', { ...VALID, family: 'OTRA' }],
    ['campo no permitido', { ...VALID, status: 'PAGADO' }],
  ])('responde 400 si %s', async (_label, payload) => {
    const response = await request(app.getHttpServer())
      .post(PATH)
      .send(payload)
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });
    expect(response.body.message).toEqual(expect.any(Array));
  });

  it('responde 429 al pasar el límite de envíos por minuto', async () => {
    const server = app.getHttpServer();
    // Payload inválido a propósito: el throttler corre antes de la
    // validación, así que cuenta igual y no deja leads en la base.
    for (let i = 0; i < 5; i++) {
      await request(server).post(PATH).send({}).expect(400);
    }

    await request(server).post(PATH).send(VALID).expect(429);
  });
});

describe('Leads del panel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let leadIds: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Usuario directo en la base (sin login): `JwtStrategy` solo necesita
    // que exista y esté active.
    const user = await prisma.user.create({
      data: {
        name: 'Admin e2e leads',
        email: `admin.leads.${Date.now()}@test.local`,
        passwordHash: 'no-se-usa',
      },
    });
    userId = user.id;
    token = await app
      .get(JwtService)
      .signAsync({ sub: user.id }, { secret: process.env.JWT_SECRET });

    // Marca única para que los filtros no choquen con otros leads de la base.
    const marker = `e2epanel${Date.now()}`;
    const leads = await prisma.lead.createManyAndReturn({
      data: [
        {
          name: `Ana ${marker}`,
          email: `ana.${marker}@example.com`,
          family: 'B2B',
        },
        {
          name: `Beto ${marker}`,
          email: `beto.${marker}@example.com`,
          family: 'CATALOG',
        },
        {
          name: `Caro ${marker}`,
          email: `caro.${marker}@example.com`,
          family: 'B2B',
          status: 'CONTACTED',
        },
      ],
      select: { id: true },
    });
    leadIds = leads.map((l) => l.id);
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.auditLog.deleteMany({
      where: { actorId: userId },
    });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it.each([
    ['GET', '/api/v1/leads'],
    ['GET', '/api/v1/leads/cualquiera'],
    ['PATCH', '/api/v1/leads/cualquiera/status'],
  ])('%s %s responde 401 sin token', async (method, path) => {
    const server = request(app.getHttpServer());
    await (method === 'GET' ? server.get(path) : server.patch(path))
      .send({ status: 'CONVERTED' })
      .expect(401);
  });

  it('lista filtrando por familia, estado y búsqueda en la base', async () => {
    const { name } = await prisma.lead.findUniqueOrThrow({
      where: { id: leadIds[0] },
    });
    const marker = name.split(' ')[1];

    const response = await request(app.getHttpServer())
      .get('/api/v1/leads')
      .query({ search: marker, family: 'B2B', status: 'NEW' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.data[0]).toMatchObject({
      id: leadIds[0],
      family: 'B2B',
      status: 'NEW',
    });
  });

  it('responde 400 con un filtro desconocido', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/leads')
      .query({ status: 'PAGADO' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('cambia el estado y deja al usuario como actor en la bitácora', async () => {
    const path = `/api/v1/leads/${leadIds[1]}/status`;
    const response = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'CONVERTED' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: leadIds[1],
      status: 'CONVERTED',
    });

    const auditEntry = await vi.waitFor(() =>
      prisma.auditLog
        .findFirst({ where: { entity: path } })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );
    expect(auditEntry).toMatchObject({
      actorType: 'PANEL_USER',
      actorId: userId,
    });
  });

  it('no deja cambiar otros datos del lead', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/leads/${leadIds[0]}/status`)
      .send({ status: 'CONTACTED', email: 'otro@example.com' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('responde 404 si el lead no existe', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/leads/no-existe')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
