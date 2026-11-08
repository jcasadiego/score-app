import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AiCallOutcome, AuditActorType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import type { ValidatedEnv } from '../config/validate-env';
import { PrismaService } from '../prisma/prisma.service';
import { ClaudeAiAdapter } from './adapters/claude-ai.adapter';
import { SimulatedAiAdapter } from './adapters/simulated-ai.adapter';
import {
  AiProviderAdapter,
  AiProviderError,
  AiProviderResponse,
} from './ai-provider.port';
import type {
  AiFailureReason,
  AiProviderName,
  AiResult,
  AiTask,
  AiUse,
} from './ai.types';
import { minimize } from './minimize';
import { estimateCostUsd } from './pricing';
import { buildSystem, buildUserContent } from './prompt-envelope';

/** Modelo por defecto si la configuración no nombra otro. */
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
/** Tope de salida por llamada (sin streaming, para no rozar timeouts HTTP). */
export const MAX_OUTPUT_TOKENS = 16_000;

interface UseConfig {
  provider: AiProviderName;
  model: string;
}

/**
 * Servicio compartido de IA (PF-32). Los módulos piden una tarea con su prompt
 * versionado, sus datos y la forma de la respuesta; aquí se elige el proveedor
 * del uso, se minimizan y aíslan los datos, se valida la salida y se registra
 * la llamada. Nunca lanza por un fallo del proveedor: devuelve `ok: false` con
 * el motivo, para que la operación que lo pidió siga. La IA nunca calcula el
 * puntaje.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly adapters = new Map<AiProviderName, AiProviderAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  /** Proveedor y modelo de un uso: el del uso, si no el general. */
  configFor(use: AiUse): UseConfig {
    const key = use.toUpperCase() as 'FLAGS' | 'REPORT';
    const provider =
      this.config.get(`AI_${key}_PROVIDER`, { infer: true }) ??
      this.config.get('AI_PROVIDER', { infer: true }) ??
      'stub';
    const model =
      this.config.get(`AI_${key}_MODEL`, { infer: true }) ??
      this.config.get('AI_MODEL', { infer: true }) ??
      DEFAULT_AI_MODEL;
    return { provider, model };
  }

  async run<T>(task: AiTask<T>): Promise<AiResult<T>> {
    const { provider, model } = this.configFor(task.use);
    if (provider === 'disabled') return { ok: false, reason: 'disabled' };
    const adapter = this.adapter(provider);

    // Lanza si quien llama mandó un dato de contacto: es un error de código.
    const data = minimize(task.data, task.redact);
    const jsonSchema = z.toJSONSchema(task.schema, { target: 'draft-7' });
    delete (jsonSchema as Record<string, unknown>).$schema;

    const started = Date.now();
    let response: AiProviderResponse | undefined;
    let failure: AiFailureReason | undefined;
    let value: T | undefined;
    try {
      response = await adapter.complete({
        model,
        system: buildSystem(task.prompt),
        userContent: buildUserContent(data),
        jsonSchema,
        maxOutputTokens: Math.min(
          task.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
          MAX_OUTPUT_TOKENS,
        ),
        timeoutMs: this.config.get('AI_TIMEOUT_MS', { infer: true }),
      });
      value = this.parse(response.text, task.schema);
      if (value === undefined) failure = 'invalid_output';
    } catch (error) {
      failure =
        error instanceof AiProviderError ? error.reason : 'provider_error';
    }

    await this.record(task, {
      provider: adapter.name,
      model,
      response,
      failure,
      durationMs: Date.now() - started,
    });

    if (failure || value === undefined) {
      this.logger.warn(
        `La IA no respondió para ${task.prompt.id}@${task.prompt.version}: ${failure}`,
      );
      return { ok: false, reason: failure ?? 'invalid_output' };
    }
    return { ok: true, value, simulated: adapter.simulated };
  }

  /** JSON que cumple el esquema, o `undefined`: nunca un dato a medias. */
  private parse<T>(text: string, schema: z.ZodType<T>): T | undefined {
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private adapter(provider: Exclude<AiProviderName, 'disabled'>) {
    let adapter = this.adapters.get(provider);
    if (!adapter) {
      adapter =
        provider === 'claude'
          ? new ClaudeAiAdapter(
              // validate-env la exige con este proveedor.
              this.config.get('ANTHROPIC_API_KEY', { infer: true }) as string,
            )
          : new SimulatedAiAdapter();
      this.adapters.set(provider, adapter);
    }
    return adapter;
  }

  /**
   * Registro de uso y bitácora, solo con metadatos. Un fallo al registrar no
   * cambia el resultado de la tarea.
   */
  private async record<T>(
    task: AiTask<T>,
    call: {
      provider: string;
      model: string;
      response?: AiProviderResponse;
      failure?: AiFailureReason;
      durationMs: number;
    },
  ): Promise<void> {
    const { response, failure } = call;
    const servedModel = response?.servedModel ?? null;
    const cost = response
      ? estimateCostUsd(
          servedModel ?? call.model,
          response.inputTokens,
          response.outputTokens,
        )
      : null;
    try {
      const log = await this.prisma.aiCallLog.create({
        data: {
          use: task.use,
          provider: call.provider,
          model: call.model,
          servedModel: servedModel !== call.model ? servedModel : null,
          promptId: task.prompt.id,
          promptVersion: task.prompt.version,
          outcome: failure ? AiCallOutcome.FAILED : AiCallOutcome.SUCCEEDED,
          failureReason: failure ?? null,
          inputTokens: response?.inputTokens ?? null,
          outputTokens: response?.outputTokens ?? null,
          estimatedCostUsd: cost,
          durationMs: call.durationMs,
          entity: task.subject?.entity ?? null,
          entityId: task.subject?.entityId ?? null,
        },
        select: { id: true },
      });
      // Datos del cliente que salen a un tercero: queda en la bitácora.
      await this.audit.record({
        actorType: AuditActorType.SYSTEM,
        action: 'AI_TASK_RUN',
        entity: task.subject?.entity ?? 'AiCallLog',
        entityId: task.subject?.entityId ?? log.id,
        data: {
          aiCallLogId: log.id,
          use: task.use,
          provider: call.provider,
          promptId: task.prompt.id,
          promptVersion: task.prompt.version,
          outcome: failure ? 'FAILED' : 'SUCCEEDED',
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la llamada a la IA: ${error instanceof Error ? error.name : 'desconocido'}`,
      );
    }
  }
}
