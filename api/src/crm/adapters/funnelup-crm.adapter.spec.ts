import type { Mock } from 'vitest';
import { CrmAdapterError, CrmContact } from '../crm.port';
import {
  FUNNELUP_TIMEOUT_MS,
  FunnelUpCrmAdapter,
  rateLimitWaitMs,
  splitName,
} from './funnelup-crm.adapter';

const CONTACT: CrmContact = {
  name: 'Ana María Pérez',
  email: 'ana@example.com',
  phone: '+573001234567',
  family: 'PROJECT',
  utmSource: 'instagram',
  utmMedium: null,
  utmCampaign: 'lanzamiento',
};
const LEAD = { status: 'Lead', tags: ['score-lead'] };
const TOKEN = 'pit-secreto-de-prueba';

describe('FunnelUpCrmAdapter', () => {
  let fetchMock: Mock;

  function build(extraTag?: string) {
    return new FunnelUpCrmAdapter({
      token: TOKEN,
      locationId: 'loc123ABC456',
      extraTag,
      fetch: fetchMock as unknown as typeof fetch,
    });
  }

  function call(index: number) {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return {
      url,
      init,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
  }

  async function failure(run: Promise<unknown>): Promise<CrmAdapterError> {
    try {
      await run;
    } catch (error) {
      return error as CrmAdapterError;
    }
    throw new Error('no falló');
  }

  beforeEach(() => {
    fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/upsert')
          ? Response.json(
              { new: true, contact: { id: 'abc123' } },
              { status: 201 },
            )
          : Response.json({}, { status: 201 }),
      ),
    );
  });

  it('crea o actualiza el contacto por correo y suma las etiquetas aparte', async () => {
    expect(await build().upsertContact(CONTACT, LEAD)).toEqual({
      contactId: 'abc123',
    });

    const upsert = call(0);
    expect(upsert.url).toBe(
      'https://services.leadconnectorhq.com/contacts/upsert',
    );
    expect(upsert.init.method).toBe('POST');
    expect(upsert.init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      Version: 'v3',
    });
    expect(upsert.init.signal).toBeInstanceOf(AbortSignal);
    // Solo los campos acordados; sin `tags`, que reemplazaría las del equipo
    // comercial.
    expect(upsert.body).toEqual({
      locationId: 'loc123ABC456',
      firstName: 'Ana',
      lastName: 'María Pérez',
      email: 'ana@example.com',
      phone: '+573001234567',
      source: 'SCORE',
      customFields: [
        { key: 'contact.estado_score', fieldValue: 'Lead' },
        { key: 'contact.familia_score', fieldValue: 'Artista o proyecto' },
        { key: 'contact.utm_source', fieldValue: 'instagram' },
        { key: 'contact.utm_campaign', fieldValue: 'lanzamiento' },
      ],
    });

    const tags = call(1);
    expect(tags.url).toBe(
      'https://services.leadconnectorhq.com/contacts/abc123/tags',
    );
    expect(tags.init.method).toBe('POST');
    expect(tags.body).toEqual({ tags: ['score-lead'] });
  });

  it('sin teléfono ni apellido no los envía', async () => {
    await build().upsertContact({ ...CONTACT, name: 'Ana', phone: null }, LEAD);
    const { body } = call(0);
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('lastName');
    expect(body.firstName).toBe('Ana');
  });

  it('un cambio de estado escribe solo "Estado SCORE" y suma etiquetas', async () => {
    await build().updateStatus('abc123', {
      status: 'Entregado',
      tags: ['score-informe-entregado'],
    });
    const update = call(0);
    expect(update.url).toBe(
      'https://services.leadconnectorhq.com/contacts/abc123',
    );
    expect(update.init.method).toBe('PUT');
    expect(update.body).toEqual({
      customFields: [{ key: 'contact.estado_score', fieldValue: 'Entregado' }],
    });
    expect(call(1).body).toEqual({ tags: ['score-informe-entregado'] });
  });

  it('sin etiquetas que sumar no llama al endpoint de etiquetas', async () => {
    await build().updateStatus('abc123', { status: 'En curso', tags: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('la etiqueta extra (QA) va en todo contacto', async () => {
    await build('score-qa').updateStatus('abc123', {
      status: 'En curso',
      tags: [],
    });
    expect(call(1).body).toEqual({ tags: ['score-qa'] });
  });

  it('rechaza un id de contacto que no es alfanumérico sin llamar al CRM', async () => {
    const error = await failure(
      build().updateStatus('../locations/x', { status: 'Cliente', tags: [] }),
    );
    expect(error.code).toBe('INVALID_DATA');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'AUTH_FAILED'],
    [403, 'AUTH_FAILED'],
    [408, 'TIMEOUT'],
    [400, 'INVALID_DATA'],
    [404, 'INVALID_DATA'],
    [422, 'INVALID_DATA'],
    [500, 'PROVIDER_ERROR'],
    [503, 'PROVIDER_ERROR'],
  ])('clasifica el estado %i como %s', async (status, code) => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"ana@example.com ya existe"}', { status }),
    );
    const error = await failure(build().upsertContact(CONTACT, LEAD));
    expect(error).toBeInstanceOf(CrmAdapterError);
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
    // Nunca lleva la respuesta del proveedor ni el token.
    expect(JSON.stringify(error) + error.message).not.toMatch(
      /ana@example\.com|pit-/,
    );
  });

  it('429 devuelve la espera de la ventana, sin esperar dentro de la llamada', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: {
          'x-ratelimit-interval-milliseconds': '10000',
          'x-ratelimit-daily-remaining': '150000',
        },
      }),
    );
    const error = await failure(build().upsertContact(CONTACT, LEAD));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterMs).toBe(10_000);
  });

  it('el tiempo de espera agotado es TIMEOUT; un fallo de red, PROVIDER_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'TimeoutError' }),
    );
    expect((await failure(build().upsertContact(CONTACT, LEAD))).code).toBe(
      'TIMEOUT',
    );
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await failure(build().upsertContact(CONTACT, LEAD))).code).toBe(
      'PROVIDER_ERROR',
    );
    expect(FUNNELUP_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('una respuesta sin id de contacto es PROVIDER_ERROR y no suma etiquetas', async () => {
    fetchMock.mockResolvedValue(Response.json({ contact: {} }));
    expect((await failure(build().upsertContact(CONTACT, LEAD))).code).toBe(
      'PROVIDER_ERROR',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si fallan las etiquetas, falla el envío (la bandeja lo repite entero)', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ contact: { id: 'abc123' } }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect((await failure(build().upsertContact(CONTACT, LEAD))).code).toBe(
      'PROVIDER_ERROR',
    );
  });
});

describe('rateLimitWaitMs', () => {
  it('con el cupo diario agotado espera a su reinicio', () => {
    expect(
      rateLimitWaitMs(
        new Headers({
          'x-ratelimit-daily-remaining': '0',
          'x-ratelimit-daily-reset': '3600000',
          'x-ratelimit-interval-milliseconds': '10000',
        }),
      ),
    ).toBe(3_600_000);
  });

  it('sin encabezados espera 10 s', () => {
    expect(rateLimitWaitMs(new Headers())).toBe(10_000);
  });
});

describe('splitName', () => {
  it('separa la primera palabra del resto e ignora espacios de más', () => {
    expect(splitName('  Ana   María Pérez ')).toEqual({
      firstName: 'Ana',
      lastName: 'María Pérez',
    });
    expect(splitName('Ana')).toEqual({ firstName: 'Ana' });
  });
});
