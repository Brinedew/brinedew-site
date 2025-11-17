#!/usr/bin/env python3
"""
Load HiG2Vec embeddings into the D1 database.

Usage:
    python scripts/load_hig2vec_embeddings.py [--remote]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import torch

if hasattr(sys.stdout, "reconfigure"):
  try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
  except OSError:
    pass

ROOT = Path(__file__).resolve().parents[1]
GENEGUESSR_DATA_DIR = ROOT / "tools" / "thoteins" / "data" / "geneguessr"
PROTEINS_JSON = GENEGUESSR_DATA_DIR / "proteins.json"
EMBEDDING_PATH = ROOT / "tools" / "thoteins" / "data" / "embeddings" / "hig2vec_human_200dim.pth"


def build_symbol_map() -> dict[str, str]:
    data = json.loads(PROTEINS_JSON.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for entry in data:
        uniprot = entry.get("uniprot")
        if not uniprot:
            continue
        for token in [entry.get("hgnc"), entry.get("full_name")]:
            if token:
                mapping[token.upper()] = uniprot
        for syn in entry.get("synonyms") or []:
            if syn:
                mapping[str(syn).upper()] = uniprot
    return mapping


def vector_to_hex(tensor: torch.Tensor) -> str:
    arr = tensor.detach().cpu().to(torch.float32).numpy()
    blob = arr.tobytes()
    return blob.hex()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true", help="Apply to remote D1 database")
    args = parser.parse_args()

    if not EMBEDDING_PATH.exists():
        raise SystemExit(f"Missing embedding file at {EMBEDDING_PATH}")

    symbol_map = build_symbol_map()
    model = torch.load(EMBEDDING_PATH, map_location="cpu")
    objects = model["objects"]
    embeddings = model["embeddings"]
    if embeddings.shape[1] != 200:
        raise SystemExit(f"Expected 200-dim embeddings, got {embeddings.shape[1]}")

    transactional = not args.remote
    statements: list[str] = []
    if transactional:
        statements.append("BEGIN TRANSACTION;")
    inserted = 0
    seen = set()
    for idx, name in enumerate(objects):
        if not name or name.startswith("GO:"):
            continue
        key = name.upper()
        if key in seen:
            continue
        seen.add(key)
        uniprot = symbol_map.get(key)
        if not uniprot:
            continue
        vector_hex = vector_to_hex(embeddings[idx])
        statements.append(
            "INSERT OR REPLACE INTO protein_embeddings (protein_id, dim, vector) "
            f"SELECT id, 200, x'{vector_hex}' FROM proteins WHERE uniprot = '{uniprot}';"
        )
        inserted += 1
    if transactional:
        statements.append("COMMIT;")
    statements.append(f"-- Inserted embeddings for {inserted} proteins")

    if inserted == 0:
        print("No embeddings matched current proteins.json entries.")
        return

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".sql") as tmp:
        tmp.write("\n".join(statements))
        tmp_path = Path(tmp.name)

    wrangler = shutil.which("wrangler") or shutil.which("wrangler.cmd")
    if not wrangler:
        raise SystemExit("wrangler CLI not found in PATH")

    cmd = [wrangler, "d1", "execute", "geneguessr"]
    if args.remote:
        cmd.append("--remote")
    cmd.extend(["--file", str(tmp_path)])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT))
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            raise SystemExit(f"wrangler exited with {result.returncode}")
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
