"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Alert, Card, buttonClass } from "@/components/ui";
import type { Question } from "@/lib/api/types";
import { PLATFORMS } from "./platforms";
import { isEmptyDraft, type Draft } from "./questionnaire";
import { RequiredTag } from "./question-step";

function answerSummary(question: Question, draft: Draft | undefined): string {
  if (isEmptyDraft(draft)) return "";
  if (question.type === "FREE_TEXT") return draft!.text.trim();
  return question.options
    .filter((o) => draft!.optionIds.includes(o.id))
    .map((o) => o.text)
    .join(", ");
}

/** Revisión antes de enviar. React escapa todo lo que muestra. */
export function ReviewStep({
  headingRef,
  questions,
  drafts,
  links,
  missingIds,
  submitting,
  onEdit,
  onEditLinks,
  onSubmit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  questions: Question[];
  drafts: Record<string, Draft>;
  links: Record<string, string>;
  missingIds: string[];
  submitting: boolean;
  onEdit: (step: number) => void;
  onEditLinks: () => void;
  onSubmit: () => void;
}) {
  const missing = questions.filter((q) => missingIds.includes(q.id));
  const missingRef = useRef<HTMLDivElement>(null);

  // Cada intento fallido lleva el foco (y la vista) a la lista de faltantes:
  // el botón de enviar queda al final de la página.
  useEffect(() => {
    if (missingIds.length > 0) missingRef.current?.focus();
  }, [missingIds]);
  const filledLinks = PLATFORMS.filter(({ id }) => links[id]?.trim());

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold leading-snug sm:text-2xl"
        >
          Revisa tus respuestas
        </h1>
        <p className="mt-2 text-base leading-relaxed text-ink-muted">
          Puedes cambiar cualquier respuesta antes de enviar. Después de
          enviarlo ya no se puede modificar.
        </p>
      </Card>

      {missing.length > 0 && (
        <div ref={missingRef} tabIndex={-1} className="scroll-mt-4">
        <Alert tone="danger" announce title="Faltan preguntas obligatorias">
          <ul className="mt-1 flex flex-col gap-1">
            {missing.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => onEdit(questions.indexOf(q))}
                  className="min-h-6 text-left underline underline-offset-4"
                >
                  Pregunta {questions.indexOf(q) + 1}: {q.text}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
        </div>
      )}

      <Card>
        <ol className="flex flex-col divide-y divide-line">
          {questions.map((question, index) => {
            const summary = answerSummary(question, drafts[question.id]);
            const isMissing = missingIds.includes(question.id);
            return (
              <li key={question.id} className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0">
                <h2 className="text-base font-medium">
                  {index + 1}. {question.text}
                  <RequiredTag required={question.required} />
                </h2>
                <p
                  className={`whitespace-pre-line break-words text-base ${
                    summary ? "" : isMissing ? "font-medium text-danger" : "text-ink-muted"
                  }`}
                >
                  {summary || (isMissing ? "Sin responder (obligatoria)" : "Sin responder")}
                </p>
                <button
                  type="button"
                  onClick={() => onEdit(index)}
                  className={`${buttonClass.link} self-start text-sm`}
                  aria-label={`Cambiar la respuesta ${index + 1}`}
                >
                  Cambiar
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card>
        <h2 className="text-base font-medium">Tus enlaces</h2>
        {filledLinks.length === 0 ? (
          <p className="mt-1 text-base text-ink-muted">No agregaste enlaces.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {filledLinks.map(({ id, label }) => (
              <li key={id} className="break-all text-base">
                {label}: {links[id]}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onEditLinks}
          className={`${buttonClass.link} text-sm`}
        >
          Cambiar enlaces
        </button>
      </Card>

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className={`${buttonClass.primary} w-full`}
      >
        {submitting ? "Enviando…" : "Enviar diagnóstico"}
      </button>
    </div>
  );
}
