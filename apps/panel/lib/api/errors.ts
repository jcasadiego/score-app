export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** `code` estable de la API (RFC 9457, `api/docs/errores.md`), si vino. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ErrorApi";
  }
}
