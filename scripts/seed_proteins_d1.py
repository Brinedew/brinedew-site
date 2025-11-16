#!/usr/bin/env python3
"""
Populate the geneguessr D1 database from workers/data/proteins.json.

Usage:
    python scripts/seed_proteins_d1.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable, List

import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except OSError:
        pass

ROOT = Path(__file__).resolve().parents[1]
PROTEINS_PATH = ROOT / "workers" / "data" / "proteins.json"


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def iter_synonyms(entry: dict) -> Iterable[str]:
    seen_norm = set()
    candidates = []
    candidates.extend(entry.get("synonyms") or [])
    candidates.append(entry.get("hgnc"))
    candidates.append(entry.get("full_name"))
    for raw in candidates:
        if not raw:
            continue
        synonym = str(raw)
        normalized = synonym.lower().strip()
        if not normalized or normalized in seen_norm:
            continue
        seen_norm.add(normalized)
        yield synonym, normalized


def build_sql(use_transactions: bool = True) -> List[str]:
    data = json.loads(PROTEINS_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("proteins.json should be an array")

    statements: List[str] = []
    if use_transactions:
        statements.append("BEGIN TRANSACTION;")
    statements.extend(
        [
            "DELETE FROM protein_synonyms;",
            "DELETE FROM proteins;",
        ]
    )

    for entry in data:
        uniprot = entry.get("uniprot")
        if not uniprot:
            continue
        hgnc = entry.get("hgnc")
        full_name = entry.get("full_name")
        length = entry.get("length")
        structure = entry.get("structure") or {}
        has_structure = 1 if structure else 0
        structure_source = structure.get("primary_source")
        metadata = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))

        columns = [
            "uniprot",
            "hgnc",
            "full_name",
            "length",
            "has_structure",
            "structure_source",
            "metadata",
        ]
        values = [
            sql_literal(uniprot),
            sql_literal(hgnc),
            sql_literal(full_name),
            sql_literal(length),
            sql_literal(has_structure),
            sql_literal(structure_source),
            sql_literal(metadata),
        ]
        statements.append(
            f"INSERT INTO proteins ({', '.join(columns)}) VALUES ({', '.join(values)});"
        )

        for synonym, normalized in iter_synonyms(entry):
            statements.append(
                "INSERT INTO protein_synonyms (protein_id, synonym, normalized) "
                f"SELECT id, {sql_literal(synonym)}, {sql_literal(normalized)} "
                f"FROM proteins WHERE uniprot = {sql_literal(uniprot)};"
            )

    if use_transactions:
        statements.append("COMMIT;")
    statements.append(f"-- Inserted {len(data)} proteins")
    return statements


def main() -> None:
    if not PROTEINS_PATH.exists():
        raise SystemExit(f"Missing {PROTEINS_PATH}")

    remote = "--remote" in sys.argv
    sql_statements = build_sql(use_transactions=not remote)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".sql") as tmp:
        tmp.write("\n".join(sql_statements))
        tmp_path = Path(tmp.name)

    wrangler = shutil.which("wrangler") or shutil.which("wrangler.cmd")
    if not wrangler:
        raise SystemExit("wrangler CLI not found in PATH")

    command = [wrangler, "d1", "execute", "geneguessr"]
    if remote:
        command.append("--remote")
    command.extend(["--file", str(tmp_path)])

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            cwd=str(ROOT),
        )
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            raise SystemExit(f"wrangler exited with {result.returncode}")
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
