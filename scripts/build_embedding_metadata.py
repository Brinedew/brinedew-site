#!/usr/bin/env python3
"""
Build a metadata payload driven entirely by the embedding token roster.

For each resolved token (token -> UniProt) we pull whatever information is
available from the Thoteins datasets (features.csv, UniProt JSON snapshots) and
write the result to tools/thoteins/data/geneguessr/embedding_proteins.json.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, List, Tuple

DATA_ROOT = Path(__file__).resolve().parents[1] / "tools" / "thoteins" / "data"
GENE_DIR = DATA_ROOT / "geneguessr"
UNIPROT_DIR = DATA_ROOT / "proteins" / "uniprot"
FEATURES_PATH = DATA_ROOT / "proteins" / "features.csv"

MAPPINGS_PATH = GENE_DIR / "embedding_token_mappings.json"
LEGACY_DATA_PATH = GENE_DIR / "proteins.json"
OUTPUT_PATH = GENE_DIR / "proteins.json"
SNAPSHOT_PATH = GENE_DIR / "embedding_proteins.json"
UNRESOLVED_METADATA_PATH = GENE_DIR / "embedding_metadata_needing_sources.json"


def load_mappings() -> List[Dict[str, str]]:
    data = json.loads(MAPPINGS_PATH.read_text(encoding="utf-8"))
    return data.get("mappings", [])


def load_features() -> Dict[str, Dict[str, str]]:
    features: Dict[str, Dict[str, str]] = {}
    with FEATURES_PATH.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            uniprot = (row.get("uniprot_id") or "").strip().upper()
            if uniprot:
                features[uniprot] = row
    return features


def load_uniprot_entry(uniprot: str) -> Dict[str, object] | None:
    path = UNIPROT_DIR / f"{uniprot}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def extract_gene_names(entry: Dict[str, object]) -> Tuple[str | None, List[str]]:
    if not entry:
        return None, []
    hgnc = None
    synonyms: List[str] = []
    genes = entry.get("genes") or []
    if genes:
        gene = genes[0]
        if isinstance(gene, dict):
            gene_name = gene.get("geneName")
            if isinstance(gene_name, dict):
                value = gene_name.get("value")
                if value:
                    hgnc = value
            for syn in gene.get("synonyms") or []:
                if isinstance(syn, dict):
                    value = syn.get("value")
                    if value:
                        synonyms.append(value)
    return hgnc, synonyms


def extract_recommended_name(entry: Dict[str, object]) -> str | None:
    if not entry:
        return None
    rec = entry.get("proteinDescription", {}).get("recommendedName")
    if isinstance(rec, dict):
        full_name = rec.get("fullName")
        if isinstance(full_name, dict):
            return full_name.get("value")
    return None


def extract_sequence_length(entry: Dict[str, object]) -> int | None:
    seq = entry.get("sequence") if entry else None
    if isinstance(seq, dict):
        length = seq.get("length")
        if isinstance(length, int):
            return length
    return None


def deep_copy(obj):
    return json.loads(json.dumps(obj))


def build_record(
    uniprot: str,
    features: Dict[str, str],
    uniprot_entry: Dict[str, object],
    legacy_entry: Dict[str, object] | None,
) -> Dict[str, object]:
    record: Dict[str, object] = deep_copy(legacy_entry) if legacy_entry else {}
    record["uniprot"] = uniprot
    record["source"] = "embedding"

    hgnc = (features.get("gene_symbol") or "").strip() if features else ""
    entry_hgnc, gene_synonyms = extract_gene_names(uniprot_entry)
    record["hgnc"] = hgnc or entry_hgnc or ""

    full_name = (features.get("full_name") or "").strip() if features else ""
    record["full_name"] = full_name or extract_recommended_name(uniprot_entry) or ""

    length = None
    if features and features.get("length"):
        try:
            length = int(float(features["length"]))
        except ValueError:
            length = None
    if length is None:
        entry_length = extract_sequence_length(uniprot_entry)
        if entry_length:
            length = entry_length
    record["length"] = length

    synonyms = []
    if features:
        for key in ("short_name", "full_name"):
            value = (features.get(key) or "").strip()
            if value:
                synonyms.append(value)
    for syn in gene_synonyms:
        if syn not in synonyms:
            synonyms.append(syn)
    record["synonyms"] = sorted(set(value for value in synonyms if value))
    return record


def main() -> None:
    mappings = load_mappings()
    features_map = load_features()

    records: List[Dict[str, object]] = []
    missing: List[Dict[str, str]] = []

    for mapping in mappings:
        uniprot = mapping["uniprot"]
        feats = features_map.get(uniprot)
        entry = load_uniprot_entry(uniprot)
        if not feats and not entry:
            missing.append(mapping)
            continue
    legacy_map = {}
    if LEGACY_DATA_PATH.exists():
        try:
            legacy_data = json.loads(LEGACY_DATA_PATH.read_text(encoding="utf-8"))
            legacy_map = {item.get("uniprot", "").strip().upper(): item for item in legacy_data if item.get("uniprot")}
        except json.JSONDecodeError:
            legacy_map = {}

    for mapping in mappings:
        uniprot = mapping["uniprot"]
        feats = features_map.get(uniprot)
        entry = load_uniprot_entry(uniprot)
        legacy_entry = legacy_map.get(uniprot)
        if not feats and not entry and not legacy_entry:
            missing.append(mapping)
            continue
        record = build_record(uniprot, feats or {}, entry or {}, legacy_entry)
        records.append(record)

    SNAPSHOT_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    OUTPUT_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    UNRESOLVED_METADATA_PATH.write_text(
        json.dumps({"missing_metadata": missing}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"[metadata] wrote {len(records)} embedding-driven records to {OUTPUT_PATH}")
    print(f"[metadata] tokens without metadata: {len(missing)} (see {UNRESOLVED_METADATA_PATH})")


if __name__ == "__main__":
    main()
