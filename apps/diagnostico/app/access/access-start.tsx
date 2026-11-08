"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Alert, Card, buttonClass } from "@/components/ui";
import { ALREADY_SUBMITTED_URL, ROUTES, recoverUrl } from "@/lib/routes";
import { redeemAccessLink } from "./actions";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const readToken = () =>
  new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";

/**
 * Bienvenida. El enlace se canjea al pulsar "Comenzar", no al abrir la página:
 * así un antivirus o la vista previa del correo no lo usan. Al entrar, la
 * navegación reemplaza esta entrada del historial y el token sale de la URL.
 */
export function AccessStart() {
  const router = useRouter();
  // En el servidor no hay fragmento: `null` mientras se hidrata.
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    if (!token) return;
    setError(null);
    startTransition(async () => {
      const result = await redeemAccessLink(token);
      if (result.ok) {
        router.replace(ROUTES.questionnaire);
      } else if (result.status === 401) {
        router.replace(recoverUrl("invalid"));
      } else if (result.code === "DIAGNOSTIC_COMPLETED") {
        router.replace(ALREADY_SUBMITTED_URL);
      } else {
        setError(result.message);
      }
    });
  }

  if (token === "") {
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          El enlace está incompleto
        </h1>
        <Card>
          <p className="text-base leading-relaxed">
            Abre el enlace directamente desde el correo que te enviamos. Si lo
            copiaste a mano, puede haberle faltado una parte.
          </p>
          <Link
            href={ROUTES.recover}
            className={`${buttonClass.secondary} mt-4`}
          >
            Pedir un enlace nuevo
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">
        Te damos la bienvenida a tu diagnóstico SCORE
      </h1>
      <Card>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed">
          <li>Respondes una pregunta a la vez.</li>
          <li>Cada respuesta se guarda sola, sin botón de guardar.</li>
          <li>
            Puedes dejarlo a medias y volver cuando quieras con este mismo
            enlace.
          </li>
          <li>Al final revisas tus respuestas y nos lo envías.</li>
        </ul>
        {error && (
          <div className="mt-5">
            <Alert tone="danger" announce>
              {error}
            </Alert>
          </div>
        )}
        <button
          type="button"
          onClick={start}
          disabled={!token || pending}
          className={`${buttonClass.primary} mt-6 w-full sm:w-auto`}
        >
          {pending ? "Entrando…" : "Comenzar"}
        </button>
      </Card>
    </main>
  );
}
