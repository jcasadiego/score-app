#!/usr/bin/env bash
# Hook PostToolUse (Edit|Write|MultiEdit): formatea y pasa el lint solo sobre el
# archivo que Claude acaba de editar, con las mismas herramientas que el CI.
#   - api: prettier --write + eslint --fix (src/ y test/, como los scripts)
#   - apps/panel y apps/diagnostico: eslint --fix (no usan Prettier)
# Si quedan errores que eslint no corrige solo, sale con 2 para que Claude los
# vea y los arregle. Si faltan node_modules, no hace nada.
set -uo pipefail

input="$(cat)"
file="$(jq -r '.tool_input.file_path // empty' <<<"$input")"
[[ -z "$file" || ! -f "$file" ]] && exit 0

# Normaliza las dos rutas (.., ./ y symlinks) antes de decidir la pieza
project="${CLAUDE_PROJECT_DIR:-$(pwd)}"
project="$(realpath -m -- "$project" 2>/dev/null || printf '%s' "$project")"
file="$(realpath -m -- "$file" 2>/dev/null || printf '%s' "$file")"
rel="${file#"$project"/}"

case "$rel" in
  api/src/*.ts | api/test/*.ts)
    piece="api"
    prettier=1
    ;;
  apps/panel/*.ts | apps/panel/*.tsx | apps/panel/*.mjs | \
  apps/diagnostico/*.ts | apps/diagnostico/*.tsx | apps/diagnostico/*.mjs)
    piece="$(cut -d/ -f1-2 <<<"$rel")"
    prettier=0
    ;;
  *) exit 0 ;;
esac

# Nunca sobre código generado ni dependencias
case "$rel" in
  */node_modules/* | */.next/* | */dist/* | */generated/*) exit 0 ;;
esac

dir="$project/$piece"
bin="$dir/node_modules/.bin"
[[ -x "$bin/eslint" ]] || exit 0

cd "$dir" || exit 0
target="${rel#"$piece"/}"

if [[ "$prettier" == 1 && -x "$bin/prettier" ]]; then
  "$bin/prettier" --write --log-level warn "$target" >/dev/null 2>&1 || true
fi

if ! out="$("$bin/eslint" --fix "$target" 2>&1)"; then
  echo "eslint dejó errores en $rel (corrígelos antes de seguir):" >&2
  echo "$out" | tail -n 30 >&2
  exit 2
fi

exit 0
