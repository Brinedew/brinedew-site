#!/usr/bin/env python3
"""
Build Genedle data.json from existing Thoteins CSVs.

Reads features.csv + persona.csv, generates a static dataset with:
- GO-Slim-like function terms (derived from biological_process + keywords)
- Tissue expression (from tissue_tau - higher = more specific)
- Domain info (from domains_top3)
- Length, TM, secreted flags
- Links to wiki pages

Outputs:
- static/genedle/data.json (protein objects array)
- static/genedle/index.json (eligible IDs + salt)
"""

import csv
import json
import hashlib
from pathlib import Path
from datetime import datetime

# Paths
BASE_DIR = Path(__file__).parent.parent
FEATURES_CSV = BASE_DIR / "tools/thoteins/data/proteins/features.csv"
PERSONA_CSV = BASE_DIR / "tools/thoteins/data/proteins/persona.csv"
OUTPUT_DIR = BASE_DIR / "quartz/static/genedle"
DATA_JSON = OUTPUT_DIR / "data.json"
INDEX_JSON = OUTPUT_DIR / "index.json"

# Minimum criteria for inclusion
MIN_LENGTH = 100  # aa
MAX_LENGTH = 5000  # aa  
MIN_DOMAINS = 1   # need at least one domain for clues

def load_features():
    """Load features.csv into dict keyed by uniprot_id."""
    features = {}
    with open(FEATURES_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            features[row['uniprot_id']] = row
    return features

def load_persona():
    """Load persona.csv into dict keyed by uniprot_id."""
    persona = {}
    with open(PERSONA_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            persona[row['uniprot_id']] = row
    return persona

def parse_go_terms(bio_process_str, keywords_str):
    """
    Extract GO-Slim-like terms from biological_process + keywords.
    
    biological_process: semicolon-separated (e.g., "Apoptosis; Cell cycle")
    keywords: semicolon-separated
    
    Returns list of unique terms (lowercase, stripped).
    """
    terms = set()
    
    if bio_process_str:
        for term in bio_process_str.split(';'):
            term = term.strip()
            if term and term != '':
                terms.add(term.lower())
    
    if keywords_str:
        for kw in keywords_str.split(';'):
            kw = kw.strip()
            if kw and kw != '':
                terms.add(kw.lower())
    
    return sorted(list(terms))

def parse_domains(domains_top3_str):
    """
    Parse domains_top3 field.
    
    Format: "Domain1; Domain2; Domain3"
    Returns list of domain names.
    """
    if not domains_top3_str or domains_top3_str.strip() == '':
        return []
    
    domains = []
    for d in domains_top3_str.split(';'):
        d = d.strip()
        if d and d.lower() != 'disordered':  # skip generic "Disordered"
            domains.append(d)
    
    return domains

def infer_tissue_specificity(tissue_tau_str):
    """
    Convert tissue_tau to a categorical label.
    
    tissue_tau ranges 0-1:
    - <0.3: ubiquitous
    - 0.3-0.6: moderate specificity
    - >0.6: highly specific
    
    Returns dict with label and score.
    """
    if not tissue_tau_str or tissue_tau_str.strip() == '':
        return {"label": "unknown", "score": None}
    
    try:
        tau = float(tissue_tau_str)
    except ValueError:
        return {"label": "unknown", "score": None}
    
    if tau < 0.3:
        label = "ubiquitous"
    elif tau < 0.6:
        label = "moderate"
    else:
        label = "highly specific"
    
    return {"label": label, "score": tau}

def is_secreted(locations_str):
    """Check if protein is secreted based on locations."""
    if not locations_str:
        return False
    
    secreted_keywords = ['extracellular', 'secreted', 'exosome']
    locations_lower = locations_str.lower()
    
    return any(kw in locations_lower for kw in secreted_keywords)

def build_protein_object(uniprot_id, feat, pers):
    """Build a single protein object for the game."""
    
    # Basic fields
    gene_symbol = feat.get('gene_symbol', '')
    short_name = feat.get('short_name', gene_symbol)
    full_name = feat.get('full_name', '')
    
    # Length
    try:
        length = int(feat.get('length', 0))
    except (ValueError, TypeError):
        length = 0
    
    # Transmembrane
    tm_str = feat.get('Has transmembrane domains', 'No')
    tmh = tm_str.strip().lower() in ['yes', 'true', '1']
    
    # Secreted (infer from locations)
    secreted = is_secreted(feat.get('locations', ''))
    
    # Domains
    domains = parse_domains(feat.get('domains_top3', ''))
    
    # GO-Slim terms (from biological_process + keywords)
    go_slim = parse_go_terms(
        feat.get('biological_process', ''),
        feat.get('keywords', '')
    )
    
    # Tissue specificity
    tissue = infer_tissue_specificity(feat.get('tissue_tau', ''))
    
    # Subcellular location (simplified - just take first location)
    locations_str = feat.get('locations', '')
    if locations_str:
        subcell = [loc.strip() for loc in locations_str.split(';')[:3]]
    else:
        subcell = []
    
    # Links
    wiki_slug = f"{gene_symbol.lower()}-{short_name.lower()}-{uniprot_id.lower()}"
    links = {
        "uniprot": f"https://www.uniprot.org/uniprotkb/{uniprot_id}",
        "wiki": f"/wiki/{wiki_slug}"
    }
    
    # Synonyms (just use short_name + gene_symbol for now)
    synonyms = list(set([gene_symbol, short_name]))
    
    return {
        "uniprot": uniprot_id,
        "hgnc": gene_symbol,
        "synonyms": synonyms,
        "full_name": full_name,
        "length": length,
        "tmh": tmh,
        "secreted": secreted,
        "domains": domains,
        "go_slim": go_slim[:5],  # limit to 5 terms max
        "tissue": tissue,
        "subcell": subcell,
        "links": links
    }

def main():
    print("Building Genedle data...")
    
    # Load CSVs
    print(f"Loading {FEATURES_CSV}")
    features = load_features()
    
    print(f"Loading {PERSONA_CSV}")
    persona = load_persona()
    
    # Build protein objects
    proteins = []
    eligible_ids = []
    
    for uniprot_id, feat in features.items():
        # Check if we have persona data (not strictly required but nice)
        pers = persona.get(uniprot_id, {})
        
        # Apply filters
        try:
            length = int(feat.get('length', 0))
        except (ValueError, TypeError):
            continue
        
        if not (MIN_LENGTH <= length <= MAX_LENGTH):
            continue
        
        # Need at least one domain for gameplay
        domains = parse_domains(feat.get('domains_top3', ''))
        if len(domains) < MIN_DOMAINS:
            continue
        
        # Build object
        protein = build_protein_object(uniprot_id, feat, pers)
        proteins.append(protein)
        eligible_ids.append(uniprot_id)
    
    print(f"Built {len(proteins)} proteins meeting criteria")
    
    # Generate salt (deterministic but changes with dataset)
    dataset_hash = hashlib.sha256(
        json.dumps(eligible_ids, sort_keys=True).encode()
    ).hexdigest()[:8]
    salt_hash = f"genedle-v1-{dataset_hash}"
    
    # Write data.json
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_JSON, 'w', encoding='utf-8') as f:
        json.dump(proteins, f, indent=2, ensure_ascii=False)
    print(f"Wrote {DATA_JSON}")
    
    # Write index.json
    index_data = {
        "eligible_ids": eligible_ids,
        "salt_hash": salt_hash,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "count": len(eligible_ids)
    }
    with open(INDEX_JSON, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, indent=2)
    print(f"Wrote {INDEX_JSON}")
    
    print("Done!")

if __name__ == "__main__":
    main()


