"use client";

import type { RefObject } from "react";
import { Card } from "@/components/ui";
import { PLATFORMS } from "./platforms";
import { SaveStatusLine } from "./save-status";
import type { SaveStatus } from "./use-autosave";

/** Enlaces externos, todos opcionales. Se guardan al salir de cada campo. */
export function LinksStep({
  headingRef,
  links,
  status,
  onChange,
  onBlur,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  links: Record<string, string>;
  status: Record<string, SaveStatus>;
  onChange: (platform: string, url: string) => void;
  onBlur: (platform: string) => void;
}) {
  return (
    <Card>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold leading-snug sm:text-2xl"
      >
        Tus enlaces
      </h1>
      <p className="mt-2 text-base leading-relaxed text-ink-muted">
        Si tienes perfiles en estas plataformas, pega aquí sus enlaces. Son
        opcionales y deben empezar con https://.
      </p>
      <div className="mt-5 flex flex-col gap-5">
        {PLATFORMS.map(({ id, label, placeholder }) => {
          const fieldStatus = status[id];
          const invalid =
            fieldStatus?.state === "error" || fieldStatus?.state === "retrying";
          return (
            <div key={id} className="flex flex-col gap-1.5">
              <label htmlFor={`link-${id}`} className="text-base font-medium">
                {label}
              </label>
              <input
                id={`link-${id}`}
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                maxLength={2048}
                placeholder={placeholder}
                value={links[id]}
                aria-invalid={invalid || undefined}
                aria-describedby={`link-${id}-status`}
                onChange={(e) => onChange(id, e.target.value)}
                onBlur={() => onBlur(id)}
                className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base"
              />
              <SaveStatusLine
                id={`link-${id}-status`}
                status={fieldStatus}
                onRetry={() => onBlur(id)}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
