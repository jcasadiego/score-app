import { Transform } from 'class-transformer';

/**
 * Recorta espacios al inicio/fin y colapsa los internos repetidos, para que
 * "  Sam   Lee " se guarde como "Sam Lee". Valores no-string pasan tal cual
 * y los rechaza el validador correspondiente.
 */
export function NormalizarTexto() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  );
}

/** Solo recorta extremos — para emails, donde no hay espacios internos válidos. */
export function Recortar() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
