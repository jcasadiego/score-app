import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AccessLinkOrigin,
  AuditActorType,
  DiagnosticFamily,
  DiagnosticStatus,
  QuestionnaireVersionStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { FlagsService } from '../flags/flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLinksService, IssuedLink } from './access-links.service';
import {
  DiagnosticViewStatus,
  statusFilter,
  viewStatus,
} from './diagnostic-status';
import {
  ANSWER_SELECT,
  DIAGNOSTIC_ALREADY_EXISTS,
  DIAGNOSTIC_COMPLETED,
  EXTERNAL_LINK_SELECT,
  NO_PUBLISHED_QUESTIONNAIRE,
  questionsWithAnswers,
  VERSION_QUESTIONS_SELECT,
} from './diagnostic-view';

const SUMMARY_SELECT = {
  id: true,
  status: true,
  lastActivityAt: true,
  completedAt: true,
  createdAt: true,
  lead: { select: { id: true, name: true, email: true } },
  questionnaireVersion: {
    select: {
      id: true,
      family: true,
      versionNumber: true,
      _count: { select: { questions: true } },
    },
  },
  _count: { select: { answers: true } },
} satisfies Prisma.DiagnosticSelect;

type SummaryRow = Prisma.DiagnosticGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

/** Fila del listado del panel: estado calculado y progreso, sin N+1. */
function summary<T extends SummaryRow>(row: T, now: Date) {
  const { questionnaireVersion: version, _count, ...diagnostic } = row;
  return {
    ...diagnostic,
    status: viewStatus(row, now),
    family: version.family,
    questionnaireVersion: {
      id: version.id,
      versionNumber: version.versionNumber,
    },
    progress: { answered: _count.answers, total: version._count.questions },
  };
}

export type DiagnosticSummary = ReturnType<typeof summary<SummaryRow>>;

export interface DiagnosticsPage {
  /** `openFlagCount`: flags abiertos del cálculo vigente (0 si no hay). */
  data: (DiagnosticSummary & { openFlagCount: number })[];
  total: number;
  page: number;
  pageSize: number;
}

interface ListParams {
  page: number;
  pageSize: number;
  status?: DiagnosticViewStatus;
  family?: DiagnosticFamily;
  search?: string;
}

