import type { ReactNode } from "react";

/** Áreas táctiles de 44 px o más (WCAG 2.5.8 pide 24; 44 es lo cómodo en móvil). */
const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2.5 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const buttonClass = {
  primary: `${BUTTON_BASE} bg-brand text-on-brand hover:bg-brand-strong`,
  secondary: `${BUTTON_BASE} border border-line-strong bg-surface text-ink hover:bg-canvas`,
  link: "inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4 hover:text-brand-strong",
};

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-8">
      {children}
    </div>
  );
}

type AlertTone = "danger" | "success" | "info";

const ALERT_TONE: Record<AlertTone, string> = {
  danger: "border-danger bg-danger-soft text-danger",
  success: "border-success bg-success-soft text-success",
  info: "border-line bg-canvas text-ink",
};

/**
 * Mensaje destacado. `announce` lo hace leer en voz alta por el lector de
 * pantalla al aparecer (`role="alert"`); úsalo solo para errores nuevos.
 */
export function Alert({
  tone,
  title,
  children,
  announce = false,
}: {
  tone: AlertTone;
  title?: string;
  children?: ReactNode;
  announce?: boolean;
}) {
  return (
    <div
      role={announce ? "alert" : undefined}
      className={`rounded-lg border-l-4 px-4 py-3 text-sm ${ALERT_TONE[tone]}`}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}
