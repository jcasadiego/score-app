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
import { SimulatedAiAdapter } from './../src/ai/adapters/simulated-ai.adapter';
import { AiProviderError } from './../src/ai/ai-provider.port';
import { AiService } from './../src/ai/ai.service';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { FlagsService } from './../src/flags/flags.service';
import { MAIL_PORT } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  SCORING_ENGINE_PORT,
  type ScoringInput,
  type ScoringOutput,
} from './../src/scoring-engine/scoring-engine.port';

/**
 * Flags (PF-34) con un motor falso (la Confianza la elige la prueba) y la IA
 * simulada, cuya respuesta se controla espiando el adapter. Base propia.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_flags_${process.pid}`;
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
  confidence: 0.9,
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
      result: { simulated: true, potential: 42, confidence: this.confidence },
      ruleSetVersionNumber: this.ruleSetVersionNumber,
      simulated: true,
    };
  },
};

describe('Flags (e2e, base propia)', () => {
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
    const realComplete = SimulatedAiAdapter.prototype.complete;
    vi.spyOn(SimulatedAiAdapter.prototype, 'complete').mockImplementation(
      async function (this: SimulatedAiAdapter, request) {
        aiRequests.push(request.userContent);
        if (aiError) throw aiError;
        if (aiAnswer === null) return realComplete.call(this, request);
        return {
          text: JSON.stringify(aiAnswer),
          servedModel: 'stub',
          inputTokens: 0,
          outputTokens: 0,
        };
      },
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
    engine.confidence = 0.9;
    aiAnswer = null;
    aiError = null;
  });

  /** Respuesta de la IA simulada en esta prueba (`null` = la de ejemplo). */
  let aiAnswer: unknown = null;
  let aiError: Error | null = null;
  let aiRequests: string[] = [];

  async function analyzed(calculationId: string) {
    for (let i = 0; i < 100; i++) {
      const analysis = await prisma.flagAnalysis.findUnique({
        where: { calculationId },
      });
      if (analysis && ['SUCCEEDED', 'FAILED'].includes(analysis.status)) {
        return analysis;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('El análisis no terminó');
  }

  /** Diagnóstico enviado, con su cálculo y su análisis terminados. */
  async function flagged() {
    const { id, session } = await submitted();
    await settled(id);
    const [calculation] = await calculations(id);
    const analysis = await analyzed(calculation.id);
    return { id, session, calculation, analysis };
  }

  const flagsOf = (id: string, query = '') =>
    server().get(`${DIAGNOSTICS}/${id}/flags${query}`);

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

  it('baja confianza: un flag del motor, y el análisis sin contradicciones queda exitoso', async () => {
    engine.confidence = 0.3;
    const { id, calculation, analysis } = await flagged();
    expect(analysis).toMatchObject({
      status: 'SUCCEEDED',
      provider: 'stub',
      promptId: 'flags.contradictions',
      promptVersion: 'v1',
      isSimulated: true,
    });

    const { body } = await flagsOf(id).set(as(reviewer.token)).expect(200);
    expect(body.calculationId).toBe(calculation.id);
    expect(body.analysis.status).toBe('SUCCEEDED');
    expect(body.openCount).toBe(1);
    expect(body.flags).toEqual([
      expect.objectContaining({
        source: 'ENGINE',
        status: 'OPEN',
        message: expect.stringContaining('Baja confianza'),
      }),
    ]);
  });

  it('con confianza alta y sin contradicciones: análisis exitoso y cero flags', async () => {
    const { id } = await flagged();
    const { body } = await flagsOf(id).set(as(reviewer.token)).expect(200);
    expect(body.analysis.status).toBe('SUCCEEDED');
    expect(body.flags).toEqual([]);
  });

  it('las contradicciones de la IA salen como posibles, con sus preguntas y severidad', async () => {
    aiAnswer = {
      contradictions: [
        {
          questionCodes: ['stage', 'story', 'stage'],
          severity: 'HIGH',
          explanation:
            'Dice que el proyecto ya salió, pero lo describe como idea.',
        },
      ],
      instructionsToAi: { detected: true, questionCodes: ['story'] },
    };
    const { id } = await flagged();
    const { body } = await flagsOf(id).set(as(reviewer.token)).expect(200);
    expect(body.flags).toHaveLength(2);
    const [contradiction, instructions] = body.flags;
    expect(contradiction).toMatchObject({ source: 'AI', severity: 'HIGH' });
    expect(contradiction.message).toMatch(/^Posible contradicción: Dice que/);
    expect(
      contradiction.questions.map((q: { code: string }) => q.code),
    ).toEqual(['stage', 'story']);
    expect(instructions.message).toContain('instrucciones a la IA');
    expect(instructions.questions.map((q: { code: string }) => q.code)).toEqual(
      ['story'],
    );
  });

  it('una pregunta que no es de la versión invalida el análisis; reintentar no duplica', async () => {
    aiAnswer = {
      contradictions: [
        { questionCodes: ['inventada'], severity: 'LOW', explanation: 'x' },
      ],
      instructionsToAi: { detected: false, questionCodes: [] },
    };
    const { id, calculation, analysis } = await flagged();
    expect(analysis).toMatchObject({
      status: 'FAILED',
      failureReason: 'invalid_question',
    });
    expect(
      await prisma.flag.count({ where: { calculationId: calculation.id } }),
    ).toBe(0);
    // El resultado no se toca.
    expect((await calculations(id))[0].status).toBe('SUCCEEDED');

    aiAnswer = {
      contradictions: [
        { questionCodes: ['stage'], severity: 'LOW', explanation: 'Revisar.' },
      ],
      instructionsToAi: { detected: false, questionCodes: [] },
    };
    const route = `/api/v1/calculations/${calculation.id}/flag-analysis`;
    await server().post(route).set(as(reviewer.token)).expect(202);
    expect((await analyzed(calculation.id)).status).toBe('SUCCEEDED');
    const { body: again } = await server()
      .post(route)
      .set(as(reviewer.token))
      .expect(409);
    expect(again.code).toBe('FLAG_ANALYSIS_NOT_RETRYABLE');
    expect(
      await prisma.flag.count({ where: { calculationId: calculation.id } }),
    ).toBe(1);
  });

  it('si la IA falla, el análisis queda fallido y se distingue de "sin flags"', async () => {
    aiError = new AiProviderError('timeout');
    const { id, calculation } = await flagged();
    const { body } = await flagsOf(id).set(as(reviewer.token)).expect(200);
    expect(body.analysis).toMatchObject({
      status: 'FAILED',
      failureReason: 'timeout',
    });
    expect(body.flags).toEqual([]);
    const { body: analysis } = await server()
      .get(`/api/v1/calculations/${calculation.id}/flag-analysis`)
      .set(as(reviewer.token))
      .expect(200);
    expect(analysis.status).toBe('FAILED');
  });

  it('recalcular da un análisis y flags nuevos, sin borrar los anteriores', async () => {
    engine.confidence = 0.2;
    const { id, calculation: first } = await flagged();
    await server()
      .post(`${DIAGNOSTICS}/${id}/calculations`)
      .set(as(approver.token))
      .expect(202);
    await settled(id);
    const second = (await calculations(id))[1];
    await analyzed(second.id);

    const current = await flagsOf(id).set(as(reviewer.token)).expect(200);
    expect(current.body.calculationId).toBe(second.id);
    expect(current.body.flags).toHaveLength(1);
    const old = await flagsOf(id, `?calculationId=${first.id}`)
      .set(as(reviewer.token))
      .expect(200);
    expect(old.body.flags).toHaveLength(1);
    expect(old.body.flags[0].id).not.toBe(current.body.flags[0].id);
  });

  it('revisar, descartar con nota y reabrir; descartar sin nota es un 400', async () => {
    engine.confidence = 0.1;
    const { id } = await flagged();
    const [flag] = (await flagsOf(id).set(as(reviewer.token))).body.flags;
    const patch = (body: object) =>
      server()
        .patch(`/api/v1/flags/${flag.id}`)
        .set(as(reviewer.token))
        .send(body);

    const { body: invalid } = await patch({
      status: 'DISMISSED',
      note: '  ',
    }).expect(400);
    expect(invalid.code).toBe('VALIDATION_FAILED');
    await patch({ status: 'NOPE' }).expect(400);

    const { body: dismissed } = await patch({
      status: 'DISMISSED',
      note: 'El cliente lo aclaró por teléfono.',
    }).expect(200);
    expect(dismissed).toMatchObject({
      status: 'DISMISSED',
      reviewNote: 'El cliente lo aclaró por teléfono.',
      reviewedBy: { id: reviewer.id },
    });
    const { body: reopened } = await patch({ status: 'OPEN' }).expect(200);
    expect(reopened).toMatchObject({
      status: 'OPEN',
      reviewedBy: null,
      reviewNote: null,
    });

    await server()
      .patch('/api/v1/flags/no-existe')
      .set(as(reviewer.token))
      .send({ status: 'REVIEWED' })
      .expect(404);
  });

  it('en un caso aprobado las alertas no cambian hasta reabrirlo (409), y el detalle lo indica', async () => {
    engine.confidence = 0.1;
    const { id } = await flagged();
    const [flag] = (await flagsOf(id).set(as(reviewer.token))).body.flags;
    // Se aprueba directo en la base: el flujo completo ya lo prueba reviews.
    await prisma.review.update({
      where: { diagnosticId: id },
      data: { status: 'APPROVED' },
    });

    const { body: detail } = await server()
      .get(`${DIAGNOSTICS}/${id}`)
      .set(as(reviewer.token))
      .expect(200);
    expect(detail.review).toMatchObject({ status: 'APPROVED' });

    for (const user of [reviewer, approver]) {
      for (const body of [
        { status: 'REVIEWED' },
        { status: 'DISMISSED', note: 'Aclarado.' },
      ]) {
        const { body: conflict } = await server()
          .patch(`/api/v1/flags/${flag.id}`)
          .set(as(user.token))
          .send(body)
          .expect(409);
        expect(conflict.code).toBe('REVIEW_APPROVED');
      }
    }
    const stored = await prisma.flag.findUniqueOrThrow({
      where: { id: flag.id },
    });
    expect(stored.status).toBe('OPEN');

    // Reabierto el caso, las alertas vuelven a cambiar.
    await prisma.review.update({
      where: { diagnosticId: id },
      data: { status: 'PENDING' },
    });
    await server()
      .patch(`/api/v1/flags/${flag.id}`)
      .set(as(reviewer.token))
      .send({ status: 'REVIEWED' })
      .expect(200);
  });

  it('el listado de diagnósticos trae los flags abiertos del cálculo vigente', async () => {
    engine.confidence = 0.1;
    const low = await flagged();
    engine.confidence = 0.9;
    const high = await flagged();
    const openFlags = async () => {
      const { body } = await server()
        .get(`${DIAGNOSTICS}?pageSize=100`)
        .set(as(reviewer.token))
        .expect(200);
      const rows = body.data as { id: string; openFlagCount: number }[];
      const count = (id: string) =>
        rows.find((row) => row.id === id)?.openFlagCount;
      return { low: count(low.id), high: count(high.id) };
    };
    expect(await openFlags()).toEqual({ low: 1, high: 0 });

    const [flag] = (await flagsOf(low.id).set(as(reviewer.token))).body.flags;
    await server()
      .patch(`/api/v1/flags/${flag.id}`)
      .set(as(reviewer.token))
      .send({ status: 'REVIEWED' })
      .expect(200);
    expect(await openFlags()).toEqual({ low: 0, high: 0 });

    // Al recalcular, cuenta el cálculo nuevo, no la suma del historial.
    engine.confidence = 0.2;
    await server()
      .post(`${DIAGNOSTICS}/${low.id}/calculations`)
      .set(as(approver.token))
      .expect(202);
    await settled(low.id);
    expect(await openFlags()).toEqual({ low: 1, high: 0 });
  });

  it('las rutas exigen sesión del panel', async () => {
    const { id, session, calculation } = await flagged();
    await flagsOf(id).expect(401);
    await flagsOf(id).set(as(session)).expect(401);
    await server()
      .post(`/api/v1/calculations/${calculation.id}/flag-analysis`)
      .expect(401);
    await flagsOf('no-existe').set(as(reviewer.token)).expect(404);
  });

  it('con la IA desactivada el análisis queda pendiente, reintentar da 503, y al activarla se retoma', async () => {
    const configFor = vi
      .spyOn(AiService.prototype, 'configFor')
      .mockReturnValue({ provider: 'disabled', model: 'claude-opus-5-5' });
    const { id } = await submitted();
    await settled(id);
    const [calculation] = await calculations(id);
    const pending = await prisma.flagAnalysis.findUniqueOrThrow({
      where: { calculationId: calculation.id },
    });
    expect(pending.status).toBe('PENDING');
    const { body } = await server()
      .post(`/api/v1/calculations/${calculation.id}/flag-analysis`)
      .set(as(reviewer.token))
      .expect(503);
    expect(body.code).toBe('AI_DISABLED');

    configFor.mockRestore();
    await app.get(FlagsService).onApplicationBootstrap();
    expect((await analyzed(calculation.id)).status).toBe('SUCCEEDED');
  });

  it('a la IA no le llega el nombre del lead, y la bitácora no guarda respuestas', async () => {
    aiRequests = [];
    const { id } = await flagged();
    const lead = await prisma.diagnostic.findUniqueOrThrow({
      where: { id },
      select: { lead: { select: { name: true, email: true } } },
    });
    const sentToAi = aiRequests.join('\n');
    expect(sentToAi).toContain('Un disco');
    expect(sentToAi).not.toContain(lead.lead.email);

    const logs = await prisma.auditLog.findMany({ where: { entityId: id } });
    expect(JSON.stringify(logs)).not.toContain('Un disco');
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['FLAG_ANALYSIS_SUCCEEDED', 'AI_TASK_RUN']),
    );
  });
});
