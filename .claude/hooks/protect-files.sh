#!/usr/bin/env bash
# Hook PreToolUse (Edit|Write|MultiEdit|NotebookEdit): impide que Claude edite
# archivos que no se tocan a mano.
#   - .env y .env.* con secretos (los .env.example sí se pueden editar)
#   - pnpm-lock.yaml (cambia solo con pnpm install / pnpm update)
#   - migraciones de Prisma que ya están en origin/develop (ya aplicadas en QA:
#     se corrige con una migración nueva, nunca editando la vieja). Compara con
#     el origin/develop local: sin un git fetch reciente, una migración recién
#     mergeada todavía no se detecta.
# Salir con 2 bloquea la herramienta y le muestra el motivo a Claude.
# No cubre comandos de Bash (sed, >, etc.): es una red de seguridad, no un control.
set -euo pipefail

# Sin jq no se puede leer la ruta: se bloquea en vez de dejar pasar la edición
command -v jq >/dev/null 2>&1 || {
  echo "Bloqueado por .claude/hooks/protect-files.sh: falta jq, instálalo para poder editar." >&2
  exit 2
}

input="$(cat)"
file="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")" || {
  echo "Bloqueado por .claude/hooks/protect-files.sh: no se pudo leer la ruta del archivo." >&2
  exit 2
}
[[ -z "$file" ]] && exit 0

# Normaliza las dos rutas (.., ./ y symlinks) para que la comparación no se salte
project="${CLAUDE_PROJECT_DIR:-$(pwd)}"
project="$(realpath -m -- "$project" 2>/dev/null || printf '%s' "$project")"
file="$(realpath -m -- "$file" 2>/dev/null || printf '%s' "$file")"
# Ruta relativa al repo (si el archivo está fuera, se deja absoluta)
rel="${file#"$project"/}"
name="$(basename "$file")"

block() {
  echo "Bloqueado por .claude/hooks/protect-files.sh: $1" >&2
  exit 2
}

if [[ "$name" =~ ^\.env(\..+)?$ && "$name" != ".env.example" ]]; then
  block "'$rel' tiene secretos locales. Las variables nuevas van en el .env.example de la pieza; los valores reales los pone José."
fi

if [[ "$name" == "pnpm-lock.yaml" ]]; then
  block "'$rel' se regenera con pnpm (install/add/update) dentro de la pieza, no se edita a mano."
fi

if [[ "$rel" == api/prisma/migrations/* ]]; then
  if git -C "$project" cat-file -e "origin/develop:$rel" 2>/dev/null; then
    block "'$rel' ya está en develop (aplicada en QA). Crea una migración nueva en lugar de editarla."
  fi
fi

exit 0
