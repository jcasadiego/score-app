import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
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
