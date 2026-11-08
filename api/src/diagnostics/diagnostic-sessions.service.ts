import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  DiagnosticStatus,
  ExternalPlatform,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { CalculationsService } from '../calculations/calculations.service';
import { VALIDATION_FAILED_CODE } from '../common/problem-details';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLinksService, ClientSession } from './access-links.service';
import { AnswerInput, validateAnswer } from './answer-rules';
import {
  ANSWER_SELECT,
  answerView,
  AnswerView,
  DIAGNOSTIC_COMPLETED,
  DIAGNOSTIC_INCOMPLETE,
  EXTERNAL_LINK_SELECT,
  questionsWithAnswers,
  VERSION_QUESTIONS_SELECT,
} from './diagnostic-view';
import { validateExternalLink } from './external-link-rules';

interface WritableDiagnostic {
  status: DiagnosticStatus;
  questionnaireVersionId: string;
}

/**
 * Lo que hace el cliente final con su sesión (PF-16). El id del diagnóstico
 * siempre sale de la sesión. Cada escritura bloquea el diagnóstico y exige que
 * no esté completado, así que no se cruza con un envío simultáneo. La bitácora
 * registra qué pregunta o plataforma cambió, nunca la respuesta.
 */
@Injectable()
export class DiagnosticSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accessLinks: AccessLinksService,
    private readonly notifications: NotificationsService,
    private readonly calculations: CalculationsService,
  ) {}

  /** Cuestionario con las respuestas guardadas, enlaces externos y progreso. */
  async current(diagnosticId: string) {
    const diagnostic = await this.prisma.diagnostic.findUniqueOrThrow({
      where: { id: diagnosticId },
      select: {
        id: true,
        status: true,
        completedAt: true,
        lead: { select: { name: true } },
        questionnaireVersion: { select: VERSION_QUESTIONS_SELECT },
        answers: { select: ANSWER_SELECT },
        externalLinks: {
          select: EXTERNAL_LINK_SELECT,
          orderBy: { platform: 'asc' },
        },
      },
    });
    const { questionnaireVersion: version, answers, ...rest } = diagnostic;
    return {
      ...rest,
      family: version.family,
      ...questionsWithAnswers(version, answers),
    };
  }

  /** Crea o reemplaza la respuesta a una pregunta, opciones incluidas. */
  async saveAnswer(
    session: ClientSession,
    questionId: string,
    input: AnswerInput,
  ): Promise<AnswerView & { questionId: string }> {
    const diagnosticId = session.sub;
    return this.prisma.$transaction(async (tx) => {
      const diagnostic = await this.lockWritable(tx, diagnosticId);
      const question = await this.findQuestion(tx, diagnostic, questionId);

      const result = validateAnswer(question, input);
      if ('errors' in result) {
        throw new BadRequestException({
          message: result.errors.map(({ message }) => message),
          code: VALIDATION_FAILED_CODE,
          errors: result.errors,
        });
      }

      const { id } = await tx.answer.upsert({
        where: { diagnosticId_questionId: { diagnosticId, questionId } },
        create: {
          diagnosticId,
          questionId,
          questionnaireVersionId: diagnostic.questionnaireVersionId,
          textValue: result.answer.textValue,
        },
        update: { textValue: result.answer.textValue },
        select: { id: true },
      });
      await tx.answerSelection.deleteMany({ where: { answerId: id } });
      await tx.answerSelection.createMany({
        data: result.answer.optionIds.map((optionId) => ({
          answerId: id,
          questionId,
          optionId,
        })),
      });

      await this.touch(tx, diagnosticId, diagnostic, true);
      await this.recordClientEvent(tx, 'ANSWER_SAVED', session, {
        questionId,
      });
      const saved = await tx.answer.findUniqueOrThrow({
        where: { id },
        select: ANSWER_SELECT,
      });
      return { questionId, ...answerView(saved) };
    });
  }

  async deleteAnswer(
    session: ClientSession,
    questionId: string,
  ): Promise<void> {
    const diagnosticId = session.sub;
    await this.prisma.$transaction(async (tx) => {
      const diagnostic = await this.lockWritable(tx, diagnosticId);
      await this.findQuestion(tx, diagnostic, questionId);
      // Las selecciones se borran en cascada con la respuesta.
      const { count } = await tx.answer.deleteMany({
        where: { diagnosticId, questionId },
      });
      if (count === 0) return;
      await this.touch(tx, diagnosticId, diagnostic, false);
      await this.recordClientEvent(tx, 'ANSWER_DELETED', session, {
        questionId,
      });
    });
  }

  async saveExternalLink(
    session: ClientSession,
    platform: ExternalPlatform,
    rawUrl: string,
  ) {
    const diagnosticId = session.sub;
    const result = validateExternalLink(platform, rawUrl);
    if ('error' in result) {
      throw new BadRequestException({
        message: [result.error],
        code: VALIDATION_FAILED_CODE,
        errors: [{ field: 'url', message: result.error }],
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const diagnostic = await this.lockWritable(tx, diagnosticId);
      const link = await tx.externalLink.upsert({
        where: { diagnosticId_platform: { diagnosticId, platform } },
        create: { diagnosticId, platform, url: result.url },
        update: { url: result.url },
        select: EXTERNAL_LINK_SELECT,
      });
      await this.touch(tx, diagnosticId, diagnostic, false);
      await this.recordClientEvent(tx, 'EXTERNAL_LINK_SAVED', session, {
        platform,
      });
      return link;
    });
  }

  async deleteExternalLink(
    session: ClientSession,
    platform: ExternalPlatform,
  ): Promise<void> {
    const diagnosticId = session.sub;
    await this.prisma.$transaction(async (tx) => {
      const diagnostic = await this.lockWritable(tx, diagnosticId);
      const { count } = await tx.externalLink.deleteMany({
        where: { diagnosticId, platform },
      });
      if (count === 0) return;
      await this.touch(tx, diagnosticId, diagnostic, false);
      await this.recordClientEvent(tx, 'EXTERNAL_LINK_DELETED', session, {
        platform,
      });
    });
  }

  /**
   * Envía el diagnóstico si todas las obligatorias tienen respuesta; si no,
   * 409 con cuáles faltan. Al completarse revoca sus enlaces (la sesión termina
   * aquí), deja pendiente su cálculo y avisa al equipo.
   */
  async submit(session: ClientSession) {
    const diagnosticId = session.sub;
    const completed = await this.prisma.$transaction(async (tx) => {
      const diagnostic = await this.lockWritable(tx, diagnosticId);
      const missing = await tx.question.findMany({
        where: {
          questionnaireVersionId: diagnostic.questionnaireVersionId,
          required: true,
          answers: { none: { diagnosticId } },
        },
        select: { id: true, code: true, text: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      if (missing.length > 0) {
        throw new ConflictException({
          message: 'Faltan preguntas obligatorias por responder.',
          code: DIAGNOSTIC_INCOMPLETE,
          errors: missing.map((question) => ({
            field: question.id,
            code: 'REQUIRED_QUESTION_UNANSWERED',
            message: question.text,
          })),
        });
      }

      const now = new Date();
      const result = await tx.diagnostic.update({
        where: { id: diagnosticId },
        data: {
          status: DiagnosticStatus.COMPLETED,
          completedAt: now,
          lastActivityAt: now,
        },
        select: {
          id: true,
          status: true,
          completedAt: true,
          lead: { select: { name: true } },
          questionnaireVersion: { select: { family: true } },
        },
      });
      const revoked = await this.accessLinks.revokeAll(tx, diagnosticId);
      await this.recordClientEvent(tx, 'DIAGNOSTIC_COMPLETED', session, {
        revokedAccessLinks: revoked,
      });
      // En la misma transacción: un reinicio no puede perder el cálculo.
      const calculation = await this.calculations.enqueue(tx, diagnosticId);
      return { ...result, calculationId: calculation.id };
    });

    // El cliente no espera al motor: se procesa en segundo plano.
    this.calculations.dispatch(completed.calculationId);
    this.notifications.notifyDiagnosticCompleted({
      diagnosticId,
      leadName: completed.lead.name,
      family: completed.questionnaireVersion.family,
    });
    return {
      id: completed.id,
      status: completed.status,
      completedAt: completed.completedAt,
    };
  }

  private async lockWritable(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
  ): Promise<WritableDiagnostic> {
    const [diagnostic] = await tx.$queryRaw<WritableDiagnostic[]>`
      SELECT status, questionnaire_version_id AS "questionnaireVersionId"
      FROM diagnostics WHERE id = ${diagnosticId} FOR UPDATE
    `;
    // La sesión ya validó que existe; sin fila, la sesión no debería existir.
    if (!diagnostic) throw new NotFoundException('Diagnóstico no encontrado');
    if (diagnostic.status === DiagnosticStatus.COMPLETED) {
      throw new ConflictException({
        message: 'El diagnóstico ya fue enviado y no admite cambios.',
        code: DIAGNOSTIC_COMPLETED,
      });
    }
    return diagnostic;
  }

  /** Solo preguntas de la versión del diagnóstico: otro id es un 404. */
  private async findQuestion(
    tx: Prisma.TransactionClient,
    diagnostic: WritableDiagnostic,
    questionId: string,
  ) {
    const question = await tx.question.findFirst({
      where: {
        id: questionId,
        questionnaireVersionId: diagnostic.questionnaireVersionId,
      },
      select: {
        type: true,
        maxLength: true,
        options: { select: { id: true } },
      },
    });
    if (!question) {
      throw new NotFoundException(`Pregunta ${questionId} no encontrada`);
    }
    return question;
  }

  /** Registra actividad; la primera respuesta lo pasa a `IN_PROGRESS`. */
  private touch(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
    diagnostic: WritableDiagnostic,
    answered: boolean,
  ) {
    return tx.diagnostic.update({
      where: { id: diagnosticId },
      data: {
        lastActivityAt: new Date(),
        ...(answered &&
          diagnostic.status === DiagnosticStatus.ACTIVE && {
            status: DiagnosticStatus.IN_PROGRESS,
          }),
      },
    });
  }

  /**
   * Con el enlace usado: el panel puede copiar el enlace del cliente, y así cada
   * cambio se rastrea hasta quién emitió ese enlace (`ACCESS_LINK_ISSUED`).
   */
  private recordClientEvent(
    tx: Prisma.TransactionClient,
    action: string,
    session: ClientSession,
    data: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.END_CLIENT,
        actorId: session.sub,
        action,
        entity: 'Diagnostic',
        entityId: session.sub,
        data: { ...data, accessLinkId: session.linkId },
      },
      tx,
    );
  }
}
