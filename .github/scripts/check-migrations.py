"""Detecta migraciones destructivas en un PR (PF-71; docs/infra/
investigacion-despliegue.md, sección 4.2).

Revisa los `migration.sql` agregados o modificados entre la base y la cabeza
del PR. Si alguno borra o reescribe datos, falla salvo que el PR tenga la
etiqueta `migracion-destructiva` y una línea `Migración destructiva: <motivo>`
en la descripción.

Entradas por variables de entorno (nunca interpoladas en el script del
workflow, para que la descripción del PR no pueda inyectar comandos):
BASE_SHA, HEAD_SHA, ALLOWED ("true" si el PR tiene la etiqueta) y PR_BODY.
"""

import os
import re
import subprocess
import sys

MIGRATIONS_DIR = "api/prisma/migrations"
LABEL = "migracion-destructiva"
JUSTIFICATION = re.compile(r"^\s*Migración destructiva:\s*\S", re.IGNORECASE | re.MULTILINE)

DESTRUCTIVE = [
    ("DROP TABLE", re.compile(r"\bDROP\s+TABLE\b", re.IGNORECASE)),
    ("DROP COLUMN", re.compile(r"\bDROP\s+COLUMN\b", re.IGNORECASE)),
    (
        "ALTER COLUMN ... TYPE",
        re.compile(r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b", re.IGNORECASE),
    ),
    ("SET NOT NULL", re.compile(r"\bSET\s+NOT\s+NULL\b", re.IGNORECASE)),
    ("RENAME", re.compile(r"\bRENAME\b", re.IGNORECASE)),
]
# Al inicio de la sentencia: `BEFORE TRUNCATE` en un trigger no borra nada.
TRUNCATE = re.compile(r"^\s*TRUNCATE\b", re.IGNORECASE)
DELETE = re.compile(r"^\s*DELETE\s+FROM\b", re.IGNORECASE)
WHERE = re.compile(r"\bWHERE\b", re.IGNORECASE)


def strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", "", sql)


def findings(sql: str) -> list[str]:
    sql = strip_comments(sql)
    found = [name for name, pattern in DESTRUCTIVE if pattern.search(sql)]
    # Partir por `;` es aproximado (no entiende cuerpos de funciones), pero
    # alcanza para avisar: ante la duda, falla y lo revisa una persona.
    statements = sql.split(";")
    if any(TRUNCATE.search(statement) for statement in statements):
        found.append("TRUNCATE")
    if any(DELETE.search(s) and not WHERE.search(s) for s in statements):
        found.append("DELETE sin WHERE")
    return found


def changed_migrations(base: str, head: str) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=AM", f"{base}...{head}", "--", MIGRATIONS_DIR],
        check=True,
        capture_output=True,
        text=True,
    )
    return [path for path in result.stdout.split() if path.endswith("/migration.sql")]


def main() -> int:
    base, head = os.environ["BASE_SHA"], os.environ["HEAD_SHA"]
    report = {}
    for path in changed_migrations(base, head):
        with open(path, encoding="utf-8") as file:
            found = findings(file.read())
        if found:
            report[path] = found

    if not report:
        print("Sin migraciones destructivas.")
        return 0

    for path, found in report.items():
        print(f"{path}: {', '.join(found)}")

    allowed = os.environ.get("ALLOWED") == "true"
    justified = bool(JUSTIFICATION.search(os.environ.get("PR_BODY", "")))
    if allowed and justified:
        print(f"Permitido: el PR tiene la etiqueta `{LABEL}` y la justificación.")
        return 0

    print(
        f"::error::Migración destructiva. Si es intencional, escribe en la "
        f"descripción del PR una línea `Migración destructiva: <motivo>` y "
        f"después agrega la etiqueta `{LABEL}` (agregarla vuelve a correr este "
        f"check; editar la descripción no). Ver el patrón expand/contract en "
        f"docs/infra/investigacion-despliegue.md, sección 4.2."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
