#!/usr/bin/env python3
"""
Rebuild the Geneguessr static payload from the embedding-driven metadata roster.

This script builds the normalized payload from a vector-driven metadata file
(`tools/thoteins/data/geneguessr/embedding_proteins.json`) and UniProt JSON
snapshots where available. It no longer builds from the Markdown wiki pages and
does not compute GO-based similarity channels.

Outputs:
- tools/thoteins/data/geneguessr/proteins.json         → normalized protein records
- tools/thoteins/data/geneguessr/index.json        → eligible IDs + seed salt

Usage:
    uv run python scripts/populate_local_database.py [--batch-size N]
    # Example:
    uv run python scripts/populate_local_database.py --batch-size 500
"""

from __future__ import annotations

import csv
import argparse
import hashlib
import json
import subprocess
# time import removed: external rate-limiting fallback removed
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
# no NamedTemporaryFile used; keep imports minimal
from typing import Dict, Iterable, List, Optional, Set, Tuple

import frontmatter
try:
    import ijson
except Exception:
    raise SystemExit("Missing dependency: ijson is required. Install via `pip install ijson` and retry.")

import requests
import time

# Paths
BASE_DIR = Path(__file__).parent.parent
CONTENT_DIR = BASE_DIR / "content" / "wiki"
FEATURES_CSV = BASE_DIR / "data" / "proteins" / "features.csv"
UNIPROT_JSON_DIR = BASE_DIR / "data" / "proteins" / "uniprot"
GO_ONTOLOGY_PATH = BASE_DIR / "data" / "go" / "go-basic.obo"
# NCBI gene cache no longer used; external NCBI Dataset fetches are removed
OUTPUT_DIR = BASE_DIR / "data" / "geneguessr"
DATA_JSON = OUTPUT_DIR / "proteins.json"
INDEX_JSON = OUTPUT_DIR / "index.json"
# Cache for NCBI gene fetches
NCBI_GENE_CACHE = BASE_DIR / "data" / "ncbi_gene_cache"
HGNC_CACHE_FILE = NCBI_GENE_CACHE / "hgnc_cache.json"
# similarity.json removed; similarity channels are no longer generated

# Inclusion criteria
MIN_LENGTH = 100  # aa
MAX_LENGTH = 5_000  # aa
MIN_DOMAINS = 1
ENABLE_WIKIPEDIA_ENRICHMENT = False  # temporary opt-out while Wikipedia pipeline is broken

# Legacy similarity parameters removed
GO_ASPECTS = ("bp", "mf", "cc")
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


# Bulk UniProt file SQLite index support
BULK_UNIPROT_PATH = UNIPROT_JSON_DIR / "uniprot_human.json"
BULK_UNIPROT_DB_PATH = NCBI_GENE_CACHE / "uniprot_bulk.db"


def build_uniprot_sqlite_index() -> None:
    """
    Build a SQLite database index of the bulk UniProt file.
    This allows O(1) lookups without loading 2.8GB into memory.
    One-time operation, cached to disk.
    """
    import sqlite3
    
    if BULK_UNIPROT_DB_PATH.exists():
        # Check if it's valid
        try:
            conn = sqlite3.connect(str(BULK_UNIPROT_DB_PATH))
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM uniprot_entries")
            count = cursor.fetchone()[0]
            conn.close()
            print(f"[info] Using existing UniProt SQLite index with {count:,} entries")
            return
        except Exception:
            print(f"[warn] Existing SQLite index is corrupted, rebuilding...")
            BULK_UNIPROT_DB_PATH.unlink()
    
    if not BULK_UNIPROT_PATH.exists():
        print(f"[warn] Bulk UniProt file not found at {BULK_UNIPROT_PATH}")
        return
    
    print(f"[info] Building UniProt SQLite index (one-time, ~3-5 minutes)...")
    NCBI_GENE_CACHE.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(str(BULK_UNIPROT_DB_PATH))
    cursor = conn.cursor()
    
    # Create table
    cursor.execute("""
        CREATE TABLE uniprot_entries (
            accession TEXT PRIMARY KEY,
            json_data TEXT NOT NULL
        )
    """)
    
    # Stream and insert
    count = 0
    batch = []
    BATCH_SIZE = 1000
    
    try:
        with open(BULK_UNIPROT_PATH, 'rb') as f:
            parser = ijson.items(f, 'results.item')
            for entry in parser:
                accession = entry.get('primaryAccession')
                if accession:
                    # Convert to JSON, handling Decimal types
                    json_data = json.dumps(entry, ensure_ascii=False, default=str)
                    batch.append((accession, json_data))
                    count += 1
                    
                    if len(batch) >= BATCH_SIZE:
                        cursor.executemany(
                            "INSERT OR REPLACE INTO uniprot_entries (accession, json_data) VALUES (?, ?)",
                            batch
                        )
                        batch = []
                        if count % 10000 == 0:
                            print(f"  Indexed {count:,} entries...")
                            conn.commit()
        
        # Insert remaining
        if batch:
            cursor.executemany(
                "INSERT OR REPLACE INTO uniprot_entries (accession, json_data) VALUES (?, ?)",
                batch
            )
        
        conn.commit()
        
        # Create index for fast lookups
        print(f"[info] Creating index...")
        cursor.execute("CREATE INDEX idx_accession ON uniprot_entries(accession)")
        conn.commit()
        
        print(f"[info] Built SQLite index with {count:,} UniProt entries")
        
    except Exception as e:
        print(f"[error] Failed to build SQLite index: {e}")
        conn.close()
        if BULK_UNIPROT_DB_PATH.exists():
            BULK_UNIPROT_DB_PATH.unlink()
        raise
    
    conn.close()


