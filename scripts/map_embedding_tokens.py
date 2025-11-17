#!/usr/bin/env python3
"""
Map embedding tokens to UniProt accessions using features.csv and the protein dataset.
Unresolved tokens are recorded for manual follow-up.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import requests

DATA_DIR = Path(__file__).resolve().parents[1] / "tools" / "thoteins" / "data"
GENEGUESSR_DIR = DATA_DIR / "geneguessr"

TOKENS_PATH = GENEGUESSR_DIR / "embedding_tokens.json"
PROTEINS_PATH = GENEGUESSR_DIR / "proteins.json"
FEATURES_PATH = DATA_DIR / "proteins" / "features.csv"
UNIPROT_DIR = DATA_DIR / "proteins" / "uniprot"
BULK_UNIPROT_PATH = UNIPROT_DIR / "uniprot_human.json"

OUTPUT_MAPPING = GENEGUESSR_DIR / "embedding_token_mappings.json"
OUTPUT_UNMAPPED = GENEGUESSR_DIR / "embedding_tokens_needing_mapping.json"
OUTPUT_REMOTE = GENEGUESSR_DIR / "embedding_token_remote_hits.json"

UNIPROT_STREAM_API = "https://rest.uniprot.org/uniprotkb/stream"
UNIPROT_SEARCH_API = "https://rest.uniprot.org/uniprotkb/search"


def fetch_uniprot_entry(uniprot_id: str) -> Dict[str, object] | None:
    UNIPROT_DIR.mkdir(parents=True, exist_ok=True)
    cached = UNIPROT_DIR / f"{uniprot_id}.json"
    if cached.exists():
        try:
            data = json.loads(cached.read_text(encoding="utf-8"))
            if data.get("results"):
                return data
        except json.JSONDecodeError:
            pass
    params = {
        "compressed": "false",
        "format": "json",
        "query": f"accession:{uniprot_id}",
    }
    response = requests.get(UNIPROT_STREAM_API, params=params, timeout=20)
    response.raise_for_status()
    cached.write_text(response.text, encoding="utf-8")
    return response.json()


def load_bulk_uniprot_index() -> Tuple[Dict[str, str], Dict[str, Dict[str, object]]]:
    if not BULK_UNIPROT_PATH.exists():
        return {}, {}
    try:
        payload = json.loads(BULK_UNIPROT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}, {}
    token_index: Dict[str, str] = {}
    entry_index: Dict[str, Dict[str, object]] = {}
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return token_index, entry_index
    for entry in results:
        accession = entry.get("primaryAccession")
        if not accession:
            continue
        entry_index[accession.upper()] = entry
        names = set()
        for gene in entry.get("genes") or []:
            if not isinstance(gene, dict):
                continue
            gene_name = gene.get("geneName")
            if isinstance(gene_name, dict) and gene_name.get("value"):
                names.add(gene_name["value"].strip().upper())
            for syn in gene.get("synonyms") or []:
                if isinstance(syn, dict):
                    value = syn.get("value")
                    if value:
                        names.add(value.strip().upper())
        for name in names:
            token_index.setdefault(name, accession.upper())
    return token_index, entry_index


def chunked(iterable: Iterable[str], size: int) -> Iterable[List[str]]:
    batch: List[str] = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def fetch_batch_tokens(tokens: List[str]) -> Dict[str, str]:
    if not tokens:
        return {}
    terms = [f"gene_exact:{token}" for token in tokens]
    query = "(" + " OR ".join(terms) + ") AND (organism_id:9606)"
    params = {
        "query": query,
        "fields": "accession,gene_primary,gene_synonym",
        "format": "json",
        "size": 500,
    }
    response = requests.get(UNIPROT_SEARCH_API, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    mapping: Dict[str, str] = {}
    for result in data.get("results", []):
        accession = result.get("primaryAccession")
        if not accession:
            continue
        names = set()
        for gene in result.get("genes") or []:
            for field in ("geneName", "synonyms"):
                entry = gene.get(field)
                if not entry:
                    continue
                if isinstance(entry, list):
                    for item in entry:
                        value = item.get("value") if isinstance(item, dict) else item
                        if value:
                            names.add(value.strip().upper())
                elif isinstance(entry, dict):
                    value = entry.get("value")
                    if value:
                        names.add(value.strip().upper())
                elif isinstance(entry, str):
                    names.add(entry.strip().upper())
        for token in tokens:
            if token in names:
                mapping[token] = accession
    return mapping


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


def try_remote_lookup(token: str) -> Tuple[str | None, Dict[str, object] | None]:
    """Attempt to resolve a token by querying UniProt directly as an accession."""
    direct_candidates = [token]
    if token.startswith(("P", "Q", "O")) and len(token) == 6:
        direct_candidates.append(token)
    for candidate in direct_candidates:
        try:
            data = fetch_uniprot_entry(candidate)
        except requests.HTTPError:
            continue
        except requests.RequestException:
            continue
        if data and data.get("results"):
            return candidate, data
    return None, None


def main() -> None:
    tokens = load_tokens()
    lookup = build_lookup()
    bulk_token_index, _ = load_bulk_uniprot_index()
    for token, accession in bulk_token_index.items():
        lookup.setdefault(token, accession.upper())

    remote_hits: List[Dict[str, object]] = []

    unresolved_tokens: List[Dict[str, str]] = []
    for item in tokens:
        token = item["token"]
        if token in lookup:
            continue
        if token in bulk_token_index:
            accession = bulk_token_index[token].upper()
            lookup[token] = accession
            remote_hits.append({"token": token, "uniprot": accession, "source": "bulk"})
            continue
        uniprot, entry = try_remote_lookup(token)
        if uniprot and entry:
            lookup[token] = uniprot.upper()
            remote_hits.append({"token": token, "uniprot": uniprot.upper(), "source": "direct"})
        else:
            unresolved_tokens.append(item)

    # Batch lookup for remaining unresolved tokens
    for batch in chunked([item["token"] for item in unresolved_tokens], 200):
        try:
            batch_map = fetch_batch_tokens(batch)
        except requests.RequestException:
            continue
        for token, accession in batch_map.items():
            uppercase = accession.upper()
            if token not in lookup:
                lookup[token] = uppercase
                remote_hits.append({"token": token, "uniprot": uppercase, "source": "batch"})
                try:
                    fetch_uniprot_entry(uppercase)
                except requests.RequestException:
                    pass

    mappings: List[Dict[str, str]] = []
    unresolved: List[Dict[str, str]] = []

    for item in tokens:
        token = item["token"]
        raw = item["raw_name"]
        uniprot = lookup.get(token)
        if uniprot:
            mappings.append({"token": token, "raw_name": raw, "uniprot": uniprot})
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
    OUTPUT_REMOTE.write_text(
        json.dumps({"remote_hits": remote_hits}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    resolved_uniprots = len({m["uniprot"] for m in mappings})
    print(f"[mapping] resolved {len(mappings)} tokens -> {resolved_uniprots} UniProt IDs")
    print(f"[mapping] unresolved tokens: {len(unresolved)} (see {OUTPUT_UNMAPPED})")
    print(f"[mapping] remote hits: {len(remote_hits)} (cached under {UNIPROT_DIR})")


if __name__ == "__main__":
    main()
