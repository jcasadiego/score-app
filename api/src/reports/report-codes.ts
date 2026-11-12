/** Códigos propios del módulo de informes (catálogo en `docs/errores.md`). */
export const REPORT_ALREADY_EXISTS = 'REPORT_ALREADY_EXISTS';
export const REPORT_APPROVED = 'REPORT_APPROVED';
export const REPORT_NOT_APPROVED = 'REPORT_NOT_APPROVED';
export const REPORT_DELIVERED = 'REPORT_DELIVERED';
export const REPORT_OUTDATED = 'REPORT_OUTDATED';
export const REPORT_DIMENSIONS_MISSING = 'REPORT_DIMENSIONS_MISSING';
export const REPORT_VERSION_MISMATCH = 'REPORT_VERSION_MISMATCH';
export const REPORT_DELIVERY_BLOCKED = 'REPORT_DELIVERY_BLOCKED';
export const REPORT_EMAIL_FAILED = 'REPORT_EMAIL_FAILED';
export const REPORT_PDF_INTEGRITY_FAILED = 'REPORT_PDF_INTEGRITY_FAILED';
export const INVALID_REPORT_LINK = 'INVALID_REPORT_LINK';
export const AI_TASK_FAILED = 'AI_TASK_FAILED';

export const REPORT_VERSION_MISMATCH_ERROR = {
  code: REPORT_VERSION_MISMATCH,
  message:
    'El informe cambió desde que lo abriste. Vuelve a cargarlo y revisa los cambios.',
};
