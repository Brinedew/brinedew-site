#!/usr/bin/env python3
"""
Rebuild the Geneguessr static payload from the live protein gallery.

This script now pulls data directly from:
- Markdown protein pages in Website/content/wiki (only non-draft pages tagged "protein")
- Thoteins feature CSVs (for canonical molecular metadata)
- UniProt JSON snapshots (Website/tools/thoteins/data/proteins/uniprot/*.json)
- A cached GO ontology file (Website/data/go/go-basic.obo)

Outputs:
- tools/thoteins/data/geneguessr/proteins.json         → normalized protein records
- tools/thoteins/data/geneguessr/index.json        → eligible IDs + seed salt
- tools/thoteins/data/geneguessr/similarity.json   → GO similarity matrix + metadata

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
import subprocess
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import frontmatter
import requests

# Paths
BASE_DIR = Path(__file__).parent.parent
CONTENT_DIR = BASE_DIR / "content" / "wiki"
FEATURES_CSV = BASE_DIR / "tools" / "thoteins" / "data" / "proteins" / "features.csv"
UNIPROT_JSON_DIR = BASE_DIR / "tools" / "thoteins" / "data" / "proteins" / "uniprot"
GO_ONTOLOGY_PATH = BASE_DIR / "data" / "go" / "go-basic.obo"
NCBI_GENE_CACHE = BASE_DIR / "tools" / "thoteins" / "data" / "ncbi_gene"
OUTPUT_DIR = BASE_DIR / "tools" / "thoteins" / "data" / "geneguessr"
DATA_JSON = OUTPUT_DIR / "proteins.json"
INDEX_JSON = OUTPUT_DIR / "index.json"
SIMILARITY_JSON = OUTPUT_DIR / "similarity.json"

# Inclusion criteria
MIN_LENGTH = 100  # aa
MAX_LENGTH = 5_000  # aa
MIN_DOMAINS = 1

# Similarity parameters
GO_ASPECTS = ("bp", "mf", "cc")
HINT_ASPECT = "bp"  # Aspect used for clue hint text
SIMILARITY_METRIC = "lin"
SIMILARITY_AGGREGATION = "bma"
ASPECT_WEIGHT_DEFAULTS = {"bp": 0.4, "mf": 0.45, "cc": 0.15}
ENABLE_EXTRA_CHANNELS = False
CHANNEL_WEIGHT_DEFAULTS = {"go": 0.7, "interpro": 0.25, "reactome": 0.05}
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


def extract_interpro_domain_ids(uniprot_id: str) -> Set[str]:
    """Extract InterPro domain IDs (for similarity computation)."""
    entry = load_uniprot_entry(uniprot_id)
    if not entry:
        return set()
    
    domains = set()
    for ref in entry.get("uniProtKBCrossReferences", []):
        if ref.get("database") == "InterPro":
            domain_id = ref.get("id")
            if domain_id:
                domains.add(domain_id)
    return domains


def extract_interpro_domains(uniprot_id: str) -> Set[str]:
    """Extract InterPro domain IDs from UniProt JSON cross-references (for similarity)."""
    entry = load_uniprot_entry(uniprot_id)
    if not entry:
        return set()
    
    domains = set()
    for ref in entry.get("uniProtKBCrossReferences", []):
        if ref.get("database") == "InterPro":
            domain_id = ref.get("id")
            if domain_id:
                domains.add(domain_id)
    return domains


def extract_interpro_domain_names(uniprot_id: str) -> List[str]:
    """Extract human-readable InterPro domain names from UniProt JSON."""
    entry = load_uniprot_entry(uniprot_id)
    if not entry:
        return []
    
    domains = []
    for ref in entry.get("uniProtKBCrossReferences", []):
        if ref.get("database") == "InterPro":
            domain_id = ref.get("id")
            if not domain_id:
                continue
            # Extract the human-readable name from properties
            name = None
            for prop in ref.get("properties", []):
                if prop.get("key") == "EntryName":
                    name = prop.get("value")
                    break
            # Use name if available, otherwise fall back to ID
            domains.append(name if name else domain_id)
    return domains


def extract_reactome_pathways(uniprot_id: str) -> List[Dict[str, str]]:
    """Extract Reactome pathway IDs + names from UniProt JSON cross-references."""
    entry = load_uniprot_entry(uniprot_id)
    if not entry:
        return []
    
    pathways: List[Dict[str, str]] = []
    for ref in entry.get("uniProtKBCrossReferences", []):
        if ref.get("database") == "Reactome":
            pathway_id = ref.get("id")
            if not pathway_id:
                continue
            name = None
            for prop in ref.get("properties", []):
                if prop.get("key") == "PathwayName":
                    name = prop.get("value")
                    break
            pathways.append({
                "id": pathway_id,
                "name": name or "",
            })
    return pathways


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


def extract_ncbi_gene_id(uniprot_entry: Optional[Dict[str, object]]) -> Optional[str]:
    """Extract NCBI GeneID from UniProt JSON cross-references."""
    if not uniprot_entry:
        return None
    cross_refs = uniprot_entry.get("uniProtKBCrossReferences", [])
    for ref in cross_refs:
        if ref.get("database") == "GeneID":
            gene_id = ref.get("id")
            if gene_id:
                return str(gene_id)
    return None


def fetch_mygene_summary(gene_id: str) -> Optional[Dict[str, object]]:
    """Fallback: fetch gene summary from MyGene.info API."""
    try:
        url = f"https://mygene.info/v3/gene/{gene_id}"
        params = {"fields": "summary"}
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            summary_text = data.get("summary")
            if summary_text and isinstance(summary_text, str):
                return {
                    "text": summary_text.strip(),
                    "source": "MyGene.info",
                    "source_id": f"GeneID:{gene_id}",
                    "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "license": "See MyGene terms",
                    "url": f"https://mygene.info/v3/gene/{gene_id}",
                }
    except Exception as e:
        print(f"[warn] MyGene.info fetch failed for {gene_id}: {e}")
    return None


def extract_uniprot_function(uniprot_entry: Optional[Dict[str, object]]) -> Optional[Dict[str, object]]:
    """Fallback: extract first sentence of UniProt Function comment."""
    if not uniprot_entry:
        return None
    
    comments = uniprot_entry.get("comments", [])
    for comment in comments:
        if comment.get("commentType") == "FUNCTION":
            texts = comment.get("texts", [])
            if texts and isinstance(texts, list):
                full_text = texts[0].get("value", "")
                # Take first sentence, up to ~350 chars
                first_sentence = full_text.split(". ")[0]
                if len(first_sentence) > 350:
                    first_sentence = first_sentence[:347] + "..."
                if first_sentence:
                    uniprot_id = uniprot_entry.get("primaryAccession", "")
                    return {
                        "text": first_sentence.strip(),
                        "source": "UniProtKB",
                        "source_id": f"UniProt:{uniprot_id}",
                        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                        "license": "CC BY 4.0",
                        "url": f"https://www.uniprot.org/uniprotkb/{uniprot_id}/entry",
                    }
    return None


def build_ncbi_gene_summaries(gene_ids: List[str]) -> Dict[str, Dict[str, object]]:
    """
    Bulk-fetch gene summaries from NCBI Datasets CLI.
    Returns dict mapping GeneID → summary object.
    """
    if not gene_ids:
        return {}
    
    # Create cache directory
    NCBI_GENE_CACHE.mkdir(parents=True, exist_ok=True)
    
    # Check for existing cache
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cache_file = NCBI_GENE_CACHE / f"gene_summaries_{today}.json"
    
    if cache_file.exists():
        print(f"[info] Loading cached NCBI gene summaries from {cache_file}")
        return json.loads(cache_file.read_text(encoding="utf-8"))
    
    print(f"[info] Fetching {len(gene_ids)} gene summaries from NCBI Datasets...")
    
    # Write gene IDs to temp file
    ids_file = NCBI_GENE_CACHE / "gene_ids.txt"
    ids_file.write_text("\n".join(gene_ids), encoding="utf-8")
    
    # Download via datasets CLI (use local binary if available)
    zip_path = NCBI_GENE_CACHE / "ncbi_gene_pkg.zip"
    
    # Try local datasets.exe first, then system PATH
    datasets_cmd = BASE_DIR / "scripts" / "datasets.exe"
    if not datasets_cmd.exists():
        datasets_cmd = "datasets"
    
    try:
        subprocess.run(
            [
                str(datasets_cmd),
                "download",
                "gene",
                "gene-id",
                "--inputfile",
                str(ids_file),
                "--include",
                "none",
                "--filename",
                str(zip_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"[warn] NCBI Datasets download failed: {e.stderr}")
        return {}
    except FileNotFoundError:
        print("[warn] 'datasets' CLI not found. Install from: https://www.ncbi.nlm.nih.gov/datasets/docs/v2/download-and-install/")
        return {}
    
    # Extract and parse data_report.jsonl
    import zipfile
    summaries = {}
    
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            # Find data_report.jsonl inside the zip
            report_path = None
            for name in zf.namelist():
                if name.endswith("data_report.jsonl"):
                    report_path = name
                    break
            
            if not report_path:
                print("[warn] No data_report.jsonl found in NCBI Datasets package")
                return {}
            
            with zf.open(report_path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    record = json.loads(line.decode("utf-8"))
                    
                    # Extract gene ID
                    gene_id = str(record.get("geneId", ""))
                    if not gene_id:
                        continue
                    
                    # Extract summary (first available from summary list)
                    gene_summaries = record.get("summary", [])
                    if gene_summaries and isinstance(gene_summaries, list):
                        summary_obj = gene_summaries[0]
                        summary_text = summary_obj.get("description", "")
                        if summary_text:
                            summaries[gene_id] = {
                                "text": summary_text.strip(),
                                "source": "NCBI Gene",
                                "source_id": f"GeneID:{gene_id}",
                                "retrieved": today,
                                "license": "Public Domain",
                                "url": f"https://www.ncbi.nlm.nih.gov/gene/{gene_id}",
                            }
    except Exception as e:
        print(f"[warn] Failed to parse NCBI Datasets package: {e}")
        return {}
    
    # Cache results
    cache_file.write_text(json.dumps(summaries, indent=2), encoding="utf-8")
    print(f"[info] Cached {len(summaries)} gene summaries to {cache_file}")
    
    return summaries


def get_gene_summary(uniprot_id: str, gene_id: Optional[str], ncbi_summaries: Dict[str, Dict[str, object]]) -> Optional[Dict[str, object]]:
    """
    Get gene summary with fallback chain: NCBI → MyGene.info → UniProt Function.
    """
    # Try NCBI first
    if gene_id and gene_id in ncbi_summaries:
        return ncbi_summaries[gene_id]
    
    # Try MyGene.info as fallback
    if gene_id:
        mygene_result = fetch_mygene_summary(gene_id)
        if mygene_result:
            time.sleep(0.2)  # Rate limiting for MyGene.info
            return mygene_result
    
    # Final fallback: UniProt Function
    uniprot_entry = load_uniprot_entry(uniprot_id)
    return extract_uniprot_function(uniprot_entry)


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
    """Prefer curated domains from the page; fall back to CSV, then UniProt."""
    domains = page.get("domains") or []
    if isinstance(domains, str):
        domains = [domains]
    domains = [d for d in domains if d]
    if domains:
        return domains
    # Try CSV domains_top3 field
    csv_domains = parse_domains(feature_row.get("domains_top3"))
    if csv_domains:
        return csv_domains
    # Final fallback: extract from UniProt JSON with human-readable names
    uniprot_id = page.get("uniprot_id") or feature_row.get("uniprot_id")
    if uniprot_id:
        return extract_interpro_domain_names(uniprot_id)
    return []


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
    ontology: Dict[str, GOTerm],
    gene_summary: Optional[Dict[str, object]] = None,
    reactome_paths: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, object]:
    """Merge wiki frontmatter + features + GO annotations + gene summary into a JSON-ready dict."""
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

    def go_term_names(go_ids: Set[str]) -> List[str]:
        names: List[str] = []
        for go_id in sorted(go_ids):
            term = ontology.get(go_id)
            names.append(term.name if term else go_id)
        return names

    record = {
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
        "go_terms_named": {
            "bp": go_term_names(go_annotations["bp"]),
            "mf": go_term_names(go_annotations["mf"]),
            "cc": go_term_names(go_annotations["cc"]),
        },
        "reactome_pathways": reactome_paths or [],
    }
    
    # Add gene summary if available
    if gene_summary:
        record["gene_summary"] = gene_summary
    
    return record


def compute_go_similarity_matrix(
    annotations: Dict[str, Set[str]],
    ontology: Dict[str, GOTerm],
) -> Tuple[Dict[str, Dict[str, float]], int]:
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
    return matrix, len(annotated)


def calibrate_similarity_matrix(
    matrix: Dict[str, Dict[str, float]]
) -> Tuple[Dict[str, Dict[str, float]], Dict[str, object]]:
    values = [score for row in matrix.values() for score in row.values()]
    if not values:
        return matrix, {"method": "none", "value_count": 0}
    
    value_counts = Counter(values)
    total = len(values)
    cumulative = 0
    cdf: Dict[float, float] = {}
    for value in sorted(value_counts):
        cumulative += value_counts[value]
        cdf[value] = cumulative / total
    
    calibrated: Dict[str, Dict[str, float]] = {}
    for pid, row in matrix.items():
        calibrated[pid] = {other: round(cdf[score], 6) for other, score in row.items()}
    
    return calibrated, {"method": "empirical_cdf", "value_count": total}


def compute_jaccard_similarity_matrix(
    signatures: Dict[str, Set[str]],
) -> Tuple[Dict[str, Dict[str, float]], Dict[str, object]]:
    proteins = sorted(signatures.keys())
    matrix: Dict[str, Dict[str, float]] = {}
    informative = sum(1 for sig in signatures.values() if sig)
    for pid_a in proteins:
        row: Dict[str, float] = {}
        set_a = signatures.get(pid_a, set())
        for pid_b in proteins:
            set_b = signatures.get(pid_b, set())
            if not set_a and not set_b:
                score = 0.0
            else:
                union = set_a.union(set_b)
                score = 0.0 if not union else len(set_a.intersection(set_b)) / len(union)
            row[pid_b] = round(score, 6)
        matrix[pid_a] = row
    metadata = {
        "similarity": "jaccard",
        "informative_proteins": informative,
        "total_proteins": len(proteins),
        "average_signature_size": round(
            sum(len(sig) for sig in signatures.values()) / max(1, len(signatures)), 3
        ),
    }
    return matrix, metadata


def build_go_training_examples(
    calibrated_aspects: Dict[str, Dict[str, Dict[str, float]]],
    interpro_signatures: Dict[str, Set[str]],
    reactome_signatures: Dict[str, Set[str]],
) -> Tuple[List[List[float]], List[int]]:
    if not calibrated_aspects:
        return [], []
    
    sample_matrix = next(iter(calibrated_aspects.values()))
    proteins = sorted(sample_matrix.keys())
    if len(proteins) < 2:
        return [], []
    
    features: List[List[float]] = []
    labels: List[int] = []
    
    for i, pid_a in enumerate(proteins):
        for pid_b in proteins[i + 1:]:
            vec = [
                calibrated_aspects.get(aspect, {}).get(pid_a, {}).get(pid_b, 0.0)
                for aspect in GO_ASPECTS
            ]
            domains_a = interpro_signatures.get(pid_a, set())
            domains_b = interpro_signatures.get(pid_b, set())
            pathways_a = reactome_signatures.get(pid_a, set())
            pathways_b = reactome_signatures.get(pid_b, set())
            share_domain = bool(domains_a and domains_b and domains_a.intersection(domains_b))
            share_pathway = bool(pathways_a and pathways_b and pathways_a.intersection(pathways_b))
            label = 1 if (share_domain or share_pathway) else 0
            features.append(vec)
            labels.append(label)
    
    return features, labels


def learn_go_aspect_weights(
    features: List[List[float]],
    labels: List[int],
    learning_rate: float = 0.1,
    epochs: int = 400,
) -> Tuple[Dict[str, float], Dict[str, object]]:
    positives = sum(labels)
    negatives = len(labels) - positives
    if not features or positives == 0 or negatives == 0:
        return ASPECT_WEIGHT_DEFAULTS.copy(), {
            "source": "default",
            "reason": "insufficient_training_pairs",
            "positives": positives,
            "negatives": negatives,
        }
    
    weights = [0.0 for _ in GO_ASPECTS]
    bias = 0.0
    n = len(features)
    
    for _ in range(epochs):
        grad_w = [0.0 for _ in GO_ASPECTS]
        grad_b = 0.0
        for vec, label in zip(features, labels):
            z = bias + sum(w * x for w, x in zip(weights, vec))
            pred = 1 / (1 + math.exp(-z))
            error = pred - label
            grad_b += error
            for i in range(len(GO_ASPECTS)):
                grad_w[i] += error * vec[i]
        grad_b /= n
        for i in range(len(GO_ASPECTS)):
            grad_w[i] /= n
            weights[i] -= learning_rate * grad_w[i]
        bias -= learning_rate * grad_b
    
    positive = [max(0.0, w) for w in weights]
    total = sum(positive)
    if total <= 0:
        return ASPECT_WEIGHT_DEFAULTS.copy(), {
            "source": "default",
            "reason": "non_positive_weights",
            "positives": positives,
            "negatives": negatives,
        }
    
    normalized = {aspect: val / total for aspect, val in zip(GO_ASPECTS, positive)}
    return normalized, {
        "source": "learned",
        "positives": positives,
        "negatives": negatives,
        "bias": round(bias, 6),
    }


def combine_calibrated_aspects(
    calibrated_aspects: Dict[str, Dict[str, Dict[str, float]]],
    weights: Dict[str, float],
) -> Dict[str, Dict[str, float]]:
    proteins = set()
    for matrix in calibrated_aspects.values():
        proteins.update(matrix.keys())
    combined: Dict[str, Dict[str, float]] = {}
    for pid_a in proteins:
        row: Dict[str, float] = {}
        for pid_b in proteins:
            score = 0.0
            for aspect in GO_ASPECTS:
                weight = weights.get(aspect, 0.0)
                if weight == 0:
                    continue
                aspect_matrix = calibrated_aspects.get(aspect, {})
                aspect_row = aspect_matrix.get(pid_a, {})
                score += weight * aspect_row.get(pid_b, 0.0)
            row[pid_b] = round(score, 6)
        combined[pid_a] = row
    return combined


def blend_similarity_channels(
    go_scores: Dict[str, Dict[str, float]],
    interpro_scores: Dict[str, Dict[str, float]],
    reactome_scores: Dict[str, Dict[str, float]],
    weights: Dict[str, float],
) -> Dict[str, Dict[str, float]]:
    proteins = sorted(go_scores.keys())
    blended: Dict[str, Dict[str, float]] = {}
    for pid_a in proteins:
        row: Dict[str, float] = {}
        go_row = go_scores.get(pid_a, {})
        ipr_row = interpro_scores.get(pid_a, {})
        pathway_row = reactome_scores.get(pid_a, {})
        for pid_b in proteins:
            score = (
                weights.get("go", 0.0) * go_row.get(pid_b, 0.0)
                + weights.get("interpro", 0.0) * ipr_row.get(pid_b, 0.0)
                + weights.get("reactome", 0.0) * pathway_row.get(pid_b, 0.0)
            )
            row[pid_b] = round(score, 6)
        blended[pid_a] = row
    return blended


def compute_similarity_payload(
    annotations: Dict[str, Dict[str, Set[str]]],
    ontology: Dict[str, GOTerm],
    go_metadata: Dict[str, str],
    interpro_signatures: Dict[str, Set[str]],
    reactome_signatures: Dict[str, Set[str]],
) -> Dict[str, object]:
    """Generate similarity.json content."""
    aspect_payloads: Dict[str, Dict[str, object]] = {}
    calibrated_matrices: Dict[str, Dict[str, Dict[str, float]]] = {}
    aspect_annotations_counts: Dict[str, int] = {}
    
    for aspect in GO_ASPECTS:
        aspect_annotations = {
            pid: annotation.get(aspect, set())
            for pid, annotation in annotations.items()
        }
        raw_matrix, annotated_count = compute_go_similarity_matrix(aspect_annotations, ontology)
        calibrated_matrix, calibration_meta = calibrate_similarity_matrix(raw_matrix)
        aspect_payloads[aspect] = {
            "raw_scores": raw_matrix,
            "calibrated_scores": calibrated_matrix,
            "metadata": {
                "aspect": ASPECT_TO_NAMESPACE[aspect],
                "annotated_proteins": annotated_count,
                "calibration": calibration_meta,
            },
        }
        calibrated_matrices[aspect] = calibrated_matrix
        aspect_annotations_counts[aspect] = annotated_count

    features, labels = build_go_training_examples(calibrated_matrices, interpro_signatures, reactome_signatures)
    aspect_weights, weight_meta = learn_go_aspect_weights(features, labels)
    combined_scores = combine_calibrated_aspects(calibrated_matrices, aspect_weights)

    interpro_matrix, interpro_meta = compute_jaccard_similarity_matrix(interpro_signatures)
    interpro_meta.update({
        "feature": "interpro_domains",
    })
    reactome_matrix, reactome_meta = compute_jaccard_similarity_matrix(reactome_signatures)
    reactome_meta.update({
        "feature": "reactome_pathways",
    })

    if ENABLE_EXTRA_CHANNELS:
        channel_weights = CHANNEL_WEIGHT_DEFAULTS.copy()
        blended_scores = blend_similarity_channels(
            combined_scores,
            interpro_matrix,
            reactome_matrix,
            channel_weights,
        )
    else:
        channel_weights = {"go": 1.0, "interpro": 0.0, "reactome": 0.0}
        blended_scores = combined_scores

    evidence_policy = "Exclude IEA (electronic) GO annotations"
    metadata = {
        "metric": SIMILARITY_METRIC,
        "aggregation": SIMILARITY_AGGREGATION,
        "evidence_policy": evidence_policy,
        "go_release": go_metadata.get("data-version", "unknown"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_proteins": len(annotations),
        "aspect_weights": aspect_weights,
        "weight_details": weight_meta,
        "calibration": "empirical_cdf_per_aspect",
        "go_aspects": [ASPECT_TO_NAMESPACE[a] for a in GO_ASPECTS],
        "aspect_annotation_counts": aspect_annotations_counts,
        "channel_weights": channel_weights,
    }

    return {
        "metadata": metadata,
        "scores": blended_scores,
        "go_channels": {
            "aspects": aspect_payloads,
            "weights": aspect_weights,
            "weight_details": weight_meta,
        },
        "interpro_channel": {
            "enabled": ENABLE_EXTRA_CHANNELS,
            "scores": interpro_matrix if ENABLE_EXTRA_CHANNELS else {},
            "metadata": interpro_meta,
        },
        "reactome_channel": {
            "enabled": ENABLE_EXTRA_CHANNELS,
            "scores": reactome_matrix if ENABLE_EXTRA_CHANNELS else {},
            "metadata": reactome_meta,
        },
    }


def main() -> None:
    print("==> Loading GO ontology")
    ontology, go_meta = parse_go_obo(GO_ONTOLOGY_PATH)
    features = load_features()
    pages = load_protein_pages()

    # First pass: collect all gene IDs for bulk fetch
    print("==> Collecting NCBI Gene IDs")
    gene_ids = []
    for md_path, page in pages:
        uniprot_id = page.get("uniprot_id").strip()
        uniprot_entry = load_uniprot_entry(uniprot_id)
        gene_id = extract_ncbi_gene_id(uniprot_entry)
        if gene_id:
            gene_ids.append(gene_id)
    
    # Bulk fetch NCBI gene summaries
    ncbi_summaries = build_ncbi_gene_summaries(list(set(gene_ids)))
    
    proteins: List[Dict[str, object]] = []
    annotations_for_similarity: Dict[str, Dict[str, Set[str]]] = {}
    interpro_signatures: Dict[str, Set[str]] = {}
    reactome_signatures: Dict[str, Set[str]] = {}

    print(f"==> Building dataset from {len(pages)} published protein pages")
    for md_path, page in pages:
        uniprot_id = page.get("uniprot_id").strip()
        feature_row = features.get(uniprot_id)
        if not feature_row:
            print(f"[warn] {uniprot_id}: not present in features.csv, skipping")
            continue

        go_annotations = gather_go_annotations(uniprot_id, ontology)
        reactome_paths = extract_reactome_pathways(uniprot_id)
        
        # Get gene summary with fallback chain
        uniprot_entry = load_uniprot_entry(uniprot_id)
        gene_id = extract_ncbi_gene_id(uniprot_entry)
        gene_summary = get_gene_summary(uniprot_id, gene_id, ncbi_summaries)
        
        record = build_protein_record(
            md_path,
            page,
            feature_row,
            go_annotations,
            ontology,
            gene_summary,
            reactome_paths,
        )

        # Apply gameplay filters
        if not (MIN_LENGTH <= record["length"] <= MAX_LENGTH):
            continue
        if len(record["domains"]) < MIN_DOMAINS:
            continue

        proteins.append(record)
        annotations_for_similarity[uniprot_id] = {
            aspect: set(go_annotations.get(aspect, set()))
            for aspect in GO_ASPECTS
        }
        interpro_signatures[uniprot_id] = extract_interpro_domains(uniprot_id)
        reactome_signatures[uniprot_id] = {p["id"] for p in reactome_paths if p.get("id")}

    if not proteins:
        raise RuntimeError("No proteins met the inclusion criteria; aborting.")

    # Compute IC once we know the annotation universe
    bp_annotations = {pid: ann.get(HINT_ASPECT, set()) for pid, ann in annotations_for_similarity.items()}
    counts = compute_term_counts(bp_annotations, ontology)
    ic_map = compute_ic(counts, len([terms for terms in bp_annotations.values() if terms]))
    for record in proteins:
        hint_terms = select_go_hint_terms(
            record["go_terms"][HINT_ASPECT],
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
        interpro_signatures,
        reactome_signatures,
    )
    with SIMILARITY_JSON.open("w", encoding="utf-8") as handle:
        json.dump(similarity_payload, handle, indent=2)
    print(f"[ok] Wrote {SIMILARITY_JSON}")

    print(f"Done. {len(proteins)} proteins ready for Geneguessr.")


if __name__ == "__main__":
    main()
