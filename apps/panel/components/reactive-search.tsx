"use client";

import {
  useEffect,
  useEffectEvent,
  useState,
  type CSSProperties,
} from "react";
import { Input } from "antd";

/** Pausa al escribir antes de buscar: evita una petición por tecla. */
const DEBOUNCE_MS = 300;

interface ReactiveSearchProps {
  /** Búsqueda que ya está en la URL, solo como valor inicial. */
  initialValue: string;
  onSearch: (q: string) => void;
  placeholder: string;
  ariaLabel: string;
  loading?: boolean;
  style?: CSSProperties;
  /** Al cambiar, vacía el buscador (p. ej. tras "Limpiar filtros"). */
  resetKey?: number;
}

/**
 * Busca mientras se escribe, tras una pausa corta; Enter y la "x" buscan
 * al instante. El texto vive aquí y no se resincroniza con la URL: si lo
 * hiciera, una navegación vieja que llega tarde pisaría lo que el usuario
 * sigue escribiendo. Para vaciarlo desde fuera (p. ej. "Limpiar
 * filtros"), el padre cambia `resetKey` — remontarlo con `key` no sirve:
 * tomaría como valor inicial la búsqueda vieja, que sigue en la URL hasta
 * que termine la navegación.
 */
export function ReactiveSearch({
  initialValue,
  onSearch,
  placeholder,
  ariaLabel,
  loading,
  style,
  resetKey = 0,
}: ReactiveSearchProps) {
  const [text, setText] = useState(initialValue);
  const [submitted, setSubmitted] = useState(initialValue);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setText("");
    setSubmitted("");
  }

  function submit(value: string) {
    const q = value.trim();
    if (q === submitted) return;
    setSubmitted(q);
    onSearch(q);
  }

  const submitAfterPause = useEffectEvent(() => submit(text));

  useEffect(() => {
    if (text.trim() === submitted) return;
    const timer = setTimeout(submitAfterPause, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, submitted]);

  return (
    <Input.Search
      value={text}
      onChange={(e) => setText(e.target.value)}
      onSearch={submit}
      placeholder={placeholder}
      aria-label={ariaLabel}
      allowClear
      maxLength={100}
      loading={loading}
      style={style}
    />
  );
}
