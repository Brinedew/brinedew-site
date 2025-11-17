#!/usr/bin/env python3
"""
Map embedding tokens to UniProt accessions using features.csv and the protein dataset.
Unresolved tokens are recorded for manual follow-up.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, List, Tuple

DATA_DIR = Path(__file__).resolve().parents[1] / "tools" / "thoteins" / "data"
GENEGUESSR_DIR = DATA_DIR / "geneguessr"

TOKENS_PATH = GENEGUESSR_DIR / "embedding_tokens.json"
PROTEINS_PATH = GENEGUESSR_DIR / "proteins.json"
FEATURES_PATH = DATA_DIR / "proteins" / "features.csv"

OUTPUT_MAPPING = GENEGUESSR_DIR / "embedding_token_mappings.json"
OUTPUT_UNMAPPED = GENEGUESSR_DIR / "embedding_tokens_needing_mapping.json"


def load_tokens() -> List[Dict[str, str]]:
    data = json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
    return data["tokens"]


def build_lookup() -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    # 1. From features.csv
    with FEATURES_PATH.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            uniprot = (row.get("uniprot_id") or "").strip().upper()
            if not uniprot:
                continue
            lookup.setdefault(uniprot, uniprot)
            gene_symbol = (row.get("gene_symbol") or "").strip().upper()
            if gene_symbol:
                lookup.setdefault(gene_symbol, uniprot)
            short_name = (row.get("short_name") or "").strip().upper()
            if short_name:
                lookup.setdefault(short_name, uniprot)
            full_name = (row.get("full_name") or "").strip().upper()
            if full_name:
                lookup.setdefault(full_name, uniprot)
    # 2. From proteins.json synonyms / HGNC / full name
    dataset = json.loads(PROTEINS_PATH.read_text(encoding="utf-8"))
    for entry in dataset:
        uniprot = (entry.get("uniprot") or "").strip().upper()
        if not uniprot:
            continue
        lookup.setdefault(uniprot, uniprot)
        hgnc = (entry.get("hgnc") or "").strip().upper()
        if hgnc:
            lookup.setdefault(hgnc, uniprot)
        full_name = (entry.get("full_name") or "").strip().upper()
        if full_name:
            lookup.setdefault(full_name, uniprot)
        for synonym in entry.get("synonyms") or []:
            token = (str(synonym) or "").strip().upper()
            if token:
                lookup.setdefault(token, uniprot)
    return lookup


def main() -> None:
    tokens = load_tokens()
    lookup = build_lookup()

    mappings: List[Dict[str, str]] = []
    unresolved: List[Dict[str, str]] = []

    for item in tokens:
        token = item["token"]
        raw = item["raw_name"]
        uniprot = lookup.get(token)
        if uniprot:
            mappings.append(
                {"token": token, "raw_name": raw, "uniprot": uniprot}
            )
        else:
            unresolved.append(item)

    OUTPUT_MAPPING.write_text(
        json.dumps({"mappings": mappings}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUTPUT_UNMAPPED.write_text(
        json.dumps({"unresolved": unresolved}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    resolved_uniprots = len({m["uniprot"] for m in mappings})
    print(f"[mapping] resolved {len(mappings)} tokens -> {resolved_uniprots} UniProt IDs")
    print(f"[mapping] unresolved tokens: {len(unresolved)} (see {OUTPUT_UNMAPPED})")


if __name__ == "__main__":
    main()