def load_uniprot_from_sqlite(uniprot_id: str) -> Optional[Dict[str, object]]:
    """
    Load a single UniProt entry from SQLite database.
    Fast O(1) lookup without loading entire file into memory.
    """
    import sqlite3
    
    if not BULK_UNIPROT_DB_PATH.exists():
        return None
    
    try:
        conn = sqlite3.connect(str(BULK_UNIPROT_DB_PATH))
        cursor = conn.cursor()
        cursor.execute(
            "SELECT json_data FROM uniprot_entries WHERE accession = ?",
            (uniprot_id,)
        )
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return json.loads(row[0])
    except Exception as e:
        print(f"[warn] SQLite lookup failed for {uniprot_id}: {e}")
    
    return None


def load_uniprot_entry(uniprot_id: str) -> Optional[Dict[str, object]]:
    """Load UniProt JSON once per protein (from individual file or SQLite DB)."""
    if uniprot_id in UNIPROT_CACHE:
        return UNIPROT_CACHE[uniprot_id]
    
    # Try individual file first (fastest)
    json_path = UNIPROT_JSON_DIR / f"{uniprot_id}.json"
    if json_path.exists():
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
            UNIPROT_CACHE[uniprot_id] = data
            return data
        except Exception as e:
            print(f"[warn] Failed to load {json_path}: {e}")
    
    # Fallback to SQLite database (fast O(1) lookup)
    data = load_uniprot_from_sqlite(uniprot_id)
    if data:
        UNIPROT_CACHE[uniprot_id] = data
        return data
    
    # Not found anywhere
    UNIPROT_CACHE[uniprot_id] = None
    return None


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
    """Extract InterPro domain IDs from UniProt JSON cross-references."""
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
    """Extract InterPro domain IDs from UniProt JSON cross-references."""
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


def extract_uniprot_synonyms(uniprot_entry: Optional[Dict[str, object]]) -> List[str]:
    """Extract gene/protein name synonyms from a UniProt JSON entry.

    Returns a list of short aliases (gene names, synonyms, alt protein names).
    """
    if not uniprot_entry:
        return []
    aliases: List[str] = []
    # Gene names
    gene_names = uniprot_entry.get("gene", {})
    # geneNames may appear under different keys in snapshots; try common patterns
    for key in ("geneName", "gene_names", "geneNames", "gene_names_from_source"):  # best-effort
        gn = uniprot_entry.get(key)
        if isinstance(gn, dict):
            name = gn.get("value") or gn.get("primary")
            if name:
                aliases.append(str(name))
        elif isinstance(gn, str):
            aliases.append(gn)

    # Cross-reference gene names block
    # Some snapshots use 'gene' -> 'geneName' / 'synonyms'
    if isinstance(gene_names, dict):
        primary = gene_names.get("geneName") or gene_names.get("primary")
        if isinstance(primary, dict):
            v = primary.get("value")
            if v:
                aliases.append(v)
        elif isinstance(primary, str):
            aliases.append(primary)
        syns = gene_names.get("synonyms") or gene_names.get("synonym")
        if isinstance(syns, list):
            for s in syns:
                if isinstance(s, dict):
                    val = s.get("value") or s.get("name")
                    if val:
                        aliases.append(val)
                elif isinstance(s, str):
                    aliases.append(s)

    # Protein description alternative names
    prot_desc = uniprot_entry.get("proteinDescription") or uniprot_entry.get("protein_description")
    if isinstance(prot_desc, dict):
        # recommendedName / alternativeNames
        alt = prot_desc.get("alternativeNames") or prot_desc.get("alternative_names")
        if isinstance(alt, list):
            for a in alt:
                if isinstance(a, dict):
                    name = a.get("fullName") or a.get("recommendedName") or a.get("full_name")
                    if isinstance(name, dict):
                        val = name.get("value")
                        if val:
                            aliases.append(val)
                    elif isinstance(name, str):
                        aliases.append(name)
                elif isinstance(a, str):
                    aliases.append(a)

    # uniProt 'uniProtKBCrossReferences' may include gene names in properties for HGNC etc.
    # Deduplicate and normalize
    seen = set()
    out = []
    for a in aliases:
        if not a:
            continue
        norm = a.strip()
        if not norm:
            continue
        if norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out


