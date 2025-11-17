#!/usr/bin/env python3
"""
Seed the Geneguessr D1 database with proteins + embeddings derived from the
HiG2Vec dataset so metadata and vectors stay in sync.

Usage:
    python scripts/load_proteins_from_embeddings.py [--remote]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.append(str(SCRIPT_DIR))

import torch

from protein_seed_utils import determine_structure, iter_synonyms, sql_literal

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except OSError:
        pass

ROOT = SCRIPT_DIR.parent
PROTEINS_JSON = ROOT / "workers" / "data" / "proteins.json"
EMBEDDING_PATH = ROOT / "tools" / "thoteins" / "data" / "embeddings" / "hig2vec_human_200dim.pth"
EXPECTED_DIM = 200
SAMPLE_UNIPROT = "P02671"


def normalize_token(value) -> str:
    if value is None:
        return ""
    return str(value).strip().upper()


def tensor_to_hex(tensor: torch.Tensor) -> str:
    arr = tensor.detach().cpu().to(torch.float32).numpy()
    return arr.tobytes().hex()


def collect_metadata() -> List[dict]:
    if not PROTEINS_JSON.exists():
        raise SystemExit(f"Missing metadata at {PROTEINS_JSON}")
    data = json.loads(PROTEINS_JSON.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("proteins.json must contain an array of objects")
    return data


def collect_candidate_tokens(entry: dict) -> Iterable[str]:
    seen = set()
    for field in ("uniprot", "hgnc", "full_name"):
        token = normalize_token(entry.get(field))
        if token and token not in seen:
            seen.add(token)
            yield token
    for raw in entry.get("synonyms") or []:
        token = normalize_token(raw)
        if token and token not in seen:
            seen.add(token)
            yield token


def build_vector_lookup() -> Tuple[Dict[str, str], int]:
    if not EMBEDDING_PATH.exists():
        raise SystemExit(f"Missing embedding file at {EMBEDDING_PATH}")
    model = torch.load(EMBEDDING_PATH, map_location="cpu")
    objects = model.get("objects")
    embeddings = model.get("embeddings")
    if objects is None or embeddings is None:
        raise SystemExit("Embedding file missing required keys ('objects', 'embeddings')")
    if getattr(embeddings, "ndim", 0) != 2:
        raise SystemExit("Embedding tensor must be 2D")
    dim = int(embeddings.shape[1])
    if dim != EXPECTED_DIM:
        raise SystemExit(f"Expected {EXPECTED_DIM}-dimensional embeddings, got {dim}")
    lookup: Dict[str, str] = {}
    for idx, raw_name in enumerate(objects):
        if not isinstance(raw_name, str):
            continue
        token = normalize_token(raw_name)
        if not token or token.startswith("GO:"):
            continue
        if token in lookup:
            continue
        lookup[token] = tensor_to_hex(embeddings[idx])
    return lookup, dim


def build_records(metadata: Sequence[dict], lookup: Dict[str, str], dim: int) -> Tuple[List[dict], List[str]]:
    records: List[dict] = []
    missing: List[str] = []
    seen_uniprot = set()
    for entry in metadata:
        uniprot = entry.get("uniprot")
        if not uniprot:
            continue
        normalized_id = normalize_token(uniprot)
        if normalized_id in seen_uniprot:
            continue
        vector_hex = None
        for token in collect_candidate_tokens(entry):
            vector_hex = lookup.get(token)
            if vector_hex:
                break
        if not vector_hex:
            missing.append(uniprot)
            continue
        seen_uniprot.add(normalized_id)
        metadata_text = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        structure = entry.get("structure") or {}
        has_structure, structure_source = determine_structure(structure, entry.get("length"))
        records.append(
            {
                "entry": entry,
                "uniprot": uniprot,
                "hgnc": entry.get("hgnc"),
                "full_name": entry.get("full_name"),
                "length": entry.get("length"),
                "has_structure": has_structure,
                "structure_source": structure_source,
                "metadata": metadata_text,
                "vector_hex": vector_hex,
                "dim": dim,
            }
        )
    return records, missing


def build_sql(records: Sequence[dict], transactional: bool = True) -> List[str]:
    statements: List[str] = []
    if transactional:
        statements.append("BEGIN TRANSACTION;")
    statements.extend(
        [
            "DELETE FROM protein_embeddings;",
            "DELETE FROM protein_synonyms;",
            "DELETE FROM proteins;",
        ]
    )
    for record in records:
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
            sql_literal(record["uniprot"]),
            sql_literal(record["hgnc"]),
            sql_literal(record["full_name"]),
            sql_literal(record["length"]),
            sql_literal(record["has_structure"]),
            sql_literal(record["structure_source"]),
            sql_literal(record["metadata"]),
        ]
        statements.append(f"INSERT INTO proteins ({', '.join(columns)}) VALUES ({', '.join(values)});")
        for synonym, normalized in iter_synonyms(record["entry"]):
            statements.append(
                "INSERT INTO protein_synonyms (protein_id, synonym, normalized) "
                f"SELECT id, {sql_literal(synonym)}, {sql_literal(normalized)} "
                f"FROM proteins WHERE uniprot = {sql_literal(record['uniprot'])};"
            )
        statements.append(
            "INSERT INTO protein_embeddings (protein_id, dim, vector) "
            f"SELECT id, {record['dim']}, x'{record['vector_hex']}' "
            f"FROM proteins WHERE uniprot = {sql_literal(record['uniprot'])};"
        )
    if transactional:
        statements.append("COMMIT;")
    statements.append(f"-- Loaded {len(records)} proteins with embeddings")
    return statements


def resolve_wrangler() -> str:
    wrangler = shutil.which("wrangler") or shutil.which("wrangler.cmd")
    if not wrangler:
        raise SystemExit("wrangler CLI not found in PATH")
    return wrangler


def execute_sql(statements: Sequence[str], remote: bool) -> None:
    wrangler = resolve_wrangler()
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".sql") as tmp:
        tmp.write("\n".join(statements))
        tmp_path = Path(tmp.name)
    try:
        command = [wrangler, "d1", "execute", "geneguessr"]
        if remote:
            command.append("--remote")
        command.extend(["--file", str(tmp_path)])
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(ROOT),
        )
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            raise SystemExit(f"wrangler exited with {result.returncode}")
    finally:
        tmp_path.unlink(missing_ok=True)


def run_query(sql: str, remote: bool) -> List[dict]:
    wrangler = resolve_wrangler()
    command = [wrangler, "d1", "execute", "geneguessr"]
    if remote:
        command.append("--remote")
    command.extend(["--command", sql, "--json"])
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        print(result.stderr)
        raise SystemExit(f"wrangler exited with {result.returncode}")
    payload = result.stdout.strip()
    if not payload:
        return []
    data = json.loads(payload)
    if not data.get("success", False):
        raise SystemExit(f"D1 query failed: {payload}")
    return data.get("results") or []


def validate_counts(expected: int, remote: bool) -> None:
    sql = (
        "SELECT "
        "(SELECT COUNT(*) FROM proteins) AS proteins, "
        "(SELECT COUNT(*) FROM protein_embeddings) AS embeddings, "
        "(SELECT COUNT(*) FROM protein_synonyms) AS synonyms;"
    )
    results = run_query(sql, remote)
    if not results:
        raise SystemExit("Validation query returned no rows")
    row = results[0]
    proteins = row.get("proteins")
    embeddings = row.get("embeddings")
    if proteins != expected or embeddings != expected:
        raise SystemExit(
            f"Validation failed: expected {expected} proteins/embeddings, "
            f"found proteins={proteins}, embeddings={embeddings}"
        )


def validate_sample(remote: bool) -> None:
    sql = f"SELECT uniprot, hgnc FROM proteins WHERE upper(uniprot) = {sql_literal(SAMPLE_UNIPROT)};"
    results = run_query(sql, remote)
    if not results:
        raise SystemExit(f"Validation failed: {SAMPLE_UNIPROT} not present in proteins table")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true", help="Execute against the remote D1 database")
    args = parser.parse_args()

    metadata = collect_metadata()
    lookup, dim = build_vector_lookup()
    records, missing = build_records(metadata, lookup, dim)
    if not records:
        raise SystemExit("No proteins had matching embeddings; aborting")
    statements = build_sql(records, transactional=not args.remote)

    print(f"[loader] Preparing to write {len(records)} proteins with dim={dim}")
    if missing:
        print(f"[loader] Warning: {len(missing)} proteins lacked embeddings ({', '.join(missing[:5])} ...)")

    execute_sql(statements, remote=args.remote)
    validate_counts(len(records), remote=args.remote)
    validate_sample(remote=args.remote)
    print("[loader] Validation succeeded.")


if __name__ == "__main__":
    main()
