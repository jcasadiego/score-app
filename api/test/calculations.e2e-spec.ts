import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import { CalculationStatus, UserRole } from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { CalculationsService } from './../src/calculations/calculations.service';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  SCORING_ENGINE_PORT,
  type ScoringInput,
  type ScoringOutput,
} from './../src/scoring-engine/scoring-engine.port';

/**
 * Cálculos del motor (PF-24) con un motor falso que la prueba controla: se
 * enciende, se apaga, falla o se queda esperando. Base propia, como
 * `diagnostics`, porque las versiones publicadas y la bitácora no se borran.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_calculations_${process.pid}`;
const DIAGNOSTICS = '/api/v1/diagnostics';
const SESSIONS = '/api/v1/diagnostic-sessions';

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

/** El motor de la prueba. `gate` deja un cálculo en `RUNNING` hasta abrirla. */
const engine = {
  driver: 'stub' as const,
  enabled: true,
  mode: 'ok' as 'ok' | 'fail',
  ruleSetVersionNumber: 0,
  gate: null as Promise<void> | null,
  received: [] as ScoringInput[],
  async evaluate(input: ScoringInput): Promise<ScoringOutput> {
    this.received.push(input);
    if (this.gate) await this.gate;
    if (this.mode === 'fail') {
      throw new Error('detalle interno del motor con la respuesta Un disco');
    }
    return {
      result: { simulated: true, potential: 42 },
      ruleSetVersionNumber: this.ruleSetVersionNumber,
      simulated: true,
    };
  },
};

