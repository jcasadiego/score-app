/**
 * Minimización de datos antes de enviar algo a la IA (ISO 27701, OWASP
 * LLM02). Quien llama ya arma `data` solo con lo necesario; esto es la
 * segunda barrera.
 */

/** Claves que nunca deben viajar: datos de contacto del lead. */
const CONTACT_KEYS =
  /^(name|full_?name|first_?name|last_?name|email|e_?mail|phone|telephone|mobile|nombre|correo|telefono|teléfono|celular)$/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Candidatos a teléfono: dígitos con separadores. */
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{6,}\d/g;

/**
 * Un teléfono empieza con `+` o tiene 9 dígitos o más. Así un monto como
 * "1.500.000" (7 dígitos) no se pierde: puede importar para la tarea.
 */
function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '').length;
  return match.startsWith('+') || digits >= 9 ? '[teléfono]' : match;
}

export class ContactDataError extends Error {
  constructor(key: string) {
    super(`El campo "${key}" parece un dato de contacto y no se envía a la IA`);
    this.name = 'ContactDataError';
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(text: string, terms: RegExp[]): string {
  let result = text
    .replace(EMAIL, '[correo]')
    .replace(PHONE_CANDIDATE, maskPhone);
  for (const term of terms) result = result.replace(term, '[dato personal]');
  return result;
}

/**
 * Copia de `data` sin datos de contacto: rechaza claves de contacto (es un
 * error de quien llama) y reemplaza correos, teléfonos y los textos de
 * `redact` que aparezcan dentro de los textos libres.
 */
export function minimize(
  data: Record<string, unknown>,
  redact: string[] = [],
): Record<string, unknown> {
  const terms = redact
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .map((term) => new RegExp(escapeRegExp(term), 'gi'));

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value, terms);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, v]) => {
          if (CONTACT_KEYS.test(key)) throw new ContactDataError(key);
          return [key, walk(v)];
        }),
      );
    }
    return value;
  };
  return walk(data) as Record<string, unknown>;
}
