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
import {
  AiProviderError,
  type AiProviderRequest,
} from './../src/ai/ai-provider.port';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  SCORING_ENGINE_PORT,
  type ScoringOutput,
} from './../src/scoring-engine/scoring-engine.port';

/**
 * Informe (PF-42): borrador con IA simulada, edición, historial y aprobación,
 * con un motor falso que devuelve dos dimensiones. Base propia.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_reports_${process.pid}`;
const DIAGNOSTICS = '/api/v1/diagnostics';
const SESSIONS = '/api/v1/diagnostic-sessions';
const REVIEWS = '/api/v1/reviews';
const LEAD_NAME = 'Valentina Quiroga';

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

const engine = {
  driver: 'stub' as const,
  enabled: true,
  ruleSetVersionNumber: 0,
  evaluate(): Promise<ScoringOutput> {
    return Promise.resolve({
      result: {
        simulated: true,
        potential: 42,
        confidence: 0.9,
        dimensions: { D1: 30, D2: 70 },
      },
      ruleSetVersionNumber: this.ruleSetVersionNumber,
      simulated: true,
    });
  },
};

describe('Informe (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let questions: { stage: string; story: string; released: string };
  let leadCount = 0;
  let aiError: Error | null = null;
  const aiRequests: AiProviderRequest[] = [];

  const server = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const reportUrl = (reviewId: string) => `${REVIEWS}/${reviewId}/report`;

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

  /** Espera a que el último cálculo y su análisis terminen. */
  async function settled(diagnosticId: string) {
    for (let i = 0; i < 200; i++) {
      const latest = await prisma.calculation.findFirst({
        where: { diagnosticId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { flagAnalysis: true },
      });
      if (
        latest?.status === CalculationStatus.SUCCEEDED &&
        latest.flagAnalysis &&
        ['SUCCEEDED', 'FAILED'].includes(latest.flagAnalysis.status)
      ) {
        return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('El cálculo no terminó');
  }

  /**
   * Un caso enviado y calculado. El cliente escribió su nombre, correo y
   * teléfono en un texto libre: nada de eso debe llegar a la IA.
   */
  async function calculatedCase() {
    leadCount += 1;
    const lead = await prisma.lead.create({
      data: {
        name: LEAD_NAME,
        email: `cliente${leadCount}@test.local`,
        phone: '+57 300 123 4567',
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
      .send({ text: `Soy ${LEAD_NAME}, cliente${leadCount}@test.local` })
      .expect(200);
    await server().post(`${current}/submission`).set(session).expect(201);
    await settled(created.id as string);
    const review = await prisma.review.findUniqueOrThrow({
      where: { diagnosticId: created.id as string },
    });
    return { reviewId: review.id, diagnosticId: created.id as string, lead };
  }

  async function approveReview(reviewId: string) {
    const { headers } = await server()
      .get(`${REVIEWS}/${reviewId}`)
      .set(as(approver.token))
      .expect(200);
    await server()
      .post(`${REVIEWS}/${reviewId}/approval`)
      .set(as(approver.token))
      .set('If-Match', headers.etag as string)
      .send({})
      .expect(201);
  }

  /** Caso aprobado con su borrador ya generado. */
  async function draftedCase() {
    const kase = await calculatedCase();
    await server()
      .post(`${REVIEWS}/${kase.reviewId}/notes`)
      .set(as(reviewer.token))
      .send({ dimension: 'D1', body: `Hablé con ${LEAD_NAME}: tiene deudas.` })
      .expect(201);
    await approveReview(kase.reviewId);
    const { body: report, headers } = await server()
      .post(reportUrl(kase.reviewId))
      .set(as(reviewer.token))
      .expect(201);
    return { ...kase, report, etag: headers.etag as string };
  }

  const read = (reviewId: string, token = reviewer.token) =>
    server().get(reportUrl(reviewId)).set(as(token)).expect(200);

  function edit(
    reviewId: string,
    sectionId: string,
    body: string,
    etag: string,
  ) {
    return server()
      .put(`${reportUrl(reviewId)}/sections/${sectionId}`)
      .set(as(reviewer.token))
      .set('If-Match', etag)
      .send({ body });
  }

  async function approveReport(reviewId: string, token = approver.token) {
    const { headers } = await read(reviewId, token);
    return server()
      .post(`${reportUrl(reviewId)}/approval`)
      .set(as(token))
      .set('If-Match', headers.etag as string);
  }

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    const realComplete = SimulatedAiAdapter.prototype.complete;
    vi.spyOn(SimulatedAiAdapter.prototype, 'complete').mockImplementation(
      async function (this: SimulatedAiAdapter, req) {
        aiRequests.push(req);
        if (aiError) throw aiError;
        return realComplete.call(this, req);
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
      maxLength: 200,
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
    aiError = null;
    aiRequests.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    // FORCE: un trabajo en segundo plano puede seguir conectado (CLAUDE.md 9).
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
    );
    await admin.$disconnect();
    vi.restoreAllMocks();
  });

  describe('borrador', () => {
    it('sin la revisión aprobada no se genera (409)', async () => {
      const { reviewId } = await calculatedCase();
      const { body } = await server()
        .post(reportUrl(reviewId))
        .set(as(reviewer.token))
        .expect(409);
      expect(body.code).toBe('REVIEW_NOT_APPROVED');
      expect(await prisma.report.count({ where: { reviewId } })).toBe(0);
    });

    it('trae las cuatro partes por dimensión, redactadas por la IA, y una sola vez', async () => {
      const { reviewId, report, etag } = await draftedCase();

      expect(etag).toBe(`"${report.version}"`);
      expect(report.status).toBe('DRAFT');
      expect(report.outdated).toBe(false);
      expect(
        report.sections.map(
          (s: { dimension: string; part: string }) =>
            `${s.dimension}:${s.part}`,
        ),
      ).toEqual([
        'D1:FINDING',
        'D1:IMPLICATION',
        'D1:RECOMMENDATION',
        'D1:NEXT_STEP',
        'D2:FINDING',
        'D2:IMPLICATION',
        'D2:RECOMMENDATION',
        'D2:NEXT_STEP',
      ]);
      for (const section of report.sections) {
        expect(section).toMatchObject({
          source: 'AI',
          sequence: 1,
          body: 'Respuesta simulada',
          author: { id: reviewer.id },
        });
      }

      const { body } = await server()
        .post(reportUrl(reviewId))
        .set(as(reviewer.token))
        .expect(409);
      expect(body.code).toBe('REPORT_ALREADY_EXISTS');
    });

    it('a la IA no le llegan nombre, correo ni teléfono del lead', async () => {
      const { lead } = await draftedCase();

      // Las del informe; el análisis de alertas también llama a la IA.
      const forReport = aiRequests.filter((r) =>
        r.system.includes('redacta el informe'),
      );
      expect(forReport).toHaveLength(1);
      const sent = forReport[0].userContent;
      expect(sent).not.toContain(LEAD_NAME);
      expect(sent).not.toContain(lead.email);
      expect(sent).not.toContain('300 123 4567');
      // Sí le llegan el resultado, las respuestas y las notas del revisor.
      expect(sent).toContain('"D1": 30');
      expect(sent).toContain('tiene deudas');
      expect(sent).toContain('Soy [dato personal]');
      expect(sent).not.toContain('"simulated"');
    });

    it('si la IA falla no se crea nada, queda registrado y se puede reintentar', async () => {
      const { reviewId } = await calculatedCase();
      await approveReview(reviewId);
      aiError = new AiProviderError('timeout');

      const { body } = await server()
        .post(reportUrl(reviewId))
        .set(as(reviewer.token))
        .expect(503);
      expect(body.code).toBe('AI_TASK_FAILED');
      expect(await prisma.report.count({ where: { reviewId } })).toBe(0);
      expect(
        await prisma.aiCallLog.count({
          where: { use: 'report', outcome: 'FAILED', failureReason: 'timeout' },
        }),
      ).toBeGreaterThan(0);

      aiError = null;
      await server()
        .post(reportUrl(reviewId))
        .set(as(reviewer.token))
        .expect(201);
    });
  });

  describe('edición e historial', () => {
    it('edita una sección, sube la versión y el historial distingue IA y persona', async () => {
      const { reviewId, report, etag } = await draftedCase();
      const section = report.sections[0];

      const { body: edited, headers } = await edit(
        reviewId,
        section.id,
        '  Texto corregido por el revisor.  ',
        etag,
      ).expect(200);
      expect(headers.etag).toBe(`"${report.version + 1}"`);
      expect(edited.sections[0]).toMatchObject({
        body: 'Texto corregido por el revisor.',
        source: 'HUMAN',
        sequence: 2,
        author: { id: reviewer.id },
      });

      const { body: history } = await server()
        .get(`${reportUrl(reviewId)}/sections/${section.id}/revisions`)
        .set(as(reviewer.token))
        .expect(200);
      expect(
        history.map((r: { source: string; sequence: number }) => [
          r.sequence,
          r.source,
        ]),
      ).toEqual([
        [2, 'HUMAN'],
        [1, 'AI'],
      ]);
      expect(history[0].aiCallLogId).toBeNull();
      expect(
        await prisma.aiCallLog.findUnique({
          where: { id: history[1].aiCallLogId as string },
        }),
      ).toMatchObject({ use: 'report', outcome: 'SUCCEEDED' });
    });

    it('de dos ediciones con la misma versión, la segunda recibe 412; sin If-Match, 428', async () => {
      const { reviewId, report, etag } = await draftedCase();
      const [first, second] = report.sections;

      await edit(reviewId, first.id, 'Primera edición', etag).expect(200);
      const { body: stale } = await edit(
        reviewId,
        second.id,
        'Segunda edición',
        etag,
      ).expect(412);
      expect(stale.code).toBe('REPORT_VERSION_MISMATCH');

      const { body: missing } = await server()
        .put(`${reportUrl(reviewId)}/sections/${second.id}`)
        .set(as(reviewer.token))
        .send({ body: 'Sin versión' })
        .expect(428);
      expect(missing.code).toBe('IF_MATCH_REQUIRED');
    });

    it('rechaza un texto vacío o demasiado largo', async () => {
      const { reviewId, report, etag } = await draftedCase();
      for (const body of ['   ', 'x'.repeat(4001)]) {
        await edit(reviewId, report.sections[0].id, body, etag).expect(400);
      }
    });

    it('una sección de otro informe no se edita por este (404)', async () => {
      const one = await draftedCase();
      const other = await draftedCase();

      await edit(
        one.reviewId,
        other.report.sections[0].id,
        'Intrusión',
        one.etag,
      ).expect(404);
    });

    it('regenera una sola sección con IA, con las otras partes como contexto', async () => {
      const { reviewId, report, etag } = await draftedCase();
      const target = report.sections[2];
      aiRequests.length = 0;

      const { body } = await server()
        .post(`${reportUrl(reviewId)}/sections/${target.id}/regenerations`)
        .set(as(reviewer.token))
        .set('If-Match', etag)
        .expect(200);

      const regenerated = body.sections.find(
        (s: { id: string }) => s.id === target.id,
      );
      expect(regenerated).toMatchObject({ source: 'AI', sequence: 2 });
      expect(
        body.sections.filter((s: { sequence: number }) => s.sequence === 2),
      ).toHaveLength(1);
      expect(aiRequests[0].userContent).toContain('"part": "recommendation"');
      expect(aiRequests[0].userContent).not.toContain(LEAD_NAME);
    });

    it('el historial no se puede alterar ni borrar, ni desde la base', async () => {
      const { report } = await draftedCase();
      const revision = await prisma.reportSectionRevision.findFirstOrThrow({
        where: { sectionId: report.sections[0].id },
      });

      await expect(
        prisma.reportSectionRevision.update({
          where: { id: revision.id },
          data: { body: 'reescrito' },
        }),
      ).rejects.toThrow(/solo inserción/);
      await expect(
        prisma.reportSectionRevision.delete({ where: { id: revision.id } }),
      ).rejects.toThrow(/solo inserción/);
    });
  });

  describe('aprobación', () => {
    it('el Revisor recibe 403 al aprobar', async () => {
      const { reviewId } = await draftedCase();
      await approveReport(reviewId, reviewer.token).then((r) =>
        expect(r.status).toBe(403),
      );
    });

    it('el Aprobador aprueba la versión exacta y después no admite cambios', async () => {
      const { reviewId, report } = await draftedCase();

      const approved = await approveReport(reviewId);
      expect(approved.status).toBe(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approval).toMatchObject({
        reportVersion: report.version,
        approvedBy: { id: approver.id },
      });
      const approval = await prisma.reportApproval.findFirstOrThrow({
        where: { reportId: report.id },
        include: { revisions: true },
      });
      expect(approval.revisions).toHaveLength(8);

      const { body } = await edit(
        reviewId,
        report.sections[0].id,
        'Cambio tardío',
        approved.headers.etag as string,
      ).expect(409);
      expect(body.code).toBe('REPORT_APPROVED');
      const again = await approveReport(reviewId);
      expect(again.status).toBe(409);
    });

    it('reabrir la revisión devuelve el informe a borrador; hay que ponerlo al día antes de aprobar', async () => {
      const { reviewId, report } = await draftedCase();
      expect((await approveReport(reviewId)).status).toBe(201);

      await server()
        .post(`${REVIEWS}/${reviewId}/reopenings`)
        .set(as(approver.token))
        .send({ reason: 'Falta revisar una respuesta' })
        .expect(201);

      const { body: reopened } = await read(reviewId);
      expect(reopened.status).toBe('DRAFT');
      expect(reopened.approval).toBeNull();
      expect(reopened.outdated).toBe(true);
      expect(
        await prisma.reportApproval.findFirstOrThrow({
          where: { reportId: report.id },
        }),
      ).toMatchObject({ voidCause: 'REOPENED', voidedById: approver.id });
      const notApproved = await approveReport(reviewId);
      expect(notApproved.status).toBe(409);
      expect(notApproved.body.code).toBe('REVIEW_NOT_APPROVED');

      // Aprobada de nuevo, el borrador sigue atado a la aprobación anterior.
      await approveReview(reviewId);
      const outdated = await approveReport(reviewId);
      expect(outdated.status).toBe(409);
      expect(outdated.body.code).toBe('REPORT_OUTDATED');

      const { headers } = await read(reviewId);
      const { body: refreshed } = await server()
        .post(`${reportUrl(reviewId)}/regenerations`)
        .set(as(reviewer.token))
        .set('If-Match', headers.etag as string)
        .expect(200);
      expect(refreshed.outdated).toBe(false);
      expect(refreshed.sections[0].sequence).toBe(2);
      expect((await approveReport(reviewId)).status).toBe(201);
    });

    it('recalcular un caso aprobado anula también la aprobación del informe', async () => {
      const { reviewId, diagnosticId, report } = await draftedCase();
      expect((await approveReport(reviewId)).status).toBe(201);

      await server()
        .post(`${DIAGNOSTICS}/${diagnosticId}/calculations`)
        .set(as(approver.token))
        .expect(202);
      await settled(diagnosticId);

      const { body } = await read(reviewId);
      expect(body.status).toBe('DRAFT');
      expect(
        await prisma.reportApproval.findFirstOrThrow({
          where: { reportId: report.id },
        }),
      ).toMatchObject({ voidCause: 'RECALCULATED' });
    });
  });

  it('ningún texto del informe ni de las notas entra a la bitácora', async () => {
    const since = new Date();
    const { reviewId, report, etag } = await draftedCase();
    await edit(
      reviewId,
      report.sections[0].id,
      'Texto secreto del informe',
      etag,
    ).expect(200);
    await approveReport(reviewId);

    const logs = JSON.stringify(
      await prisma.auditLog.findMany({ where: { createdAt: { gte: since } } }),
    );
    expect(logs).toContain('REPORT_GENERATED');
    expect(logs).toContain('REPORT_SECTION_EDITED');
    expect(logs).toContain('REPORT_APPROVED');
    expect(logs).not.toContain('Texto secreto del informe');
    expect(logs).not.toContain('Respuesta simulada');
    expect(logs).not.toContain('tiene deudas');
  });
});
