import type { Mock } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EnvValidado } from '../config/validar-env';
import { CorreoPort } from './correo.port';
import { CorreoService, enmascararEmail } from './correo.service';

const ENLACE = 'https://diagnostico.example.com/e/token-secreto-123';

describe('CorreoService', () => {
  let proveedor: { enviar: Mock };
  let auditoria: { registrar: Mock };
  let service: CorreoService;

  beforeEach(() => {
    proveedor = { enviar: vi.fn() };
    auditoria = { registrar: vi.fn().mockResolvedValue({}) };
    const config = { get: vi.fn().mockReturnValue(undefined) };
    service = new CorreoService(
      proveedor as unknown as CorreoPort,
      auditoria as unknown as AuditoriaService,
      config as unknown as ConfigService<EnvValidado, true>,
    );
  });

  it('envía el enlace del diagnóstico en español, con el enlace en el cuerpo', async () => {
    proveedor.enviar.mockResolvedValue({ enviado: true, proveedorId: 'em_1' });

    const resultado = await service.enviarEnlaceDiagnostico({
      para: 'ana@example.com',
      nombre: 'Ana',
      enlace: ENLACE,
    });

    expect(resultado).toEqual({ enviado: true, proveedorId: 'em_1' });
    const message = proveedor.enviar.mock.calls[0][0];
    expect(message.para).toBe('ana@example.com');
    expect(message.asunto).toBe('Tu diagnóstico SCORE');
    expect(message.html).toContain(`href="${ENLACE}"`);
    expect(message.html).toContain('lang="es"');
    expect(message.texto).toContain(ENLACE);
  });

  it('registra el envío en Auditoría sin el enlace ni el email completo', async () => {
    proveedor.enviar.mockResolvedValue({ enviado: true, proveedorId: 'em_1' });

    await service.enviarRecuperacionEnlace(
      { para: 'ana@example.com', nombre: 'Ana', enlace: ENLACE },
      { entity: 'Caso', entityId: 'caso-1' },
    );

    expect(auditoria.registrar).toHaveBeenCalledWith({
      actorType: 'SYSTEM',
      actorId: undefined,
      action: 'EMAIL_SENT',
      entity: 'Caso',
      entityId: 'caso-1',
      data: {
        type: 'LINK_RECOVERY',
        recipient: 'a***@example.com',
        providerId: 'em_1',
      },
    });
    expect(JSON.stringify(auditoria.registrar.mock.calls)).not.toContain(
      'token-secreto',
    );
  });

  it('un fallo del proveedor se devuelve y se audita, sin lanzar', async () => {
    proveedor.enviar.mockResolvedValue({
      enviado: false,
      motivo: 'daily_quota_exceeded (429): límite diario',
    });

    const resultado = await service.enviarEnlaceDiagnostico({
      para: 'ana@example.com',
      nombre: 'Ana',
      enlace: ENLACE,
    });

    expect(resultado).toEqual({
      enviado: false,
      motivo: 'daily_quota_exceeded (429): límite diario',
    });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EMAIL_FAILED',
        entity: 'Email',
        data: expect.objectContaining({
          reason: 'daily_quota_exceeded (429): límite diario',
        }),
      }),
    );
  });

  it('si el adaptador lanza, lo convierte en fallo controlado', async () => {
    proveedor.enviar.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      service.enviarEnlaceDiagnostico({
        para: 'ana@example.com',
        nombre: 'Ana',
        enlace: ENLACE,
      }),
    ).resolves.toEqual({ enviado: false, motivo: 'ECONNRESET' });
  });

  it('si Auditoría falla, el envío igual devuelve su resultado', async () => {
    proveedor.enviar.mockResolvedValue({ enviado: true, proveedorId: 'em_1' });
    auditoria.registrar.mockRejectedValue(new Error('db caída'));

    await expect(
      service.enviarEnlaceDiagnostico({
        para: 'ana@example.com',
        nombre: 'Ana',
        enlace: ENLACE,
      }),
    ).resolves.toEqual({ enviado: true, proveedorId: 'em_1' });
  });

  it('escapa el nombre del destinatario en el HTML', async () => {
    proveedor.enviar.mockResolvedValue({ enviado: true, proveedorId: 'em_1' });

    await service.enviarEnlaceDiagnostico({
      para: 'ana@example.com',
      nombre: '<script>alert(1)</script>',
      enlace: ENLACE,
    });

    const { html } = proveedor.enviar.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('enmascararEmail', () => {
  it('deja solo la primera letra y el dominio', () => {
    expect(enmascararEmail('ana.perez@dominio.com')).toBe('a***@dominio.com');
    expect(enmascararEmail('sin-arroba')).toBe('***');
  });
});
