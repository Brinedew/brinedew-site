#!/usr/bin/env python3
"""
Load ESM2-3B embeddings into the D1 database.

This script adds ESM2 structural embeddings alongside existing HiG2Vec embeddings.
ESM2 captures sequence/structure similarity while HiG2Vec captures functional/GO similarity.

Usage:
    python scripts/load_esm2_embeddings.py [--remote]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except OSError:
        pass

ROOT = Path(__file__).resolve().parents[1]
PROTEINS_JSON = Path(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json")
ESM2_EMBEDDING_PATH = Path(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")


def load_proteins() -> list[dict]:
    """Load the proteins.json file."""
    return json.loads(PROTEINS_JSON.read_text(encoding="utf-8"))


def vector_to_hex_float16(tensor: torch.Tensor) -> str:
    """Convert a tensor to a hex string using float16 to save space."""
    arr = tensor.detach().cpu().to(torch.float16).numpy()
    blob = arr.tobytes()
    return blob.hex()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true", help="Apply to remote D1 database")
    parser.add_argument("--dry-run", action="store_true", help="Print SQL without executing")
    parser.add_argument("--batch-size", type=int, default=500, help="Statements per batch (default 500)")
    args = parser.parse_args()

    if not ESM2_EMBEDDING_PATH.exists():
        raise SystemExit(f"Missing ESM2 embedding file at {ESM2_EMBEDDING_PATH}")
    if not PROTEINS_JSON.exists():
        raise SystemExit(f"Missing proteins.json at {PROTEINS_JSON}")

    print("Loading ESM2 embeddings...")
    esm2_data = torch.load(ESM2_EMBEDDING_PATH, map_location="cpu")
    print(f"  Loaded {len(esm2_data)} gene embeddings")

    print("Loading proteins.json...")
    proteins = load_proteins()
    print(f"  Loaded {len(proteins)} proteins")

    # Build gene -> embedding mapping
    # ESM2 file is keyed by gene symbol
    esm2_keys = set(esm2_data.keys())

    # Check dimensions of first entry
    sample_key = next(iter(esm2_data.keys()))
    sample_dim = esm2_data[sample_key].shape[0]
    print(f"  ESM2 dimension: {sample_dim}")

    statements: list[str] = []
    matched = 0
    missing = 0

    for protein in proteins:
        gene = protein.get("gene", "")
        if not gene:
            missing += 1
            continue

        if gene not in esm2_keys:
            missing += 1
            continue

        embedding = esm2_data[gene]
        vector_hex = vector_to_hex_float16(embedding)

        # Escape any quotes in gene symbol for SQL safety
        gene_escaped = gene.replace("'", "''")

        # Update existing row with ESM2 data
        statements.append(
            f"UPDATE protein_embeddings SET esm2_dim = {sample_dim}, esm2_vector = x'{vector_hex}' "
            f"WHERE upper(gene_symbol) = upper('{gene_escaped}');"
        )
        matched += 1

    print(f"  Matched: {matched}, Missing: {missing}")

    if matched == 0:
        print("No embeddings matched. Make sure HiG2Vec embeddings are loaded first.")
        return

    if args.dry_run:
        print("\n--- DRY RUN: First 5 statements ---")
        for stmt in statements[:5]:
            print(stmt[:200] + "..." if len(stmt) > 200 else stmt)
        print(f"\n... and {len(statements) - 5} more statements")
        return

    wrangler = shutil.which("wrangler") or shutil.which("wrangler.cmd")
    if not wrangler:
        raise SystemExit("wrangler CLI not found in PATH")

    # Execute in batches to avoid command-line length limits
    batch_size = args.batch_size
    total_batches = (len(statements) + batch_size - 1) // batch_size

    for batch_num in range(total_batches):
        start = batch_num * batch_size
        end = min(start + batch_size, len(statements))
        batch = statements[start:end]

        # Wrap batch in transaction for local, but not remote (remote auto-commits)
        if not args.remote:
            batch = ["BEGIN TRANSACTION;"] + batch + ["COMMIT;"]

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".sql") as tmp:
            tmp.write("\n".join(batch))
            tmp_path = Path(tmp.name)

        cmd = [wrangler, "d1", "execute", "geneguessr"]
        if args.remote:
            cmd.append("--remote")
        cmd.extend(["--file", str(tmp_path)])

        try:
            print(f"Executing batch {batch_num + 1}/{total_batches} ({len(batch)} statements)...")
            result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT))
            if result.returncode != 0:
                print(result.stdout)
                print(result.stderr)
                raise SystemExit(f"wrangler exited with {result.returncode}")
        finally:
            tmp_path.unlink(missing_ok=True)

    print(f"\nDone! Updated {matched} proteins with ESM2 embeddings.")


if __name__ == "__main__":
    main()
