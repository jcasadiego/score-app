"use client";

import {
  useEffect,
  useEffectEvent,
  useState,
  type CSSProperties,
} from "react";
import { Input } from "antd";

/** Pausa al escribir antes de buscar: evita una petición por tecla. */
const ESPERA_MS = 300;

interface BuscadorReactivoProps {
  /** Búsqueda que ya está en la URL, solo como valor inicial. */
  valorInicial: string;
  onBuscar: (q: string) => void;
  placeholder: string;
  ariaLabel: string;
  cargando?: boolean;
  style?: CSSProperties;
  /** Al cambiar, vacía el buscador (p. ej. tras "Limpiar filtros"). */
  reinicio?: number;
}

/**
 * Busca mientras se escribe, tras una pausa corta; Enter y la "x" buscan
 * al instante. El texto vive aquí y no se resincroniza con la URL: si lo
 * hiciera, una navegación vieja que llega tarde pisaría lo que el usuario
 * sigue escribiendo. Para vaciarlo desde fuera (p. ej. "Limpiar
 * filtros"), el padre cambia `reinicio` — remontarlo con `key` no sirve:
 * tomaría como valor inicial la búsqueda vieja, que sigue en la URL hasta
 * que termine la navegación.
 */
export function BuscadorReactivo({
  valorInicial,
  onBuscar,
  placeholder,
  ariaLabel,
  cargando,
  style,
  reinicio = 0,
}: BuscadorReactivoProps) {
  const [texto, setTexto] = useState(valorInicial);
  const [enviado, setEnviado] = useState(valorInicial);
  const [reinicioPrevio, setReinicioPrevio] = useState(reinicio);

  if (reinicio !== reinicioPrevio) {
    setReinicioPrevio(reinicio);
    setTexto("");
    setEnviado("");
  }

  function enviar(valor: string) {
    const q = valor.trim();
    if (q === enviado) return;
    setEnviado(q);
    onBuscar(q);
  }

  const enviarTrasPausa = useEffectEvent(() => enviar(texto));

  useEffect(() => {
    if (texto.trim() === enviado) return;
    const temporizador = setTimeout(enviarTrasPausa, ESPERA_MS);
    return () => clearTimeout(temporizador);
  }, [texto, enviado]);

  return (
    <Input.Search
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onSearch={enviar}
      placeholder={placeholder}
      aria-label={ariaLabel}
      allowClear
      maxLength={100}
      loading={cargando}
      style={style}
    />
  );
}
