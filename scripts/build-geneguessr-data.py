#!/usr/bin/env python3
"""
Rebuild the Geneguessr static payload from the live protein gallery.

This script now pulls data directly from:
- Markdown protein pages in Website/content/wiki (only non-draft pages tagged "protein")
- Thoteins feature CSVs (for canonical molecular metadata)
- UniProt JSON snapshots (Website/tools/thoteins/data/proteins/uniprot/*.json)
- A cached GO ontology file (Website/data/go/go-basic.obo)

Outputs:
- quartz/static/geneguessr/data.json         → normalized protein records
- quartz/static/geneguessr/index.json        → eligible IDs + seed salt
- quartz/static/geneguessr/similarity.json   → GO similarity matrix + metadata

GO similarity defaults:
- Aspect: Biological Process
- Metric: Lin semantic similarity
- Aggregation: Best-match average (BMA)
- Evidence: drops IEA annotations (keeps experimental + curated codes)

Usage:
    uv run python scripts/build-geneguessr-data.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import frontmatter

# Paths
BASE_DIR = Path(__file__).parent.parent
CONTENT_DIR = BASE_DIR / "content" / "wiki"
FEATURES_CSV = BASE_DIR / "tools" / "thoteins" / "data" / "proteins" / "features.csv"
UNIPROT_JSON_DIR = BASE_DIR / "tools" / "thoteins" / "data" / "proteins" / "uniprot"
GO_ONTOLOGY_PATH = BASE_DIR / "data" / "go" / "go-basic.obo"
OUTPUT_DIR = BASE_DIR / "quartz" / "static" / "geneguessr"
DATA_JSON = OUTPUT_DIR / "data.json"
INDEX_JSON = OUTPUT_DIR / "index.json"
SIMILARITY_JSON = OUTPUT_DIR / "similarity.json"

# Inclusion criteria
MIN_LENGTH = 100  # aa
MAX_LENGTH = 5_000  # aa
MIN_DOMAINS = 1

# Similarity parameters
SIMILARITY_ASPECT = "bp"  # biological_process
SIMILARITY_METRIC = "lin"
SIMILARITY_AGGREGATION = "bma"
GO_HINT_LIMIT = 5
DROP_EVIDENCE_CODES = {"IEA"}  # Drop purely electronic GO annotations
UNIPROT_CACHE: Dict[str, Optional[Dict[str, object]]] = {}

# Mapping helpers
ASPECT_FROM_PREFIX = {"P": "bp", "F": "mf", "C": "cc"}
ASPECT_TO_NAMESPACE = {
    "bp": "biological_process",
    "mf": "molecular_function",
    "cc": "cellular_component",
}


class GOTerm:
    """Minimal GO Term representation extracted from go-basic.obo."""

    __slots__ = ("go_id", "name", "namespace", "parents")

    def __init__(self, go_id: str, name: str, namespace: str, parents: Iterable[str]) -> None:
        self.go_id = go_id
        self.name = name
        self.namespace = namespace
        self.parents: Set[str] = set(parents)


def load_features() -> Dict[str, Dict[str, str]]:
    """Load Thoteins features.csv keyed by UniProt ID."""
    if not FEATURES_CSV.exists():
        raise FileNotFoundError(f"Missing features CSV at {FEATURES_CSV}")

    features: Dict[str, Dict[str, str]] = {}
    with FEATURES_CSV.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            features[row["uniprot_id"]] = row
    return features


def load_protein_pages() -> List[Tuple[Path, frontmatter.Post]]:
    """Return (path, frontmatter) tuples for published protein pages."""
    if not CONTENT_DIR.exists():
        raise FileNotFoundError(f"Protein wiki directory not found: {CONTENT_DIR}")

    pages: List[Tuple[Path, frontmatter.Post]] = []
    for md_path in sorted(CONTENT_DIR.glob("*.md")):
        post = frontmatter.load(md_path)
        tags = post.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        if "protein" not in tags:
            continue
        if post.get("draft", False):
            continue
        if not post.get("uniprot_id"):
            print(f"[warn] {md_path.name}: missing uniprot_id, skipping")
            continue
        pages.append((md_path, post))
    return pages


def parse_go_obo(path: Path) -> Tuple[Dict[str, GOTerm], Dict[str, str]]:
    """Parse go-basic.obo into GOTerm objects + header metadata."""
    if not path.exists():
        raise FileNotFoundError(
            f"GO ontology not found at {path}. "
            "Download from https://purl.obolibrary.org/obo/go/go-basic.obo"
        )

    ontology: Dict[str, GOTerm] = {}
    metadata: Dict[str, str] = {}
    current: Dict[str, object] | None = None

    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\n")
            if not line:
                continue
            if line.startswith("!"):
                continue

            if line == "[Term]":
                if current and not current.get("obsolete") and current.get("id"):
                    ontology[current["id"]] = GOTerm(
                        current["id"],
                        current.get("name", "unknown"),
                        current.get("namespace", "unknown"),
                        current.get("parents", []),
                    )
                current = {"parents": set(), "obsolete": False}
                continue

            if line == "[Typedef]":
                current = None
                continue

            if current is None:
                if ":" in line:
                    key, value = line.split(":", 1)
                    metadata[key.strip()] = value.strip()
                continue

            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()

            if key == "id":
                current["id"] = value
            elif key == "name":
                current["name"] = value
            elif key == "namespace":
                current["namespace"] = value
            elif key == "is_obsolete" and value.lower() == "true":
                current["obsolete"] = True
            elif key == "is_a":
                parent = value.split("!", 1)[0].strip()
                current["parents"].add(parent)
            elif key == "relationship" and value.startswith("part_of"):
                parts = value.split()
                if len(parts) >= 2:
                    current["parents"].add(parts[1])

        # flush final term
        if current and not current.get("obsolete") and current.get("id"):
            ontology[current["id"]] = GOTerm(
                current["id"],
                current.get("name", "unknown"),
                current.get("namespace", "unknown"),
                current.get("parents", []),
            )

    return ontology, metadata


def infer_tissue_specificity(tissue_tau: Optional[str]) -> Dict[str, Optional[float]]:
    """Derive qualitative tissue specificity labels from tau values."""
    if not tissue_tau or str(tissue_tau).strip() == "":
        return {"label": "unknown", "score": None}
    try:
        tau = float(tissue_tau)
    except (TypeError, ValueError):
        return {"label": "unknown", "score": None}

    if tau < 0.3:
        label = "ubiquitous"
    elif tau < 0.6:
        label = "moderate"
    else:
        label = "highly specific"
    return {"label": label, "score": round(tau, 3)}


def is_secreted(locations: str | None) -> bool:
    """Simple keyword inference for secretion."""
    if not locations:
        return False
    text = locations.lower()
    for keyword in ("extracellular", "secreted", "exosome"):
        if keyword in text:
            return True
    return False


def parse_domains(raw: str | None) -> List[str]:
    """Convert ';'-delimited domains into a clean list."""
    if not raw:
        return []
    domains: List[str] = []
    for part in raw.split(";"):
        clean = part.strip()
        if not clean or clean.lower() == "disordered":
            continue
        domains.append(clean)
    return domains


def load_uniprot_entry(uniprot_id: str) -> Optional[Dict[str, object]]:
    """Load UniProt JSON once per protein."""
    if uniprot_id in UNIPROT_CACHE:
        return UNIPROT_CACHE[uniprot_id]
    json_path = UNIPROT_JSON_DIR / f"{uniprot_id}.json"
    if not json_path.exists():
        print(f"[warn] Missing UniProt JSON for {uniprot_id} at {json_path}")
        UNIPROT_CACHE[uniprot_id] = None
        return None
    data = json.loads(json_path.read_text(encoding="utf-8"))
    UNIPROT_CACHE[uniprot_id] = data
    return data


def gather_go_annotations(uniprot_id: str, ontology: Dict[str, GOTerm]) -> Dict[str, Set[str]]:
    """Pull GO term IDs per aspect from the cached UniProt JSON blobs."""
    result: Dict[str, Set[str]] = {"bp": set(), "mf": set(), "cc": set()}
    entry = load_uniprot_entry(uniprot_id)
    if not entry:
        return result

    for ref in entry.get("uniProtKBCrossReferences", []):
        if ref.get("database") != "GO":
            continue
        go_id = ref.get("id")
        if not go_id:
            continue
        properties = {prop["key"]: prop["value"] for prop in ref.get("properties", [])}
        go_term = properties.get("GoTerm")
        if not go_term:
            continue
        aspect_prefix, _, _ = go_term.partition(":")
        aspect = ASPECT_FROM_PREFIX.get(aspect_prefix)
        if not aspect:
            continue
        evidence = properties.get("GoEvidenceType", "")
        evidence_code = evidence.split(":", 1)[0] if evidence else ""
        if evidence_code in DROP_EVIDENCE_CODES:
            continue
        if go_id not in ontology:
            continue
        result[aspect].add(go_id)
    return result


def parse_resolution(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    cleaned = raw.replace("Å", "").replace("A", "").strip()
    if cleaned in {"", "-", "NA"}:
        return None
    try:
        token = cleaned.split()[0]
        return float(token)
    except Exception:
        return None


def select_best_pdb_entry(pdb_refs: List[Dict[str, object]]) -> Optional[Dict[str, object]]:
    if not pdb_refs:
        return None

    method_priority = {
        "x-ray": 0,
        "x-ray diffraction": 0,
        "electron microscopy": 1,
        "cryo-em": 1,
        "electron cryo-microscopy": 1,
        "nmr": 2,
    }

    def ref_props(ref: Dict[str, object]) -> Dict[str, str]:
        return {p["key"]: p["value"] for p in ref.get("properties", []) if isinstance(p, dict)}

    def sort_key(ref: Dict[str, object]):
        props = ref_props(ref)
        method = props.get("Method", "") or ""
        method_key = method_priority.get(method.lower(), 3)
        resolution = parse_resolution(props.get("Resolution"))
        resolution_key = resolution if resolution is not None else float("inf")
        return (method_key, resolution_key, ref.get("id"))

    best = min(pdb_refs, key=sort_key)
    props = ref_props(best)
    resolution = parse_resolution(props.get("Resolution"))

    return {
        "id": best.get("id"),
        "method": props.get("Method"),
        "resolution": resolution,
        "resolution_raw": props.get("Resolution"),
        "chains": props.get("Chains"),
        "url": f"https://www.ebi.ac.uk/pdbe/entry/pdb/{best.get('id')}" if best.get("id") else None,
    }


def build_alphafold_info(uniprot_id: str, alphafold_ref: Optional[Dict[str, object]]) -> Optional[Dict[str, object]]:
    if not alphafold_ref:
        return None
    model_id = f"AF-{uniprot_id}-F1"
    base_url = "https://alphafold.ebi.ac.uk/files"
    return {
        "id": model_id,
        "model_url": f"{base_url}/{model_id}-model_v4.cif",
        "pae_url": f"{base_url}/{model_id}-predicted_aligned_error_v4.json",
        "thumbnail_url": f"{base_url}/{model_id}-thumbnail.png",
        "viewer_url": f"https://alphafold.ebi.ac.uk/entry/{uniprot_id}",
    }


def extract_structure_info(uniprot_id: str) -> Dict[str, Optional[object]]:
    entry = load_uniprot_entry(uniprot_id)
    if not entry:
        return {
            "structure_id": None,
            "primary_source": None,
            "pdb": None,
            "alphafold": None,
        }

    cross_refs = entry.get("uniProtKBCrossReferences", [])
    pdb_refs = [ref for ref in cross_refs if ref.get("database") == "PDB"]
    alphafold_ref = next((ref for ref in cross_refs if ref.get("database") == "AlphaFoldDB"), None)

    pdb_info = select_best_pdb_entry(pdb_refs)
    alphafold_info = build_alphafold_info(uniprot_id, alphafold_ref)

    primary_source = None
    structure_id = None
    if pdb_info and pdb_info.get("id"):
        primary_source = "pdb"
        structure_id = pdb_info["id"]
    elif alphafold_info and alphafold_info.get("id"):
        primary_source = "alphafold"
        structure_id = alphafold_info["id"]

    return {
        "structure_id": structure_id,
        "primary_source": primary_source,
        "pdb": pdb_info,
        "alphafold": alphafold_info,
    }


def build_synonyms(page: frontmatter.Post, feature_row: Dict[str, str]) -> List[str]:
    """Combine aliases and short names into a small synonym list."""
    synonyms: Set[str] = set()
    for candidate in (
        page.get("gene_symbol"),
        page.get("symbol"),
        page.get("title"),
        feature_row.get("gene_symbol"),
        feature_row.get("short_name"),
    ):
        if candidate:
            synonyms.add(str(candidate))
    aliases = page.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    for alias in aliases:
        if alias:
            synonyms.add(str(alias))
    return sorted(s for s in synonyms if s)


def slug_for_page(md_path: Path) -> str:
    """Turn content/wiki/foo.md into /wiki/foo."""
    rel = md_path.relative_to(BASE_DIR / "content")
    slug = rel.with_suffix("").as_posix()
    return f"/{slug}"


def normalize_domains(page: frontmatter.Post, feature_row: Dict[str, str]) -> List[str]:
    """Prefer curated domains from the page; fall back to CSV data."""
    domains = page.get("domains") or []
    if isinstance(domains, str):
        domains = [domains]
    domains = [d for d in domains if d]
    if domains:
        return domains
    return parse_domains(feature_row.get("domains_top3"))


def ancestors(term_id: str, ontology: Dict[str, GOTerm], cache: Dict[str, Set[str]]) -> Set[str]:
    """Return all ancestors (excluding the term itself) with memoization."""
    if term_id in cache:
        return cache[term_id]
    term = ontology.get(term_id)
    if not term:
        cache[term_id] = set()
        return set()
    result: Set[str] = set()
    for parent in term.parents:
        result.add(parent)
        result.update(ancestors(parent, ontology, cache))
    cache[term_id] = result
    return result


def ancestors_with_self(term_id: str, ontology: Dict[str, GOTerm], cache: Dict[str, Set[str]]) -> Set[str]:
    """Return ancestors plus the term itself."""
    return {term_id} | ancestors(term_id, ontology, cache)


def compute_term_counts(
    annotations: Dict[str, Set[str]],
    ontology: Dict[str, GOTerm],
) -> Dict[str, int]:
    """Count how often each GO term (and its ancestors) appears across proteins."""
    counts: Dict[str, int] = defaultdict(int)
    ancestor_cache: Dict[str, Set[str]] = {}
    for terms in annotations.values():
        seen: Set[str] = set()
        for term_id in terms:
            if term_id not in ontology:
                continue
            seen.add(term_id)
            seen.update(ancestors(term_id, ontology, ancestor_cache))
        for term_id in seen:
            counts[term_id] += 1
    return counts


def compute_ic(counts: Dict[str, int], total_entities: int) -> Dict[str, float]:
    """Convert term counts to information content (IC) values."""
    ic: Dict[str, float] = {}
    if total_entities <= 0:
        return ic
    for term_id, count in counts.items():
        probability = count / total_entities
        if probability <= 0:
            continue
        ic[term_id] = -math.log(probability)
    return ic


def lin_similarity(
    term_a: str,
    term_b: str,
    ic_map: Dict[str, float],
    ontology: Dict[str, GOTerm],
    ancestor_cache: Dict[str, Set[str]],
) -> float:
    """Lin's IC-based similarity for two GO terms."""
    if term_a == term_b:
        if ic_map.get(term_a, 0.0) == 0.0:
            return 0.0
        return 1.0
    ancestors_a = ancestors_with_self(term_a, ontology, ancestor_cache)
    ancestors_b = ancestors_with_self(term_b, ontology, ancestor_cache)
    common = ancestors_a & ancestors_b
    if not common:
        return 0.0
    mica = max(common, key=lambda term: ic_map.get(term, 0.0))
    mica_ic = ic_map.get(mica, 0.0)
    denom = ic_map.get(term_a, 0.0) + ic_map.get(term_b, 0.0)
    if denom == 0.0:
        return 0.0
    return (2.0 * mica_ic) / denom


