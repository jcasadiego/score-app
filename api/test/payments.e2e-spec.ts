import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import { DiagnosticFamily, UserRole } from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT, MailMessage } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Pagos (PF-51). Activar crea un diagnóstico, que apunta a una versión
 * publicada que no se puede borrar, y la bitácora es de solo inserción: base
 * propia, creada y borrada aquí, igual que `diagnostics`.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_payments_${process.pid}`;
const PAYMENTS = '/api/v1/payments';
const LEADS = '/api/v1/leads';

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

interface PaymentBody {
  id: string;
  amount: string;
  status: string;
  reference: string;
}

describe('Pagos (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const sent: MailMessage[] = [];
  let mailFails = false;
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let leadCount = 0;
  let referenceCount = 0;

  const server = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();

  async function signedIn(name: string, role: UserRole) {
    const user = await prisma.user.create({
      data: { name, email: `${name}@test.local`, passwordHash: 'x', role },
    });
    const session = await prisma.userSession.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const token = await app
      .get(JwtService)
      .signAsync(
        { sub: user.id, ver: user.sessionVersion, sid: session.id },
        { secret: process.env.JWT_SECRET },
      );
    return { id: user.id, token };
  }

  async function newLead(family: DiagnosticFamily = DiagnosticFamily.PROJECT) {
    leadCount += 1;
    return prisma.lead.create({
      data: {
        name: `Cliente ${leadCount}`,
        email: `cliente${leadCount}@test.local`,
        family,
      },
    });
  }

  function paymentFor(leadId: string, overrides: object = {}) {
    referenceCount += 1;
    return {
      leadId,
      amount: '150.00',
      currency: 'USD',
      method: 'BANK_TRANSFER',
      reference: `REF-${referenceCount}`,
      paidAt: yesterday(),
      ...overrides,
    };
  }

  async function register(leadId: string, overrides: object = {}) {
    const res = await server()
      .post(PAYMENTS)
      .set(as(approver.token))
      .send(paymentFor(leadId, overrides))
      .expect(201);
    return { body: res.body as PaymentBody, etag: res.headers.etag as string };
  }

  async function confirmed(leadId: string, overrides: object = {}) {
    const { body, etag } = await register(leadId, overrides);
    await server()
      .post(`${PAYMENTS}/${body.id}/confirmation`)
      .set(as(approver.token))
      .set('If-Match', etag)
      .expect(200);
    return body;
  }

  async function summary(leadId: string) {
    const res = await server()
      .get(`${LEADS}/${leadId}/payment-summary`)
      .set(as(approver.token))
      .expect(200);
    return { body: res.body, etag: res.headers.etag as string };
  }

  const activate = (leadId: string, etag: string) =>
    server()
      .post(`${LEADS}/${leadId}/diagnostic-activation`)
      .set(as(approver.token))
      .set('If-Match', etag);

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DATABASE}`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl(DATABASE) },
      stdio: 'pipe',
    });
    process.env.DATABASE_URL = databaseUrl(DATABASE);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PORT)
      .useValue({
        send: async (message: MailMessage) => {
          if (mailFails) return { sent: false, reason: 'proveedor caído' };
          sent.push(message);
          return { sent: true, providerId: 'e2e' };
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    approver = await signedIn('aprobador', UserRole.ADMIN);
    reviewer = await signedIn('revisor', UserRole.REVIEWER);

    // Versión publicada de PROJECT con una pregunta. CATALOG queda sin versión.
    const versions = '/api/v1/questionnaire-versions';
    const { body: draft } = await server()
      .post(versions)
      .set(as(approver.token))
      .send({ family: 'PROJECT' })
      .expect(201);
    await server()
      .post(`${versions}/${draft.id}/questions`)
      .set(as(approver.token))
      .send({
        code: 'stage',
        text: '¿En qué etapa está el proyecto?',
        type: 'SINGLE_CHOICE',
        required: true,
        options: [
          { value: 'idea', text: 'Idea' },
          { value: 'released', text: 'Lanzado' },
        ],
      })
      .expect(201);
    await server()
      .post(`${versions}/${draft.id}/publication`)
      .set(as(approver.token))
      .expect(200);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
    );
    await admin.$disconnect();
    vi.restoreAllMocks();
  });

  describe('permisos', () => {
    it('sin sesión responde 401', async () => {
      await server().get(PAYMENTS).expect(401);
    });

    it('el Revisor recibe 403 en todas las rutas', async () => {
      const lead = await newLead();
      const { body } = await register(lead.id);
      // Cada petición se arma al usarla: supertest abre el servidor al enviar.
      const routes = [
        () => server().get(PAYMENTS),
        () => server().post(PAYMENTS).send(paymentFor(lead.id)),
        () => server().get(`${PAYMENTS}/${body.id}`),
        () =>
          server()
            .post(`${PAYMENTS}/${body.id}/confirmation`)
            .set('If-Match', '"0"'),
        () =>
          server()
            .post(`${PAYMENTS}/${body.id}/voiding`)
            .set('If-Match', '"0"')
            .send({ reason: 'Prueba' }),
        () => server().get(`${LEADS}/${lead.id}/payment-summary`),
        () =>
          server()
            .post(`${LEADS}/${lead.id}/diagnostic-activation`)
            .set('If-Match', '"0"'),
      ];
      for (const route of routes) {
        const res = await route().set(as(reviewer.token)).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
      // Nada cambió: el pago sigue pendiente.
      const stored = await prisma.payment.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(stored.status).toBe('PENDING');
    });
  });

  describe('registrar', () => {
    it('registra un pago pendiente con sus datos y el monto como string', async () => {
      const lead = await newLead();
      const res = await server()
        .post(PAYMENTS)
        .set(as(approver.token))
        .send(
          paymentFor(lead.id, {
            amount: '1234.5',
            currency: 'VES',
            method: 'PAGO_MOVIL',
          }),
        )
        .expect(201);
      expect(res.headers.etag).toBe('"0"');
      expect(res.headers.location).toBe(`${PAYMENTS}/${res.body.id}`);
      expect(res.body).toMatchObject({
        amount: '1234.50',
        currency: 'VES',
        method: 'PAGO_MOVIL',
        status: 'PENDING',
        lead: { id: lead.id },
        registeredBy: { id: approver.id },
        confirmedBy: null,
      });
      expect(res.body.version).toBe(0);
    });

    it.each([
      ['monto cero', { amount: '0.00' }, 'amount'],
      ['monto negativo', { amount: '-5' }, 'amount'],
      ['monto como número', { amount: 150 }, 'amount'],
      ['tres decimales', { amount: '1.005' }, 'amount'],
      ['moneda no permitida', { currency: 'EUR' }, 'currency'],
      ['método no permitido', { method: 'CASH' }, 'method'],
      ['referencia vacía', { reference: '   ' }, 'reference'],
      [
        'fecha futura',
        { paidAt: new Date(Date.now() + 86_400_000).toISOString() },
        'paidAt',
      ],
      ['fecha sin formato RFC 3339', { paidAt: '20/11/2026' }, 'paidAt'],
    ])('rechaza %s con 400', async (_case, overrides, field) => {
      const lead = await newLead();
      const { body } = await server()
        .post(PAYMENTS)
        .set(as(approver.token))
        .send(paymentFor(lead.id, overrides))
        .expect(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.errors.map((e: { field: string }) => e.field)).toContain(
        field,
      );
    });

    it('lead inexistente → 404', async () => {
      const { body } = await server()
        .post(PAYMENTS)
        .set(as(approver.token))
        .send(paymentFor('no-existe'))
        .expect(404);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('un solo pago pendiente por lead', async () => {
      const lead = await newLead();
      await register(lead.id);
      const { body } = await server()
        .post(PAYMENTS)
        .set(as(approver.token))
        .send(paymentFor(lead.id))
        .expect(409);
      expect(body.code).toBe('PAYMENT_PENDING_EXISTS');
    });

    it('dos registros simultáneos del mismo lead dejan uno solo pendiente', async () => {
      const lead = await newLead();
      const results = await Promise.all([
        server()
          .post(PAYMENTS)
          .set(as(approver.token))
          .send(paymentFor(lead.id)),
        server()
          .post(PAYMENTS)
          .set(as(approver.token))
          .send(paymentFor(lead.id)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.payment.count({ where: { leadId: lead.id } })).toBe(
        1,
      );
    });

    it('rechaza la misma referencia con el mismo método, sin distinguir mayúsculas', async () => {
      const first = await newLead();
      const second = await newLead();
      await register(first.id, { method: 'PAYPAL', reference: 'Pay-777' });
      const { body } = await server()
        .post(PAYMENTS)
        .set(as(approver.token))
        .send(paymentFor(second.id, { method: 'PAYPAL', reference: 'pay-777' }))
        .expect(409);
      expect(body.code).toBe('PAYMENT_REFERENCE_DUPLICATE');
      // Con otro método, la misma referencia sí vale.
      await register(second.id, { method: 'OTHER', reference: 'PAY-777' });
    });

    it('una referencia anulada se puede volver a usar', async () => {
      const lead = await newLead();
      const { body, etag } = await register(lead.id, { reference: 'REUSO-1' });
      await server()
        .post(`${PAYMENTS}/${body.id}/voiding`)
        .set(as(approver.token))
        .set('If-Match', etag)
        .send({ reason: 'Referencia mal cargada' })
        .expect(200);
      await register(lead.id, { reference: 'REUSO-1' });
    });
  });

  describe('confirmar y anular', () => {
    it('sin If-Match → 428; versión vieja → 412', async () => {
      const lead = await newLead();
      const { body } = await register(lead.id);
      const missing = await server()
        .post(`${PAYMENTS}/${body.id}/confirmation`)
        .set(as(approver.token))
        .expect(428);
      expect(missing.body.code).toBe('IF_MATCH_REQUIRED');
      const stale = await server()
        .post(`${PAYMENTS}/${body.id}/confirmation`)
        .set(as(approver.token))
        .set('If-Match', '"7"')
        .expect(412);
      expect(stale.body.code).toBe('PAYMENT_VERSION_MISMATCH');
    });

    it('confirma un pago pendiente y no crea el diagnóstico', async () => {
      const lead = await newLead();
      const { body, etag } = await register(lead.id);
      const res = await server()
        .post(`${PAYMENTS}/${body.id}/confirmation`)
        .set(as(approver.token))
        .set('If-Match', etag)
        .expect(200);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        confirmedBy: { id: approver.id },
      });
      expect(res.body.confirmedAt).toBeTruthy();
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(0);
    });

    it('un pago confirmado no se confirma de nuevo ni se anula', async () => {
      const lead = await newLead();
      const payment = await confirmed(lead.id);
      for (const path of ['confirmation', 'voiding']) {
        const { body } = await server()
          .post(`${PAYMENTS}/${payment.id}/${path}`)
          .set(as(approver.token))
          .set('If-Match', '"1"')
          .send({ reason: 'Intento de anular' })
          .expect(409);
        expect(body.code).toBe('PAYMENT_NOT_PENDING');
      }
    });

    it('dos confirmaciones simultáneas: una gana y la otra recibe 409', async () => {
      const lead = await newLead();
      const { body, etag } = await register(lead.id);
      const confirm = () =>
        server()
          .post(`${PAYMENTS}/${body.id}/confirmation`)
          .set(as(approver.token))
          .set('If-Match', etag);
      const results = await Promise.all([confirm(), confirm()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const stored = await prisma.payment.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(stored.version).toBe(1);
    });

    it('anula un pendiente con motivo; sin motivo → 400', async () => {
      const lead = await newLead();
      const { body, etag } = await register(lead.id);
      const empty = await server()
        .post(`${PAYMENTS}/${body.id}/voiding`)
        .set(as(approver.token))
        .set('If-Match', etag)
        .send({ reason: '  ' })
        .expect(400);
      expect(empty.body.code).toBe('VALIDATION_FAILED');

      const res = await server()
        .post(`${PAYMENTS}/${body.id}/voiding`)
        .set(as(approver.token))
        .set('If-Match', etag)
        .send({ reason: 'Monto equivocado' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'VOIDED',
        voidReason: 'Monto equivocado',
        voidedBy: { id: approver.id },
      });
      // Anulado, el lead puede registrar otro pendiente.
      await register(lead.id);
    });

    it('pago inexistente → 404', async () => {
      await server()
        .post(`${PAYMENTS}/no-existe/confirmation`)
        .set(as(approver.token))
        .set('If-Match', '"0"')
        .expect(404);
    });
  });

  describe('listar', () => {
    it('filtra en la base por estado, método, moneda, fechas y lead, paginado', async () => {
      const lead = await newLead();
      await confirmed(lead.id, {
        method: 'PAYPAL',
        currency: 'USD',
        paidAt: '2026-01-10T12:00:00Z',
      });
      await confirmed(lead.id, {
        method: 'PAGO_MOVIL',
        currency: 'VES',
        paidAt: '2026-02-10T12:00:00Z',
      });
      await register(lead.id, { paidAt: '2026-03-10T12:00:00Z' });

      const list = async (query: Record<string, string | number>) =>
        (
          await server()
            .get(PAYMENTS)
            .query({ leadId: lead.id, ...query })
            .set(as(approver.token))
            .expect(200)
        ).body;

      expect((await list({})).total).toBe(3);
      // El panel confirma y anula desde la fila: cada una trae su versión.
      expect((await list({ status: 'CONFIRMED' })).data[0].version).toBe(1);
      expect((await list({ status: 'CONFIRMED' })).total).toBe(2);
      expect((await list({ method: 'PAYPAL' })).total).toBe(1);
      expect((await list({ currency: 'VES' })).total).toBe(1);
      const range = await list({
        paidFrom: '2026-02-01T00:00:00Z',
        paidTo: '2026-03-01T00:00:00Z',
      });
      expect(range.data.map((p: PaymentBody) => p.amount)).toEqual(['150.00']);
      expect(range.total).toBe(1);

      const page = await list({ page: 2, pageSize: 2 });
      expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.data).toHaveLength(1);
      // Orden estable: del más reciente al más antiguo.
      const all = await list({});
      expect(all.data.map((p: { paidAt: string }) => p.paidAt)).toEqual([
        '2026-03-10T12:00:00.000Z',
        '2026-02-10T12:00:00.000Z',
        '2026-01-10T12:00:00.000Z',
      ]);
    });

    it('rechaza filtros inválidos con 400', async () => {
      await server()
        .get(PAYMENTS)
        .query({ status: 'PAID' })
        .set(as(approver.token))
        .expect(400);
    });
  });

  describe('activar el diagnóstico', () => {
    it('sin pagos confirmados → 409', async () => {
      const lead = await newLead();
      await register(lead.id);
      const { etag } = await summary(lead.id);
      const { body } = await activate(lead.id, etag).expect(409);
      expect(body.code).toBe('NO_CONFIRMED_PAYMENT');
    });

    it('el resumen suma por moneda, sin mezclar ni contar pendientes ni anulados', async () => {
      const lead = await newLead();
      await confirmed(lead.id, { amount: '100.10', currency: 'USD' });
      await confirmed(lead.id, { amount: '50.25', currency: 'USD' });
      await confirmed(lead.id, { amount: '3000', currency: 'VES' });
      const pending = await register(lead.id, { amount: '999' });

      const { body, etag } = await summary(lead.id);
      expect(etag).toBe('"3"');
      expect(body).toEqual({
        leadId: lead.id,
        confirmedTotals: [
          { currency: 'USD', amount: '150.35' },
          { currency: 'VES', amount: '3000.00' },
        ],
        confirmedCount: 3,
        pendingPaymentId: pending.body.id,
        diagnostic: null,
      });
    });

    it('con un cobro que el Aprobador no vio → 412 y no crea nada', async () => {
      const lead = await newLead();
      await confirmed(lead.id);
      const { etag } = await summary(lead.id);
      await confirmed(lead.id);
      const { body } = await activate(lead.id, etag).expect(412);
      expect(body.code).toBe('LEAD_PAYMENTS_CHANGED');
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(0);
      const stored = await prisma.lead.findUniqueOrThrow({
        where: { id: lead.id },
      });
      expect(stored.status).toBe('NEW');
    });

    it('crea el diagnóstico pagado, emite el enlace, envía el correo y convierte el lead', async () => {
      const lead = await newLead();
      await confirmed(lead.id);
      const { etag } = await summary(lead.id);
      const res = await activate(lead.id, etag).expect(201);

      expect(res.headers.location).toBe(`/api/v1/diagnostics/${res.body.id}`);
      expect(res.body).toMatchObject({
        activationType: 'PAID',
        emailSent: true,
        lead: { id: lead.id },
      });
      expect(res.body.accessLink.url).toContain('#token=');
      expect(sent.filter((m) => m.to === lead.email)).toHaveLength(1);

      const diagnostic = await prisma.diagnostic.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
      expect(diagnostic).toMatchObject({
        activationType: 'PAID',
        createdById: approver.id,
        creationReason: null,
      });
      const stored = await prisma.lead.findUniqueOrThrow({
        where: { id: lead.id },
      });
      expect(stored.status).toBe('CONVERTED');

      const again = await summary(lead.id);
      expect(again.body.diagnostic).toEqual({
        id: diagnostic.id,
        activationType: 'PAID',
      });
      const second = await activate(lead.id, again.etag).expect(409);
      expect(second.body.code).toBe('DIAGNOSTIC_ALREADY_EXISTS');
    });

    it('dos activaciones simultáneas crean un solo diagnóstico', async () => {
      const lead = await newLead();
      await confirmed(lead.id);
      const { etag } = await summary(lead.id);
      const results = await Promise.all([
        activate(lead.id, etag),
        activate(lead.id, etag),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(1);
    });

    it('si solo falla el correo, el diagnóstico queda y la respuesta lo indica', async () => {
      const lead = await newLead();
      await confirmed(lead.id);
      const { etag } = await summary(lead.id);
      mailFails = true;
      try {
        const { body } = await activate(lead.id, etag).expect(201);
        expect(body.emailSent).toBe(false);
        expect(body.accessLink.url).toContain('#token=');
      } finally {
        mailFails = false;
      }
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(1);
    });

    it('si falla crear el diagnóstico, no queda nada a medias', async () => {
      const lead = await newLead(DiagnosticFamily.CATALOG);
      await confirmed(lead.id);
      const { etag } = await summary(lead.id);
      const { body } = await activate(lead.id, etag).expect(409);
      expect(body.code).toBe('NO_PUBLISHED_QUESTIONNAIRE');
      const stored = await prisma.lead.findUniqueOrThrow({
        where: { id: lead.id },
      });
      expect(stored.status).toBe('NEW');
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { action: 'LEAD_STATUS_CHANGED', entityId: lead.id },
        }),
      ).toBe(0);
    });

    it('pago tardío: con diagnóstico sin pago, se registra y confirma igual', async () => {
      const lead = await newLead();
      await server()
        .post('/api/v1/diagnostics')
        .set(as(approver.token))
        .send({ leadId: lead.id, reason: 'Cortesía, paga después' })
        .expect(201);
      const before = sent.length;
      await confirmed(lead.id);
      expect(sent.length).toBe(before);
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(1);
      const { body } = await summary(lead.id);
      expect(body.diagnostic.activationType).toBe('WITHOUT_PAYMENT');
    });
  });

  describe('bitácora y base', () => {
    it('registra quién y cuándo, sin monto ni referencia', async () => {
      const lead = await newLead();
      const payment = await confirmed(lead.id, {
        amount: '4321.09',
        reference: 'SECRETO-REF-99',
      });
      const logs = await prisma.auditLog.findMany({
        where: { entity: 'Payment', entityId: payment.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => [l.action, l.actorId])).toEqual([
        ['PAYMENT_REGISTERED', approver.id],
        ['PAYMENT_CONFIRMED', approver.id],
      ]);
      const everything = JSON.stringify(
        await prisma.auditLog.findMany({ where: { entity: 'Payment' } }),
      );
      // El monto completo: "4321" solo podía aparecer al azar dentro de un id o
      // un UUID de la bitácora y hacía fallar el test sin motivo.
      expect(everything).not.toContain('4321.09');
      expect(everything).not.toMatch(/"amount"/);
      expect(everything).not.toContain('SECRETO-REF-99');
    });

    it('la base rechaza un monto no positivo y un estado sin sus datos', async () => {
      const lead = await newLead();
      const base = {
        leadId: lead.id,
        currency: 'USD' as const,
        method: 'OTHER' as const,
        paidAt: new Date(),
        registeredById: approver.id,
      };
      await expect(
        prisma.payment.create({
          data: { ...base, amount: '0', reference: 'DB-1' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.payment.create({
          data: {
            ...base,
            amount: '10',
            reference: 'DB-2',
            status: 'CONFIRMED',
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.payment.create({
          data: {
            ...base,
            amount: '10',
            reference: 'DB-3',
            status: 'VOIDED',
            voidedById: approver.id,
            voidedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('la base exige motivo sin pago y lo prohíbe con pago', async () => {
      const [withoutReason, paidWithReason] = [
        await newLead(),
        await newLead(),
      ];
      const version = await prisma.questionnaireVersion.findFirstOrThrow({
        where: { status: 'PUBLISHED' },
      });
      const base = {
        questionnaireVersionId: version.id,
        createdById: approver.id,
      };
      await expect(
        prisma.diagnostic.create({
          data: {
            ...base,
            leadId: withoutReason.id,
            activationType: 'WITHOUT_PAYMENT',
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.diagnostic.create({
          data: {
            ...base,
            leadId: paidWithReason.id,
            activationType: 'PAID',
            creationReason: 'No corresponde',
          },
        }),
      ).rejects.toThrow();
    });
  });
});
