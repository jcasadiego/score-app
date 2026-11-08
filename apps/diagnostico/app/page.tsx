import Link from "next/link";
import { Alert, Card, buttonClass } from "@/components/ui";
import { ROUTES } from "@/lib/routes";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { left } = await searchParams;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">
        Tu diagnóstico SCORE
      </h1>
      {left === "1" && (
        <Alert tone="success" title="Tu avance quedó guardado">
          Puedes volver cuando quieras con el enlace que te enviamos por correo.
        </Alert>
      )}
      <Card>
        <p className="text-base leading-relaxed">
          Para responder tu diagnóstico, abre el enlace que te enviamos por
          correo. No necesitas crear una cuenta ni una contraseña.
        </p>
        <p className="mt-4 text-base leading-relaxed text-ink-muted">
          ¿No encuentras el correo?
        </p>
        <Link href={ROUTES.recover} className={`${buttonClass.secondary} mt-3`}>
          Pedir un enlace nuevo
        </Link>
      </Card>
    </main>
  );
}
