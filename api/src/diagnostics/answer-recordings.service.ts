import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AuditActorType, AudioFormat } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { CrmSyncService } from '../crm/crm-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { newObjectKey } from '../storage/object-key';
import { storageHttpError } from '../storage/storage-http';
import { StorageService } from '../storage/storage.service';
import { ClientSession } from './access-links.service';
import { DiagnosticSessionsService } from './diagnostic-sessions.service';
import {
  RECORDING_NOT_FOUND,
  RECORDING_SELECT,
  RECORDING_UNSUPPORTED_TYPE,
  RecordingView,
  recordingView,
  VOICE_CONSENT_REQUIRED,
  VOICE_NOT_ALLOWED,
} from './diagnostic-view';
import { AUDIO_CONTENT_TYPES, detectAudioFormat } from './recording-rules';

/** El archivo que entrega multer, en memoria. */
export interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface RecordingPlayback {
  url: string;
  expiresAt: Date;
  contentType: string;
  durationMs: number;
}

/**
 * Grabaciones de voz de las respuestas (PF-86). El audio vive en el
 * almacenamiento con una clave opaca; la base guarda solo el registro. El
 * objeto se sube antes de la transacción (no se tiene un bloqueo abierto
 * mientras viaja) y, si la transacción falla, se borra. Ni el audio ni su
 * clave entran a la bitácora o a los logs.
 */
