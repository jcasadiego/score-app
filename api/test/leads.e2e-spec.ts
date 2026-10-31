import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/bootstrap';
import { PrismaService } from './../src/prisma/prisma.service';

const RUTA = '/api/v1/leads/precalificacion';

const VALIDO = {
  nombre: 'Ana Pérez',
  email: 'ana.e2e@example.com',
  telefono: '+52 55 1234 5678',
  familia: 'CATALOGO',
  utmSource: 'instagram',
  utmMedium: 'social',
  utmCampaign: 'lanzamiento',
};

describe('LeadsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const idsCreados: string[] = [];

  // App nueva por test: el throttler guarda los contadores en memoria por
  // instancia, así cada test arranca con el límite limpio.
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    if (idsCreados.length > 0) {
      await prisma.lead.deleteMany({ where: { id: { in: idsCreados } } });
      idsCreados.length = 0;
    }
    await app.close();
  });

  it('crea el lead y responde solo id y estado', async () => {
    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .send(VALIDO)
      .expect(201);

    expect(Object.keys(respuesta.body).sort()).toEqual(['estado', 'id']);
    expect(respuesta.body.estado).toBe('NUEVO');
    idsCreados.push(respuesta.body.id);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: respuesta.body.id },
    });
    expect(lead).toMatchObject({ ...VALIDO, estado: 'NUEVO' });
  });

  it('no guarda los datos personales del lead en la bitácora', async () => {
    const desde = new Date();
    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .send(VALIDO)
      .expect(201);
    idsCreados.push(respuesta.body.id);

    // La auditoría se escribe sin bloquear la respuesta.
    const registro = await vi.waitFor(() =>
      prisma.registroAuditoria
        .findFirst({ where: { entidad: RUTA, creadoEn: { gte: desde } } })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );

    expect(registro.actorTipo).toBe('SISTEMA');
    expect(registro.datos).toMatchObject({
      body: {
        nombre: '[REDACTADO]',
        email: '[REDACTADO]',
        telefono: '[REDACTADO]',
        familia: 'CATALOGO',
      },
    });
    await prisma.registroAuditoria.delete({ where: { id: registro.id } });
  });

  it.each([
    ['falta el email', { ...VALIDO, email: undefined }],
    ['email mal formado', { ...VALIDO, email: 'no-es-email' }],
    ['familia desconocida', { ...VALIDO, familia: 'OTRA' }],
    ['campo no permitido', { ...VALIDO, estado: 'PAGADO' }],
  ])('responde 400 si %s', async (_caso, payload) => {
    const respuesta = await request(app.getHttpServer())
      .post(RUTA)
      .send(payload)
      .expect(400);

    expect(respuesta.body).toMatchObject({ statusCode: 400 });
    expect(respuesta.body.mensaje).toEqual(expect.any(Array));
  });

  it('responde 429 al pasar el límite de envíos por minuto', async () => {
    const servidor = app.getHttpServer();
    // Payload inválido a propósito: el throttler corre antes de la
    // validación, así que cuenta igual y no deja leads en la base.
    for (let i = 0; i < 5; i++) {
      await request(servidor).post(RUTA).send({}).expect(400);
    }

    await request(servidor).post(RUTA).send(VALIDO).expect(429);
  });
});

describe('Leads del panel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let usuarioId: string;
  let leadIds: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Usuario directo en la base (sin login): `JwtStrategy` solo necesita
    // que exista y esté activo.
    const usuario = await prisma.usuario.create({
      data: {
        nombre: 'Admin e2e leads',
        email: `admin.leads.${Date.now()}@test.local`,
        passwordHash: 'no-se-usa',
      },
    });
    usuarioId = usuario.id;
    token = await app
      .get(JwtService)
      .signAsync({ sub: usuario.id }, { secret: process.env.JWT_SECRET });

    // Marca única para que los filtros no choquen con otros leads de la base.
    const marca = `e2epanel${Date.now()}`;
    const leads = await prisma.lead.createManyAndReturn({
      data: [
        {
          nombre: `Ana ${marca}`,
          email: `ana.${marca}@example.com`,
          familia: 'B2B',
        },
        {
          nombre: `Beto ${marca}`,
          email: `beto.${marca}@example.com`,
          familia: 'CATALOGO',
        },
        {
          nombre: `Caro ${marca}`,
          email: `caro.${marca}@example.com`,
          familia: 'B2B',
          estado: 'CONTACTADO',
        },
      ],
      select: { id: true },
    });
    leadIds = leads.map((l) => l.id);
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.registroAuditoria.deleteMany({
      where: { actorId: usuarioId },
    });
    await prisma.usuario.delete({ where: { id: usuarioId } });
    await app.close();
  });

  it.each([
    ['GET', '/api/v1/leads'],
    ['GET', '/api/v1/leads/cualquiera'],
    ['PATCH', '/api/v1/leads/cualquiera/estado'],
  ])('%s %s responde 401 sin token', async (metodo, ruta) => {
    const servidor = request(app.getHttpServer());
    await (metodo === 'GET' ? servidor.get(ruta) : servidor.patch(ruta))
      .send({ estado: 'CONVERTIDO' })
      .expect(401);
  });

  it('lista filtrando por familia, estado y búsqueda en la base', async () => {
    const { nombre } = await prisma.lead.findUniqueOrThrow({
      where: { id: leadIds[0] },
    });
    const marca = nombre.split(' ')[1];

    const respuesta = await request(app.getHttpServer())
      .get('/api/v1/leads')
      .query({ q: marca, familia: 'B2B', estado: 'NUEVO' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(respuesta.body.total).toBe(1);
    expect(respuesta.body.datos[0]).toMatchObject({
      id: leadIds[0],
      familia: 'B2B',
      estado: 'NUEVO',
    });
  });

  it('responde 400 con un filtro desconocido', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/leads')
      .query({ estado: 'PAGADO' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('cambia el estado y deja al usuario como actor en la bitácora', async () => {
    const ruta = `/api/v1/leads/${leadIds[1]}/estado`;
    const respuesta = await request(app.getHttpServer())
      .patch(ruta)
      .send({ estado: 'CONVERTIDO' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(respuesta.body).toMatchObject({
      id: leadIds[1],
      estado: 'CONVERTIDO',
    });

    const registro = await vi.waitFor(() =>
      prisma.registroAuditoria
        .findFirst({ where: { entidad: ruta } })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );
    expect(registro).toMatchObject({
      actorTipo: 'USUARIO_PANEL',
      actorId: usuarioId,
    });
  });

  it('no deja cambiar otros datos del lead', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/leads/${leadIds[0]}/estado`)
      .send({ estado: 'CONTACTADO', email: 'otro@example.com' })
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
