import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import {
  CalculationStatus,
  FlagAnalysisStatus,
  UserRole,
} from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { SimulatedAiAdapter } from './../src/ai/adapters/simulated-ai.adapter';
import { AiProviderError } from './../src/ai/ai-provider.port';
import { AuditService } from './../src/audit/audit.service';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  SCORING_ENGINE_PORT,
  type ScoringInput,
  type ScoringOutput,
} from './../src/scoring-engine/scoring-engine.port';

/**
 * Revisión y aprobación (PF-39), con un motor falso (la confianza y los fallos
 * los elige la prueba) y la IA simulada. Base propia.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_reviews_${process.pid}`;
const DIAGNOSTICS = '/api/v1/diagnostics';
const SESSIONS = '/api/v1/diagnostic-sessions';
const REVIEWS = '/api/v1/reviews';

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
    if (this.mode === 'fail') throw new Error('fallo del motor');
    return {
      result: { simulated: true, potential: 42, confidence: this.confidence },
      ruleSetVersionNumber: this.ruleSetVersionNumber,
      simulated: true,
    };
  },
};

describe('Revisión (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let otherReviewer: { id: string; token: string };
  let questions: {
    stage: string;
    story: string;
    idea: string;
    released: string;
  };
  let leadCount = 0;
  let aiError: Error | null = null;

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

  /** Diagnóstico enviado por el cliente, con las obligatorias respondidas. */
  async function submitted() {
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
    const session = as(redeemed.sessionToken as string);
    const current = `${SESSIONS}/current`;
    await server()
      .put(`${current}/answers/${questions.stage}`)
      .set(session)
      .send({ optionIds: [questions.released] })
      .expect(200);
    await server()
      .put(`${current}/answers/${questions.story}`)
      .set(session)
      .send({ text: 'Un disco' })
      .expect(200);
    await server().post(`${current}/submission`).set(session).expect(201);
    return created.id as string;
  }

  /** Espera a que el último cálculo y su análisis terminen. */
  async function settled(diagnosticId: string) {
    for (let i = 0; i < 200; i++) {
      const latest = await prisma.calculation.findFirst({
        where: { diagnosticId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { flagAnalysis: true },
      });
      const calcDone =
        latest &&
        (latest.status === CalculationStatus.FAILED ||
          (latest.status === CalculationStatus.SUCCEEDED &&
            latest.flagAnalysis &&
            ['SUCCEEDED', 'FAILED'].includes(latest.flagAnalysis.status)));
      if (calcDone) return latest;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('El cálculo no terminó');
  }

  /** Un caso listo: diagnóstico enviado, calculado y analizado. */
  async function ready() {
    const diagnosticId = await submitted();
    const calculation = await settled(diagnosticId);
    const review = await prisma.review.findUniqueOrThrow({
      where: { diagnosticId },
    });
    const answers = await prisma.answer.findMany({ where: { diagnosticId } });
    const answerOf = (questionId: string) =>
      answers.find((a) => a.questionId === questionId)!.id;
    return {
      diagnosticId,
      reviewId: review.id,
      calculation,
      stageAnswer: answerOf(questions.stage),
      storyAnswer: answerOf(questions.story),
    };
  }

  const detail = (reviewId: string, token = reviewer.token) =>
    server().get(`${REVIEWS}/${reviewId}`).set(as(token)).expect(200);

  const take = (reviewId: string, token = reviewer.token) =>
    server().put(`${REVIEWS}/${reviewId}/assignment`).set(as(token));

  /** Con el ETag recién leído. Devuelve la respuesta ya comprobada. */
  async function correct(
    reviewId: string,
    body: object,
    status: number,
    token = reviewer.token,
  ) {
    const { headers } = await detail(reviewId, token);
    return server()
      .post(`${REVIEWS}/${reviewId}/corrections`)
      .set(as(token))
      .set('If-Match', headers.etag as string)
      .send(body)
      .expect(status);
  }

  async function approve(reviewId: string, status: number, body: object = {}) {
    const { headers } = await detail(reviewId, approver.token);
    return server()
      .post(`${REVIEWS}/${reviewId}/approval`)
      .set(as(approver.token))
      .set('If-Match', headers.etag as string)
      .send(body)
      .expect(status);
  }

  async function recalculate(diagnosticId: string, token = reviewer.token) {
    await server()
      .post(`${DIAGNOSTICS}/${diagnosticId}/calculations`)
      .set(as(token))
      .expect(202);
    return settled(diagnosticId);
  }

  /** Marca revisados los flags de un cálculo, por la API de flags. */
  async function closeFlags(calculationId: string) {
    const flags = await prisma.flag.findMany({ where: { calculationId } });
    for (const flag of flags) {
      await server()
        .patch(`/api/v1/flags/${flag.id}`)
        .set(as(reviewer.token))
        .send({ status: 'REVIEWED' })
        .expect(200);
    }
  }

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    const realComplete = SimulatedAiAdapter.prototype.complete;
    vi.spyOn(SimulatedAiAdapter.prototype, 'complete').mockImplementation(
      async function (this: SimulatedAiAdapter, request) {
        if (aiError) throw aiError;
        return realComplete.call(this, request);
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
    otherReviewer = await signedIn('otro-revisor', UserRole.REVIEWER);

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
    const option = (value: string) =>
      stage.options.find((o) => o.value === value)!.id;
    questions = {
      stage: stage.id,
      story: story.id,
      idea: option('idea'),
      released: option('released'),
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
    aiError = null;
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

  describe('bandeja', () => {
    it('solo muestra diagnósticos con un cálculo exitoso, con sus filtros', async () => {
      const okCase = await ready();
      engine.mode = 'fail';
      const failed = await ready();
      engine.mode = 'ok';

      const ids = async (query = '') => {
        const { body } = await server()
          .get(`${REVIEWS}?pageSize=100${query}`)
          .set(as(reviewer.token))
          .expect(200);
        return (body.data as { id: string }[]).map((r) => r.id);
      };
      expect(await ids()).toContain(okCase.reviewId);
      expect(await ids()).not.toContain(failed.reviewId);

      await take(okCase.reviewId).expect(200);
      expect(await ids('&assignment=mine')).toContain(okCase.reviewId);
      expect(await ids('&assignment=unassigned')).not.toContain(
        okCase.reviewId,
      );
      expect(await ids('&status=IN_REVIEW')).toContain(okCase.reviewId);
      expect(await ids('&status=PENDING')).not.toContain(okCase.reviewId);

      const { body } = await server()
        .get(`${REVIEWS}?pageSize=100&assignment=mine`)
        .set(as(reviewer.token))
        .expect(200);
      const row = (body.data as Record<string, unknown>[]).find(
        (r) => r.id === okCase.reviewId,
      );
      expect(row).toMatchObject({
        status: 'IN_REVIEW',
        assignee: { id: reviewer.id },
        diagnostic: { id: okCase.diagnosticId, family: 'PROJECT' },
        openFlags: 0,
      });
      expect(body).toMatchObject({ page: 1, pageSize: 100 });
    });

    it('las rutas rechazan peticiones sin sesión', async () => {
      await server().get(REVIEWS).expect(401);
      const { reviewId } = await ready();
      await server().get(`${REVIEWS}/${reviewId}`).expect(401);
      await server().put(`${REVIEWS}/${reviewId}/assignment`).expect(401);
      await server().post(`${REVIEWS}/${reviewId}/approval`).expect(401);
    });

    it('404 si la revisión no existe', async () => {
      await server()
        .get(`${REVIEWS}/no-existe`)
        .set(as(reviewer.token))
        .expect(404);
    });
  });

  describe('tomar y liberar', () => {
    it('un caso tomado no lo toma otro, ni con dos peticiones simultáneas', async () => {
      const { reviewId } = await ready();
      const results = await Promise.all([
        take(reviewId, reviewer.token),
        take(reviewId, otherReviewer.token),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body.code).toBe('REVIEW_ALREADY_TAKEN');
    });

    it('quien lo tomó puede liberarlo', async () => {
      const { reviewId } = await ready();
      await take(reviewId).expect(200);
      await server()
        .delete(`${REVIEWS}/${reviewId}/assignment`)
        .set(as(reviewer.token))
        .expect(204);
      const { body } = await detail(reviewId);
      expect(body).toMatchObject({ status: 'PENDING', assignee: null });
    });

    it('si el revisor asignado está desactivado, otro puede tomarlo', async () => {
      const { reviewId } = await ready();
      const gone = await signedIn('revisor-baja', UserRole.REVIEWER);
      await take(reviewId, gone.token).expect(200);
      await take(reviewId, otherReviewer.token).expect(409);
      await prisma.user.update({
        where: { id: gone.id },
        data: { active: false },
      });
      const { body } = await take(reviewId, otherReviewer.token).expect(200);
      expect(body.assignee.id).toBe(otherReviewer.id);
    });

    it('el Aprobador libera un caso ajeno; un Revisor no', async () => {
      const { reviewId } = await ready();
      await take(reviewId).expect(200);
      const forbidden = await server()
        .delete(`${REVIEWS}/${reviewId}/assignment`)
        .set(as(otherReviewer.token))
        .expect(403);
      expect(forbidden.body.code).toBe('REVIEW_TAKEN_BY_OTHER');
      await server()
        .delete(`${REVIEWS}/${reviewId}/assignment`)
        .set(as(approver.token))
        .expect(204);
    });
  });

  describe('correcciones', () => {
    it('exige motivo y conserva la respuesta original con autor y fecha', async () => {
      const { reviewId, storyAnswer } = await ready();
      await take(reviewId).expect(200);
      const missing = await correct(
        reviewId,
        {
          answerId: storyAnswer,
          text: 'Dos discos',
        },
        400,
      );
      expect(missing.body.code).toBe('VALIDATION_FAILED');
      await correct(
        reviewId,
        {
          answerId: storyAnswer,
          text: 'Dos discos',
          reason: '   ',
        },
        400,
      );

      const { body: created, headers } = await correct(
        reviewId,
        {
          answerId: storyAnswer,
          text: 'Dos discos',
          reason: 'Lo confirmó en la llamada',
        },
        201,
      );
      expect(headers.etag).toBeDefined();
      expect(created).toMatchObject({
        sequence: 1,
        textValue: 'Dos discos',
        reason: 'Lo confirmó en la llamada',
        correctedBy: { id: reviewer.id },
        original: { textValue: 'Un disco' },
      });

      const original = await prisma.answer.findUniqueOrThrow({
        where: { id: storyAnswer },
      });
      expect(original.textValue).toBe('Un disco');
      const { body: list } = await server()
        .get(`${REVIEWS}/${reviewId}/corrections`)
        .set(as(reviewer.token))
        .expect(200);
      expect(list).toHaveLength(1);
      expect(list[0].createdAt).toBeDefined();
      // Solo inserción: la base no deja reescribir la historia.
      await expect(
        prisma.answerCorrection.updateMany({ data: { reason: 'otro' } }),
      ).rejects.toThrow();
    });

    it('valida el valor nuevo contra la pregunta', async () => {
      const { reviewId, stageAnswer } = await ready();
      await take(reviewId).expect(200);
      const { body } = await correct(
        reviewId,
        {
          answerId: stageAnswer,
          text: 'texto',
          reason: 'motivo',
        },
        400,
      );
      expect(body.errors[0].field).toBe('text');
    });

    it('solo corrige quien tiene el caso tomado', async () => {
      const { reviewId, storyAnswer } = await ready();
      const body = { answerId: storyAnswer, text: 'x', reason: 'motivo' };
      const notTaken = await correct(reviewId, body, 409);
      expect(notTaken.body.code).toBe('REVIEW_NOT_TAKEN');
      await take(reviewId).expect(200);
      const other = await correct(reviewId, body, 403, otherReviewer.token);
      expect(other.body.code).toBe('REVIEW_TAKEN_BY_OTHER');
    });

    it('después de corregir y recalcular, el cálculo usa la respuesta corregida', async () => {
      const { diagnosticId, reviewId, stageAnswer } = await ready();
      await take(reviewId).expect(200);
      await correct(
        reviewId,
        {
          answerId: stageAnswer,
          optionIds: [questions.idea],
          reason: 'Todavía no lanza',
        },
        201,
      );
      engine.received = [];
      const calculation = await recalculate(diagnosticId);
      expect(engine.received.at(-1)?.answers).toMatchObject({
        stage: 'idea',
        story: 'Un disco',
      });
      expect(calculation.correctionSequence).toBe(1);
    });

    it('428 sin If-Match y 412 con una versión vieja', async () => {
      const { reviewId, storyAnswer } = await ready();
      await take(reviewId).expect(200);
      const body = { answerId: storyAnswer, text: 'x', reason: 'motivo' };
      const required = await server()
        .post(`${REVIEWS}/${reviewId}/corrections`)
        .set(as(reviewer.token))
        .send(body)
        .expect(428);
      expect(required.body.code).toBe('IF_MATCH_REQUIRED');

      const { headers } = await detail(reviewId);
      await correct(reviewId, body, 201);
      const stale = await server()
        .post(`${REVIEWS}/${reviewId}/corrections`)
        .set(as(reviewer.token))
        .set('If-Match', headers.etag as string)
        .send(body)
        .expect(412);
      expect(stale.body.code).toBe('REVIEW_VERSION_MISMATCH');
    });
  });

  describe('notas', () => {
    it('agrega notas generales y por dimensión', async () => {
      const { reviewId } = await ready();
      await server()
        .post(`${REVIEWS}/${reviewId}/notes`)
        .set(as(reviewer.token))
        .send({ body: 'Buen potencial\nen vivo' })
        .expect(201);
      await server()
        .post(`${REVIEWS}/${reviewId}/notes`)
        .set(as(otherReviewer.token))
        .send({ body: 'Revisar regalías', dimension: 'D3' })
        .expect(201);
      await server()
        .post(`${REVIEWS}/${reviewId}/notes`)
        .set(as(reviewer.token))
        .send({ body: '  ' })
        .expect(400);
      const { body } = await server()
        .get(`${REVIEWS}/${reviewId}/notes`)
        .set(as(reviewer.token))
        .expect(200);
      expect(body).toEqual([
        expect.objectContaining({
          dimension: null,
          body: 'Buen potencial\nen vivo',
          author: { id: reviewer.id, name: 'revisor' },
        }),
        expect.objectContaining({ dimension: 'D3' }),
      ]);
      // La dimensión es texto libre: no entra a la bitácora.
      const logs = await prisma.auditLog.findMany({
        where: { action: 'REVIEW_NOTE_ADDED', entityId: reviewId },
      });
      expect(logs).toHaveLength(2);
      for (const log of logs) {
        expect(log.data).not.toHaveProperty('dimension');
        expect(JSON.stringify(log.data)).not.toContain('D3');
      }
    });
  });

  describe('aprobación', () => {
    it('el Aprobador aprueba un caso tomado por un Revisor, atado al cálculo', async () => {
      const { reviewId, calculation } = await ready();
      await take(reviewId).expect(200);
      const { body, headers } = await approve(reviewId, 201);
      expect(body).toMatchObject({
        calculationId: calculation.id,
        approvedBy: { id: approver.id },
        aiExceptionReason: null,
        voidedAt: null,
      });
      expect(headers.etag).toBeDefined();
      const { body: review } = await detail(reviewId);
      expect(review).toMatchObject({
        status: 'APPROVED',
        approval: { calculationId: calculation.id },
        approvalBlockers: [],
      });
    });

    it('un Revisor recibe 403 al aprobar, reabrir o registrar la excepción', async () => {
      const { reviewId } = await ready();
      const { headers } = await detail(reviewId);
      await server()
        .post(`${REVIEWS}/${reviewId}/approval`)
        .set(as(reviewer.token))
        .set('If-Match', headers.etag as string)
        .send({ aiExceptionReason: 'IA caída' })
        .expect(403);
      await server()
        .post(`${REVIEWS}/${reviewId}/reopenings`)
        .set(as(reviewer.token))
        .send({ reason: 'motivo' })
        .expect(403);
    });

    it('no aprueba con flags abiertos, y el error dice qué falta', async () => {
      engine.confidence = 0.3;
      const { reviewId, calculation } = await ready();
      const { body } = await approve(reviewId, 409);
      expect(body.code).toBe('APPROVAL_REQUIREMENTS_NOT_MET');
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'OPEN_FLAGS' }),
      ]);
      await closeFlags(calculation.id);
      await approve(reviewId, 201);
    });

    it('no aprueba sin cálculo exitoso', async () => {
      engine.mode = 'fail';
      const { reviewId } = await ready();
      const { body } = await approve(reviewId, 409);
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'LATEST_CALCULATION_NOT_SUCCEEDED' }),
      ]);
    });

    it('no aprueba si el último intento falló, aunque haya un cálculo vigente anterior', async () => {
      const { diagnosticId, reviewId } = await ready();
      engine.mode = 'fail';
      const failed = await recalculate(diagnosticId);
      expect(failed.status).toBe('FAILED');
      const { body } = await approve(reviewId, 409);
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'LATEST_CALCULATION_NOT_SUCCEEDED' }),
      ]);
    });

    it('corregir sin recalcular impide aprobar, aunque exista un cálculo exitoso', async () => {
      const { diagnosticId, reviewId, storyAnswer } = await ready();
      await take(reviewId).expect(200);
      await correct(
        reviewId,
        {
          answerId: storyAnswer,
          text: 'Dos discos',
          reason: 'motivo',
        },
        201,
      );
      const { body } = await approve(reviewId, 409);
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'CORRECTIONS_NOT_CALCULATED' }),
      ]);
      await recalculate(diagnosticId);
      await approve(reviewId, 201);
    });

    it('una corrección hecha mientras corre un cálculo impide aprobar con ese cálculo', async () => {
      const { diagnosticId, reviewId, storyAnswer } = await ready();
      await take(reviewId).expect(200);
      let open!: () => void;
      engine.gate = new Promise((resolve) => (open = resolve));
      await server()
        .post(`${DIAGNOSTICS}/${diagnosticId}/calculations`)
        .set(as(reviewer.token))
        .expect(202);
      await correct(
        reviewId,
        {
          answerId: storyAnswer,
          text: 'Tres discos',
          reason: 'motivo',
        },
        201,
      );
      open();
      const calculation = await settled(diagnosticId);
      expect(calculation.status).toBe('SUCCEEDED');
      expect(calculation.correctionSequence).toBe(0);
      const { body } = await approve(reviewId, 409);
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'CORRECTIONS_NOT_CALCULATED' }),
      ]);
    });

    it('con el análisis de IA fallido no aprueba, salvo excepción con motivo, que queda registrada', async () => {
      aiError = new AiProviderError('timeout');
      const { reviewId, calculation } = await ready();
      expect(calculation.flagAnalysis?.status).toBe(FlagAnalysisStatus.FAILED);
      const { body: blocked } = await approve(reviewId, 409);
      expect(blocked.errors).toEqual([
        expect.objectContaining({ code: 'FLAG_ANALYSIS_NOT_SUCCEEDED' }),
      ]);
      const { body } = await approve(reviewId, 201, {
        aiExceptionReason: 'La IA no está disponible',
      });
      expect(body.aiExceptionReason).toBe('La IA no está disponible');
    });

    it('un Revisor no recalcula un caso aprobado: debe reabrirlo un Aprobador', async () => {
      const { diagnosticId, reviewId } = await ready();
      await take(reviewId).expect(200);
      const { body: approval } = await approve(reviewId, 201);
      const { body } = await server()
        .post(`${DIAGNOSTICS}/${diagnosticId}/calculations`)
        .set(as(reviewer.token))
        .expect(409);
      expect(body.code).toBe('REVIEW_APPROVED');
      const kept = await prisma.reviewApproval.findUniqueOrThrow({
        where: { id: approval.id },
      });
      expect(kept.voidedAt).toBeNull();
      const { body: detailBody } = await detail(reviewId);
      expect(detailBody).toMatchObject({ status: 'APPROVED' });
    });

    it('recalcular después de aprobar anula la aprobación (Aprobador)', async () => {
      const { diagnosticId, reviewId } = await ready();
      await take(reviewId).expect(200);
      const { body: approval } = await approve(reviewId, 201);
      await recalculate(diagnosticId, approver.token);
      const voided = await prisma.reviewApproval.findUniqueOrThrow({
        where: { id: approval.id },
      });
      expect(voided).toMatchObject({
        voidCause: 'RECALCULATED',
        voidedById: approver.id,
      });
      const { body } = await detail(reviewId);
      expect(body).toMatchObject({ status: 'IN_REVIEW', approval: null });
    });

    it('un caso aprobado rechaza correcciones hasta reabrirlo; reabrir exige motivo', async () => {
      const { reviewId, storyAnswer } = await ready();
      await take(reviewId).expect(200);
      await approve(reviewId, 201);
      const body = { answerId: storyAnswer, text: 'x', reason: 'motivo' };
      const rejected = await correct(reviewId, body, 409);
      expect(rejected.body.code).toBe('REVIEW_APPROVED');

      await server()
        .post(`${REVIEWS}/${reviewId}/reopenings`)
        .set(as(approver.token))
        .send({ reason: ' ' })
        .expect(400);
      const { body: reopened } = await server()
        .post(`${REVIEWS}/${reviewId}/reopenings`)
        .set(as(approver.token))
        .send({ reason: 'El cliente mandó datos nuevos' })
        .expect(201);
      expect(reopened).toMatchObject({
        voidCause: 'REOPENED',
        voidedBy: { id: approver.id },
        voidReason: 'El cliente mandó datos nuevos',
      });
      await correct(reviewId, body, 201);
      await server()
        .post(`${REVIEWS}/${reviewId}/reopenings`)
        .set(as(approver.token))
        .send({ reason: 'otra vez' })
        .expect(409);
    });

    it('aprobar sobre una versión vieja se rechaza', async () => {
      const { reviewId } = await ready();
      const { headers } = await detail(reviewId, approver.token);
      await take(reviewId).expect(200);
      const { body } = await server()
        .post(`${REVIEWS}/${reviewId}/approval`)
        .set(as(approver.token))
        .set('If-Match', headers.etag as string)
        .send({})
        .expect(412);
      expect(body.code).toBe('REVIEW_VERSION_MISMATCH');
    });

    it('la bitácora registra quién corrigió y quién aprobó, sin las respuestas', async () => {
      const { diagnosticId, reviewId, storyAnswer } = await ready();
      await take(reviewId, approver.token).expect(200);
      await correct(
        reviewId,
        { answerId: storyAnswer, text: 'Dato secreto', reason: 'motivo' },
        201,
        approver.token,
      );
      await recalculate(diagnosticId);
      await approve(reviewId, 201);
      const logs = await prisma.auditLog.findMany({
        where: { entity: 'Review', entityId: reviewId },
        orderBy: { createdAt: 'asc' },
      });
      const approved = logs.find((l) => l.action === 'REVIEW_APPROVED');
      expect(approved).toMatchObject({
        actorId: approver.id,
        data: expect.objectContaining({
          correctedByIds: [approver.id],
          approverCorrected: true,
        }),
      });
      expect(JSON.stringify(logs)).not.toContain('Dato secreto');
    });

    it('si falla la bitácora, aprobar y corregir se revierten', async () => {
      const { reviewId, storyAnswer } = await ready();
      await take(reviewId).expect(200);
      const record = AuditService.prototype.record;
      const spy = vi
        .spyOn(AuditService.prototype, 'record')
        .mockImplementation(function (this: AuditService, params, client) {
          if (['REVIEW_APPROVED', 'ANSWER_CORRECTED'].includes(params.action)) {
            return Promise.reject(new Error('bitácora caída')) as never;
          }
          return record.call(this, params, client);
        });
      try {
        await approve(reviewId, 500);
        await correct(
          reviewId,
          {
            answerId: storyAnswer,
            text: 'x',
            reason: 'motivo',
          },
          500,
        );
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.reviewApproval.count({ where: { reviewId } })).toBe(
        0,
      );
      expect(await prisma.answerCorrection.count({ where: { reviewId } })).toBe(
        0,
      );
      const { body } = await detail(reviewId);
      expect(body.status).toBe('IN_REVIEW');
    });
  });
});
