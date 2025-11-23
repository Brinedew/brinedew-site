#!/usr/bin/env python3
"""
Seed the Geneguessr D1 database with proteins + embeddings derived from the
HiG2Vec dataset so metadata and vectors stay in sync.

Loads protein metadata and embeddings, builds SQL, and seeds Cloudflare D1 via Wrangler CLI.

Note: This script is for local/manual use only. Do not run as part of CI/CD workflows.
Run locally after updating embeddings or metadata. Large files are not tracked in git.

Usage:
    python scripts/upload_local_database.py [--remote] [--metadata-file PATH]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.append(str(SCRIPT_DIR))
# Also ensure the repo-level `scripts/` directory is on sys.path so shared helpers
# (e.g. scripts/protein_seed_utils.py) can be imported when running from the repo root.
REPO_SCRIPTS = SCRIPT_DIR.parent.parent.parent / "scripts"
if str(REPO_SCRIPTS) not in sys.path:
    sys.path.append(str(REPO_SCRIPTS))

import torch

from protein_seed_utils import determine_structure, iter_synonyms, sql_literal

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except OSError:
        pass

ROOT = SCRIPT_DIR.parent.parent.parent
GENEGUESSR_DATA_DIR = ROOT / "tools" / "thoteins" / "data" / "geneguessr"
PROTEINS_JSON = GENEGUESSR_DATA_DIR / "proteins.json"
EMBEDDING_PATH = ROOT / "tools" / "thoteins" / "data" / "embeddings" / "hig2vec_human_200dim.pth"
EXPECTED_DIM = 200
SAMPLE_UNIPROT = "P02671"


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_token(value) -> str:
    if value is None:
        return ""
    return str(value).strip().upper()


def tensor_to_hex(tensor: torch.Tensor) -> str:
    arr = tensor.detach().cpu().to(torch.float32).numpy()
    return arr.tobytes().hex()


def collect_metadata(path: Optional[Path] = None) -> List[dict]:
    metadata_path = PROTEINS_JSON if path is None else Path(path)
    if not metadata_path.exists():
        raise SystemExit(f"Missing metadata at {metadata_path}")
    data = json.loads(metadata_path.read_text(encoding="utf-8"))
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


def collect_needed_tokens(metadata: Optional[Sequence[dict]]) -> Set[str]:
    if not metadata:
        return set()
    tokens: Set[str] = set()
    for entry in metadata:
        for token in collect_candidate_tokens(entry):
            tokens.add(token)
    return tokens


def build_vector_lookup(metadata: Optional[Sequence[dict]] = None) -> Tuple[Dict[str, str], int, Dict[str, object]]:
    if not EMBEDDING_PATH.exists():
        raise SystemExit(f"Missing embedding file at {EMBEDDING_PATH}")
    needed = collect_needed_tokens(metadata)

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
    stats = {
        "objects": len(objects) if hasattr(objects, "__len__") else 0,
        "skipped_go": 0,
        "skipped_nonstring": 0,
        "deduped": 0,
        "file_sha256": hash_file(EMBEDDING_PATH),
        "file_size": EMBEDDING_PATH.stat().st_size,
    }
    needed_hits = 0
    for idx, raw_name in enumerate(objects):
        if not isinstance(raw_name, str):
            stats["skipped_nonstring"] += 1
            continue
        token = normalize_token(raw_name)
        if not token:
            stats["skipped_nonstring"] += 1
            continue
        if token.startswith("GO:"):
            stats["skipped_go"] += 1
            continue
        if token in lookup:
            stats["deduped"] += 1
            continue
        lookup[token] = tensor_to_hex(embeddings[idx])
        needed_hits += 1
        if needed and needed_hits % 2000 == 0:
            print(f"[loader] Embedded {needed_hits}/{len(needed)} needed tokens (tracking only).")
    stats["vectors"] = len(lookup)
    # Release tensor memory promptly
    del embeddings
    del model
    return lookup, dim, stats


def build_records(metadata: Sequence[dict], lookup: Dict[str, str], dim: int) -> Tuple[List[dict], List[str]]:
    records: List[dict] = []
    missing: List[str] = []
    seen_uniprot = set()
    used_tokens = set()
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
                used_tokens.add(token)
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
    # Add placeholder entries for embedding tokens that lack metadata to keep embeddings the source of truth
    unused_tokens = set(lookup.keys()) - used_tokens
    for token in sorted(unused_tokens):
        records.append(
            {
                "entry": {},
                "uniprot": token,
                "hgnc": None,
                "full_name": None,
                "length": None,
                "has_structure": False,
                "structure_source": None,
                "metadata": "{}",
                "vector_hex": lookup[token],
                "dim": dim,
            }
        )
    return records, missing


def _write_sql_chunk(
    records: Sequence[dict],
    *,
    include_delete: bool,
    transactional: bool,
    chunk_label: str,
    total: int,
) -> Path:
    """
    Write a chunk of SQL statements to a temp file.
    """
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".sql") as tmp:
        if transactional:
            tmp.write("BEGIN TRANSACTION;\n")
        if include_delete:
            tmp.write("DELETE FROM protein_embeddings;\nDELETE FROM protein_synonyms;\nDELETE FROM proteins;\n")
        for idx, record in enumerate(records, start=1):
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
            tmp.write(f"INSERT INTO proteins ({', '.join(columns)}) VALUES ({', '.join(values)});\n")
            for synonym, normalized in iter_synonyms(record["entry"]):
                tmp.write(
                    "INSERT INTO protein_synonyms (protein_id, synonym, normalized) "
                    f"SELECT id, {sql_literal(synonym)}, {sql_literal(normalized)} "
                    f"FROM proteins WHERE uniprot = {sql_literal(record['uniprot'])};\n"
                )
            tmp.write(
                "INSERT INTO protein_embeddings (protein_id, dim, vector) "
                f"SELECT id, {record['dim']}, x'{record['vector_hex']}' "
                f"FROM proteins WHERE uniprot = {sql_literal(record['uniprot'])};\n"
            )
            if (idx % 500) == 0:
                tmp.flush()
                print(f"[loader] Wrote SQL for chunk {chunk_label}: {idx}/{len(records)} in chunk (total {total})")
        if transactional:
            tmp.write("COMMIT;\n")
        tmp.write(f"-- Loaded {len(records)} proteins in chunk {chunk_label}\n")
        return Path(tmp.name)


def write_sql_chunks(records: Sequence[dict], transactional: bool = True, chunk_size: int = 1000) -> List[Path]:
    """
    Stream SQL in smaller chunks to avoid local D1 hash index issues.
    """
    paths: List[Path] = []
    total = len(records)
    for start in range(0, total, chunk_size):
        end = min(start + chunk_size, total)
        chunk = records[start:end]
        label = f"{start+1}-{end}"
        include_delete = start == 0
        path = _write_sql_chunk(
            chunk,
            include_delete=include_delete,
            transactional=transactional,
            chunk_label=label,
            total=total,
        )
        paths.append(path)
    return paths


def resolve_wrangler() -> str:
    wrangler = shutil.which("wrangler") or shutil.which("wrangler.cmd")
    if not wrangler:
        raise SystemExit("wrangler CLI not found in PATH")
    return wrangler


def execute_sql(sql_paths: Sequence[Path], remote: bool) -> None:
    wrangler = resolve_wrangler()
    try:
        for path in sql_paths:
            command = [wrangler, "d1", "execute", "geneguessr"]
            if remote:
                command.append("--remote")
            command.extend(["--file", str(path)])
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
        for path in sql_paths:
            path.unlink(missing_ok=True)


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
    if isinstance(data, list):
        if not data:
            return []
        first = data[0]
    elif isinstance(data, dict):
        first = data
    else:
        raise SystemExit(f"Unexpected D1 response: {payload}")
    if not first.get("success", False):
        raise SystemExit(f"D1 query failed: {payload}")
    return first.get("results") or []


def validate_counts(expected: int, remote: bool) -> Dict[str, object]:
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
    return row


def validate_sample(remote: bool) -> Dict[str, object]:
    sql = f"SELECT uniprot, hgnc FROM proteins WHERE upper(uniprot) = {sql_literal(SAMPLE_UNIPROT)};"
    results = run_query(sql, remote)
    if not results:
        raise SystemExit(f"Validation failed: {SAMPLE_UNIPROT} not present in proteins table")
    return results[0]


def print_validation_report(
    metadata_total: int,
    inserted: int,
    missing: Sequence[str],
    embedding_stats: Dict[str, object],
    counts_row: Dict[str, object],
    sample_row: Dict[str, object],
) -> None:
    missing_count = len(missing)
    missing_preview = ", ".join(missing[:5])
    size_mb = embedding_stats["file_size"] / (1024 * 1024)
    print(
        "[stats] Metadata entries=%d | matched embeddings=%d | missing embeddings=%d%s"
        % (
            metadata_total,
            inserted,
            missing_count,
            f" ({missing_preview} ...)" if missing_preview else "",
        )
    )
    print(
        "[stats] Embedding file %s | sha256=%s | size=%.2f MB | objects=%s | usable vectors=%s | skipped GO=%s | skipped/invalid=%s | deduped=%s"
        % (
            EMBEDDING_PATH.name,
            str(embedding_stats.get("file_sha256", ""))[:16],
            size_mb,
            embedding_stats.get("objects"),
            embedding_stats.get("vectors"),
            embedding_stats.get("skipped_go"),
            embedding_stats.get("skipped_nonstring"),
            embedding_stats.get("deduped"),
        )
    )
    print(
        "[stats] D1 row counts => proteins=%s | embeddings=%s | synonyms=%s"
        % (
            counts_row.get("proteins"),
            counts_row.get("embeddings"),
            counts_row.get("synonyms"),
        )
    )
    if sample_row:
        print(
            "[stats] Sample %s => HGNC=%s"
            % (SAMPLE_UNIPROT, sample_row.get("hgnc") or "unknown")
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true", help="Execute against the remote D1 database")
    parser.add_argument(
        "--metadata-file",
        dest="metadata_file",
        type=str,
        default=None,
        help=(
            "Optional path to a metadata JSON file. "
            "Defaults to geneguessr/proteins.json if present (includes clans), "
            "otherwise falls back to geneguessr/embedding_proteins.json."
        ),
    )
    args = parser.parse_args()

    default_with_clans = ROOT / "tools" / "thoteins" / "data" / "geneguessr" / "proteins.json"
    default_embedding = ROOT / "tools" / "thoteins" / "data" / "geneguessr" / "embedding_proteins.json"
    metadata_path = (
        Path(args.metadata_file)
        if args.metadata_file
        else (default_with_clans if default_with_clans.exists() else default_embedding)
    )
    if not metadata_path.exists():
        raise SystemExit(f"Metadata file not found: {metadata_path}")

    metadata = collect_metadata(path=metadata_path)
    metadata_total = len(metadata)
    lookup, dim, embedding_stats = build_vector_lookup(metadata)
    records, missing = build_records(metadata, lookup, dim)
    if not records:
        raise SystemExit("No proteins had matching embeddings; aborting")
    sql_paths = write_sql_chunks(records, transactional=not args.remote, chunk_size=1000)

    print(f"[loader] Preparing to write {len(records)} proteins with dim={dim}")
    if missing:
        print(f"[loader] Warning: {len(missing)} proteins lacked embeddings ({', '.join(missing[:5])} ...)")

    execute_sql(sql_paths, remote=args.remote)
    counts_row = validate_counts(len(records), remote=args.remote)
    sample_row = validate_sample(remote=args.remote)
    print_validation_report(metadata_total, len(records), missing, embedding_stats, counts_row, sample_row)
    print("[loader] Validation succeeded.")


if __name__ == "__main__":
    main()
