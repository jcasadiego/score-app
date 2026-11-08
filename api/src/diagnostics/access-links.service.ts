import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '../../generated/prisma/client';
import {
  AccessLinkOrigin,
  AuditActorType,
  DiagnosticStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { hashToken, newLinkToken } from '../common/link-token';
import { diagnosticLink } from '../config/diagnostic-url';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { DIAGNOSTIC_COMPLETED } from './diagnostic-view';

/** Un token del panel o de otro uso no abre una sesión de cliente. */
export const SESSION_AUDIENCE = 'diagnostic-session';
/** La sesión es corta: el cliente vuelve a entrar con el mismo enlace. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** Recuperaciones por correo destino y hora; pasado el tope no se envía nada. */
export const RECOVERY_LIMIT_PER_HOUR = 3;

export const INVALID_ACCESS_LINK = 'INVALID_ACCESS_LINK';
/** Mismo mensaje para inválido, vencido o revocado: no da pistas de cuál. */
export const INVALID_ACCESS_LINK_MESSAGE =
  'El enlace no es válido o ya venció. Pide uno nuevo con tu correo.';

export const RECOVERY_MESSAGE =
  'Si hay un diagnóstico pendiente con ese correo, te enviamos un enlace para continuarlo.';

interface SessionPayload {
  /** Id del diagnóstico. */
  sub: string;
  /** Id del enlace canjeado: sin él vigente, la sesión no vale. */
  lid: string;
}

/** Lo que `AccessLinkGuard` deja en `request.accessLink`. */
export interface ClientSession {
  sub: string;
  linkId: string;
}

export interface IssuedLink {
  url: string;
  expiresAt: Date;
}

interface LinkRecipient {
  name: string;
  email: string;
}

/**
 * Enlaces sin contraseña del cliente final. El token es opaco y aleatorio, y en
 * la base queda solo su SHA-256. Canjearlo abre una sesión corta que nombra al
 * enlace; en cada petición se comprueba que el enlace siga vigente, así que
 * revocarlo corta la sesión de inmediato.
 */
@Injectable()
export class AccessLinksService {
  private readonly logger = new Logger(AccessLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  /**
   * Crea un enlace dentro de la transacción de quien lo pide y lo registra en
   * la bitácora. El token solo existe en la URL devuelta.
   */
  async issue(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
    origin: AccessLinkOrigin,
    createdById?: string,
  ): Promise<IssuedLink> {
    const ttlDays = this.config.get('ACCESS_LINK_TTL_DAYS', { infer: true });
    const { token, record } = newLinkToken(ttlDays * 24 * 60 * 60 * 1000);
    const link = await tx.accessLink.create({
      data: { diagnosticId, origin, createdById, ...record },
      select: { id: true, expiresAt: true },
    });
    await this.audit.record(
      {
        actorType: createdById
          ? AuditActorType.PANEL_USER
          : AuditActorType.SYSTEM,
        actorId: createdById,
        action: 'ACCESS_LINK_ISSUED',
        entity: 'Diagnostic',
        entityId: diagnosticId,
        data: { accessLinkId: link.id, origin },
      },
      tx,
    );
    return { url: this.linkUrl(token), expiresAt: link.expiresAt };
  }

  /** Revoca los enlaces vigentes del diagnóstico; sus sesiones caen con ellos. */
  async revokeAll(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
  ): Promise<number> {
    const { count } = await tx.accessLink.updateMany({
      where: { diagnosticId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** `MailService` nunca lanza: un fallo de envío queda en la bitácora. */
  async sendLink(
    recipient: LinkRecipient,
    link: IssuedLink,
    diagnosticId: string,
    actorId: string,
  ): Promise<boolean> {
    const result = await this.mail.sendDiagnosticLink(
      { to: recipient.email, name: recipient.name, link: link.url },
      {
        entity: 'Diagnostic',
        entityId: diagnosticId,
        actorType: AuditActorType.PANEL_USER,
        actorId,
      },
    );
    return result.sent;
  }

  /**
   * Cambia el token del enlace por una sesión. El enlace sirve varias veces
   * hasta vencer; al usarlo se revocan los emitidos antes que él, así que un
   * enlace de recuperación deja sin valor al anterior recién cuando se usa.
   * Si el diagnóstico ya se envió, un enlace no vencido lo dice (409): quien lo
   * tiene es el cliente, y así no le pide un enlace nuevo que no va a llegar.
   */
  async redeem(
    token: string,
  ): Promise<{ sessionToken: string; expiresAt: Date }> {
    const link = await this.prisma.accessLink.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, diagnosticId: true },
    });
    if (!link) {
      this.recordRejected();
      throw this.invalidLink();
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Ordena el canje con un envío o un reenvío simultáneos del mismo diagnóstico.
      const [diagnostic] = await tx.$queryRaw<{ status: DiagnosticStatus }[]>`
        SELECT status FROM diagnostics WHERE id = ${link.diagnosticId} FOR UPDATE
      `;
      const current = await tx.accessLink.findUniqueOrThrow({
        where: { id: link.id },
        select: {
          expiresAt: true,
          revokedAt: true,
          redeemedAt: true,
          createdAt: true,
        },
      });
      const now = new Date();
      if (current.expiresAt <= now) return null;
      if (diagnostic?.status === DiagnosticStatus.COMPLETED) {
        return 'completed' as const;
      }
      if (current.revokedAt) return null;

      if (!current.redeemedAt) {
        await tx.accessLink.update({
          where: { id: link.id },
          data: { redeemedAt: now },
        });
      }
      const { count: revokedPrevious } = await tx.accessLink.updateMany({
        where: {
          diagnosticId: link.diagnosticId,
          revokedAt: null,
          createdAt: { lt: current.createdAt },
        },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          actorType: AuditActorType.END_CLIENT,
          actorId: link.diagnosticId,
          action: 'DIAGNOSTIC_SESSION_STARTED',
          entity: 'Diagnostic',
          entityId: link.diagnosticId,
          data: { accessLinkId: link.id, revokedPrevious },
        },
        tx,
      );
      return new Date(
        Math.min(
          now.getTime() + SESSION_TTL_SECONDS * 1000,
          current.expiresAt.getTime(),
        ),
      );
    });

    if (!outcome || outcome === 'completed') {
      this.recordRejected(link.diagnosticId);
      throw outcome
        ? new ConflictException({
            message: 'Este diagnóstico ya fue enviado.',
            code: DIAGNOSTIC_COMPLETED,
          })
        : this.invalidLink();
    }
    const expiresAt = outcome;

    const sessionToken = await this.jwt.signAsync(
      { sub: link.diagnosticId, lid: link.id } satisfies SessionPayload,
      {
        secret: this.sessionSecret(),
        audience: SESSION_AUDIENCE,
        algorithm: 'HS256',
        expiresIn: Math.max(
          1,
          Math.floor((expiresAt.getTime() - Date.now()) / 1000),
        ),
      },
    );
    return { sessionToken, expiresAt };
  }

  /** Valida la firma y, en la base, que el enlace de la sesión siga vigente. */
  async verifySession(sessionToken: string): Promise<ClientSession> {
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(sessionToken, {
        secret: this.sessionSecret(),
        audience: SESSION_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException();
    }

    const link =
      typeof payload.lid === 'string'
        ? await this.prisma.accessLink.findUnique({
            where: { id: payload.lid },
            select: { diagnosticId: true, revokedAt: true, expiresAt: true },
          })
        : null;
    if (
      !link ||
      link.diagnosticId !== payload.sub ||
      link.revokedAt ||
      link.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException();
    }
    return { sub: payload.sub, linkId: payload.lid };
  }

  /**
   * Responde enseguida y procesa en segundo plano: la respuesta es la misma, en
   * contenido y en tiempo, haya o no un diagnóstico con ese correo.
   */
  requestRecovery(email: string): { message: string } {
    void this.processRecovery(email).catch((error: unknown) =>
      this.logger.error(
        'Falló la recuperación de un enlace de diagnóstico',
        error instanceof Error ? error.stack : undefined,
      ),
    );
    return { message: RECOVERY_MESSAGE };
  }

  /**
   * Envía un enlace nuevo para el diagnóstico sin completar más reciente del
   * correo, sin revocar el anterior: quien conozca el correo de otro no puede
   * dejarlo fuera. Con el tope por correo, tampoco puede llenarle la bandeja.
   */
  async processRecovery(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const issued = await this.prisma.$transaction(async (tx) => {
      // Serializa las recuperaciones del mismo correo: el tope no se salta en paralelo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`access-link-recovery:${normalized}`}))`;

      const diagnostic = await tx.diagnostic.findFirst({
        where: {
          status: { not: DiagnosticStatus.COMPLETED },
          lead: { email: normalized },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, lead: { select: { name: true, email: true } } },
      });
      if (!diagnostic) return null;

      const recent = await tx.accessLink.count({
        where: {
          origin: AccessLinkOrigin.RECOVERY,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          diagnostic: { lead: { email: normalized } },
        },
      });
      if (recent >= RECOVERY_LIMIT_PER_HOUR) {
        await this.audit.record(
          {
            actorType: AuditActorType.SYSTEM,
            action: 'ACCESS_LINK_RECOVERY_LIMITED',
            entity: 'Diagnostic',
            entityId: diagnostic.id,
          },
          tx,
        );
        return null;
      }

      const link = await this.issue(
        tx,
        diagnostic.id,
        AccessLinkOrigin.RECOVERY,
      );
      return { link, diagnostic };
    });
    if (!issued) return;

    await this.mail.sendLinkRecovery(
      {
        to: issued.diagnostic.lead.email,
        name: issued.diagnostic.lead.name,
        link: issued.link.url,
      },
      { entity: 'Diagnostic', entityId: issued.diagnostic.id },
    );
  }

  /**
   * El token va en el fragmento (`#`): el navegador no lo manda al servidor de
   * `apps/diagnostico`, así que no queda en sus logs ni en el `Referer`.
   */
  private linkUrl(token: string): string {
    const url = diagnosticLink(this.config, '/access');
    url.hash = new URLSearchParams({ token }).toString();
    return url.href;
  }

  private sessionSecret(): string {
    return this.config.get('ACCESS_LINK_JWT_SECRET', { infer: true });
  }

  private invalidLink() {
    return new UnauthorizedException({
      message: INVALID_ACCESS_LINK_MESSAGE,
      code: INVALID_ACCESS_LINK,
    });
  }

  /** Sin bloquear: la respuesta no debe tardar distinto por esto. */
  private recordRejected(diagnosticId?: string): void {
    this.audit
      .record({
        actorType: AuditActorType.SYSTEM,
        action: 'ACCESS_LINK_REJECTED',
        entity: 'Diagnostic',
        entityId: diagnosticId,
      })
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo registrar el enlace rechazado',
          error instanceof Error ? error.stack : undefined,
        ),
      );
  }
}
