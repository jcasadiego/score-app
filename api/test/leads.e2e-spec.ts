import type { Mock, MockInstance } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { MAIL_PORT, MailMessage, SendResult } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

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
        .findFirst({
          where: {
            action: 'LEAD_CREATED',
            entityId: response.body.id,
            createdAt: { gte: since },
          },
        })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );

    expect(auditEntry.actorType).toBe('SYSTEM');
    expect(auditEntry.data).toMatchObject({
      body: { family: 'CATALOG' },
    });
    expect(JSON.stringify(auditEntry.data)).not.toContain(VALID.email);
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

    // Usuario y sesión directos en la base (sin login): `JwtStrategy` solo
    // necesita que la sesión exista y el usuario esté activo.
    const user = await prisma.user.create({
      data: {
        name: 'Admin e2e leads',
        email: `admin.leads.${Date.now()}@test.local`,
        passwordHash: 'no-se-usa',
      },
    });
    userId = user.id;
    const session = await prisma.userSession.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    token = await app
      .get(JwtService)
      .signAsync(
        { sub: user.id, ver: user.sessionVersion, sid: session.id },
        { secret: process.env.JWT_SECRET },
      );

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
        .findFirst({
          where: { action: 'LEAD_STATUS_CHANGED', entityId: leadIds[1] },
        })
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

describe('Aviso al equipo por lead nuevo (e2e)', () => {
  const ACTIVE_EMAIL = 'aviso-activo.e2e@example.com';
  const INACTIVE_EMAIL = 'aviso-inactivo.e2e@example.com';

  let app: INestApplication;
  let prisma: PrismaService;
  let send: Mock<(message: MailMessage) => Promise<SendResult>>;
  let findActiveEmails: MockInstance<UsersService['findActiveEmails']>;
  let leadId: string | undefined;

  beforeEach(async () => {
    send = vi.fn();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PORT)
      .useValue({ send })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    findActiveEmails = vi.spyOn(app.get(UsersService), 'findActiveEmails');

    await prisma.user.createMany({
      data: [
        { name: 'Activo', email: ACTIVE_EMAIL, passwordHash: 'x' },
        {
          name: 'Inactivo',
          email: INACTIVE_EMAIL,
          passwordHash: 'x',
          active: false,
        },
      ],
    });
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [ACTIVE_EMAIL, INACTIVE_EMAIL] } },
    });
    if (leadId) {
      await prisma.lead.delete({ where: { id: leadId } });
      leadId = undefined;
    }
    await app.close();
  });

  /**
   * Espera a que el aviso, que va en segundo plano, termine. Toma los
   * destinatarios de la consulta real: otros archivos de e2e crean usuarios en
   * paralelo, así que contarlos aparte daría un número distinto.
   */
  async function waitForNotice(action: string): Promise<string[]> {
    await vi.waitFor(() => expect(findActiveEmails).toHaveBeenCalled());
    const recipients = await (findActiveEmails.mock.results[0].value as Promise<
      string[]
    >);
    await vi.waitFor(async () => {
      const logs = await prisma.auditLog.count({
        where: { entity: 'Lead', entityId: leadId, action },
      });
      expect(logs).toBe(recipients.length);
    });
    return recipients;
  }

  it('avisa a los usuarios activos, no a los desactivados, y queda en la bitácora', async () => {
    send.mockResolvedValue({ sent: true, providerId: 'em_1' });

    const response = await request(app.getHttpServer())
      .post(PATH)
      .send(VALID)
      .expect(201);
    leadId = response.body.id;

    await waitForNotice('EMAIL_SENT');

    const recipients = send.mock.calls.map(([message]) => message.to);
    expect(recipients).toContain(ACTIVE_EMAIL);
    expect(recipients).not.toContain(INACTIVE_EMAIL);
    const message = send.mock.calls[0][0];
    expect(message.text).toContain('Nombre: Ana Pérez');
    expect(message.text).toContain('Familia: Catálogo');
    expect(message.text).toContain('instagram / social / lanzamiento');
    expect(message.text).toContain('/leads');

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Lead', entityId: leadId, action: 'EMAIL_SENT' },
    });
    expect(JSON.stringify(log.data)).not.toContain('Ana Pérez');
  });

  it('si el correo falla, el lead se registra igual y el fallo queda en la bitácora', async () => {
    send.mockResolvedValue({ sent: false, reason: 'proveedor caído' });

    const response = await request(app.getHttpServer())
      .post(PATH)
      .send(VALID)
      .expect(201);
    leadId = response.body.id;

    await waitForNotice('EMAIL_FAILED');

    await expect(
      prisma.lead.findUnique({ where: { id: leadId } }),
    ).resolves.not.toBeNull();
  });
});
