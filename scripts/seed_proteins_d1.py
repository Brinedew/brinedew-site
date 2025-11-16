#!/usr/bin/env python3
"""
Populate the geneguessr D1 database from workers/data/proteins.json.

Usage:
    python scripts/seed_proteins_d1.py
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable, List, Optional

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except OSError:
        pass

ROOT = Path(__file__).resolve().parents[1]
PROTEINS_PATH = ROOT / "workers" / "data" / "proteins.json"

PDB_COVERAGE_THRESHOLD = 0.6
SWISS_MODEL_COVERAGE_THRESHOLD = 0.6
SWISS_MODEL_QMEAN_THRESHOLD = 0.7

CHAIN_SPLITTER = re.compile(r"[;,]")


def parse_chain_segments(spec: Optional[str]):
    if not spec:
        return []
    segments = []
    for part in CHAIN_SPLITTER.split(spec):
        part = part.strip()
        if not part or "=" not in part:
            continue
        _, range_token = part.split("=", 1)
        range_token = range_token.strip()
        if "-" not in range_token:
            continue
        start_token, end_token = range_token.split("-", 1)
        try:
            start = int(start_token.strip())
            end = int(end_token.strip())
        except ValueError:
            continue
        length = abs(end - start) + 1
        if length > 0:
            segments.append(length)
    return segments


def compute_pdb_coverage(pdb_entry, protein_length):
    if not pdb_entry:
        return 0.0
    if not isinstance(protein_length, (int, float)) or protein_length <= 0:
        return 1.0
    segments = parse_chain_segments(pdb_entry.get("chains"))
    covered = sum(segments)
    if covered <= 0:
        return 0.0
    return min(1.0, covered / protein_length)


def extract_swiss_quality(model):
    if not model:
        return None
    candidates = [
        model.get("qmean"),
        model.get("qmeanDisCo_global"),
        model.get("qmean_dis_co_global"),
        model.get("quality", {}).get("qmeanDisCo_global"),
        model.get("quality", {}).get("qmean_dis_co_global"),
        model.get("qmean", {}).get("qmeanDisCo_global") if isinstance(model.get("qmean"), dict) else None,
        model.get("qmean", {}).get("qmean_dis_co_global") if isinstance(model.get("qmean"), dict) else None,
        model.get("qmean", {}).get("qmean4_norm_score") if isinstance(model.get("qmean"), dict) else None,
        model.get("qmean", {}).get("avg_local_score") if isinstance(model.get("qmean"), dict) else None,
    ]
    for value in candidates:
        if isinstance(value, (int, float)):
            return float(value)
    return None


def compute_swiss_coverage(model, protein_length):
    if not model:
        return 0.0
    if isinstance(model.get("coverage"), (int, float)):
        return float(model["coverage"])
    if not isinstance(protein_length, (int, float)) or protein_length <= 0:
        return 0.0
    start = model.get("uniprot_start") or model.get("uniprot_from") or model.get("start") or model.get("from")
    end = model.get("uniprot_end") or model.get("uniprot_to") or model.get("end") or model.get("to")
    try:
        start = int(start)
        end = int(end)
    except (TypeError, ValueError):
        return 0.0
    span = abs(end - start) + 1
    return min(1.0, span / protein_length) if span > 0 else 0.0


def determine_structure(structure, protein_length):
    if not structure:
        return 0, None
    pdb_entry = structure.get("pdb")
    swiss_entry = structure.get("swiss_model")
    alphafold_entry = structure.get("alphafold")

    pdb_coverage = compute_pdb_coverage(pdb_entry, protein_length) if pdb_entry else 0.0
    if pdb_entry and pdb_coverage >= PDB_COVERAGE_THRESHOLD:
        return 1, "pdb"

    if swiss_entry:
        swiss_coverage = compute_swiss_coverage(swiss_entry, protein_length)
        swiss_quality = extract_swiss_quality(swiss_entry)
        if (
            swiss_coverage >= SWISS_MODEL_COVERAGE_THRESHOLD
            and (swiss_quality is None or swiss_quality >= SWISS_MODEL_QMEAN_THRESHOLD)
        ):
            return 1, "swissmodel"

    if alphafold_entry and alphafold_entry.get("model_url"):
        return 0, "alphafold"

    if swiss_entry:
        return 0, "swissmodel"
    if pdb_entry:
        return 0, "pdb"
    return 0, None

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
        has_structure, structure_source = determine_structure(structure, length)
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