def fetch_hgnc_aliases(symbol: str) -> Tuple[Optional[List[str]], Optional[str]]:
    """Fetch HGNC alias_symbol and prev_symbol for a gene symbol, with local caching.

    Returns (aliases, error) where aliases is a list or None on failure.
    """
    if not symbol:
        return None, "no symbol"
    # Ensure cache dir
    try:
        NCBI_GENE_CACHE.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    # Load cache
    cache: Dict[str, List[str]] = {}
    if HGNC_CACHE_FILE.exists():
        try:
            cache = json.loads(HGNC_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}

    if symbol in cache:
        return cache[symbol], None

    url = f"https://rest.genenames.org/fetch/symbol/{symbol}"
    try:
        r = requests.get(url, headers={"Accept": "application/json"}, timeout=8)
        if r.status_code != 200:
            return None, f"HGNC returned {r.status_code}"
        obj = r.json()
        docs = obj.get("response", {}).get("docs", [])
        if not docs:
            cache[symbol] = []
            HGNC_CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            return [], None
        doc = docs[0]
        aliases = []
        for k in ("alias_symbol", "prev_symbol"):
            v = doc.get(k) or []
            if isinstance(v, list):
                for a in v:
                    if a:
                        aliases.append(a)
        # uniq
        uniq = []
        seen2 = set()
        for a in aliases:
            if a not in seen2:
                seen2.add(a)
                uniq.append(a)
        cache[symbol] = uniq
        try:
            HGNC_CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
        return uniq, None
    except Exception as e:
        return None, str(e)


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


def extract_uniprot_quality(uniprot_entry: Optional[Dict[str, object]]) -> Optional[int]:
    """
    Extract UniProt annotation score (1-5 scale).
    No normalization - keep as-is from the annotationScore field.
    """
    if not uniprot_entry:
        return None
    
    score = uniprot_entry.get("annotationScore")
    if score is None:
        return None
    
    # Handle both numeric and string values (SQLite stores as string)
    try:
        # Convert to float first (handles "5.0"), then to int
        return int(float(score))
    except (TypeError, ValueError):
        return None


def get_wikipedia_title(hgnc: str, full_name: str, uniprot_id: str) -> Optional[str]:
    """
    Find Wikipedia article by querying Wikidata for entities with our UniProt ID (P352).
    This is the REVERSE lookup: UniProt ID → Wikidata → Wikipedia article.
    100% accurate, handles all edge cases (disambiguation, redirects, synonyms).
    """
    if not uniprot_id:
        return None
    
    # SPARQL query to Wikidata
    sparql_query = f"""
    SELECT ?article WHERE {{
      ?item wdt:P352 "{uniprot_id}" .
      ?article schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> .
    }}
    """
    
    url = "https://query.wikidata.org/sparql"
    headers = {
        "User-Agent": "GeneGuessr/1.0 (https://brinedew.com; contact@brinedew.com) Python-requests",
        "Accept": "application/sparql-results+json"
    }
    params = {
        "query": sparql_query,
        "format": "json"
    }
    
    try:
        response = requests.get(url, params=params, headers=headers, timeout=15)
        
        if response.status_code != 200:
            print(f"[error] Wikidata SPARQL returned {response.status_code} for {uniprot_id}")
            return None
        
        data = response.json()
        results = data.get("results", {}).get("bindings", [])
        
        if not results:
            # No Wikipedia article found for this UniProt ID
            return None
        
        if len(results) == 1:
            # Perfect! Exactly one Wikipedia article
            article_url = results[0]["article"]["value"]
            # Extract title from URL: https://en.wikipedia.org/wiki/P53 -> P53
            title = article_url.split("/wiki/")[-1].replace("_", " ")
            # URL decode
            import urllib.parse
            title = urllib.parse.unquote(title)
            print(f"[wiki] ✓ Found article for {hgnc}: {title}")
            return title
        
        # Multiple Wikipedia articles found - pick best match
        print(f"[debug] Found {len(results)} Wikipedia articles for {uniprot_id}")
        
        for result in results:
            article_url = result["article"]["value"]
            title = article_url.split("/wiki/")[-1].replace("_", " ")
            title = urllib.parse.unquote(title)
            print(f"[debug]   - {title}")
            
            # Prefer exact HGNC match
            if hgnc and hgnc.upper() == title.upper():
                print(f"[wiki] ✓ Matched by HGNC: {title}")
                return title
            
            # Or title contains gene symbol
            if hgnc and hgnc.upper() in title.upper():
                print(f"[wiki] ✓ Matched by symbol in title: {title}")
                return title
        
        # Fallback: return first result
        article_url = results[0]["article"]["value"]
        title = article_url.split("/wiki/")[-1].replace("_", " ")
        title = urllib.parse.unquote(title)
        print(f"[wiki] ✓ Using first result: {title}")
        return title
        
    except Exception as e:
        print(f"[error] Wikidata SPARQL query failed for {uniprot_id}: {e}")
        return None