@Injectable()
export class AnswerRecordingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly sessions: DiagnosticSessionsService,
    private readonly crm: CrmSyncService,
  ) {}

  /** El cliente acepta el uso de su voz. Repetirlo con la misma versión no cambia nada. */
  async giveConsent(session: ClientSession, version: string) {
    const diagnosticId = session.sub;
    return this.prisma.$transaction(async (tx) => {
      await this.sessions.lockWritable(tx, diagnosticId);
      const current = await tx.diagnostic.findUniqueOrThrow({
        where: { id: diagnosticId },
        select: { voiceConsentAt: true, voiceConsentVersion: true },
      });
      if (current.voiceConsentVersion === version) return current;

      const updated = await tx.diagnostic.update({
        where: { id: diagnosticId },
        data: { voiceConsentAt: new Date(), voiceConsentVersion: version },
        select: { voiceConsentAt: true, voiceConsentVersion: true },
      });
      await this.sessions.recordClientEvent(
        tx,
        'VOICE_CONSENT_GIVEN',
        session,
        {
          version,
        },
      );
      return updated;
    });
  }

  /** Crea o reemplaza la grabación de una respuesta. */
  async upload(
    session: ClientSession,
    questionId: string,
    file: UploadedAudio,
    durationMs: number,
  ): Promise<RecordingView & { questionId: string }> {
    const diagnosticId = session.sub;
    const format = detectAudioFormat(file.buffer, file.mimetype);
    if (!format) {
      throw new UnsupportedMediaTypeException({
        message: 'El audio debe ser WebM (Opus) o MP4 (AAC).',
        code: RECORDING_UNSUPPORTED_TYPE,
      });
    }
    // Antes de subir nada: falla rápido sin gastar almacenamiento. Se vuelve a
    // comprobar con el diagnóstico bloqueado.
    await this.prisma.$transaction((tx) =>
      this.assertCanRecord(tx, diagnosticId, questionId),
    );

    const objectKey = newObjectKey('voice');
    try {
      await this.storage.put({
        key: objectKey,
        body: file.buffer,
        contentType: AUDIO_CONTENT_TYPES[format],
      });
    } catch (error) {
      throw storageHttpError(error, RECORDING_NOT_FOUND);
    }

    let saved: { view: RecordingView; replacedKey: string | null };
    try {
      saved = await this.prisma.$transaction((tx) =>
        this.saveRecording(tx, session, questionId, {
          objectKey,
          format,
          sizeBytes: file.size,
          durationMs,
        }),
      );
    } catch (error) {
      await this.storage.deleteQuietly(objectKey);
      throw error;
    }

    if (saved.replacedKey) await this.storage.deleteQuietly(saved.replacedKey);
    // Una primera respuesta por voz deja el evento `DIAGNOSTIC_STARTED`.
    this.crm.kick();
    return { questionId, ...saved.view };
  }

  /**
   * Borra la grabación. Si la respuesta no tenía texto, se borra también: la
   * pregunta queda sin responder.
   */
  async remove(session: ClientSession, questionId: string): Promise<void> {
    const diagnosticId = session.sub;
    const objectKey = await this.prisma.$transaction(async (tx) => {
      const diagnostic = await this.sessions.lockWritable(tx, diagnosticId);
      await this.sessions.findQuestion(tx, diagnostic, questionId);
      const answer = await tx.answer.findUnique({
        where: { diagnosticId_questionId: { diagnosticId, questionId } },
        select: {
          id: true,
          textValue: true,
          recording: { select: { id: true, objectKey: true } },
        },
      });
      if (!answer?.recording) return null;

      await tx.answerRecording.delete({ where: { id: answer.recording.id } });
      const answerDeleted = answer.textValue === null;
      if (answerDeleted) {
        await tx.answer.delete({ where: { id: answer.id } });
      }
      await this.sessions.touch(tx, diagnosticId, diagnostic, false);
      await this.sessions.recordClientEvent(
        tx,
        'ANSWER_RECORDING_DELETED',
        session,
        { questionId, answerDeleted },
      );
      return answer.recording.objectKey;
    });
    if (objectKey) await this.storage.deleteQuietly(objectKey);
  }

  /** El cliente escucha su propia grabación (antes de enviar el diagnóstico). */
  async clientPlayback(
    session: ClientSession,
    questionId: string,
  ): Promise<RecordingPlayback> {
    return this.playback(session.sub, questionId);
  }

  /** El panel escucha la grabación; queda en la bitácora quién y cuál. */
  async panelPlayback(
    diagnosticId: string,
    questionId: string,
    requesterId: string,
  ): Promise<RecordingPlayback> {
    const playback = await this.playback(diagnosticId, questionId);
    await this.audit.record({
      actorType: AuditActorType.PANEL_USER,
      actorId: requesterId,
      action: 'ANSWER_RECORDING_PLAYED',
      entity: 'Diagnostic',
      entityId: diagnosticId,
      data: { questionId },
    });
    return playback;
  }

  private async playback(
    diagnosticId: string,
    questionId: string,
  ): Promise<RecordingPlayback> {
    const recording = await this.prisma.answerRecording.findFirst({
      where: { answer: { diagnosticId, questionId } },
      select: { objectKey: true, format: true, durationMs: true },
    });
    if (!recording) {
      throw new NotFoundException({
        message: 'Esta respuesta no tiene grabación.',
        code: RECORDING_NOT_FOUND,
      });
    }
    const contentType = AUDIO_CONTENT_TYPES[recording.format];
    try {
      const signed = await this.storage.getSignedReadUrl(recording.objectKey, {
        contentType,
        contentDisposition: 'inline',
      });
      return { ...signed, contentType, durationMs: recording.durationMs };
    } catch (error) {
      throw storageHttpError(error, RECORDING_NOT_FOUND);
    }
  }

  /** Diagnóstico abierto, consentimiento dado y pregunta que acepta voz. */
  private async assertCanRecord(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
    questionId: string,
  ) {
    const diagnostic = await this.sessions.lockWritable(tx, diagnosticId);
    const question = await this.sessions.findQuestion(
      tx,
      diagnostic,
      questionId,
    );
    if (!question.allowsVoice) {
      throw new ConflictException({
        message: 'Esta pregunta no admite respuestas por voz.',
        code: VOICE_NOT_ALLOWED,
      });
    }
    const { voiceConsentAt } = await tx.diagnostic.findUniqueOrThrow({
      where: { id: diagnosticId },
      select: { voiceConsentAt: true },
    });
    if (!voiceConsentAt) {
      throw new ConflictException({
        message: 'Antes de grabar hay que aceptar el uso de la voz.',
        code: VOICE_CONSENT_REQUIRED,
      });
    }
    return diagnostic;
  }

  private async saveRecording(
    tx: Prisma.TransactionClient,
    session: ClientSession,
    questionId: string,
    data: {
      objectKey: string;
      format: AudioFormat;
      sizeBytes: number;
      durationMs: number;
    },
  ) {
    const diagnosticId = session.sub;
    const diagnostic = await this.assertCanRecord(tx, diagnosticId, questionId);

    // Sin texto todavía, la respuesta nace solo con la voz.
    const answer = await tx.answer.upsert({
      where: { diagnosticId_questionId: { diagnosticId, questionId } },
      create: {
        diagnosticId,
        questionId,
        questionnaireVersionId: diagnostic.questionnaireVersionId,
        textValue: null,
      },
      update: {},
      select: { id: true, recording: { select: { objectKey: true } } },
    });
    const replacedKey = answer.recording?.objectKey ?? null;
    const recording = await tx.answerRecording.upsert({
      where: { answerId: answer.id },
      create: { answerId: answer.id, ...data },
      update: data,
      select: RECORDING_SELECT,
    });

    await this.sessions.touch(tx, diagnosticId, diagnostic, true);
    await this.sessions.recordClientEvent(
      tx,
      'ANSWER_RECORDING_SAVED',
      session,
      {
        questionId,
        format: data.format,
        replaced: replacedKey !== null,
      },
    );
    return { view: recordingView(recording), replacedKey };
  }
}
