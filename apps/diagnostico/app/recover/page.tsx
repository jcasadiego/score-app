import { Alert, Card } from "@/components/ui";
import { RecoverForm } from "./recover-form";

export const metadata = { title: "¿Perdiste tu enlace? — Diagnóstico SCORE" };

const NOTICES = {
  invalid: {
    title: "El enlace no es válido o ya venció",
    body: "Puede que hayas pedido uno más nuevo, o que haya pasado su plazo. Pide otro aquí abajo.",
  },
  session: {
    title: "Tu sesión terminó",
    body: "Tu avance quedó guardado. Vuelve a abrir el enlace de tu correo, o pide uno nuevo aquí abajo.",
  },
} as const;

export default async function RecoverPage({
  searchParams,
}: PageProps<"/recover">) {
  const { reason } = await searchParams;
  const notice =
    reason === "invalid" || reason === "session" ? NOTICES[reason] : null;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">
        ¿Perdiste tu enlace?
      </h1>
      {notice && (
        <Alert tone="info" title={notice.title}>
          {notice.body}
        </Alert>
      )}
      <Card>
        <p className="mb-5 text-base leading-relaxed">
          Escribe tu correo y, si tienes un diagnóstico pendiente, te enviamos
          un enlace nuevo para continuarlo donde lo dejaste.
        </p>
        <RecoverForm />
      </Card>
    </main>
  );
}
