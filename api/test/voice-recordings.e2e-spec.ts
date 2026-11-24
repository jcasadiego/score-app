import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import { MemoryStorageAdapter } from './../src/storage/adapters/memory-storage.adapter';
import { STORAGE_PORT, StorageError } from './../src/storage/storage.port';

/**
 * Grabaciones de voz (PF-86). Base propia, como `diagnostics`, porque las
 * versiones publicadas y la bitácora no se pueden borrar. El almacenamiento es
 * el adaptador en memoria, para ver qué objetos quedan.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_voice_${process.pid}`;
const DIAGNOSTICS = '/api/v1/diagnostics';
const SESSIONS = '/api/v1/diagnostic-sessions';
const CURRENT = `${SESSIONS}/current`;
const CONSENT_VERSION = '2026-11-24';

const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
  Buffer.from('B\x82\x84webmB\x87\x81\x04', 'latin1'),
  Buffer.alloc(256, 7),
]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]),
  Buffer.from('ftypM4A \x00\x00\x00\x00', 'latin1'),
  Buffer.alloc(256, 9),
]);

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

function tokenFrom(url: string): string {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  if (!token) throw new Error(`Enlace sin token: ${url}`);
  return token;
}

describe('Grabaciones de voz (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const storage = new MemoryStorageAdapter();
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let voice: { id: string };
  let plain: { id: string };
  let leadCount = 0;

  const server = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const storedKeys = () =>
    (storage as unknown as { objects: Map<string, unknown> }).objects;

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

  /** Diagnóstico nuevo con su sesión abierta. */
  async function started() {
    leadCount += 1;
    const lead = await prisma.lead.create({
      data: {
        name: `Cliente ${leadCount}`,
        email: `cliente${leadCount}@test.local`,
        family: 'PROJECT',
      },
    });
    const { body } = await server()
      .post(DIAGNOSTICS)
      .set(as(approver.token))
      .send({ leadId: lead.id, reason: 'Cortesía para la prueba' })
      .expect(201);
    const { body: redeemed } = await server()
      .post(SESSIONS)
      .send({ token: tokenFrom(body.accessLink.url) })
      .expect(201);
    return { id: body.id as string, session: redeemed.sessionToken as string };
  }

  const consent = (session: string) =>
    server()
      .post(`${CURRENT}/voice-consent`)
      .set(as(session))
      .send({ version: CONSENT_VERSION })
      .expect(200);

  const upload = (
    session: string,
    questionId: string,
    body: Buffer = WEBM,
    contentType = 'audio/webm;codecs=opus',
    durationMs: string | number = 12_000,
  ) =>
    server()
      .put(`${CURRENT}/answers/${questionId}/recording`)
      .set(as(session))
      .field('durationMs', String(durationMs))
      .attach('audio', body, { filename: 'respuesta', contentType });

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
      .overrideProvider(STORAGE_PORT)
      .useValue(storage)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    approver = await signedIn('aprobador', UserRole.ADMIN);
    reviewer = await signedIn('revisor', UserRole.REVIEWER);

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
      ).body as { id: string; allowsVoice: boolean };
    voice = await add({
      code: 'story',
      text: 'Cuéntanos del proyecto',
      type: 'FREE_TEXT',
      required: true,
      maxLength: 200,
      allowsVoice: true,
    });
    plain = await add({
      code: 'notes',
      text: 'Notas',
      type: 'FREE_TEXT',
      required: false,
      maxLength: 200,
    });
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

  describe('cuestionario', () => {
    it('la pregunta guarda si acepta voz', () => {
      expect(voice.allowsVoice).toBe(true);
    });

    it('una pregunta de selección no puede aceptar voz', async () => {
      const { body: draft } = await server()
        .post('/api/v1/questionnaire-versions')
        .set(as(approver.token))
        .send({ family: 'B2B' })
        .expect(201);
      const { body } = await server()
        .post(`/api/v1/questionnaire-versions/${draft.id}/questions`)
        .set(as(approver.token))
        .send({
          code: 'size',
          text: 'Tamaño',
          type: 'SINGLE_CHOICE',
          required: true,
          allowsVoice: true,
          options: [
            { value: 'a', text: 'A' },
            { value: 'b', text: 'B' },
          ],
        })
        .expect(400);
      expect(body.errors.map((e: { code: string }) => e.code)).toContain(
        'VOICE_NOT_ALLOWED',
      );
    });
  });

  describe('consentimiento', () => {
    it('sin consentimiento no se puede grabar', async () => {
      const { session } = await started();
      const { body } = await upload(session, voice.id).expect(409);
      expect(body.code).toBe('VOICE_CONSENT_REQUIRED');
      expect(storedKeys().size).toBe(0);
    });

    it('rechaza una versión del texto desconocida', async () => {
      const { session } = await started();
      await server()
        .post(`${CURRENT}/voice-consent`)
        .set(as(session))
        .send({ version: 'inventada' })
        .expect(400);
    });

    it('se guarda una vez con fecha y versión, y se ve en la sesión', async () => {
      const { id, session } = await started();
      const { body: first } = await consent(session);
      const { body: again } = await consent(session);
      expect(first.voiceConsentVersion).toBe(CONSENT_VERSION);
      expect(again.voiceConsentAt).toBe(first.voiceConsentAt);

      const { body: current } = await server()
        .get(CURRENT)
        .set(as(session))
        .expect(200);
      expect(current.voiceConsentVersion).toBe(CONSENT_VERSION);
      const events = await prisma.auditLog.count({
        where: { entityId: id, action: 'VOICE_CONSENT_GIVEN' },
      });
      expect(events).toBe(1);
    });
  });

  describe('subir', () => {
    it('guarda WebM y la voz sola cuenta como respuesta', async () => {
      const { id, session } = await started();
      await consent(session);
      const { body } = await upload(session, voice.id).expect(200);
      expect(body).toMatchObject({
        questionId: voice.id,
        contentType: 'audio/webm',
        sizeBytes: WEBM.length,
        durationMs: 12_000,
      });
      expect(JSON.stringify(body)).not.toContain('voice/');

      const { body: current } = await server()
        .get(CURRENT)
        .set(as(session))
        .expect(200);
      const question = current.questions.find(
        (q: { id: string }) => q.id === voice.id,
      );
      expect(question.allowsVoice).toBe(true);
      expect(question.answer).toMatchObject({
        text: null,
        recording: { contentType: 'audio/webm', durationMs: 12_000 },
      });
      expect(current.progress.answered).toBe(1);
      expect(current.status).toBe('IN_PROGRESS');

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: 'ANSWER_RECORDING_SAVED' },
      });
      expect(log.data).toMatchObject({ questionId: voice.id, format: 'WEBM' });
      expect(JSON.stringify(log.data)).not.toContain('voice/');
    });

    it('guarda MP4 de Safari', async () => {
      const { session } = await started();
      await consent(session);
      const { body } = await upload(session, voice.id, MP4, 'audio/mp4');
      expect(body.contentType).toBe('audio/mp4');
    });

    it('rechaza otro tipo aunque diga audio, o un tipo que no coincide', async () => {
      const { session } = await started();
      await consent(session);
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      for (const [body, type] of [
        [html, 'audio/webm'],
        [WEBM, 'audio/mp4'],
        [WEBM, 'audio/ogg'],
      ] as const) {
        const { body: problem } = await upload(session, voice.id, body, type);
        expect(problem.status).toBe(415);
        expect(problem.code).toBe('RECORDING_UNSUPPORTED_TYPE');
      }
    });

    it('rechaza más de 5 MB y más de 3 minutos', async () => {
      const { session } = await started();
      await consent(session);
      const big = Buffer.concat([WEBM, Buffer.alloc(5 * 1024 * 1024)]);
      const { body: tooBig } = await upload(session, voice.id, big).expect(413);
      expect(tooBig.code).toBe('RECORDING_TOO_LARGE');
      const { body: tooLong } = await upload(
        session,
        voice.id,
        WEBM,
        'audio/webm',
        180_001,
      ).expect(400);
      expect(tooLong.code).toBe('VALIDATION_FAILED');
    });

    it('sin archivo responde 400', async () => {
      const { session } = await started();
      await consent(session);
      await server()
        .put(`${CURRENT}/answers/${voice.id}/recording`)
        .set(as(session))
        .field('durationMs', '1000')
        .expect(400);
    });

    it('una pregunta sin voz responde 409', async () => {
      const { session } = await started();
      await consent(session);
      const { body } = await upload(session, plain.id).expect(409);
      expect(body.code).toBe('VOICE_NOT_ALLOWED');
    });

    it('reemplazar borra el objeto anterior', async () => {
      const { session } = await started();
      await consent(session);
      const before = new Set(storedKeys().keys());
      await upload(session, voice.id).expect(200);
      const first = [...storedKeys().keys()].find((k) => !before.has(k));
      await upload(session, voice.id, MP4, 'audio/mp4').expect(200);
      expect(storedKeys().has(first!)).toBe(false);
      expect(storedKeys().size).toBe(before.size + 1);
    });

    it('con el almacenamiento caído responde 503 y no guarda nada', async () => {
      const { id, session } = await started();
      await consent(session);
      const put = vi
        .spyOn(storage, 'put')
        .mockRejectedValueOnce(new StorageError('unavailable'));
      const { body } = await upload(session, voice.id).expect(503);
      put.mockRestore();
      expect(body.code).toBe('STORAGE_UNAVAILABLE');
      expect(await prisma.answer.count({ where: { diagnosticId: id } })).toBe(
        0,
      );
    });

    it('después de enviar el diagnóstico no se puede cambiar', async () => {
      const { session } = await started();
      await consent(session);
      await upload(session, voice.id).expect(200);
      // Solo con voz, la obligatoria está respondida: se puede enviar.
      await server().post(`${CURRENT}/submission`).set(as(session)).expect(201);
      // La sesión termina al enviar.
      await upload(session, voice.id).expect(401);
    });
  });

  describe('texto y voz juntos', () => {
    it('vaciar el texto deja la voz; borrar la voz deja el texto', async () => {
      const { id, session } = await started();
      await consent(session);
      await server()
        .put(`${CURRENT}/answers/${voice.id}`)
        .set(as(session))
        .send({ text: 'Lanzamos un EP' })
        .expect(200);
      await upload(session, voice.id).expect(200);

      const { body: cleared } = await server()
        .put(`${CURRENT}/answers/${voice.id}`)
        .set(as(session))
        .send({ text: '' })
        .expect(200);
      expect(cleared.text).toBeNull();
      expect(cleared.recording).not.toBeNull();

      await server()
        .put(`${CURRENT}/answers/${voice.id}`)
        .set(as(session))
        .send({ text: 'Otra vez texto' })
        .expect(200);
      await server()
        .delete(`${CURRENT}/answers/${voice.id}/recording`)
        .set(as(session))
        .expect(204);
      const answer = await prisma.answer.findFirstOrThrow({
        where: { diagnosticId: id, questionId: voice.id },
        select: { textValue: true, recording: true },
      });
      expect(answer).toEqual({ textValue: 'Otra vez texto', recording: null });
    });

    it('borrar la voz sin texto deja la pregunta sin responder', async () => {
      const { id, session } = await started();
      await consent(session);
      const before = storedKeys().size;
      await upload(session, voice.id).expect(200);
      await server()
        .delete(`${CURRENT}/answers/${voice.id}/recording`)
        .set(as(session))
        .expect(204);
      expect(await prisma.answer.count({ where: { diagnosticId: id } })).toBe(
        0,
      );
      expect(storedKeys().size).toBe(before);
    });

    it('borrar la respuesta borra también la grabación y su objeto', async () => {
      const { id, session } = await started();
      await consent(session);
      const before = storedKeys().size;
      await upload(session, voice.id).expect(200);
      await server()
        .delete(`${CURRENT}/answers/${voice.id}`)
        .set(as(session))
        .expect(204);
      expect(
        await prisma.answerRecording.count({
          where: { answer: { diagnosticId: id } },
        }),
      ).toBe(0);
      expect(storedKeys().size).toBe(before);
    });
  });

  describe('escuchar', () => {
    it('el cliente escucha la suya; otro diagnóstico no la ve ni la toca', async () => {
      const owner = await started();
      const other = await started();
      await consent(owner.session);
      await consent(other.session);
      await upload(owner.session, voice.id).expect(200);

      const { body } = await server()
        .get(`${CURRENT}/answers/${voice.id}/recording`)
        .set(as(owner.session))
        .expect(200);
      expect(body).toMatchObject({
        contentType: 'audio/webm',
        durationMs: 12_000,
      });
      expect(body.url).toMatch(/^memory:\/\/voice\//);
      const played = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: owner.id, action: 'ANSWER_RECORDING_PLAYED' },
        select: { actorType: true, data: true },
      });
      expect(played.actorType).toBe('END_CLIENT');
      expect(played.data).toMatchObject({ questionId: voice.id });

      const { body: notFound } = await server()
        .get(`${CURRENT}/answers/${voice.id}/recording`)
        .set(as(other.session))
        .expect(404);
      expect(notFound.code).toBe('RECORDING_NOT_FOUND');
      await server()
        .delete(`${CURRENT}/answers/${voice.id}/recording`)
        .set(as(other.session))
        .expect(204);
      expect(
        await prisma.answerRecording.count({
          where: { answer: { diagnosticId: owner.id } },
        }),
      ).toBe(1);
    });

    it('el panel escucha con ambos roles y queda en la bitácora', async () => {
      const { id, session } = await started();
      await consent(session);
      await upload(session, voice.id).expect(200);
      const url = `${DIAGNOSTICS}/${id}/answers/${voice.id}/recording`;

      await server().get(url).expect(401);
      for (const user of [reviewer, approver]) {
        const { body } = await server()
          .get(url)
          .set(as(user.token))
          .expect(200);
        expect(body.contentType).toBe('audio/webm');
        expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      }
      const logs = await prisma.auditLog.findMany({
        where: { entityId: id, action: 'ANSWER_RECORDING_PLAYED' },
        select: { actorId: true, data: true },
      });
      expect(logs.map((l) => l.actorId).sort()).toEqual(
        [reviewer.id, approver.id].sort(),
      );
      expect(logs[0].data).toEqual({ questionId: voice.id });

      await server()
        .get(`${DIAGNOSTICS}/${id}/answers/${plain.id}/recording`)
        .set(as(reviewer.token))
        .expect(404);
    });
  });
});
