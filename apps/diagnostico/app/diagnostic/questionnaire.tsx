"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert, buttonClass } from "@/components/ui";
import type {
  CurrentDiagnostic,
  ExternalPlatform,
  Question,
} from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";
import {
  deleteAnswer,
  deleteExternalLink,
  saveAnswer,
  saveExternalLink,
  submitDiagnostic,
} from "./actions";
import { ExitDialog } from "./exit-dialog";
import { LinksStep } from "./links-step";
import { PLATFORMS } from "./platforms";
import { QuestionStep } from "./question-step";
import { ReviewStep } from "./review-step";
import { useAutosave } from "./use-autosave";

export interface Draft {
  text: string;
  optionIds: string[];
}

/** Espera tras la última tecla antes de guardar un texto. */
const TEXT_SAVE_DELAY_MS = 800;

export const isEmptyDraft = (draft: Draft | undefined) =>
  !draft || (draft.text.trim() === "" && draft.optionIds.length === 0);

const draftPrint = (draft: Draft) =>
  JSON.stringify([draft.text.trim(), [...draft.optionIds].sort()]);

const toDraft = (question: Question): Draft => ({
  text: question.answer?.text ?? "",
  optionIds: question.answer?.optionIds ?? [],
});

/**
 * El cuestionario: una pregunta por paso, luego los enlaces externos y al final
 * la revisión. Las respuestas viven aquí mientras se editan (son el borrador del
 * cliente) y se guardan solas en la API; al recargar, la API devuelve lo
 * guardado y se retoma en la primera pregunta sin responder.
 */
