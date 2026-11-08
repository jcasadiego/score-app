import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
 * Un diagnóstico apunta a una versión publicada, que no se puede borrar nunca, y
 * la bitácora es de solo inserción. Por eso este e2e usa una base propia, creada
 * y borrada aquí, igual que `questionnaire-versions`.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_diagnostics_${process.pid}`;
const DIAGNOSTICS = '/api/v1/diagnostics';
const SESSIONS = '/api/v1/diagnostic-sessions';
const CURRENT = `${SESSIONS}/current`;
const RECOVERIES = '/api/v1/access-link-recoveries';

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** El token viaja en el fragmento del enlace: `#token=...`. */
function tokenFrom(url: string): string {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  if (!token) throw new Error(`Enlace sin token: ${url}`);
  return token;
}

function tokenInMail(message: MailMessage): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) throw new Error('Correo sin enlace');
  return match[1];
}

interface Question {
  id: string;
  code: string;
  options: { id: string; value: string }[];
}

describe('Diagnósticos (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const sent: MailMessage[] = [];
  let mailFails = false;
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let questions: Record<'choice' | 'multi' | 'story', Question>;
  let leadCount = 0;

  const server = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const mailsTo = (to: string) => sent.filter((m) => m.to === to);

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

  async function generate(leadId: string) {
    const { body } = await server()
      .post(DIAGNOSTICS)
      .set(as(approver.token))
      .send({ leadId, reason: 'Cortesía para la prueba' })
      .expect(201);
    return body as {
      id: string;
      accessLink: { url: string; expiresAt: string };
      emailSent: boolean;
    };
  }

  async function redeem(token: string) {
    const { body } = await server().post(SESSIONS).send({ token }).expect(201);
    return (body as { sessionToken: string }).sessionToken;
  }

  /** Diagnóstico nuevo con su sesión abierta. */
  async function started() {
    const lead = await newLead();
    const created = await generate(lead.id);
    const session = await redeem(tokenFrom(created.accessLink.url));
    return { lead, id: created.id, url: created.accessLink.url, session };
  }

  const answer = (session: string, questionId: string, body: object) =>
    server()
      .put(`${CURRENT}/answers/${questionId}`)
      .set(as(session))
      .send(body);

  /** Los correos de recuperación y los avisos salen en segundo plano. */
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 50 && !check(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
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

    // Versión publicada de PROJECT: una de selección única y una de texto
    // obligatorias, y una de selección múltiple opcional.
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
      ).body as Question;
    questions = {
      choice: await add({
        code: 'stage',
        text: '¿En qué etapa está el proyecto?',
        type: 'SINGLE_CHOICE',
        required: true,
        options: [
          { value: 'idea', text: 'Idea' },
          { value: 'released', text: 'Lanzado' },
        ],
      }),
      multi: await add({
        code: 'channels',
        text: '¿Dónde publicas?',
        type: 'MULTIPLE_CHOICE',
        required: false,
        options: [
          { value: 'spotify', text: 'Spotify' },
          { value: 'youtube', text: 'YouTube' },
          { value: 'shows', text: 'En vivo' },
        ],
      }),
      story: await add({
        code: 'story',
        text: 'Cuéntanos del proyecto',
        type: 'FREE_TEXT',
        required: true,
        maxLength: 20,
      }),
    };
    await server()
      .post(`${versions}/${draft.id}/publication`)
      .set(as(approver.token))
      .expect(200);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.$disconnect();
    vi.restoreAllMocks();
  });

  describe('permisos del panel', () => {
    it('sin sesión responde 401', async () => {
      await server().get(DIAGNOSTICS).expect(401);
    });

    it('solo el Aprobador genera un diagnóstico', async () => {
      const lead = await newLead();
      const { body } = await server()
        .post(DIAGNOSTICS)
        .set(as(reviewer.token))
        .send({ leadId: lead.id, reason: 'x' })
        .expect(403);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('el Revisor ve el listado y el detalle', async () => {
      const { id } = await started();
      await server().get(DIAGNOSTICS).set(as(reviewer.token)).expect(200);
      await server()
        .get(`${DIAGNOSTICS}/${id}`)
        .set(as(reviewer.token))
        .expect(200);
    });

    it('una sesión de cliente no abre el panel, ni el JWT del panel abre la del cliente', async () => {
      const { session } = await started();
      await server().get(DIAGNOSTICS).set(as(session)).expect(401);
      await server().get(CURRENT).set(as(approver.token)).expect(401);
    });
  });

  describe('generar', () => {
    it('crea el diagnóstico, devuelve el enlace una vez y lo envía al lead', async () => {
      const lead = await newLead();
      const response = await server()
        .post(DIAGNOSTICS)
        .set(as(approver.token))
        .send({ leadId: lead.id, reason: '  Cortesía   comercial ' })
        .expect(201);
      const body = response.body;

      expect(response.headers.location).toBe(`${DIAGNOSTICS}/${body.id}`);
      expect(body).toMatchObject({
        status: 'ACTIVE',
        family: 'PROJECT',
        emailSent: true,
        progress: { answered: 0, total: 3 },
        lead: { id: lead.id, email: lead.email },
      });
      const token = tokenFrom(body.accessLink.url);
      expect(body.accessLink.url).toMatch(
        /^http:\/\/localhost:3001\/access#token=/,
      );

      const [mail] = mailsTo(lead.email);
      expect(tokenInMail(mail)).toBe(token);

      // Solo el hash del token y el motivo normalizado.
      const stored = await prisma.diagnostic.findUniqueOrThrow({
        where: { id: body.id },
        include: { accessLinks: true },
      });
      expect(stored.creationReason).toBe('Cortesía comercial');
      expect(stored.createdById).toBe(approver.id);
      expect(stored.accessLinks).toHaveLength(1);
      expect(stored.accessLinks[0].tokenHash).toBe(sha256(token));

      // El detalle del panel tampoco expone el token ni su hash.
      const { body: detail } = await server()
        .get(`${DIAGNOSTICS}/${body.id}`)
        .set(as(approver.token))
        .expect(200);
      expect(JSON.stringify(detail)).not.toContain(token);
      expect(JSON.stringify(detail)).not.toContain(sha256(token));
      expect(detail.creationReason).toBe('Cortesía comercial');

      // El lead del panel dice qué diagnóstico tiene (PF-18).
      const { body: panelLead } = await server()
        .get(`/api/v1/leads/${lead.id}`)
        .set(as(reviewer.token))
        .expect(200);
      expect(panelLead.diagnostic).toEqual({ id: body.id });
    });

    it('exige el motivo', async () => {
      const lead = await newLead();
      const { body } = await server()
        .post(DIAGNOSTICS)
        .set(as(approver.token))
        .send({ leadId: lead.id })
        .expect(400);
      expect(body.code).toBe('VALIDATION_FAILED');
    });

    it('404 si el lead no existe y 409 si su familia no tiene versión publicada', async () => {
      await server()
        .post(DIAGNOSTICS)
        .set(as(approver.token))
        .send({ leadId: 'no-existe', reason: 'Cortesía' })
        .expect(404);

      const lead = await newLead(DiagnosticFamily.B2B);
      const { body } = await server()
        .post(DIAGNOSTICS)
        .set(as(approver.token))
        .send({ leadId: lead.id, reason: 'Cortesía' })
        .expect(409);
      expect(body.code).toBe('NO_PUBLISHED_QUESTIONNAIRE');
    });

    it('dos generaciones simultáneas para el mismo lead crean uno y envían un solo correo', async () => {
      const lead = await newLead();
      const send = () =>
        server()
          .post(DIAGNOSTICS)
          .set(as(approver.token))
          .send({ leadId: lead.id, reason: 'Cortesía' });
      const statuses = (await Promise.all([send(), send()]))
        .map((r) => r.status)
        .sort();

      expect(statuses).toEqual([201, 409]);
      expect(
        await prisma.diagnostic.count({ where: { leadId: lead.id } }),
      ).toBe(1);
      expect(mailsTo(lead.email)).toHaveLength(1);

      const { body } = await send().expect(409);
      expect(body.code).toBe('DIAGNOSTIC_ALREADY_EXISTS');
    });

    it('si el correo falla, el diagnóstico queda creado y el panel recibe el aviso', async () => {
      const lead = await newLead();
      mailFails = true;
      try {
        const body = await generate(lead.id);
        expect(body.emailSent).toBe(false);
        expect(body.accessLink.url).toContain('#token=');
        expect(
          await prisma.diagnostic.count({ where: { leadId: lead.id } }),
        ).toBe(1);
      } finally {
        mailFails = false;
      }
    });
  });

  describe('enlace y sesión del cliente', () => {
    it('un token inventado no abre nada', async () => {
      const { body } = await server()
        .post(SESSIONS)
        .send({ token: 'inventado' })
        .expect(401);
      expect(body.code).toBe('INVALID_ACCESS_LINK');
      await server().get(CURRENT).set(as('inventado')).expect(401);
      await server().get(CURRENT).expect(401);
    });

    it('el mismo enlace sirve varias veces mientras está vigente', async () => {
      const { url } = await started();
      const again = await redeem(tokenFrom(url));
      await server().get(CURRENT).set(as(again)).expect(200);
    });

    it('un enlace vencido no da acceso y corta la sesión ya abierta', async () => {
      const { id, url, session } = await started();
      const past = new Date(Date.now() - 60_000);
      await prisma.accessLink.updateMany({
        where: { diagnosticId: id },
        data: { createdAt: new Date(past.getTime() - 1000), expiresAt: past },
      });

      await server()
        .post(SESSIONS)
        .send({ token: tokenFrom(url) })
        .expect(401);
      await server().get(CURRENT).set(as(session)).expect(401);
    });

    it('reenviar desde el panel revoca el enlace anterior y su sesión, y envía uno nuevo', async () => {
      const { id, lead, url, session } = await started();
      const before = mailsTo(lead.email).length;

      const { body } = await server()
        .post(`${DIAGNOSTICS}/${id}/access-links`)
        .set(as(reviewer.token))
        .expect(201);
      expect(body.emailSent).toBe(true);
      expect(mailsTo(lead.email)).toHaveLength(before + 1);

      await server().get(CURRENT).set(as(session)).expect(401);
      await server()
        .post(SESSIONS)
        .send({ token: tokenFrom(url) })
        .expect(401);
      const fresh = await redeem(tokenFrom(body.accessLink.url));
      await server().get(CURRENT).set(as(fresh)).expect(200);
    });

    it('un cliente solo alcanza su propio diagnóstico', async () => {
      const a = await started();
      const b = await started();
      await answer(a.session, questions.story.id, { text: 'De A' }).expect(200);
      await answer(b.session, questions.story.id, { text: 'De B' }).expect(200);

      const { body: mine } = await server()
        .get(CURRENT)
        .set(as(a.session))
        .expect(200);
      expect(mine.id).toBe(a.id);
      const story = mine.questions.find(
        (q: { id: string }) => q.id === questions.story.id,
      );
      expect(story.answer.text).toBe('De A');
    });
  });

  describe('respuestas', () => {
    it('guarda, cambia y borra respuestas; el progreso las cuenta', async () => {
      const { id, session } = await started();
      const [idea, released] = questions.choice.options;

      const { body: saved } = await answer(session, questions.choice.id, {
        optionIds: [idea.id],
      }).expect(200);
      expect(saved).toMatchObject({
        questionId: questions.choice.id,
        text: null,
        optionIds: [idea.id],
      });
      await answer(session, questions.choice.id, {
        optionIds: [released.id],
      }).expect(200);
      await answer(session, questions.multi.id, {
        optionIds: questions.multi.options.slice(0, 2).map((o) => o.id),
      }).expect(200);

      const { body } = await server().get(CURRENT).set(as(session)).expect(200);
      expect(body.status).toBe('IN_PROGRESS');
      expect(body.progress).toEqual({ answered: 2, total: 3 });
      const choice = body.questions.find(
        (q: { id: string }) => q.id === questions.choice.id,
      );
      expect(choice.answer.optionIds).toEqual([released.id]);

      await server()
        .delete(`${CURRENT}/answers/${questions.multi.id}`)
        .set(as(session))
        .expect(204);
      const { body: panel } = await server()
        .get(`${DIAGNOSTICS}/${id}`)
        .set(as(approver.token))
        .expect(200);
      expect(panel.progress).toEqual({ answered: 1, total: 3 });
    });

    it('rechaza respuestas que no corresponden a la pregunta', async () => {
      const { session } = await started();
      const [idea, released] = questions.choice.options;

      for (const [questionId, body] of [
        [questions.choice.id, { optionIds: [idea.id, released.id] }],
        [questions.choice.id, { optionIds: [questions.multi.options[0].id] }],
        [questions.choice.id, { text: 'texto' }],
        [questions.story.id, { text: 'x'.repeat(21) }],
        [questions.story.id, { optionIds: [idea.id] }],
      ] as const) {
        const { body: error } = await answer(session, questionId, body).expect(
          400,
        );
        expect(error.code).toBe('VALIDATION_FAILED');
      }
      await answer(session, 'otra-pregunta', { text: 'x' }).expect(404);
    });
  });

  describe('enlaces externos', () => {
    it('acepta las 5 plataformas con https y sus dominios', async () => {
      const { session } = await started();
      const put = (platform: string, url: string) =>
        server()
          .put(`${CURRENT}/external-links/${platform}`)
          .set(as(session))
          .send({ url });

      await put('SPOTIFY', 'https://open.spotify.com/artist/abc').expect(200);
      await put('WEBSITE', 'https://banda.com').expect(200);
      for (const [platform, url, status] of [
        ['SPOTIFY', 'http://open.spotify.com/artist/abc', 400],
        ['INSTAGRAM', 'https://evil.com/banda', 400],
        ['WEBSITE', 'https://127.0.0.1/', 400],
        ['MYSPACE', 'https://myspace.com/banda', 400],
      ] as const) {
        await put(platform, url).expect(status);
      }

      await server()
        .delete(`${CURRENT}/external-links/WEBSITE`)
        .set(as(session))
        .expect(204);
      const { body } = await server().get(CURRENT).set(as(session)).expect(200);
      expect(body.externalLinks).toEqual([
        expect.objectContaining({
          platform: 'SPOTIFY',
          url: 'https://open.spotify.com/artist/abc',
        }),
      ]);
    });
  });

  describe('enviar', () => {
    it('no envía con obligatorias sin responder y dice cuáles', async () => {
      const { session } = await started();
      await answer(session, questions.choice.id, {
        optionIds: [questions.choice.options[0].id],
      }).expect(200);

      const { body } = await server()
        .post(`${CURRENT}/submission`)
        .set(as(session))
        .expect(409);
      expect(body.code).toBe('DIAGNOSTIC_INCOMPLETE');
      expect(body.errors).toEqual([
        expect.objectContaining({
          field: questions.story.id,
          code: 'REQUIRED_QUESTION_UNANSWERED',
        }),
      ]);
    });

    it('completado, corta la sesión, no admite cambios ni enlaces nuevos y avisa al equipo', async () => {
      const { id, session, url, lead } = await started();
      await answer(session, questions.choice.id, {
        optionIds: [questions.choice.options[0].id],
      }).expect(200);
      await answer(session, questions.story.id, { text: 'Un disco' }).expect(
        200,
      );

      const { body } = await server()
        .post(`${CURRENT}/submission`)
        .set(as(session))
        .expect(201);
      expect(body).toMatchObject({ id, status: 'COMPLETED' });

      await answer(session, questions.story.id, { text: 'Otro' }).expect(401);
      // Con el enlace del correo, el cliente sabe que ya lo envió.
      const { body: redeemed } = await server()
        .post(SESSIONS)
        .send({ token: tokenFrom(url) })
        .expect(409);
      expect(redeemed.code).toBe('DIAGNOSTIC_COMPLETED');
      const { body: conflict } = await server()
        .post(`${DIAGNOSTICS}/${id}/access-links`)
        .set(as(approver.token))
        .expect(409);
      expect(conflict.code).toBe('DIAGNOSTIC_COMPLETED');

      await waitFor(() =>
        sent.some(
          (m) => m.to === 'aprobador@test.local' && m.text.includes(lead.name),
        ),
      );
      expect(
        sent.some(
          (m) => m.to === 'aprobador@test.local' && m.text.includes(lead.name),
        ),
      ).toBe(true);

      // Tampoco se recupera el enlace de un diagnóstico completado.
      const before = mailsTo(lead.email).length;
      await server().post(RECOVERIES).send({ email: lead.email }).expect(202);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mailsTo(lead.email)).toHaveLength(before);
    });
  });

  describe('recuperar el enlace', () => {
    it('responde lo mismo exista o no el correo', async () => {
      const { lead } = await started();
      const unknown = await server()
        .post(RECOVERIES)
        .send({ email: 'nadie@test.local' })
        .expect(202);
      const known = await server()
        .post(RECOVERIES)
        .send({ email: lead.email.toUpperCase() })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
    });

    it('el enlace anterior sigue valiendo hasta que se usa el nuevo', async () => {
      const { lead, url, session } = await started();
      const before = mailsTo(lead.email).length;

      await server().post(RECOVERIES).send({ email: lead.email }).expect(202);
      await waitFor(() => mailsTo(lead.email).length > before);
      const recovered = tokenInMail(mailsTo(lead.email)[before]);

      // Quien pidió la recuperación sin ser el cliente no lo deja fuera.
      await server().get(CURRENT).set(as(session)).expect(200);
      await redeem(tokenFrom(url));

      const fresh = await redeem(recovered);
      await server().get(CURRENT).set(as(fresh)).expect(200);
      await server().get(CURRENT).set(as(session)).expect(401);
      await server()
        .post(SESSIONS)
        .send({ token: tokenFrom(url) })
        .expect(401);
    });

    it('tiene un tope por correo destino', async () => {
      const { lead } = await started();
      const before = mailsTo(lead.email).length;
      for (let i = 0; i < 5; i++) {
        await server().post(RECOVERIES).send({ email: lead.email }).expect(202);
      }
      await waitFor(() => mailsTo(lead.email).length >= before + 3);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mailsTo(lead.email)).toHaveLength(before + 3);
    });
  });

  describe('listado y abandono', () => {
    it('pagina y filtra en la base, con progreso', async () => {
      const { lead } = await started();
      const { body } = await server()
        .get(DIAGNOSTICS)
        .query({ search: lead.email, pageSize: 5 })
        .set(as(reviewer.token))
        .expect(200);
      expect(body).toMatchObject({ total: 1, page: 1, pageSize: 5 });
      expect(body.data[0]).toMatchObject({
        lead: { email: lead.email },
        status: 'ACTIVE',
        progress: { answered: 0, total: expect.any(Number) },
      });

      const { body: byFamily } = await server()
        .get(DIAGNOSTICS)
        .query({ family: 'B2B' })
        .set(as(reviewer.token))
        .expect(200);
      expect(byFamily.total).toBe(0);
    });

    it('tras 7 días sin actividad aparece abandonado, y el cliente puede retomarlo', async () => {
      const { id, session } = await started();
      await prisma.diagnostic.update({
        where: { id },
        data: { lastActivityAt: new Date(Date.now() - 8 * 86_400_000) },
      });

      const { body } = await server()
        .get(DIAGNOSTICS)
        .query({ status: 'ABANDONED', pageSize: 100 })
        .set(as(reviewer.token))
        .expect(200);
      expect(body.data.map((d: { id: string }) => d.id)).toContain(id);
      expect(
        body.data.every((d: { status: string }) => d.status === 'ABANDONED'),
      ).toBe(true);

      await answer(session, questions.story.id, { text: 'Volví' }).expect(200);
      const { body: detail } = await server()
        .get(`${DIAGNOSTICS}/${id}`)
        .set(as(reviewer.token))
        .expect(200);
      expect(detail.status).toBe('IN_PROGRESS');
    });

    it('rechaza un estado que no existe', async () => {
      await server()
        .get(DIAGNOSTICS)
        .query({ status: 'PAUSED' })
        .set(as(reviewer.token))
        .expect(400);
    });
  });

  describe('bitácora', () => {
    it('registra quién hizo qué, sin el token, el motivo ni las respuestas', async () => {
      const { id, url, session } = await started();
      await answer(session, questions.story.id, { text: 'Secreto' }).expect(
        200,
      );
      await server()
        .put(`${CURRENT}/external-links/SPOTIFY`)
        .set(as(session))
        .send({ url: 'https://open.spotify.com/artist/secreto' })
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { entity: 'Diagnostic', entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining([
          'DIAGNOSTIC_CREATED',
          'ACCESS_LINK_ISSUED',
          'EMAIL_SENT',
          'DIAGNOSTIC_SESSION_STARTED',
          'ANSWER_SAVED',
          'EXTERNAL_LINK_SAVED',
        ]),
      );
      const created = logs.find((l) => l.action === 'DIAGNOSTIC_CREATED');
      expect(created).toMatchObject({
        actorType: 'PANEL_USER',
        actorId: approver.id,
      });
      const saved = logs.find((l) => l.action === 'ANSWER_SAVED');
      expect(saved).toMatchObject({ actorType: 'END_CLIENT', actorId: id });
      // Con el enlace usado: se rastrea hasta quién lo emitió.
      const link = await prisma.accessLink.findFirstOrThrow({
        where: { diagnosticId: id },
      });
      expect(saved?.data).toMatchObject({
        questionId: questions.story.id,
        accessLinkId: link.id,
      });
      expect(
        logs.find(
          (l) =>
            l.action === 'ACCESS_LINK_ISSUED' &&
            (l.data as { accessLinkId?: string }).accessLinkId === link.id,
        ),
      ).toMatchObject({ actorType: 'PANEL_USER', actorId: approver.id });

      const everything = JSON.stringify(
        await prisma.auditLog.findMany({ select: { data: true } }),
      );
      for (const secret of [
        tokenFrom(url),
        session,
        'Secreto',
        'artist/secreto',
        'Cortesía para la prueba',
      ]) {
        expect(everything).not.toContain(secret);
      }
    });
  });
  // Al final: desde aquí los diagnósticos nuevos usan la versión 2.
  describe('versión nueva del cuestionario', () => {
    it('publicar una versión nueva no cambia los diagnósticos ya creados', async () => {
      const { id } = await started();
      const versions = '/api/v1/questionnaire-versions';
      const { body: draft } = await server()
        .post(versions)
        .set(as(approver.token))
        .send({ family: 'PROJECT' })
        .expect(201);
      await server()
        .delete(`${versions}/${draft.id}/questions/${draft.questions[2].id}`)
        .set(as(approver.token))
        .expect(204);
      await server()
        .post(`${versions}/${draft.id}/publication`)
        .set(as(approver.token))
        .expect(200);

      const { body } = await server()
        .get(`${DIAGNOSTICS}/${id}`)
        .set(as(approver.token))
        .expect(200);
      expect(body.questionnaireVersion.versionNumber).toBe(1);
      expect(body.questions).toHaveLength(3);

      // Los diagnósticos nuevos sí usan la versión 2.
      const lead = await newLead();
      const created = await generate(lead.id);
      const { body: fresh } = await server()
        .get(`${DIAGNOSTICS}/${created.id}`)
        .set(as(approver.token))
        .expect(200);
      expect(fresh.questionnaireVersion.versionNumber).toBe(2);
      expect(fresh.questions).toHaveLength(2);
    });

    it('una pregunta de otra versión no existe para este diagnóstico', async () => {
      // El diagnóstico nuevo es de la versión 2; `story` solo existe en la 1.
      const { session } = await started();
      await answer(session, questions.story.id, { text: 'x' }).expect(404);
    });
  });
});
