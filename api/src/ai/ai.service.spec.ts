import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SimulatedAiAdapter } from './adapters/simulated-ai.adapter';
import { AiProviderError } from './ai-provider.port';
import { AiService } from './ai.service';
import type { AiTask } from './ai.types';
import { ContactDataError } from './minimize';

const SCHEMA = z.object({
  answered: z.number().int().min(0),
  summary: z.string(),
});

const TASK: AiTask<z.infer<typeof SCHEMA>> = {
  use: 'flags',
  prompt: { id: 'test.prompt', version: 'v3', instructions: 'Revisa.' },
  data: { answers: { story: 'Lancé un disco. Escríbeme a ana@correo.com' } },
  schema: SCHEMA,
  subject: { entity: 'Diagnostic', entityId: 'diag-1' },
};

describe('AiService', () => {
  let env: Record<string, unknown>;
  let create: ReturnType<typeof vi.fn>;
  let auditRecord: ReturnType<typeof vi.fn>;
  let service: AiService;

  beforeEach(() => {
    vi.restoreAllMocks();
    env = { AI_TIMEOUT_MS: 5000 };
    create = vi.fn().mockResolvedValue({ id: 'log-1' });
    auditRecord = vi.fn().mockResolvedValue(undefined);
    service = new AiService(
      { aiCallLog: { create } } as unknown as PrismaService,
      { record: auditRecord } as unknown as AuditService,
      { get: (key: string) => env[key] } as unknown as ConfigService<
        never,
        true
      >,
    );
  });

  it('sin configuración usa el simulado: responde con la forma pedida y lo marca', async () => {
    const result = await service.run(TASK);
    expect(result).toEqual({
      ok: true,
      value: { answered: 0, summary: 'Respuesta simulada' },
      simulated: true,
      callLogId: 'log-1',
    });
  });

  it('elige proveedor y modelo por uso, con el general como respaldo', () => {
    env.AI_PROVIDER = 'disabled';
    env.AI_MODEL = 'claude-sonnet-5-5';
    env.AI_REPORT_PROVIDER = 'stub';
    expect(service.configFor('flags')).toEqual({
      provider: 'disabled',
      model: 'claude-sonnet-5-5',
    });
    expect(service.configFor('report')).toEqual({
      provider: 'stub',
      model: 'claude-sonnet-5-5',
    });
  });

  it('desactivada responde "disabled", distinto de un resultado vacío, y no llama a nadie', async () => {
    env.AI_PROVIDER = 'disabled';
    const complete = vi.spyOn(SimulatedAiAdapter.prototype, 'complete');
    expect(await service.run(TASK)).toEqual({ ok: false, reason: 'disabled' });
    expect(complete).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('una respuesta que no cumple la estructura es un error, nunca un dato', async () => {
    vi.spyOn(SimulatedAiAdapter.prototype, 'complete').mockResolvedValue({
      text: '{"answered":"muchas"}',
      servedModel: 'stub',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(await service.run(TASK)).toEqual({
      ok: false,
      reason: 'invalid_output',
      callLogId: 'log-1',
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      outcome: 'FAILED',
      failureReason: 'invalid_output',
    });
  });

  it('un fallo del proveedor no lanza: devuelve el motivo y queda registrado', async () => {
    vi.spyOn(SimulatedAiAdapter.prototype, 'complete').mockRejectedValue(
      new AiProviderError('timeout'),
    );
    expect(await service.run(TASK)).toEqual({
      ok: false,
      reason: 'timeout',
      callLogId: 'log-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a la IA solo llegan los datos minimizados y separados de las instrucciones', async () => {
    const complete = vi.spyOn(SimulatedAiAdapter.prototype, 'complete');
    await service.run(TASK);
    const request = complete.mock.calls[0][0];
    expect(request.system).toContain('Revisa.');
    expect(request.system).not.toContain('Lancé un disco');
    expect(request.userContent).toContain('Lancé un disco');
    expect(request.userContent).not.toContain('ana@correo.com');
    expect(request.jsonSchema).not.toHaveProperty('$schema');
  });

  it('un dato de contacto en los datos es un error de quien llama', async () => {
    await expect(
      service.run({ ...TASK, data: { email: 'ana@correo.com' } }),
    ).rejects.toThrow(ContactDataError);
  });

  it('el registro y la bitácora guardan metadatos, nunca contenido', async () => {
    await service.run(TASK);
    const logged = JSON.stringify([
      create.mock.calls[0][0],
      auditRecord.mock.calls[0][0],
    ]);
    expect(create.mock.calls[0][0].data).toMatchObject({
      use: 'flags',
      provider: 'stub',
      model: 'claude-opus-5-5',
      promptId: 'test.prompt',
      promptVersion: 'v3',
      outcome: 'SUCCEEDED',
      entity: 'Diagnostic',
      entityId: 'diag-1',
      estimatedCostUsd: 0,
    });
    expect(auditRecord.mock.calls[0][0]).toMatchObject({
      action: 'AI_TASK_RUN',
      entityId: 'diag-1',
    });
    expect(logged).not.toContain('Lancé un disco');
    expect(logged).not.toContain('Respuesta simulada');
  });

  it('un fallo al registrar no cambia el resultado, pero no hay id del registro', async () => {
    create.mockRejectedValue(new Error('base caída'));
    const result = await service.run(TASK);
    expect(result.ok).toBe(true);
    expect(result.callLogId).toBeUndefined();
  });

  it('si falla solo la bitácora, el id del registro de uso sigue llegando', async () => {
    auditRecord.mockRejectedValue(new Error('bitácora caída'));
    expect((await service.run(TASK)).callLogId).toBe('log-1');
  });
});