export function Questionnaire({
  diagnostic,
}: {
  diagnostic: CurrentDiagnostic;
}) {
  const router = useRouter();
  const { questions } = diagnostic;
  const linksStep = questions.length;
  const reviewStep = questions.length + 1;

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, toDraft(q)])),
  );
  const [links, setLinks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      PLATFORMS.map(({ id }) => [
        id,
        diagnostic.externalLinks.find((l) => l.platform === id)?.url ?? "",
      ]),
    ),
  );
  const [step, setStep] = useState(() => {
    const firstOpen = questions.findIndex((q) => !q.answer);
    return firstOpen === -1 ? reviewStep : firstOpen;
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [submitting, startSubmit] = useTransition();
  const [exitOpen, setExitOpen] = useState(false);

  const answers = useAutosave<Draft>({
    initial: drafts,
    fingerprint: draftPrint,
    persist: (questionId, draft) => {
      const question = questions.find((q) => q.id === questionId);
      if (isEmptyDraft(draft)) return deleteAnswer(questionId);
      return saveAnswer(
        questionId,
        question?.type === "FREE_TEXT"
          ? { text: draft.text.trim() }
          : { optionIds: draft.optionIds },
      );
    },
  });
  const linkSaves = useAutosave<string>({
    initial: links,
    fingerprint: (url) => url.trim(),
    persist: (platform, url) =>
      url.trim() === ""
        ? deleteExternalLink(platform as ExternalPlatform)
        : saveExternalLink(platform as ExternalPlatform, url.trim()),
  });

  // Al cambiar de paso, el foco va al título del paso (lectores de pantalla).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  // Solo si algo quedó sin guardar: lo guardado no necesita aviso.
  const answerQueue = answers.queue;
  const linkQueue = linkSaves.queue;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (answerQueue.hasPending() || linkQueue.hasPending()) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [answerQueue, linkQueue]);

  const answered = questions.filter((q) => !isEmptyDraft(drafts[q.id])).length;

  function changeDraft(questionId: string, draft: Draft, delayMs = 0) {
    setDrafts((current) => ({ ...current, [questionId]: draft }));
    answers.queue.update(questionId, draft, delayMs);
    setMissingIds((ids) => ids.filter((id) => id !== questionId));
  }

  function changeLink(platform: string, url: string) {
    setLinks((current) => ({ ...current, [platform]: url }));
    linkSaves.queue.update(platform, url, 60_000);
  }

  function goTo(next: number) {
    // Lo que quede pendiente se guarda sin esperar: no frena la navegación.
    void answers.queue.flushAll();
    void linkSaves.queue.flushAll();
    setSubmitError(null);
    setStep(next);
  }

  function submit() {
    setSubmitError(null);
    const missing = questions
      .filter((q) => q.required && isEmptyDraft(drafts[q.id]))
      .map((q) => q.id);
    setMissingIds(missing);
    if (missing.length > 0) return;

    startSubmit(async () => {
      const [answersSaved, linksSaved] = await Promise.all([
        answers.queue.flushAll(),
        linkSaves.queue.flushAll(),
      ]);
      if (!answersSaved || !linksSaved) {
        setSubmitError(
          "Algunas respuestas o enlaces no se guardaron. Revisa los avisos e intenta de nuevo.",
        );
        return;
      }
      const result = await submitDiagnostic();
      // Con éxito, la acción redirige a la confirmación.
      if (result.ok) return;
      if (result.status === 401) {
        router.replace(ROUTES.sessionEnded);
      } else if (result.code === "DIAGNOSTIC_INCOMPLETE") {
        setMissingIds(
          (result.errors ?? []).flatMap((e) => (e.field ? [e.field] : [])),
        );
      } else {
        setSubmitError(result.message);
      }
    });
  }

  const stepLabel =
    step < linksStep
      ? `Pregunta ${step + 1} de ${questions.length}`
      : step === linksStep
        ? "Tus enlaces"
        : "Revisar y enviar";

  return (
    <main className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-ink-muted">
          Hola, {diagnostic.lead.name}. Tu avance se guarda solo.
        </p>
        <button
          type="button"
          onClick={() => setExitOpen(true)}
          className={`${buttonClass.link} shrink-0 text-sm`}
        >
          Salir
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="font-medium">{stepLabel}</span>
          <span id="progress-label" className="text-ink-muted">
            {answered} de {questions.length} respondidas
          </span>
        </div>
        <progress
          className="w-full"
          max={questions.length}
          value={answered}
          aria-labelledby="progress-label"
        />
      </div>

      {step < linksStep && (
        <QuestionStep
          key={questions[step].id}
          headingRef={headingRef}
          question={questions[step]}
          draft={drafts[questions[step].id]}
          status={answers.status[questions[step].id]}
          missing={missingIds.includes(questions[step].id)}
          onChange={(draft, isText) =>
            changeDraft(
              questions[step].id,
              draft,
              isText ? TEXT_SAVE_DELAY_MS : 0,
            )
          }
          onBlur={() => void answers.queue.flush(questions[step].id)}
          onRetry={() => void answers.queue.flush(questions[step].id)}
        />
      )}
      {step === linksStep && (
        <LinksStep
          headingRef={headingRef}
          links={links}
          status={linkSaves.status}
          onChange={changeLink}
          onBlur={(platform) => void linkSaves.queue.flush(platform)}
        />
      )}
      {step === reviewStep && (
        <ReviewStep
          headingRef={headingRef}
          questions={questions}
          drafts={drafts}
          links={links}
          missingIds={missingIds}
          submitting={submitting}
          onEdit={goTo}
          onEditLinks={() => goTo(linksStep)}
          onSubmit={submit}
        />
      )}

      {submitError && (
        <Alert tone="danger" announce>
          {submitError}
        </Alert>
      )}

      <nav
        aria-label="Pasos del diagnóstico"
        className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"
      >
        {step > 0 ? (
          <button
            type="button"
            onClick={() => goTo(step - 1)}
            className={buttonClass.secondary}
          >
            Anterior
          </button>
        ) : (
          <span />
        )}
        {step < reviewStep && (
          <button
            type="button"
            onClick={() => goTo(step + 1)}
            className={buttonClass.primary}
          >
            {step === linksStep - 1
              ? "Siguiente: tus enlaces"
              : step === linksStep
                ? "Revisar y enviar"
                : "Siguiente"}
          </button>
        )}
      </nav>

      <ExitDialog
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        flush={async () =>
          (await answers.queue.flushAll()) && (await linkSaves.queue.flushAll())
        }
      />
    </main>
  );
}