describe('Cálculos del motor (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let questions: { stage: string; story: string; released: string };
  let leadCount = 0;

  const server = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const calculationsOf = (id: string) => `${DIAGNOSTICS}/${id}/calculations`;

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

  /** Diagnóstico con su sesión de cliente abierta y las obligatorias respondidas. */
  async function answered() {
    leadCount += 1;
    const lead = await prisma.lead.create({
      data: {
        name: `Cliente ${leadCount}`,
        email: `cliente${leadCount}@test.local`,
        family: 'PROJECT',
      },
    });
    const { body: created } = await server()
      .post(DIAGNOSTICS)
      .set(as(approver.token))
      .send({ leadId: lead.id, reason: 'Cortesía para la prueba' })
      .expect(201);
    const token = new URLSearchParams(
      new URL(created.accessLink.url as string).hash.slice(1),
    ).get('token');
    const { body: redeemed } = await server()
      .post(SESSIONS)
      .send({ token })
      .expect(201);
    const session = redeemed.sessionToken as string;
    const current = `${SESSIONS}/current`;
    await server()
      .put(`${current}/answers/${questions.stage}`)
      .set(as(session))
      .send({ optionIds: [questions.released] })
      .expect(200);
    await server()
      .put(`${current}/answers/${questions.story}`)
      .set(as(session))
      .send({ text: 'Un disco' })
      .expect(200);
    return { id: created.id as string, session };
  }

  async function submitted() {
    const diagnostic = await answered();
    await server()
      .post(`${SESSIONS}/current/submission`)
      .set(as(diagnostic.session))
      .expect(201);
    return diagnostic;
  }

  /** El cálculo se procesa en segundo plano. */
  async function settled(diagnosticId: string) {
    for (let i = 0; i < 100; i++) {
      const open = await prisma.calculation.count({
        where: {
          diagnosticId,
          status: {
            in: [CalculationStatus.PENDING, CalculationStatus.RUNNING],
          },
        },
      });
      if (open === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('El cálculo no terminó');
  }

  const calculations = (diagnosticId: string) =>
    prisma.calculation.findMany({
      where: { diagnosticId },
      orderBy: { createdAt: 'asc' },
    });

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
      .useValue({ send: async () => ({ sent: true, providerId: 'e2e' }) })
      .overrideProvider(SCORING_ENGINE_PORT)
      .useValue(engine)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    approver = await signedIn('aprobador', UserRole.ADMIN);
    reviewer = await signedIn('revisor', UserRole.REVIEWER);

    const rules = await prisma.ruleSetVersion.create({
      data: { content: { e2e: true }, active: true },
    });
    engine.ruleSetVersionNumber = rules.number;

    const versions = '/api/v1/questionnaire-versions';
    const { body: draft } = await server()
      .post(versions)
      .set(as(approver.token))
      .send({ family: 'PROJECT' })
      .expect(201);
    const add = async (question: object) =>
      (
        await server()
          .post(`${versions}/${draft.id}/questions`)
          .set(as(approver.token))
          .send(question)
          .expect(201)
      ).body as { id: string; options: { id: string; value: string }[] };
    const stage = await add({
      code: 'stage',
      text: '¿En qué etapa está?',
      type: 'SINGLE_CHOICE',
      required: true,
      options: [
        { value: 'idea', text: 'Idea' },
        { value: 'released', text: 'Lanzado' },
      ],
    });
    const story = await add({
      code: 'story',
      text: 'Cuéntanos',
      type: 'FREE_TEXT',
      required: true,
      maxLength: 50,
    });
    questions = {
      stage: stage.id,
      story: story.id,
      released: stage.options.find((o) => o.value === 'released')!.id,
    };
    await server()
      .post(`${versions}/${draft.id}/publication`)
      .set(as(approver.token))
      .expect(200);
  }, 60_000);

  beforeEach(() => {
    engine.enabled = true;
    engine.mode = 'ok';
    engine.gate = null;
  });

  afterAll(async () => {
    await app?.close();
    // FORCE: un trabajo en segundo plano (cálculo, alertas) puede seguir con
    // una conexión abierta después de app.close() y bloquear el DROP (55006).
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
    );
    await admin.$disconnect();
    vi.restoreAllMocks();
  });

  it('al enviar el diagnóstico calcula por code y value, sin hacer esperar al cliente', async () => {
    let open!: () => void;
    engine.gate = new Promise((resolve) => (open = resolve));
    const { id } = await submitted();

    // El envío respondió aunque el motor sigue esperando.
    const [running] = await calculations(id);
    expect(running.status).toBe(CalculationStatus.RUNNING);
    expect(running.requestedById).toBeNull();
    expect(running.input).toEqual({
      family: 'PROJECT',
      questionnaireVersion: 1,
      answers: { stage: 'released', story: 'Un disco' },
    });

    open();
    await settled(id);
    const [done] = await calculations(id);
    expect(done).toMatchObject({
      status: CalculationStatus.SUCCEEDED,
      output: { simulated: true, potential: 42 },
      isSimulated: true,
      engine: 'stub',
    });
    expect(done.ruleSetVersionId).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
  });

  it('con el motor desactivado completa igual, recalcular da 503 y al activarlo se procesa', async () => {
    engine.enabled = false;
    const { id } = await submitted();
    const [pending] = await calculations(id);
    expect(pending.status).toBe(CalculationStatus.PENDING);

    const { body } = await server()
      .post(calculationsOf(id))
      .set(as(approver.token))
      .expect(503);
    expect(body.code).toBe('SCORING_ENGINE_DISABLED');
    expect(await calculations(id)).toHaveLength(1);

    // "Reinicio" con el motor activo.
    engine.enabled = true;
    await app.get(CalculationsService).onApplicationBootstrap();
    await settled(id);
    const [done] = await calculations(id);
    expect(done.status).toBe(CalculationStatus.SUCCEEDED);
  });

  it('retoma al arrancar un cálculo que quedó a medias', async () => {
    const { id } = await submitted();
    await settled(id);
    // Lo que deja un reinicio en pleno cálculo.
    const stuck = await prisma.calculation.create({
      data: {
        diagnosticId: id,
        status: CalculationStatus.RUNNING,
        startedAt: new Date(),
        input: { family: 'PROJECT', questionnaireVersion: 1, answers: {} },
      },
    });

    await app.get(CalculationsService).onApplicationBootstrap();
    await settled(id);
    const done = await prisma.calculation.findUniqueOrThrow({
      where: { id: stuck.id },
    });
    expect(done.status).toBe(CalculationStatus.SUCCEEDED);
  });

  it('un fallo queda registrado sin detalles internos, y el vigente sigue siendo el último exitoso', async () => {
    const { id } = await submitted();
    await settled(id);

    engine.mode = 'fail';
    const { body: requested, headers } = await server()
      .post(calculationsOf(id))
      .set(as(reviewer.token))
      .expect(202);
    expect(headers.location).toBe(`${calculationsOf(id)}/${requested.id}`);
    await settled(id);

    const { body: history } = await server()
      .get(calculationsOf(id))
      .set(as(approver.token))
      .expect(200);
    expect(history.total).toBe(2);
    const [latest, previous] = history.data;
    expect(latest).toMatchObject({ id: requested.id, status: 'FAILED' });
    expect(latest.error).not.toContain('Un disco');
    expect(latest.error).not.toContain('interno');
    expect(previous.status).toBe('SUCCEEDED');

    const { body: current } = await server()
      .get(`${calculationsOf(id)}/current`)
      .set(as(approver.token))
      .expect(200);
    expect(current.id).toBe(previous.id);

    // Y se puede reintentar: un cálculo nuevo, el anterior se conserva.
    engine.mode = 'ok';
    await server().post(calculationsOf(id)).set(as(approver.token)).expect(202);
    await settled(id);
    expect(await calculations(id)).toHaveLength(3);
  });

  it('doble clic en recalcular no crea dos cálculos en curso', async () => {
    const { id } = await submitted();
    await settled(id);

    let open!: () => void;
    engine.gate = new Promise((resolve) => (open = resolve));
    const results = await Promise.all([
      server().post(calculationsOf(id)).set(as(approver.token)),
      server().post(calculationsOf(id)).set(as(approver.token)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe(
      'CALCULATION_IN_PROGRESS',
    );

    // La base lo impide aunque se salte el servicio.
    await expect(
      prisma.calculation.create({
        data: {
          diagnosticId: id,
          input: { family: 'PROJECT', questionnaireVersion: 1, answers: {} },
        },
      }),
    ).rejects.toThrow();
    open();
    await settled(id);
  });

  it('solo calcula diagnósticos enviados, y responde 404 si no existe', async () => {
    const { id } = await answered();
    const { body } = await server()
      .post(calculationsOf(id))
      .set(as(approver.token))
      .expect(409);
    expect(body.code).toBe('DIAGNOSTIC_NOT_COMPLETED');
    await server()
      .post(calculationsOf('no-existe'))
      .set(as(approver.token))
      .expect(404);

    const { body: none } = await server()
      .get(`${calculationsOf(id)}/current`)
      .set(as(approver.token))
      .expect(404);
    expect(none.code).toBe('NO_CURRENT_CALCULATION');
  });

  it('el detalle trae lo enviado, y la bitácora no guarda las respuestas', async () => {
    const { id } = await submitted();
    await settled(id);
    const [calculation] = await calculations(id);

    const { body } = await server()
      .get(`${calculationsOf(id)}/${calculation.id}`)
      .set(as(reviewer.token))
      .expect(200);
    expect(body.input.answers.story).toBe('Un disco');

    // Un cálculo de otro diagnóstico no se ve por esta ruta.
    const other = await submitted();
    await settled(other.id);
    await server()
      .get(`${calculationsOf(other.id)}/${calculation.id}`)
      .set(as(reviewer.token))
      .expect(404);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: id, action: { startsWith: 'CALCULATION' } },
    });
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'CALCULATION_REQUESTED',
        'CALCULATION_SUCCEEDED',
      ]),
    );
    expect(JSON.stringify(logs)).not.toContain('Un disco');
  });

  it('las rutas exigen sesión del panel, y el estado del motor se puede consultar', async () => {
    const { id, session } = await submitted();
    await settled(id);
    await server().get(calculationsOf(id)).expect(401);
    await server().get(calculationsOf(id)).set(as(session)).expect(401);

    const { body } = await server()
      .get('/api/v1/scoring-engine/status')
      .set(as(reviewer.token))
      .expect(200);
    expect(body).toEqual({ driver: 'stub', enabled: true, simulated: true });
  });

  it('no admite dos versiones de reglas activas', async () => {
    await expect(
      prisma.ruleSetVersion.create({
        data: { content: { e2e: 'otra' }, active: true },
      }),
    ).rejects.toThrow();
  });
});
