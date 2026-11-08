"use client";

import { useActionState } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { requestNewLink, type RecoverState } from "./actions";

const INITIAL: RecoverState = { status: "idle" };

export function RecoverForm() {
  const [state, action, pending] = useActionState(requestNewLink, INITIAL);
  const hasError = state.status === "error";

  if (state.status === "sent") {
    return (
      <div role="status">
        <Alert tone="success" title="Revisa tu correo">
          {state.message} Si no lo ves en unos minutos, busca también en la
          carpeta de spam.
        </Alert>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-base font-medium">
          Tu correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "email-error" : "email-help"}
          className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base"
        />
        <p id="email-help" className="text-sm text-ink-muted">
          El mismo con el que te registraste en Music Finance Pro.
        </p>
      </div>
      {hasError && (
        <div id="email-error">
          <Alert tone="danger" announce>
            {state.message}
          </Alert>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass.primary} w-full sm:w-auto`}
      >
        {pending ? "Enviando…" : "Enviarme un enlace nuevo"}
      </button>
    </form>
  );
}