def gene_similarity_bma(
    terms_a: Set[str],
    terms_b: Set[str],
    ic_map: Dict[str, float],
    ontology: Dict[str, GOTerm],
) -> float:
    """Best-match-average aggregation of term similarities."""
    if not terms_a or not terms_b:
        return 0.0

    ancestor_cache: Dict[str, Set[str]] = {}
    sim_cache: Dict[Tuple[str, str], float] = {}

    def best_match(source: Set[str], target: Set[str]) -> float:
        if not source:
            return 0.0
        total = 0.0
        for s_term in source:
            best = 0.0
            for t_term in target:
                key = (s_term, t_term)
                if key not in sim_cache:
                    sim_cache[key] = lin_similarity(s_term, t_term, ic_map, ontology, ancestor_cache)
                best = max(best, sim_cache[key])
            total += best
        return total / len(source)

    forward = best_match(terms_a, terms_b)
    backward = best_match(terms_b, terms_a)
    return (forward + backward) / 2.0


def select_go_hint_terms(
    go_ids: Iterable[str],
    ontology: Dict[str, GOTerm],
    ic_map: Dict[str, float],
    limit: int = GO_HINT_LIMIT,
) -> List[str]:
    """Pick a handful of high-information GO term names for clue cards."""
    scored: List[Tuple[float, str]] = []
    for go_id in go_ids:
        term = ontology.get(go_id)
        if not term:
            continue
        scored.append((ic_map.get(go_id, 0.0), term.name))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [name for _, name in scored[:limit]]


