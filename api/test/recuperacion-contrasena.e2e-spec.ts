import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/bootstrap';
import { CORREO_PORT, MensajeCorreo } from './../src/correo/correo.port';
import { PrismaService } from './../src/prisma/prisma.service';

const BASE = '/api/v1/auth/recuperacion';
const EMAIL = 'recuperacion.e2e@example.com';

describe('Recuperación de contraseña (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const enviados: MensajeCorreo[] = [];

  beforeEach(async () => {
    enviados.length = 0;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Captura el correo en vez de mandarlo, para sacar el enlace.
      .overrideProvider(CORREO_PORT)
      .useValue({
        enviar: async (mensaje: MensajeCorreo) => {
          enviados.push(mensaje);
          return { enviado: true, proveedorId: 'e2e' };
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.usuario.deleteMany({ where: { email: EMAIL } });
    await prisma.usuario.create({
      data: {
        nombre: 'Recuperación E2E',
        email: EMAIL,
        passwordHash: await argon2.hash('clave-vieja-123'),
      },
    });
  });

  afterEach(async () => {
    await prisma.usuario.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  function login(password: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password });
  }

  async function pedirEnlace(): Promise<string> {
    const cantidadPrevia = enviados.length;
    await request(app.getHttpServer())
      .post(`${BASE}/solicitar`)
      .send({ email: EMAIL })
      .expect(200);
    // El correo sale en segundo plano, después de responder.
    await vi.waitFor(() => {
      if (enviados.length === cantidadPrevia) throw new Error('sin correo');
    });
    const { texto } = enviados[enviados.length - 1];
    return new URL(texto.match(/https?:\/\/\S+/)![0]).searchParams.get(
      'token',
    )!;
  }

  it('responde lo mismo exista o no el correo, y solo envía al que existe', async () => {
    const existe = await request(app.getHttpServer())
      .post(`${BASE}/solicitar`)
      .send({ email: EMAIL })
      .expect(200);
    const noExiste = await request(app.getHttpServer())
      .post(`${BASE}/solicitar`)
      .send({ email: 'nadie.e2e@example.com' })
      .expect(200);

    expect(noExiste.body).toEqual(existe.body);
    await vi.waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].para).toBe(EMAIL);
  });

  it('restablece una sola vez, cierra las sesiones y deja entrar con la nueva', async () => {
    const desde = new Date();
    const sesionVieja = (await login('clave-vieja-123').expect(200)).body
      .accessToken;
    await request(app.getHttpServer())
      .get('/api/v1/usuarios')
      .set('Authorization', `Bearer ${sesionVieja}`)
      .expect(200);

    const token = await pedirEnlace();
    await request(app.getHttpServer())
      .post(`${BASE}/restablecer`)
      .send({ token, password: 'clave-nueva-456' })
      .expect(204);

    await request(app.getHttpServer())
      .post(`${BASE}/restablecer`)
      .send({ token, password: 'otra-clave-789' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/usuarios')
      .set('Authorization', `Bearer ${sesionVieja}`)
      .expect(401);
    await login('clave-vieja-123').expect(401);
    await login('clave-nueva-456').expect(200);

    const bitacora = await prisma.registroAuditoria.findMany({
      where: { creadoEn: { gte: desde } },
    });
    expect(bitacora.map((r) => r.accion)).toEqual(
      expect.arrayContaining([
        'RECUPERACION_CONTRASENA_SOLICITADA',
        'CONTRASENA_RESTABLECIDA',
      ]),
    );
    expect(JSON.stringify(bitacora)).not.toContain(token);
    expect(JSON.stringify(bitacora)).not.toContain('clave-nueva-456');
  });

  it('pedir un enlace nuevo invalida el anterior', async () => {
    const primero = await pedirEnlace();
    const segundo = await pedirEnlace();

    await request(app.getHttpServer())
      .post(`${BASE}/restablecer`)
      .send({ token: primero, password: 'clave-nueva-456' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${BASE}/restablecer`)
      .send({ token: segundo, password: 'clave-nueva-456' })
      .expect(204);
  });

  it('rechaza una contraseña que no cumple las reglas', async () => {
    const token = await pedirEnlace();

    await request(app.getHttpServer())
      .post(`${BASE}/restablecer`)
      .send({ token, password: 'corta' })
      .expect(400);
  });

  it('limita las solicitudes por minuto', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`${BASE}/solicitar`)
        .send({ email: 'nadie.e2e@example.com' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post(`${BASE}/solicitar`)
      .send({ email: 'nadie.e2e@example.com' })
      .expect(429);
  });
});
