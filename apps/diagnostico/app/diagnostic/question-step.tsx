"use client";

import type { RefObject } from "react";
import type { Question } from "@/lib/api/types";
import { Card } from "@/components/ui";
import type { Draft } from "./questionnaire";
import { SaveStatusLine } from "./save-status";
import type { SaveStatus } from "./use-autosave";

const OPTION_CLASS =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-base has-[:checked]:border-brand has-[:checked]:bg-canvas has-[:checked]:font-medium";

export function RequiredTag({ required }: { required: boolean }) {
  return (
    <span className="ml-2 align-middle text-sm font-normal text-ink-muted">
      {" "}
      {required ? "(obligatoria)" : "(opcional)"}
    </span>
  );
}

/** Una pregunta. El texto de la pregunta es la etiqueta de su respuesta. */
export function QuestionStep({
  headingRef,
  question,
  draft,
  status,
  missing,
  onChange,
  onBlur,
  onRetry,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  question: Question;
  draft: Draft;
  status?: SaveStatus;
  missing: boolean;
  onChange: (draft: Draft, isText: boolean) => void;
  onBlur: () => void;
  onRetry: () => void;
}) {
  const base = `q-${question.id}`;
  const helpId = question.helpText ? `${base}-help` : undefined;
  const statusId = `${base}-status`;
  const missingId = `${base}-missing`;
  const describedBy = [helpId, missing ? missingId : undefined, statusId]
    .filter(Boolean)
    .join(" ");

  const heading = (
    <h1
      ref={headingRef}
      tabIndex={-1}
      id={`${base}-title`}
      className="text-xl font-semibold leading-snug sm:text-2xl"
    >
      {question.text}
      <RequiredTag required={question.required} />
    </h1>
  );
  const help = question.helpText && (
    <p id={helpId} className="mt-2 text-base leading-relaxed text-ink-muted">
      {question.helpText}
    </p>
  );
  const missingNotice = missing && (
    <p id={missingId} className="mt-3 text-sm font-medium text-danger">
      Esta pregunta es obligatoria: respóndela para poder enviar.
    </p>
  );

  if (question.type === "FREE_TEXT") {
    const max = question.maxLength ?? 5000;
    return (
      <Card>
        {heading}
        {help}
        {missingNotice}
        <textarea
          aria-labelledby={`${base}-title`}
          aria-describedby={`${describedBy} ${base}-count`}
          aria-invalid={missing || status?.state === "error" || undefined}
          value={draft.text}
          maxLength={max}
          rows={6}
          onChange={(e) =>
            onChange({ text: e.target.value, optionIds: [] }, true)
          }
          onBlur={onBlur}
          className="mt-4 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base leading-relaxed"
        />
        <div className="mt-1 flex items-start justify-between gap-4">
          <SaveStatusLine id={statusId} status={status} onRetry={onRetry} />
          <p id={`${base}-count`} className="shrink-0 text-sm text-ink-muted">
            {draft.text.length} / {max}
          </p>
        </div>
      </Card>
    );
  }

  const multiple = question.type === "MULTIPLE_CHOICE";
  const toggle = (optionId: string, checked: boolean) => {
    const optionIds = multiple
      ? checked
        ? [...draft.optionIds, optionId]
        : draft.optionIds.filter((id) => id !== optionId)
      : [optionId];
    onChange({ text: "", optionIds }, false);
  };

  return (
    <Card>
      <fieldset aria-describedby={describedBy}>
        <legend className="contents">{heading}</legend>
        {help}
        {multiple && (
          <p className="mt-2 text-sm text-ink-muted">
            Puedes elegir más de una.
          </p>
        )}
        {missingNotice}
        <div className="mt-4 flex flex-col gap-3">
          {question.options.map((option) => (
            <label key={option.id} className={OPTION_CLASS}>
              <input
                type={multiple ? "checkbox" : "radio"}
                name={base}
                value={option.id}
                checked={draft.optionIds.includes(option.id)}
                onChange={(e) => toggle(option.id, e.target.checked)}
                className="size-5 shrink-0 accent-brand"
              />
              <span>{option.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3">
        <SaveStatusLine id={statusId} status={status} onRetry={onRetry} />
      </div>
    </Card>
  );
}
