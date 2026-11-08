"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { leave } from "./actions";

/**
 * Aviso al salir. `<dialog>` nativo: atrapa el foco, cierra con Escape y
 * devuelve el foco al botón que lo abrió.
 */
export function ExitDialog({
  open,
  onClose,
  flush,
}: {
  open: boolean;
  onClose: () => void;
  flush: () => Promise<boolean>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [leaving, startLeaving] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function exit() {
    startLeaving(async () => {
      if (!(await flush())) {
        setUnsaved(true);
        return;
      }
      await leave();
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setUnsaved(false);
        onClose();
      }}
      aria-labelledby="exit-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-6 text-ink backdrop:bg-black/50"
    >
      <h2 id="exit-title" className="text-xl font-semibold">
        Tu avance quedó guardado
      </h2>
      <p className="mt-3 text-base leading-relaxed">
        Puedes volver cuando quieras con el enlace que te enviamos por correo y
        seguir donde lo dejaste.
      </p>
      {unsaved && (
        <div className="mt-4">
          <Alert tone="danger" announce>
            Algo no se pudo guardar todavía. Si sales ahora, podrías perder la
            última respuesta.
          </Alert>
        </div>
      )}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className={buttonClass.secondary}
          autoFocus
        >
          Seguir respondiendo
        </button>
        <button
          type="button"
          onClick={unsaved ? () => startLeaving(() => leave()) : exit}
          disabled={leaving}
          className={buttonClass.primary}
        >
          {unsaved ? "Salir de todos modos" : leaving ? "Saliendo…" : "Salir"}
        </button>
      </div>
    </dialog>
  );
}