def build_protein_record(
    md_path: Path,
    page: frontmatter.Post,
    feature_row: Dict[str, str],
    go_annotations: Dict[str, Set[str]],
) -> Dict[str, object]:
    """Merge wiki frontmatter + features + GO annotations into a JSON-ready dict."""
    uniprot_id = page.get("uniprot_id").strip()
    gene_symbol = (
        page.get("gene_symbol")
        or feature_row.get("gene_symbol")
        or page.get("symbol")
        or page.get("title")
        or uniprot_id
    )
    full_name = page.get("full_name") or feature_row.get("full_name") or gene_symbol
    short_name = feature_row.get("short_name") or gene_symbol

    try:
        length = int(float(feature_row.get("length", 0)))
    except (TypeError, ValueError):
        length = 0

    tm_flag = feature_row.get("Has transmembrane domains", "").strip().lower()
    tmh = tm_flag in {"yes", "true", "1"}

    secreted = is_secreted(feature_row.get("locations", ""))

    tissue = infer_tissue_specificity(feature_row.get("tissue_tau"))

    locations_str = feature_row.get("locations", "")
    subcell = [loc.strip() for loc in locations_str.split(";") if loc.strip()]
    subcell = subcell[:3]

    links = {
        "uniprot": f"https://www.uniprot.org/uniprotkb/{uniprot_id}",
        "wiki": slug_for_page(md_path),
    }

    structure_info = extract_structure_info(uniprot_id)

    return {
        "uniprot": uniprot_id,
        "hgnc": gene_symbol,
        "synonyms": build_synonyms(page, feature_row),
        "full_name": full_name,
        "length": length,
        "tmh": tmh,
        "secreted": secreted,
        "domains": normalize_domains(page, feature_row),
        "tissue": tissue,
        "subcell": subcell,
        "links": links,
        "structure": structure_info,
        "structure_id": structure_info.get("structure_id"),
        "alphafold_id": (structure_info.get("alphafold") or {}).get("id"),
        "go_terms": {
            "bp": sorted(go_annotations["bp"]),
            "mf": sorted(go_annotations["mf"]),
            "cc": sorted(go_annotations["cc"]),
        },
    }


