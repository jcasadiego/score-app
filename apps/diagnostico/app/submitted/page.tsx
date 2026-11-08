import { Card } from "@/components/ui";

export const metadata = { title: "Diagnóstico enviado — SCORE" };

export default async function SubmittedPage({
  searchParams,
}: PageProps<"/submitted">) {
  const { state } = await searchParams;
  const already = state === "already";

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">
        {already ? "Este diagnóstico ya fue enviado" : "¡Recibimos tu diagnóstico!"}
      </h1>
      <Card>
        <p className="text-base leading-relaxed">
          {already
            ? "Ya no se puede modificar. Si necesitas cambiar algo, responde al correo en el que te llegó el enlace."
            : "Gracias por completarlo. El equipo de Music Finance Pro lo va a revisar y te contactará con los resultados."}
        </p>
        {!already && (
          <p className="mt-4 text-base leading-relaxed text-ink-muted">
            Tus respuestas ya no se pueden modificar. Puedes cerrar esta
            página.
          </p>
        )}
      </Card>
    </main>
  );
}
