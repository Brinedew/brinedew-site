#!/usr/bin/env python3
from __future__ import annotations

import re
from typing import Iterable, List, Optional, Tuple

PDB_COVERAGE_THRESHOLD = 0.6
SWISS_MODEL_COVERAGE_THRESHOLD = 0.6
SWISS_MODEL_QMEAN_THRESHOLD = 0.7

CHAIN_SPLITTER = re.compile(r"[;,]")


def parse_chain_segments(spec: Optional[str]) -> List[int]:
    if not spec:
        return []
    segments: List[int] = []
    for part in CHAIN_SPLITTER.split(spec):
        token = part.strip()
        if not token or "=" not in token:
            continue
        _, range_token = token.split("=", 1)
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


def compute_pdb_coverage(pdb_entry: Optional[dict], protein_length: Optional[int]) -> float:
    if not pdb_entry:
        return 0.0
    if not isinstance(protein_length, (int, float)) or protein_length <= 0:
        return 1.0
    segments = parse_chain_segments(pdb_entry.get("chains"))
    covered = sum(segments)
    if covered <= 0:
        return 0.0
    return min(1.0, covered / protein_length)


def extract_swiss_quality(model: Optional[dict]) -> Optional[float]:
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


def compute_swiss_coverage(model: Optional[dict], protein_length: Optional[int]) -> float:
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


def determine_structure(structure: Optional[dict], protein_length: Optional[int]) -> Tuple[int, Optional[str]]:
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


def sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def iter_synonyms(entry: dict) -> Iterable[Tuple[str, str]]:
    seen_norm = set()
    candidates: List[Optional[str]] = []
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