def compute_similarity_payload(
    annotations: Dict[str, Set[str]],
    ontology: Dict[str, GOTerm],
    go_metadata: Dict[str, str],
) -> Dict[str, object]:
    """Generate similarity.json content."""
    annotated = {pid: terms for pid, terms in annotations.items() if terms}
    counts = compute_term_counts(annotated, ontology)
    ic_map = compute_ic(counts, len(annotated))

    matrix: Dict[str, Dict[str, float]] = {}
    for pid_a, terms_a in annotations.items():
        row: Dict[str, float] = {}
        for pid_b, terms_b in annotations.items():
            score = gene_similarity_bma(terms_a, terms_b, ic_map, ontology)
            row[pid_b] = round(score, 6)
        matrix[pid_a] = row

    evidence_policy = "Exclude IEA (electronic) GO annotations"
    metadata = {
        "aspect": ASPECT_TO_NAMESPACE[SIMILARITY_ASPECT],
        "metric": SIMILARITY_METRIC,
        "aggregation": "best_match_average",
        "evidence_policy": evidence_policy,
        "go_release": go_metadata.get("data-version", "unknown"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "annotated_proteins": len(annotated),
        "total_proteins": len(annotations),
    }

    return {
        "metadata": metadata,
        "scores": matrix,
    }


def main() -> None:
    print("==> Loading GO ontology")
    ontology, go_meta = parse_go_obo(GO_ONTOLOGY_PATH)
    features = load_features()
    pages = load_protein_pages()

    proteins: List[Dict[str, object]] = []
    annotations_for_similarity: Dict[str, Set[str]] = {}

    print(f"==> Building dataset from {len(pages)} published protein pages")
    for md_path, page in pages:
        uniprot_id = page.get("uniprot_id").strip()
        feature_row = features.get(uniprot_id)
        if not feature_row:
            print(f"[warn] {uniprot_id}: not present in features.csv, skipping")
            continue

        go_annotations = gather_go_annotations(uniprot_id, ontology)
        record = build_protein_record(md_path, page, feature_row, go_annotations)

        # Apply gameplay filters
        if not (MIN_LENGTH <= record["length"] <= MAX_LENGTH):
            continue
        if len(record["domains"]) < MIN_DOMAINS:
            continue

        proteins.append(record)
        annotations_for_similarity[uniprot_id] = set(go_annotations[SIMILARITY_ASPECT])

    if not proteins:
        raise RuntimeError("No proteins met the inclusion criteria; aborting.")

    # Compute IC once we know the annotation universe
    counts = compute_term_counts(annotations_for_similarity, ontology)
    ic_map = compute_ic(counts, len([terms for terms in annotations_for_similarity.values() if terms]))
    for record in proteins:
        hint_terms = select_go_hint_terms(
            record["go_terms"][SIMILARITY_ASPECT],
            ontology,
            ic_map,
        )
        record["go_slim"] = hint_terms

    eligible_ids = sorted(record["uniprot"] for record in proteins)
    dataset_hash = hashlib.sha256(json.dumps(eligible_ids, sort_keys=True).encode()).hexdigest()[:8]
    salt_hash = f"geneguessr-v2-{dataset_hash}"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with DATA_JSON.open("w", encoding="utf-8") as handle:
        json.dump(proteins, handle, indent=2, ensure_ascii=False)
    print(f"[ok] Wrote {DATA_JSON}")

    index_payload = {
        "eligible_ids": eligible_ids,
        "salt_hash": salt_hash,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(eligible_ids),
    }
    with INDEX_JSON.open("w", encoding="utf-8") as handle:
        json.dump(index_payload, handle, indent=2)
    print(f"[ok] Wrote {INDEX_JSON}")

    similarity_payload = compute_similarity_payload(
        annotations_for_similarity,
        ontology,
        go_meta,
    )
    with SIMILARITY_JSON.open("w", encoding="utf-8") as handle:
        json.dump(similarity_payload, handle, indent=2)
    print(f"[ok] Wrote {SIMILARITY_JSON}")

    print(f"Done. {len(proteins)} proteins ready for Geneguessr.")


if __name__ == "__main__":
    main()