/** Lo que ve el panel una sola vez tras emitir un enlace. */
export interface IssuedLinkResult {
  accessLink: IssuedLink;
  /** `false` si el correo no salió: el panel avisa para copiar o reenviar. */
  emailSent: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Diagnósticos desde `apps/panel` (PF-16). Ver, listar y reenviar el enlace:
 * Revisor y Aprobador. Generar sin pago, con motivo: solo Aprobador (CLAUDE.md
 * 5.3). El correo sale después del commit: si falla, el diagnóstico y el enlace
 * quedan creados y el panel recibe `emailSent: false`.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accessLinks: AccessLinksService,
    private readonly flags: FlagsService,
  ) {}

  async list({
    page,
    pageSize,
    status,
    family,
    search,
  }: ListParams): Promise<DiagnosticsPage> {
    const now = new Date();
    const where: Prisma.DiagnosticWhereInput = {
      ...(status && statusFilter(status, now)),
      ...(family && { questionnaireVersion: { family } }),
      ...(search && {
        lead: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.diagnostic.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.diagnostic.count({ where }),
    ]);

    const openFlags = await this.flags.openCountsByDiagnostic(
      rows.map((row) => row.id),
    );
    return {
      data: rows.map((row) => ({
        ...summary(row, now),
        openFlagCount: openFlags.get(row.id) ?? 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Detalle con cada pregunta y su respuesta, enlaces externos y de acceso. */
  async findOne(id: string) {
    const diagnostic = await this.prisma.diagnostic.findUnique({
      where: { id },
      select: {
        ...SUMMARY_SELECT,
        creationReason: true,
        createdBy: { select: { id: true, name: true } },
        questionnaireVersion: {
          select: {
            ...SUMMARY_SELECT.questionnaireVersion.select,
            ...VERSION_QUESTIONS_SELECT,
          },
        },
        // Con el id, que el panel necesita para corregir (PF-39/PF-40).
        answers: { select: { ...ANSWER_SELECT, id: true } },
        externalLinks: {
          select: EXTERNAL_LINK_SELECT,
          orderBy: { platform: 'asc' },
        },
        // Sin el hash del token: solo para saber qué enlaces siguen vigentes.
        accessLinks: {
          select: {
            id: true,
            origin: true,
            expiresAt: true,
            redeemedAt: true,
            revokedAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
      },
    });
    if (!diagnostic) throw this.notFound(id);

    const { answers, questionnaireVersion: version, ...rest } = diagnostic;
    const answerIds = new Map(answers.map((a) => [a.questionId, a.id]));
    const questions = questionsWithAnswers(version, answers).questions.map(
      (question) =>
        question.answer
          ? {
              ...question,
              answer: { id: answerIds.get(question.id), ...question.answer },
            }
          : question,
    );
    // `summary` conserva el resto de los campos: motivo, enlaces y quién lo generó.
    return {
      ...summary({ ...rest, questionnaireVersion: version }, new Date()),
      questions,
    };
  }

  /**
   * Genera el diagnóstico de un lead con la última versión publicada de su
   * familia, emite el enlace y lo envía por correo. Dos peticiones simultáneas
   * para el mismo lead chocan con el único de `leadId` antes de enviar nada.
   */
  async create(
    leadId: string,
    reason: string,
    requesterId: string,
  ): Promise<DiagnosticSummary & IssuedLinkResult> {
    let created: { id: string; link: IssuedLink };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.findUnique({
          where: { id: leadId },
          select: { family: true },
        });
        if (!lead) throw new NotFoundException(`Lead ${leadId} no encontrado`);

        const version = await tx.questionnaireVersion.findFirst({
          where: {
            family: lead.family,
            status: QuestionnaireVersionStatus.PUBLISHED,
          },
          orderBy: { versionNumber: 'desc' },
          select: { id: true, versionNumber: true },
        });
        if (!version) {
          throw new ConflictException({
            message: `No hay una versión publicada del cuestionario para la familia ${lead.family}.`,
            code: NO_PUBLISHED_QUESTIONNAIRE,
          });
        }

        const diagnostic = await tx.diagnostic.create({
          data: {
            leadId,
            questionnaireVersionId: version.id,
            createdById: requesterId,
            creationReason: reason,
          },
          select: { id: true },
        });
        // Sin el motivo: es texto libre y puede nombrar al cliente.
        await this.audit.record(
          {
            actorType: AuditActorType.PANEL_USER,
            actorId: requesterId,
            action: 'DIAGNOSTIC_CREATED',
            entity: 'Diagnostic',
            entityId: diagnostic.id,
            data: {
              leadId,
              questionnaireVersionId: version.id,
              versionNumber: version.versionNumber,
              withoutPayment: true,
            },
          },
          tx,
        );
        const link = await this.accessLinks.issue(
          tx,
          diagnostic.id,
          AccessLinkOrigin.PANEL,
          requesterId,
        );
        return { id: diagnostic.id, link };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          message: 'El lead ya tiene un diagnóstico.',
          code: DIAGNOSTIC_ALREADY_EXISTS,
        });
      }
      throw error;
    }

    const row = await this.prisma.diagnostic.findUniqueOrThrow({
      where: { id: created.id },
      select: SUMMARY_SELECT,
    });
    const emailSent = await this.accessLinks.sendLink(
      row.lead,
      created.link,
      created.id,
      requesterId,
    );
    return {
      ...summary(row, new Date()),
      accessLink: created.link,
      emailSent,
    };
  }

  /** Revoca los enlaces vigentes (y sus sesiones) y envía uno nuevo. */
  async resendLink(id: string, requesterId: string): Promise<IssuedLinkResult> {
    const { link, lead } = await this.prisma.$transaction(async (tx) => {
      const [diagnostic] = await tx.$queryRaw<{ status: DiagnosticStatus }[]>`
        SELECT status FROM diagnostics WHERE id = ${id} FOR UPDATE
      `;
      if (!diagnostic) throw this.notFound(id);
      if (diagnostic.status === DiagnosticStatus.COMPLETED) {
        throw new ConflictException({
          message:
            'El diagnóstico ya está completado: no admite enlaces nuevos.',
          code: DIAGNOSTIC_COMPLETED,
        });
      }

      const revoked = await this.accessLinks.revokeAll(tx, id);
      if (revoked > 0) {
        await this.audit.record(
          {
            actorType: AuditActorType.PANEL_USER,
            actorId: requesterId,
            action: 'ACCESS_LINKS_REVOKED',
            entity: 'Diagnostic',
            entityId: id,
            data: { count: revoked },
          },
          tx,
        );
      }
      const issued = await this.accessLinks.issue(
        tx,
        id,
        AccessLinkOrigin.PANEL,
        requesterId,
      );
      const { lead: recipient } = await tx.diagnostic.findUniqueOrThrow({
        where: { id },
        select: { lead: { select: { name: true, email: true } } },
      });
      return { link: issued, lead: recipient };
    });

    const emailSent = await this.accessLinks.sendLink(
      lead,
      link,
      id,
      requesterId,
    );
    return { accessLink: link, emailSent };
  }

  private notFound(id: string) {
    return new NotFoundException(`Diagnóstico ${id} no encontrado`);
  }
}
