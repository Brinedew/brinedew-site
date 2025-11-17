#!/usr/bin/env python3
"""
Extract the canonical list of protein tokens from the HiG2Vec embedding file.

This is Step 1 of the vector-driven pipeline: walk the .pth, skip GO terms,
deduplicate, and persist the resulting tokens for downstream metadata fetches.
"""

from __future__ import annotations

import json
from pathlib import Path

import torch

EMBEDDING_PATH = Path(__file__).resolve().parents[1] / "tools" / "thoteins" / "data" / "embeddings" / "hig2vec_human_200dim.pth"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "tools" / "thoteins" / "data" / "geneguessr" / "embedding_tokens.json"


def normalize_token(value: str) -> str:
    return value.strip().upper()


def main() -> None:
    if not EMBEDDING_PATH.exists():
        raise SystemExit(f"Missing embedding file at {EMBEDDING_PATH}")
    model = torch.load(EMBEDDING_PATH, map_location="cpu")
    objects = model.get("objects")
    if objects is None:
        raise SystemExit("Embedding file missing 'objects' array")

    tokens: list[dict[str, str]] = []
    seen = set()
    stats = {
        "total_objects": len(objects) if hasattr(objects, "__len__") else 0,
        "skipped_nonstring": 0,
        "skipped_empty": 0,
        "skipped_go": 0,
        "deduped": 0,
    }

    for raw in objects:
        if not isinstance(raw, str):
            stats["skipped_nonstring"] += 1
            continue
        cleaned = raw.strip()
        if not cleaned:
            stats["skipped_empty"] += 1
            continue
        if cleaned.upper().startswith("GO:"):
            stats["skipped_go"] += 1
            continue
        token = normalize_token(cleaned)
        if token in seen:
            stats["deduped"] += 1
            continue
        seen.add(token)
        tokens.append({"token": token, "raw_name": cleaned})

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps({"tokens": tokens}, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[embedding] wrote {len(tokens)} tokens to {OUTPUT_PATH}")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
