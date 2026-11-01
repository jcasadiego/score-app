"use client";

import { useSyncExternalStore } from "react";

const formatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

const subscribeNoop = () => () => {};

/**
 * Fecha en la zona horaria del navegador. El servidor no la conoce, así
 * que en el render del servidor (y en la hidratación) muestra solo el día
 * en UTC, y el cliente la reemplaza — sin esto, formatear en los dos lados
 * da un error de hidratación cuando las zonas no coinciden.
 */
export function LocalDate({ iso }: { iso: string }) {
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  return (
    <time dateTime={iso}>
      {isClient ? formatter.format(new Date(iso)) : iso.slice(0, 10)}
    </time>
  );
}
