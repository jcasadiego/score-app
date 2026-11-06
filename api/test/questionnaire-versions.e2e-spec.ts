import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import {
  SAMPLE_PREFIX,
  seedSampleQuestionnaire,
} from '../prisma/sample-questionnaire';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * "Un solo borrador por familia" es una regla sobre toda la tabla, y una versión
 * publicada no se puede borrar nunca. Por eso este e2e usa una base propia,
 * creada y borrada aquí, igual que `last-approver`.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_questionnaire_${process.pid}`;
const VERSIONS = '/api/v1/questionnaire-versions';

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

const choiceQuestion = (code: string, values = ['yes', 'no']) => ({
  code,
  text: `¿Pregunta ${code}?`,
  type: 'SINGLE_CHOICE',
  helpText: 'Ejemplo de ayuda',
  required: true,
  options: values.map((value) => ({ value, text: `Opción ${value}` })),
});

const freeTextQuestion = (code: string) => ({
  code,
  text: `Cuéntanos ${code}`,
  type: 'FREE_TEXT',
  required: false,
  maxLength: 500,
});

describe('Versiones del cuestionario (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };

  const server = () => request(app.getHttpServer());
  const as = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

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

  async function newDraft(family: string) {
    const { body } = await server()
      .post(VERSIONS)
      .set(as(approver))
      .send({ family })
      .expect(201);
    return body as { id: string; versionNumber: number; questions: unknown[] };
  }

  async function addQuestion(versionId: string, question: object) {
    const { body } = await server()
      .post(`${VERSIONS}/${versionId}/questions`)
      .set(as(approver))
      .send(question)
      .expect(201);
    return body as { id: string; code: string };
  }

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DATABASE}`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl(DATABASE) },
      stdio: 'pipe',
    });
    // `PrismaService` lee la URL al construirse: toda la app usa la base propia.
    process.env.DATABASE_URL = databaseUrl(DATABASE);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    approver = await signedIn('aprobador', UserRole.ADMIN);
    reviewer = await signedIn('revisor', UserRole.REVIEWER);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.$disconnect();
    vi.restoreAllMocks();
  });

  describe('permisos', () => {
    it('sin sesión responde 401', async () => {
      await server().get(VERSIONS).expect(401);
    });

    it.each([
      ['post', VERSIONS],
      ['post', `${VERSIONS}/x/questions`],
      ['put', `${VERSIONS}/x/questions/y`],
      ['delete', `${VERSIONS}/x/questions/y`],
      ['put', `${VERSIONS}/x/question-order`],
      ['post', `${VERSIONS}/x/publication`],
    ] as const)('Revisor recibe 403 en %s %s', async (method, path) => {
      const { body } = await server()
        [method](path)
        .set(as(reviewer))
        .send({})
        .expect(403);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('Revisor ve el listado y el detalle', async () => {
      const draft = await newDraft('B2B');
      await server().get(VERSIONS).set(as(reviewer)).expect(200);
      await server()
        .get(`${VERSIONS}/${draft.id}`)
        .set(as(reviewer))
        .expect(200);
    });
  });

  describe('borradores', () => {
    it('no permite un segundo borrador de la misma familia', async () => {
      await newDraft('PROJECT');
      const { body } = await server()
        .post(VERSIONS)
        .set(as(approver))
        .send({ family: 'PROJECT' })
        .expect(409);
      expect(body.code).toBe('DRAFT_ALREADY_EXISTS');
    });

    it('ni siquiera con peticiones simultáneas', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          server()
            .post(VERSIONS)
            .set(as(approver))
            .send({ family: 'PROFESSIONAL' }),
        ),
      );
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(
        await prisma.questionnaireVersion.count({
          where: { family: 'PROFESSIONAL', status: 'DRAFT' },
        }),
      ).toBe(1);
    });

    it('rechaza una familia que no existe', async () => {
      await server()
        .post(VERSIONS)
        .set(as(approver))
        .send({ family: 'OTHER' })
        .expect(400);
    });

    it('404 si la versión no existe', async () => {
      const { body } = await server()
        .get(`${VERSIONS}/no-existe`)
        .set(as(approver))
        .expect(404);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('preguntas de un borrador', () => {
    let draftId: string;

    beforeAll(async () => {
      draftId = (await newDraft('CATALOG')).id;
    });

    it('crea una pregunta con sus opciones, en orden', async () => {
      const question = await addQuestion(
        draftId,
        choiceQuestion('rights', ['masters', 'publishing', 'sync']),
      );
      const { body } = await server()
        .get(`${VERSIONS}/${draftId}`)
        .set(as(approver))
        .expect(200);
      const saved = body.questions.find(
        (q: { id: string }) => q.id === question.id,
      );
      expect(saved.options.map((o: { value: string }) => o.value)).toEqual([
        'masters',
        'publishing',
        'sync',
      ]);
    });

    it.each([
      ['selección con una sola opción', choiceQuestion('una', ['solo'])],
      [
        'texto libre con opciones',
        { ...freeTextQuestion('libre'), options: [{ value: 'a', text: 'A' }] },
      ],
      [
        'texto libre sin largo máximo',
        { ...freeTextQuestion('sinlargo'), maxLength: undefined },
      ],
      [
        'selección con largo máximo',
        { ...choiceQuestion('conlargo'), maxLength: 10 },
      ],
      ['opciones con valor repetido', choiceQuestion('rep', ['a', 'a'])],
      ['code con mayúsculas', choiceQuestion('Mal_Code')],
      [
        'texto demasiado largo',
        { ...choiceQuestion('larga'), text: 'x'.repeat(501) },
      ],
    ])('rechaza %s con 400', async (_, question) => {
      const { body } = await server()
        .post(`${VERSIONS}/${draftId}/questions`)
        .set(as(approver))
        .send(question)
        .expect(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.errors.length).toBeGreaterThan(0);
    });

    it('no repite un code dentro de la versión', async () => {
      await addQuestion(draftId, choiceQuestion('unique_code'));
      const { body } = await server()
        .post(`${VERSIONS}/${draftId}/questions`)
        .set(as(approver))
        .send(choiceQuestion('unique_code'))
        .expect(409);
      expect(body.code).toBe('DUPLICATE_QUESTION_CODE');
    });

    it('edita la pregunta y reemplaza sus opciones en una sola operación', async () => {
      const question = await addQuestion(draftId, choiceQuestion('edit_me'));
      const { body } = await server()
        .put(`${VERSIONS}/${draftId}/questions/${question.id}`)
        .set(as(approver))
        .send({
          ...choiceQuestion('edit_me', ['low', 'mid', 'high']),
          type: 'MULTIPLE_CHOICE',
        })
        .expect(200);
      expect(body.type).toBe('MULTIPLE_CHOICE');
      expect(body.options.map((o: { value: string }) => o.value)).toEqual([
        'low',
        'mid',
        'high',
      ]);
    });

    it('una edición rechazada deja la pregunta como estaba', async () => {
      const question = await addQuestion(draftId, choiceQuestion('keep_me'));
      await addQuestion(draftId, choiceQuestion('taken'));
      await server()
        .put(`${VERSIONS}/${draftId}/questions/${question.id}`)
        .set(as(approver))
        .send(choiceQuestion('taken', ['x', 'y', 'z']))
        .expect(409);

      const saved = await prisma.question.findUniqueOrThrow({
        where: { id: question.id },
        include: { options: { orderBy: { position: 'asc' } } },
      });
      expect(saved.code).toBe('keep_me');
      expect(saved.options.map((o) => o.value)).toEqual(['yes', 'no']);
    });

    it('404 si la pregunta es de otra versión', async () => {
      // El borrador de B2B lo creó la prueba de permisos.
      const other = await prisma.questionnaireVersion.findFirstOrThrow({
        where: { family: 'B2B', status: 'DRAFT' },
      });
      const foreign = await addQuestion(other.id, choiceQuestion('foreign'));
      await server()
        .put(`${VERSIONS}/${draftId}/questions/${foreign.id}`)
        .set(as(approver))
        .send(choiceQuestion('foreign'))
        .expect(404);
      await server()
        .delete(`${VERSIONS}/${draftId}/questions/${foreign.id}`)
        .set(as(approver))
        .expect(404);
    });

    it('reordena y, al borrar, cierra el hueco de posiciones', async () => {
      const { body: before } = await server()
        .get(`${VERSIONS}/${draftId}`)
        .set(as(approver));
      const ids: string[] = before.questions.map((q: { id: string }) => q.id);
      const reversed = [...ids].reverse();

      const { body: reordered } = await server()
        .put(`${VERSIONS}/${draftId}/question-order`)
        .set(as(approver))
        .send({ questionIds: reversed })
        .expect(200);
      expect(reordered.questions.map((q: { id: string }) => q.id)).toEqual(
        reversed,
      );

      await server()
        .delete(`${VERSIONS}/${draftId}/questions/${reversed[0]}`)
        .set(as(approver))
        .expect(204);
      const { body: after } = await server()
        .get(`${VERSIONS}/${draftId}`)
        .set(as(approver));
      expect(after.questions.map((q: { id: string }) => q.id)).toEqual(
        reversed.slice(1),
      );
      expect(
        after.questions.map((q: { position: number }) => q.position),
      ).toEqual(reversed.slice(1).map((_, i) => i));
    });

    it('el orden debe traer cada pregunta exactamente una vez', async () => {
      const { body: version } = await server()
        .get(`${VERSIONS}/${draftId}`)
        .set(as(approver));
      const ids: string[] = version.questions.map((q: { id: string }) => q.id);

      for (const questionIds of [
        ids.slice(1),
        [...ids, 'otra'],
        [ids[0], ids[0]],
      ]) {
        await server()
          .put(`${VERSIONS}/${draftId}/question-order`)
          .set(as(approver))
          .send({ questionIds })
          .expect(400);
      }
    });

    it('cada cambio queda en la bitácora con quién lo hizo', async () => {
      const question = await addQuestion(draftId, freeTextQuestion('audited'));
      await server()
        .delete(`${VERSIONS}/${draftId}/questions/${question.id}`)
        .set(as(approver))
        .expect(204);

      const logs = await prisma.auditLog.findMany({
        where: { entity: 'Question', entityId: question.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((log) => log.action)).toEqual([
        'QUESTION_CREATED',
        'QUESTION_DELETED',
      ]);
      expect(logs.every((log) => log.actorId === approver.id)).toBe(true);
    });
  });

  describe('publicar', () => {
    it('sin preguntas responde 409 con lo que falta', async () => {
      const draft = await prisma.questionnaireVersion.findFirstOrThrow({
        where: { family: 'PROJECT', status: 'DRAFT' },
      });
      const { body } = await server()
        .post(`${VERSIONS}/${draft.id}/publication`)
        .set(as(approver))
        .expect(409);
      expect(body.code).toBe('QUESTIONNAIRE_VERSION_INCOMPLETE');
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'NO_QUESTIONS' }),
      ]);
    });

    it('con preguntas inválidas en la base, lista cada una', async () => {
      const draft = await prisma.questionnaireVersion.findFirstOrThrow({
        where: { family: 'PROJECT', status: 'DRAFT' },
      });
      // Entra por fuera de la API, que nunca la habría aceptado.
      await prisma.question.create({
        data: {
          questionnaireVersionId: draft.id,
          code: 'broken',
          text: 'Rota',
          type: 'SINGLE_CHOICE',
          required: true,
          position: 0,
        },
      });
      const { body } = await server()
        .post(`${VERSIONS}/${draft.id}/publication`)
        .set(as(approver))
        .expect(409);
      expect(body.errors).toEqual([
        expect.objectContaining({
          field: 'questions[0].options',
          code: 'NOT_ENOUGH_OPTIONS',
        }),
      ]);
    });

    it('publica, queda inmutable y el siguiente borrador copia sus preguntas', async () => {
      const draft = await prisma.questionnaireVersion.findFirstOrThrow({
        where: { family: 'PROJECT', status: 'DRAFT' },
        include: { questions: true },
      });
      const broken = draft.questions.find((q) => q.code === 'broken');
      if (broken) {
        await server()
          .delete(`${VERSIONS}/${draft.id}/questions/${broken.id}`)
          .set(as(approver))
          .expect(204);
      }
      const kept = await addQuestion(draft.id, choiceQuestion('budget'));
      await addQuestion(draft.id, freeTextQuestion('plan'));

      const { body: published } = await server()
        .post(`${VERSIONS}/${draft.id}/publication`)
        .set(as(approver))
        .expect(200);
      expect(published.status).toBe('PUBLISHED');
      expect(published.publishedById).toBe(approver.id);

      // Funciones: supertest cierra el servidor al terminar cada petición, así
      // que se crean de a una.
      const writes = [
        () =>
          server()
            .post(`${VERSIONS}/${draft.id}/questions`)
            .send(choiceQuestion('late')),
        () =>
          server()
            .put(`${VERSIONS}/${draft.id}/questions/${kept.id}`)
            .send(choiceQuestion('budget')),
        () => server().delete(`${VERSIONS}/${draft.id}/questions/${kept.id}`),
        () =>
          server()
            .put(`${VERSIONS}/${draft.id}/question-order`)
            .send({ questionIds: [kept.id] }),
        () => server().post(`${VERSIONS}/${draft.id}/publication`),
      ];
      for (const write of writes) {
        const { body } = await write().set(as(approver)).expect(409);
        expect(body.code).toBe('QUESTIONNAIRE_VERSION_PUBLISHED');
      }

      const log = await prisma.auditLog.findFirst({
        where: {
          action: 'QUESTIONNAIRE_VERSION_PUBLISHED',
          entityId: draft.id,
        },
      });
      expect(log?.actorId).toBe(approver.id);

      const next = await newDraft('PROJECT');
      expect(next.versionNumber).toBe(published.versionNumber + 1);
      const { body: copy } = await server()
        .get(`${VERSIONS}/${next.id}`)
        .set(as(approver));
      expect(copy.questions.map((q: { code: string }) => q.code)).toEqual([
        'budget',
        'plan',
      ]);
      expect(copy.questions[0].id).not.toBe(kept.id);
    });

    it('la base rechaza cambios a una versión publicada aunque no pasen por la API', async () => {
      const published = await prisma.questionnaireVersion.findFirstOrThrow({
        where: { family: 'PROJECT', status: 'PUBLISHED' },
        include: { questions: { include: { options: true } } },
      });
      const [question] = published.questions;

      await expect(
        prisma.question.update({
          where: { id: question.id },
          data: { text: 'otra' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.answerOption.deleteMany({ where: { questionId: question.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.questionnaireVersion.update({
          where: { id: published.id },
          data: { status: 'DRAFT', publishedAt: null, publishedById: null },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.questionnaireVersion.delete({ where: { id: published.id } }),
      ).rejects.toThrow();
    });
  });

  describe('listado', () => {
    it('pagina y filtra por familia y estado', async () => {
      const { body } = await server()
        .get(`${VERSIONS}?family=PROJECT&status=PUBLISHED&page=1&pageSize=1`)
        .set(as(reviewer))
        .expect(200);
      expect(body).toMatchObject({ total: 1, page: 1, pageSize: 1 });
      expect(body.data[0]).toMatchObject({
        family: 'PROJECT',
        status: 'PUBLISHED',
        questionCount: 2,
      });
    });
  });

  describe('cuestionario de prueba', () => {
    it('carga las 4 familias, y cargarlo otra vez no duplica nada', async () => {
      // El seed omite una familia con borrador abierto: se descartan primero.
      const drafts = await prisma.questionnaireVersion.findMany({
        where: { status: 'DRAFT' },
        select: { id: true },
      });
      const draftIds = drafts.map(({ id }) => id);
      await prisma.question.deleteMany({
        where: { questionnaireVersionId: { in: draftIds } },
      });
      await prisma.questionnaireVersion.deleteMany({
        where: { id: { in: draftIds } },
      });

      const seedClient = prisma as unknown as PrismaClient;
      await seedSampleQuestionnaire(seedClient, approver.id);
      await seedSampleQuestionnaire(seedClient, approver.id);

      const samples = await prisma.questionnaireVersion.findMany({
        where: { isSample: true },
        include: { questions: true },
      });
      expect(samples.map((s) => s.family).sort()).toEqual([
        'B2B',
        'CATALOG',
        'PROFESSIONAL',
        'PROJECT',
      ]);
      for (const sample of samples) {
        expect(sample.status).toBe('PUBLISHED');
        expect(
          sample.questions.every((q) => q.text.startsWith(SAMPLE_PREFIX)),
        ).toBe(true);
      }
    });

    it('un borrador nuevo no copia la versión de prueba', async () => {
      // CATALOG solo tiene la versión de prueba publicada.
      const draft = await newDraft('CATALOG');
      expect(draft.questions).toEqual([]);
    });
  });
});
