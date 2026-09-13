export function parsearCorsOrigins(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0);
}
