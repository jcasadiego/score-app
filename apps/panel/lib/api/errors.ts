/** Un error de un campo, de la extensión `errors` de RFC 9457. */
export interface ApiFieldError {
  field?: string;
  code?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** `code` estable de la API (RFC 9457, `api/docs/errores.md`), si vino. */
    public readonly code?: string,
    /** Detalle por campo (`errors`), si vino. */
    public readonly errors?: ApiFieldError[],
  ) {
    super(message);
    this.name = "ErrorApi";
  }
}
