#!/usr/bin/env bash
# Espera a que una URL responda 200 y, si se pasa un filtro de jq, a que el
# cuerpo lo cumpla (PF-71). Tolera el arranque en frío de una instancia
# gratuita de Render (~80 s) y el build del despliegue (3 a 6 minutos).
#
# Uso: wait-for.sh <url> [filtro-jq]
# TIMEOUT_SECONDS (900 por omisión) e INTERVAL_SECONDS (15) ajustan la espera.
set -euo pipefail

url="${1:?falta la URL}"
filter="${2:-}"
timeout="${TIMEOUT_SECONDS:-900}"
interval="${INTERVAL_SECONDS:-15}"
body=$(mktemp)
deadline=$((SECONDS + timeout))
code=''

while ((SECONDS < deadline)); do
  code=$(curl --silent --output "$body" --write-out '%{http_code}' \
    --max-time 120 "$url") || code=''
  if [[ "$code" == 200 ]]; then
    if [[ -z "$filter" ]] || jq -e "$filter" "$body" >/dev/null 2>&1; then
      echo "Listo: $url (${SECONDS}s)."
      exit 0
    fi
  fi
  echo "Esperando $url: HTTP ${code:-sin respuesta} (${SECONDS}s)."
  sleep "$interval"
done

echo "::error::$url no quedó lista en ${timeout}s (última respuesta: HTTP ${code:-sin respuesta})."
exit 1
