#!/usr/bin/env bash
# Pide a Render que despliegue el commit actual con el deploy hook del servicio
# (PF-71). El hook es un secreto: va por stdin a curl (`--config -`), nunca
# como argumento, para que no aparezca en la lista de procesos ni en el log.
#
# Uso: DEPLOY_HOOK=<secreto> render-deploy.sh <servicio>
set -euo pipefail

service="${1:?falta el nombre del servicio}"
if [[ -z "${DEPLOY_HOOK:-}" ]]; then
  echo "::error::Falta el deploy hook de $service en los secretos del ambiente."
  exit 1
fi
: "${GITHUB_SHA:?falta GITHUB_SHA}"

separator='?'
[[ "$DEPLOY_HOOK" == *\?* ]] && separator='&'

# `ref` fija el commit: Render despliega exactamente lo que se fusionó, aunque
# `develop` ya haya avanzado. `--retry` solo repite errores transitorios.
code=$(printf 'url = "%s%sref=%s"\n' "$DEPLOY_HOOK" "$separator" "$GITHUB_SHA" |
  curl --config - --silent --show-error --request POST \
    --output /dev/null --write-out '%{http_code}' \
    --max-time 30 --retry 2 --retry-delay 5) || true

if [[ ! "$code" =~ ^2[0-9][0-9]$ ]]; then
  echo "::error::El deploy hook de $service respondió HTTP ${code:-sin respuesta}. Si se regeneró en Render, actualizar el secreto del ambiente qa."
  exit 1
fi
echo "Despliegue de $service pedido a Render (HTTP $code), commit $GITHUB_SHA."
