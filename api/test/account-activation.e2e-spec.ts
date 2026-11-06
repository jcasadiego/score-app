import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { UserRole } from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT, MailMessage } from './../src/mail/mail.port';
import { SETUP_LINK_TTL_MS } from './../src/password-reset/password-link.service';
import { PrismaService } from './../src/prisma/prisma.service';

const USERS = '/api/v1/users';
const AUTH = '/api/v1/auth';
const STAMP = Date.now();
const DOMAIN = 'activacion-e2e.test.local';
const email = (name: string) => `${name}.${STAMP}@${DOMAIN}`;
const KNOWN_PASSWORD = 'clave-conocida-123';

describe('Activación de cuenta y contraseña definida por su dueño (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let approver: { id: string; token: string };
  const sent: MailMessage[] = [];

  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (to: string, password: string) =>
    server().post(`${AUTH}/login`).send({ email: to, password });

  /** Último enlace enviado a `to`, como lo abriría su dueño. */
  function tokenSentTo(to: string): string {
    const message = sent.filter((m) => m.to === to).at(-1);
    expect(message).toBeDefined();
    const link = new URL(message!.text.match(/https?:\/\/\S+/)![0]);
    expect(link.pathname).toBe('/reset-password');
    return link.searchParams.get('token')!;
  }

  const confirm = (token: string, password: string) =>
    server().post(`${AUTH}/password-reset/confirm`).send({ token, password });

  /** Usuario con contraseña conocida y sesión abierta, directo en la base. */
  async function signedIn(name: string, role: UserRole) {
    const user = await prisma.user.create({
      data: {
        name,
        email: email(name),
        passwordHash: await argon2.hash(KNOWN_PASSWORD),
        role,
      },
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
    return { id: user.id, email: user.email, token };
  }

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PORT)
      .useValue({
        send: async (message: MailMessage) => {
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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: `.${STAMP}@${DOMAIN}` } },
    });
    await app.close();
    vi.restoreAllMocks();
  });

  describe('crear una cuenta', () => {
    it('quien la crea no puede entrar; su dueño define la contraseña con el enlace', async () => {
      const to = email('nueva');
      const since = new Date();

      const { body } = await server()
        .post(USERS)
        .set(bearer(approver.token))
        .send({ name: 'Nueva', email: to, role: 'REVIEWER' })
        .expect(201);

      expect(body).toMatchObject({ passwordSetAt: null, linkSent: true });
      expect(body.passwordHash).toBeUndefined();
      const message = sent.filter((m) => m.to === to).at(-1)!;
      expect(message.subject).toBe('Activa tu cuenta del panel SCORE');

      // Sin contraseña conocida, ningún intento abre el reto del MFA.
      await login(to, KNOWN_PASSWORD).expect(401);

      const token = tokenSentTo(to);
      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: body.id, usedAt: null },
      });
      const ttl = stored.expiresAt.getTime() - stored.createdAt.getTime();
      expect(Math.abs(ttl - SETUP_LINK_TTL_MS)).toBeLessThan(5_000);

      await confirm(token, 'la-elige-su-duena-1').expect(204);
      const challenge = await login(to, 'la-elige-su-duena-1').expect(200);
      expect(challenge.body.mfaToken).toEqual(expect.any(String));
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(user.passwordSetAt).not.toBeNull();

      // Bitácora: quién la creó, sin contraseña ni enlace; y el correo enviado.
      const created = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_CREATED', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      });
      expect(created.actorId).toBe(approver.id);
      expect(created.data).not.toHaveProperty('password');
      const mail = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'EMAIL_SENT',
          entityId: body.id,
          createdAt: { gte: since },
        },
      });
      expect(mail.actorId).toBe(approver.id);
      expect(mail.data).toMatchObject({ type: 'PASSWORD_SETUP' });
      expect(JSON.stringify(mail.data)).not.toContain(token);
    });

    it('ya no acepta contraseña al crear ni al editar', async () => {
      await server()
        .post(USERS)
        .set(bearer(approver.token))
        .send({
          name: 'Con clave',
          email: email('conclave'),
          role: 'REVIEWER',
          password: KNOWN_PASSWORD,
        })
        .expect(400);

      const other = await signedIn('editada', UserRole.REVIEWER);
      await server()
        .patch(`${USERS}/${other.id}`)
        .set(bearer(approver.token))
        .send({ password: 'otra-clave-del-admin' })
        .expect(400);
    });
  });

  describe('restablecer la contraseña de otra cuenta', () => {
    it('invalida la vigente, cierra su sesión y le manda el enlace a su dueño', async () => {
      const owner = await signedIn('duena', UserRole.REVIEWER);
      await server().get('/api/v1/leads').set(bearer(owner.token)).expect(200);

      const { body } = await server()
        .post(`${USERS}/${owner.id}/password-reset`)
        .set(bearer(approver.token))
        .expect(200);

      expect(body).toMatchObject({ passwordSetAt: null, linkSent: true });
      await server().get('/api/v1/leads').set(bearer(owner.token)).expect(401);
      await login(owner.email, KNOWN_PASSWORD).expect(401);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'PASSWORD_RESET_BY_APPROVER', entityId: owner.id },
      });
      expect(log.actorId).toBe(approver.id);

      await confirm(tokenSentTo(owner.email), 'nueva-de-la-duena-2').expect(
        204,
      );
      await login(owner.email, 'nueva-de-la-duena-2').expect(200);
    });

    it('reenviar invalida el enlace anterior', async () => {
      const owner = await signedIn('reenvio', UserRole.REVIEWER);
      const path = `${USERS}/${owner.id}/password-reset`;

      await server().post(path).set(bearer(approver.token)).expect(200);
      const first = tokenSentTo(owner.email);
      await server().post(path).set(bearer(approver.token)).expect(200);
      const second = tokenSentTo(owner.email);

      await confirm(first, 'no-deberia-servir-1').expect(400);
      await confirm(second, 'esta-si-sirve-12').expect(204);
    });

    it('no sobre uno mismo, ni sobre una cuenta desactivada', async () => {
      await server()
        .post(`${USERS}/${approver.id}/password-reset`)
        .set(bearer(approver.token))
        .expect(409);

      const inactive = await signedIn('inactiva', UserRole.REVIEWER);
      await prisma.user.update({
        where: { id: inactive.id },
        data: { active: false },
      });
      const before = sent.length;
      await server()
        .post(`${USERS}/${inactive.id}/password-reset`)
        .set(bearer(approver.token))
        .expect(409);
      expect(sent).toHaveLength(before);
      const untouched = await prisma.user.findUniqueOrThrow({
        where: { id: inactive.id },
      });
      expect(untouched.passwordSetAt).not.toBeNull();
    });
  });
});