# Wikipedia pageviews cache
WIKIPEDIA_PAGEVIEWS_CACHE_FILE = NCBI_GENE_CACHE / "wikipedia_pageviews_2024.json"
WIKIPEDIA_PAGEVIEWS_CACHE: Dict[str, int] = {}

# Load Wikipedia cache at startup
if WIKIPEDIA_PAGEVIEWS_CACHE_FILE.exists():
    try:
        WIKIPEDIA_PAGEVIEWS_CACHE = json.loads(
            WIKIPEDIA_PAGEVIEWS_CACHE_FILE.read_text(encoding="utf-8")
        )
        print(f"[info] Loaded {len(WIKIPEDIA_PAGEVIEWS_CACHE)} Wikipedia pageview entries from cache")
    except Exception as e:
        print(f"[warn] Failed to load Wikipedia pageviews cache: {e}")
        WIKIPEDIA_PAGEVIEWS_CACHE = {}


def fetch_wikipedia_pageviews(article_title: str, year: int = 2024) -> int:
    """
    Fetch yearly pageviews from Wikipedia Pageviews API.
    
    API: https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
         en.wikipedia/all-access/all-agents/{article}/monthly/{start}/{end}
    
    Returns total pageviews for the year, or 0 if article doesn't exist.
    Uses local caching to avoid repeated API calls.
    """
    global WIKIPEDIA_PAGEVIEWS_CACHE
    
    # Return 0 if no article title
    if not article_title:
        return 0
    
    # Load cache if not already loaded
    if not WIKIPEDIA_PAGEVIEWS_CACHE and WIKIPEDIA_PAGEVIEWS_CACHE_FILE.exists():
        try:
            WIKIPEDIA_PAGEVIEWS_CACHE = json.loads(
                WIKIPEDIA_PAGEVIEWS_CACHE_FILE.read_text(encoding="utf-8")
            )
        except Exception:
            WIKIPEDIA_PAGEVIEWS_CACHE = {}
    
    # Check cache
    if article_title in WIKIPEDIA_PAGEVIEWS_CACHE:
        return WIKIPEDIA_PAGEVIEWS_CACHE[article_title]
    
    # Fetch from API
    try:
        url = f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{article_title}/monthly/{year}0101/{year}1231"
        headers = {
            "User-Agent": "GeneGuessr/1.0 (https://brinedew.com; contact@brinedew.com) Python-requests"
        }
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 404:
            # Article doesn't exist
            WIKIPEDIA_PAGEVIEWS_CACHE[article_title] = 0
            return 0
        
        if response.status_code != 200:
            print(f"[warn] Wikipedia Pageviews API returned {response.status_code} for '{article_title}'")
            WIKIPEDIA_PAGEVIEWS_CACHE[article_title] = 0
            return 0
        
        data = response.json()
        items = data.get("items", [])
        
        # Sum monthly pageviews
        total_views = sum(item.get("views", 0) for item in items)
        
        # Cache the result
        WIKIPEDIA_PAGEVIEWS_CACHE[article_title] = total_views
        
        # Save cache to disk
        try:
            NCBI_GENE_CACHE.mkdir(parents=True, exist_ok=True)
            WIKIPEDIA_PAGEVIEWS_CACHE_FILE.write_text(
                json.dumps(WIKIPEDIA_PAGEVIEWS_CACHE, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
        except Exception as e:
            print(f"[warn] Failed to save Wikipedia pageviews cache: {e}")
        
        # No rate limiting - Wikipedia can handle it
        
        return total_views
        
    except Exception as e:
        print(f"[error] Wikipedia Pageviews fetch failed for '{article_title}': {e}")
        WIKIPEDIA_PAGEVIEWS_CACHE[article_title] = 0
        return 0


def build_synonyms(page: frontmatter.Post, feature_row: Dict[str, str]) -> List[str]:
    """Combine aliases and short names into a small synonym list."""

    def _add_many(bucket: Set[str], values) -> None:
        if not values:
            return
        if isinstance(values, (list, tuple, set)):
            for value in values:
                _add_many(bucket, value)
            return
        if isinstance(values, dict):
            return
        text = str(values).strip()
        if text:
            bucket.add(text)

    synonyms: Set[str] = set()
    for candidate in (
        page.get("gene_symbol"),
        page.get("symbol"),
        page.get("title"),
        feature_row.get("gene_symbol"),
        feature_row.get("short_name"),
    ):
        _add_many(synonyms, candidate)

    # Frontmatter-style aliases
    aliases = page.get("aliases") or []
    _add_many(synonyms, aliases)

    # Embedding metadata already carries curated synonyms; keep them.
    _add_many(synonyms, page.get("synonyms"))

    return sorted(synonyms)


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


# GO similarity functions removed — the script only records GO annotations for
# labeling; no similarity channels are computed.


# GO hint term selection and similarity calculations removed: embedding data is authoritative


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
    uniprot_id = (page.get("uniprot_id") or page.get("uniprot") or "").strip()
    gene_symbol = (
        page.get("gene_symbol")
        or page.get("hgnc")
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

    # Build domain metadata: keep IDs for backwards compatibility, add names for UI use.
    domain_ids = sorted(extract_interpro_domain_ids(uniprot_id))
    domain_names = normalize_domains(page, feature_row)
    if domain_names and all(isinstance(d, str) and d.upper().startswith("IPR") for d in domain_names):
        fallback_names = extract_interpro_domain_names(uniprot_id)
        if fallback_names:
            domain_names = fallback_names
    if not domain_names:
        domain_names = extract_interpro_domain_names(uniprot_id)

    record = {
        "uniprot": uniprot_id,
        "hgnc": gene_symbol,
        "synonyms": build_synonyms(page, feature_row),
        "full_name": full_name,
        "length": length,
        "tmh": tmh,
        "secreted": secreted,
        "domains": domain_ids or domain_names,
        "domain_names": domain_names,
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
    
    # Add popularity metrics
    uniprot_entry = load_uniprot_entry(uniprot_id)
    record["uniprot_quality"] = extract_uniprot_quality(uniprot_entry)
    
    if ENABLE_WIKIPEDIA_ENRICHMENT:
        wikipedia_title = get_wikipedia_title(gene_symbol, full_name, uniprot_id)
        if wikipedia_title:
            record["wikipedia_pageviews"] = fetch_wikipedia_pageviews(wikipedia_title)
            record["wikipedia_title"] = wikipedia_title
        else:
            record["wikipedia_pageviews"] = 0
            record["wikipedia_title"] = None
    else:
        record["wikipedia_pageviews"] = 0
        record["wikipedia_title"] = None
    
    return record


# Similarity calculation functions are removed from this script; they can be
# reimplemented as a separate tool if needed.


def load_embedding_metadata(path: Path) -> List[dict]:
    """Load a vector-driven metadata file (embedding_proteins.json)."""
    if not path.exists():
        raise FileNotFoundError(f"Missing embedding metadata at {path}")
    # Keep this helper for small files but prefer streaming via ijson where possible
    return json.loads(path.read_text(encoding="utf-8"))


def stream_embedding_entries(path: Path):
    """Yield embedding entries one-at-a-time using ijson.

    This avoids allocating the entire embedding file in memory. ijson is optional
    but recommended for large files; if unavailable we fall back to loading the
    whole file (not ideal for very large payloads).
    """
    if not path.exists():
        raise FileNotFoundError(f"Missing embedding metadata at {path}")
    if ijson is None:
        # Fallback: load entire file and iterate (less memory-efficient)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise RuntimeError("embed file must contain an array of records")
        for item in payload:
            yield item
        return

    with path.open("rb") as handle:
        for entry in ijson.items(handle, "item"):
            yield entry


def stream_uniprot_combined(path: Path):
    """Yield UniProt entries from a combined JSON array file using ijson."""
    if not path.exists():
        return
    with path.open("rb") as handle:
        for item in ijson.items(handle, "item"):
            yield item


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=500, help="Number of records to buffer before flushing")
    parser.add_argument("--test", action="store_true", help="Test mode: process only top 200 highest quality proteins")
    args = parser.parse_args()

    print("==> Loading GO ontology")
    ontology, go_meta = parse_go_obo(GO_ONTOLOGY_PATH)
    
    # Build SQLite index for bulk UniProt file (one-time, cached)
    build_uniprot_sqlite_index()
    
    EMBED_FILE = OUTPUT_DIR / "embedding_proteins.json"

    if not EMBED_FILE.exists():
        raise FileNotFoundError(f"Embedding metadata not found: {EMBED_FILE}")

    # First pass: collect unique UniProt IDs from embedding roster (streamed)
    print("==> Collecting UniProt IDs from embedding roster")
    uniprot_ids: Set[str] = set()
    total_entries = 0
    
    # Test mode: use hardcoded list of famous proteins with known Wikipedia articles
    if args.test:
        print("==> TEST MODE: Using 10 famous proteins with known Wikipedia articles")
        test_proteins = [
            "P04637",  # TP53 (tumor suppressor)
            "P38398",  # BRCA1 (breast cancer)
            "P01308",  # INS (insulin)
            "P01375",  # TNF (tumor necrosis factor)
            "P05231",  # IL6 (interleukin 6)
            "P01112",  # HRAS (oncogene)
            "P00533",  # EGFR (epidermal growth factor receptor)
            "P42574",  # CASP3 (caspase 3)
            "P04406",  # GAPDH (glyceraldehyde-3-phosphate dehydrogenase)
            "P62258",  # YWHAE (14-3-3 protein epsilon)
        ]
        uniprot_ids = set(test_proteins)
        total_entries = len(test_proteins)
        print(f"==> Selected {total_entries} test proteins")
    else:
        for entry in stream_embedding_entries(EMBED_FILE):
            total_entries += 1
            uniprot_id = entry.get("uniprot")
            if not uniprot_id:
                continue
            uniprot_ids.add(uniprot_id)

    print(f"==> Found {len(uniprot_ids)} unique UniProt IDs across {total_entries} entries")

    # Prefill per-file UniProt snapshots for those IDs: prefer per-file JSONs.
    # If some IDs are missing, stream the combined `uniprot_human.json` once and
    # write matching per-accession files to `UNIPROT_JSON_DIR` (streamed, no large memory use).
    combined_path = UNIPROT_JSON_DIR / "uniprot_human.json"
    missing_ids: Set[str] = set()
    # Try per-file JSONs first
    for uid in sorted(uniprot_ids):
        json_path = UNIPROT_JSON_DIR / f"{uid}.json"
        if json_path.exists():
            try:
                UNIPROT_CACHE[uid] = json.loads(json_path.read_text(encoding="utf-8"))
            except Exception:
                UNIPROT_CACHE[uid] = None
        else:
            missing_ids.add(uid)

    # If we have a combined snapshot, stream it once and write per-accession files
    # for the missing IDs. This avoids holding many entries in memory.
    if missing_ids and combined_path.exists():
        print(f"==> Streaming combined UniProt file and writing {len(missing_ids)} missing per-accession files")
        UNIPROT_JSON_DIR.mkdir(parents=True, exist_ok=True)
        written = 0
        for item in stream_uniprot_combined(combined_path):
            acc = item.get("primaryAccession") or item.get("accession") or item.get("uniProtkbId")
            if not acc:
                # try some common fallbacks
                if isinstance(item.get("primaryAccession"), list):
                    acc = item.get("primaryAccession")[0]
            if not acc:
                continue
            if acc in missing_ids:
                try:
                    out_path = UNIPROT_JSON_DIR / f"{acc}.json"
                    out_path.write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
                    # Optionally populate the small in-memory cache entry to avoid re-reading immediately
                    UNIPROT_CACHE[acc] = item
                except Exception:
                    UNIPROT_CACHE[acc] = None
                missing_ids.remove(acc)
                written += 1
                if not missing_ids:
                    break
        print(f"==> Wrote {written} per-accession UniProt JSON files")

    # Build gene_ids set from the cached UniProt entries (for NCBI bulk fetch)
    gene_ids: Set[str] = set()
    for uid in uniprot_ids:
        entry = UNIPROT_CACHE.get(uid)
        if entry:
            gid = extract_ncbi_gene_id(entry)
            if gid:
                gene_ids.add(gid)

    print(f"==> Found {len(gene_ids)} unique gene IDs from cached UniProt entries")

    # Bulk fetch NCBI gene summaries (cached)
    ncbi_summaries = build_ncbi_gene_summaries(list(gene_ids))

    # Prepare output
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    temp = DATA_JSON.with_suffix(".tmp")

    batch: List[Dict[str, object]] = []
    eligible_ids: List[str] = []
    written_count = 0
    first_written = False
    processed_count = 0
    # Diagnostic counters
    skipped_short = 0
    skipped_long = 0
    skipped_no_domains = 0
    missing_uniprot_json = 0
    
    # Empty-field counters (incremented for records that are written)
    from collections import defaultdict as _dd
    empty_counts: Dict[str, int] = _dd(int)
    # fields to report on (top-level and a few nested keys)
    report_fields = [
        "uniprot",
        "hgnc",
        "synonyms",
        "full_name",
        "length",
        "tmh",
        "secreted",
        "domains",
        "tissue",
        "subcell",
        "links.uniprot",
        "links.wiki",
        "structure",
        "structure_id",
        "alphafold_id",
        "go_terms.bp",
        "go_terms.mf",
        "go_terms.cc",
        "go_terms_named.bp",
        "domain_names",
        "reactome_pathways",
        "gene_summary",
        "uniprot_quality",
        "wikipedia_pageviews",
    ]

    print(f"==> Building dataset (streaming, batch_size={args.batch_size})")
    with temp.open("w", encoding="utf-8") as out_handle:
        out_handle.write("[\n")
        for entry in stream_embedding_entries(EMBED_FILE):
            processed_count += 1
            if processed_count % 100 == 0:
                print(f"[progress] {processed_count}/{total_entries} ({processed_count*100//total_entries}%)")

            uniprot_id = entry.get("uniprot")
            if not uniprot_id:
                missing_uniprot_json += 1
                continue
            
            # In test mode, skip proteins not in our test list
            if args.test and uniprot_id not in uniprot_ids:
                continue

            md_path = BASE_DIR / "content" / "wiki" / f"{uniprot_id}.md"
            # Load UniProt snapshot early so we can fill synonyms/reactome fallbacks
            uniprot_entry = load_uniprot_entry(uniprot_id)
            if uniprot_entry is None:
                # count missing snapshots but continue — some records are still useful
                missing_uniprot_json += 1
            # Populate a small feature_row from the embedding entry so
            # build_protein_record gets length/domains information when the
            # CSV/wiki data is not available.
            feature_row: Dict[str, str] = {}
            # length may be numeric in the embedding entry
            if "length" in entry and entry.get("length") is not None:
                feature_row["length"] = str(entry.get("length"))
            # domains may be provided in the embedding entry as names or InterPro IDs.
            # We prefer English names. If the embedding provides InterPro IDs,
            # try to resolve them to names from the UniProt JSON snapshot.
            domains_list = entry.get("domains") or entry.get("interpro_domains") or entry.get("interpro") or []
            domain_names: List[str] = []
            if isinstance(domains_list, list) and domains_list:
                # detect InterPro-like IDs (e.g. IPRxxxxx)
                looks_like_ipr = any(isinstance(d, str) and d.upper().startswith("IPR") for d in domains_list)
                if looks_like_ipr:
                    names = extract_interpro_domain_names(uniprot_id)
                    if names:
                        domain_names = names
                    else:
                        domain_names = [str(d) for d in domains_list]
                else:
                    domain_names = [str(d) for d in domains_list]
            elif domains_list:
                domain_names = [str(domains_list)]
            else:
                # No domain info in embedding entry; try UniProt JSON
                domain_names = extract_interpro_domain_names(uniprot_id) or []

            if domain_names:
                # Store as semicolon-delimited string so `normalize_domains` can parse it
                feature_row["domains_top3"] = ";".join(domain_names)
            page_post = entry
            raw_go = entry.get("go_terms", {}) or {}
            go_annotations = {
                "bp": set(raw_go.get("bp", [])),
                "mf": set(raw_go.get("mf", [])),
                "cc": set(raw_go.get("cc", [])),
            }

            reactome_paths = entry.get("reactome_pathways", []) or []
            # If embedding didn't include reactome pathways, try UniProt JSON
            if not reactome_paths:
                reactome_paths = extract_reactome_pathways(uniprot_id)

            gene_summary = entry.get("gene_summary")

            # If embedding metadata lacks a gene_summary, try fallback chain
            if not gene_summary:
                gene_id = extract_ncbi_gene_id(uniprot_entry) if uniprot_entry else None
                gene_summary = get_gene_summary(uniprot_id, gene_id, ncbi_summaries)

            record = build_protein_record(
                md_path,
                page_post,
                feature_row,
                go_annotations,
                ontology,
                gene_summary,
                reactome_paths,
            )
            
            # Enrich synonyms with every reliable source so short tokens survive downstream matching.
            try:
                synonym_pool: Set[str] = set()

                def _ingest(values) -> None:
                    if not values:
                        return
                    if isinstance(values, (list, tuple, set)):
                        for value in values:
                            _ingest(value)
                        return
                    if isinstance(values, dict):
                        return
                    text = str(values).strip()
                    if text:
                        synonym_pool.add(text)

                _ingest(record.get("synonyms"))
                _ingest(entry.get("synonyms"))
                _ingest(record.get("hgnc"))
                _ingest(record.get("uniprot"))

                up_syn = extract_uniprot_synonyms(uniprot_entry)
                _ingest(up_syn)

                if record.get("hgnc"):
                    hgnc_aliases, _ = fetch_hgnc_aliases(record.get("hgnc"))
                    _ingest(hgnc_aliases)

                record["synonyms"] = sorted(synonym_pool)
            except Exception:
                # never fail the whole run for enrichment errors
                pass

            # Apply simple inclusion criteria
            rec_length = int(record.get("length", 0) or 0)
            if rec_length < MIN_LENGTH:
                skipped_short += 1
                continue
            if len(record.get("domains", [])) < MIN_DOMAINS:
                skipped_no_domains += 1
                continue

            # Update empty-field counters for this accepted record
            def _is_empty(v) -> bool:
                if v is None:
                    return True
                if isinstance(v, str) and v.strip() == "":
                    return True
                if isinstance(v, (list, dict, set)) and len(v) == 0:
                    return True
                return False

            for fld in report_fields:
                if "." in fld:
                    outer, inner = fld.split(".", 1)
                    outer_val = record.get(outer)
                    if outer_val is None:
                        empty_counts[fld] += 1
                    else:
                        # nested access for known shapes
                        if isinstance(outer_val, dict):
                            nested = outer_val.get(inner)
                            if _is_empty(nested):
                                empty_counts[fld] += 1
                        else:
                            if _is_empty(None):
                                empty_counts[fld] += 1
                else:
                    val = record.get(fld)
                    if _is_empty(val):
                        empty_counts[fld] += 1

            batch.append(record)
            eligible_ids.append(record["uniprot"])

            if len(batch) >= args.batch_size:
                for rec in batch:
                    if first_written:
                        out_handle.write(",\n")
                    out_handle.write(json.dumps(rec, ensure_ascii=False))
                    first_written = True
                    written_count += 1
                batch = []

        # flush remaining batch
        if batch:
            for rec in batch:
                if first_written:
                    out_handle.write(",\n")
                out_handle.write(json.dumps(rec, ensure_ascii=False))
                first_written = True
                written_count += 1
        out_handle.write("\n]\n")

    if written_count == 0:
        raise RuntimeError("No proteins met the inclusion criteria; aborting.")

    eligible_ids = sorted(set(eligible_ids))
    dataset_hash = hashlib.sha256(json.dumps(eligible_ids, sort_keys=True).encode()).hexdigest()[:8]
    salt_hash = f"geneguessr-v2-{dataset_hash}"

    # Atomically move the temp file into place
    temp.replace(DATA_JSON)
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

    print(f"Done. {written_count} proteins ready for Geneguessr.")
    # Print diagnostic summary
    print("\nDiagnostics summary:")
    print(f"  processed entries: {processed_count}")
    print(f"  written records:   {written_count}")
    print(f"  skipped (too short): {skipped_short}")
    # removed 'too long' restriction so all long proteins are included
    print(f"  skipped (no domains): {skipped_no_domains}")
    print(f"  entries missing UniProt JSON or uniprot id: {missing_uniprot_json}")
    # Print empty-field percentages for written records
    if written_count > 0:
        print("\nEmpty-field percentages (on written records):")
        for fld in report_fields:
            missing = empty_counts.get(fld, 0)
            pct = (missing / written_count) * 100
            print(f"  {fld:20s}: {missing:6d} / {written_count:6d} ({pct:5.2f}%)")


if __name__ == "__main__":
    main()
