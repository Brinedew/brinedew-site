#!/usr/bin/env python3
"""
Protein Page Enrichment Script

Scans Website/content/wiki/*.md for protein pages and enriches frontmatter
with molecular + persona data from Thoteins CSVs.

Usage:
    python scripts/enrich-proteins.py

Outputs:
    - Updated frontmatter in protein pages
    - image_generation_queue.txt with prompts for missing images
"""
"""
Enriches markdown frontmatter and generates image prompts for protein pages.

Note: This script is for local/manual use only. Do not run as part of CI/CD workflows.
Run locally after updating markdown or metadata. Large files are not tracked in git.
"""

import sys
import json
from pathlib import Path
import pandas as pd
import frontmatter
from typing import Dict, List, Optional

# Paths
SCRIPT_DIR = Path(__file__).parent
WEBSITE_ROOT = SCRIPT_DIR.parent
CONTENT_DIR = WEBSITE_ROOT / "content"
WIKI_DIR = CONTENT_DIR / "wiki"
PUBLIC_DIR = WEBSITE_ROOT / "public"
# Write images to Quartz static input so CI/Pages include them in the build output
STATIC_PROTEINS_DIR = WEBSITE_ROOT / "static" / "proteins"
ATTACHMENTS_DIR = CONTENT_DIR / "Attachments"

# Thoteins data sources:
# - v2 (preferred): ../Datasets/thoteins-v2/proteins_with_demographics.json (outside Website repo)
# - v1 (deprecated): Website/tools/thoteins-v1/data/proteins/*.csv (often not present in CI)
REPO_ROOT = WEBSITE_ROOT.parent

THOTEINS_V2_ROOT = REPO_ROOT / "Datasets" / "thoteins-v2"
THOTEINS_V2_PROTEINS_JSON = THOTEINS_V2_ROOT / "proteins_with_demographics.json"

THOTEINS_V1_ROOT = WEBSITE_ROOT / "tools" / "thoteins-v1"
THOTEINS_V1_DATA_DIR = THOTEINS_V1_ROOT / "data" / "proteins"
THOTEINS_V1_FEATURES_CSV = THOTEINS_V1_DATA_DIR / "features.csv"
THOTEINS_V1_PERSONA_CSV = THOTEINS_V1_DATA_DIR / "persona.csv"

# Output
IMAGE_QUEUE_FILE = WEBSITE_ROOT / "image_generation_queue.txt"

# Template from Thoteins logic.js
PROMPT_TEMPLATE = """Editorial magazine cover portrait photo. Magazine title: "{symbol} MONTHLY".
Subject: {age} year old {gender}, {height} cm tall, {ethnicity} appearance, {hair_color} hair, {expression} expression, wearing {clothing_style} with {accessories_count} accessories, {pose_description}, {background_setting}.
Professional studio lighting, high fashion photography style, sharp focus on face, shallow depth of field.
Subheads: {title}; {domains}."""


def hsl_to_hex(h: float, s: float, l: float) -> str:
    """Convert HSL in degrees/[0-100]/[0-100] to #RRGGBB."""
    h = float(h) % 360.0
    s = max(0.0, min(100.0, float(s))) / 100.0
    l = max(0.0, min(100.0, float(l))) / 100.0

    c = (1.0 - abs(2.0 * l - 1.0)) * s
    x = c * (1.0 - abs((h / 60.0) % 2.0 - 1.0))
    m = l - c / 2.0

    r1 = g1 = b1 = 0.0
    if 0 <= h < 60:
        r1, g1, b1 = c, x, 0.0
    elif 60 <= h < 120:
        r1, g1, b1 = x, c, 0.0
    elif 120 <= h < 180:
        r1, g1, b1 = 0.0, c, x
    elif 180 <= h < 240:
        r1, g1, b1 = 0.0, x, c
    elif 240 <= h < 300:
        r1, g1, b1 = x, 0.0, c
    else:
        r1, g1, b1 = c, 0.0, x

    r = int(round((r1 + m) * 255.0))
    g = int(round((g1 + m) * 255.0))
    b = int(round((b1 + m) * 255.0))

    r = max(0, min(255, r))
    g = max(0, min(255, g))
    b = max(0, min(255, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def normalize_mass_kda(mass_value) -> Optional[float]:
    """Normalize mass into kDa (frontmatter convention)."""
    if mass_value is None:
        return None
    try:
        mass = float(mass_value)
    except Exception:
        return None

    # Thoteins v2 stores mass in daltons (e.g., 16499). Frontmatter uses kDa.
    if mass > 1000:
        return mass / 1000.0
    return mass


def load_thoteins_data():
    """Load Thoteins CSVs and mapping configuration."""
    print("Loading Thoteins data...")

    # Prefer v2 dataset if available (outside the Website repo).
    if THOTEINS_V2_PROTEINS_JSON.exists():
        try:
            with open(THOTEINS_V2_PROTEINS_JSON, "r", encoding="utf-8") as f:
                raw = json.load(f)
            df = pd.json_normalize(raw, sep="_")

            # Normalize/derive columns expected by the rest of this script.
            df["uniprot_id"] = df.get("uniprot")
            df["gene_symbol"] = df.get("gene")

            def _domains_top3(domains):
                if not isinstance(domains, list):
                    return None
                top = [str(d).strip() for d in domains[:3] if str(d).strip()]
                return ", ".join(top) if top else None

            df["domain_count"] = df["domains"].apply(lambda v: len(v) if isinstance(v, list) else None)
            df["domains_top3"] = df["domains"].apply(_domains_top3)

            df["locations"] = df["locations"].apply(
                lambda v: ", ".join([str(x).strip() for x in v if str(x).strip()]) if isinstance(v, list) else v
            )

            # Persona columns (keep legacy column names so the rest of the script is minimally changed).
            df["height"] = df.get("demographics_height")
            df["Sex"] = df.get("demographics_sex")
            df["Politics"] = df.get("demographics_politics")
            df["Skintone Hue "] = df.get("demographics_skintone_hue")
            df["Skintone Saturation"] = df.get("demographics_skintone_saturation")
            df["Skintone Lightness"] = df.get("demographics_skintone_lightness")
            df["Age"] = df.get("demographics_apparent_age")

            def _aesthetics_list_to_str(aes):
                if isinstance(aes, list):
                    cleaned = [str(a).strip() for a in aes if str(a).strip()]
                    return ", ".join(cleaned) if cleaned else None
                return None

            df["Aesthetics"] = df.get("demographics_aesthetics").apply(_aesthetics_list_to_str)

            def _hexcode_from_demographics(row):
                try:
                    hue = row.get("demographics_skintone_hue")
                    sat = row.get("demographics_skintone_saturation")
                    lig = row.get("demographics_skintone_lightness")
                    if hue is None or sat is None or lig is None:
                        return "#cccccc"
                    return hsl_to_hex(hue, sat, lig)
                except Exception:
                    return "#cccccc"

            df["hexcode"] = df.apply(_hexcode_from_demographics, axis=1)

            print(f"Loaded {len(df)} proteins from Thoteins v2 ({THOTEINS_V2_PROTEINS_JSON})")
            return df, {}
        except Exception as err:
            print(f"WARNING: Failed to load Thoteins v2 dataset at {THOTEINS_V2_PROTEINS_JSON}: {err}")

    # Deprecated: v1 CSVs (often not present in CI).
    if THOTEINS_V1_FEATURES_CSV.exists() and THOTEINS_V1_PERSONA_CSV.exists():
        print(f"WARNING: Falling back to deprecated Thoteins v1 CSVs at {THOTEINS_V1_DATA_DIR}")
        features = pd.read_csv(THOTEINS_V1_FEATURES_CSV)
        persona = pd.read_csv(THOTEINS_V1_PERSONA_CSV)

        combined = features.merge(persona, on="uniprot_id", how="left", suffixes=("", "_persona"))
        combined = combined.loc[:, ~combined.columns.str.endswith("_persona")]

        print(f"Loaded {len(combined)} proteins from Thoteins v1")
        return combined, {}

    # No data available. Do not fail Pages builds.
    print("=" * 60)
    print("WARNING: Thoteins dataset not found.")
    print(f"- Looked for v2 JSON at: {THOTEINS_V2_PROTEINS_JSON}")
    print(f"- Looked for v1 CSVs at: {THOTEINS_V1_DATA_DIR}")
    print("Skipping enrichment to avoid breaking builds.")
    print("=" * 60)
    return None, {}


def get_mapped_fields(mapping_config: Dict) -> Dict[str, str]:
    """Get source->target mappings from mapping.json."""
    mappings = {}
    for m in mapping_config.get('mappings', []):
        source = m.get('source')
        target = m.get('target')
        if source and target:
            mappings[source] = target
    return mappings


def generate_image_prompt(protein_data: pd.Series) -> str:
    """Generate prompt from persona attributes using Thoteins template."""
    
    # Get values with fallbacks
    symbol = protein_data.get('gene_symbol', 'PROTEIN')
    title = protein_data.get('full_name', '')
    age = int(protein_data.get('Age', 30)) if pd.notna(protein_data.get('Age')) else 30
    height = int(protein_data.get('height', 160)) if pd.notna(protein_data.get('height')) else 160
    domains = protein_data.get('domains_top3', '')
    
    # Persona attributes (from persona.csv or deterministic fallback)
    gender = protein_data.get('Sex', 'person')
    
    # Fallback attributes (matching Thoteins deterministicHuman logic)
    ethnicity = "European"
    hair_color = "dark brown"  
    expression = "confident"
    clothing_style = "lab coat over casual wear"
    accessories_count = 1
    pose_description = "half-length portrait, facing camera"
    background_setting = "nuclear lab interior with instrumentation"
    
    prompt = PROMPT_TEMPLATE.format(
        symbol=symbol,
        age=age,
        gender=gender.lower() if gender else 'person',
        height=height,
        ethnicity=ethnicity,
        hair_color=hair_color,
        expression=expression,
        clothing_style=clothing_style,
        accessories_count=accessories_count,
        pose_description=pose_description,
        background_setting=background_setting,
        title=title,
        domains=domains or 'No domain data'
    )
    
    return prompt.strip()


def find_protein_pages() -> List[Path]:
    """Find all markdown files tagged 'protein' in wiki directory."""
    protein_pages = []
    
    if not WIKI_DIR.exists():
        print(f"WARNING: Wiki directory not found at {WIKI_DIR}")
        return protein_pages
    
    for md_file in WIKI_DIR.glob("*.md"):
        try:
            post = frontmatter.load(md_file)
            tags = post.get('tags', [])
            
            if isinstance(tags, str):
                tags = [tags]
            
            if 'protein' in tags:
                protein_pages.append(md_file)
        except Exception as e:
            print(f"WARNING: Could not parse {md_file.name}: {e}")
    
    print(f"Found {len(protein_pages)} protein pages")
    return protein_pages


def enrich_protein_page(md_file: Path, proteins_df: pd.DataFrame, 
                        mapping_config: Dict, image_queue: List[str]):
    """Enrich a single protein page with Thoteins data."""
    
    post = frontmatter.load(md_file)
    uniprot_id = post.get('uniprot_id')
    
    if not uniprot_id:
        print(f"  Skipping {md_file.name}: no uniprot_id")
        return
    
    # Find in database
    protein_row = proteins_df[proteins_df['uniprot_id'] == uniprot_id]
    
    if protein_row.empty:
        print(f"  WARNING: {uniprot_id} not in Thoteins database")
        return
    
    protein_data = protein_row.iloc[0]
    
    # Helper to handle NaN strings
    def clean_str(value):
        """Convert value to string, handling NaN."""
        if pd.isna(value):
            return None
        s = str(value).strip()
        if not s or s.lower() == 'nan':
            return None
        return s
    
    # Check if already enriched (compare key fields)
    mass_kda = normalize_mass_kda(protein_data.get('mass'))
    mass_kda_rounded = round(mass_kda) if mass_kda is not None else None
    background_setting_clean = clean_str(protein_data.get('background_setting')) if 'background_setting' in getattr(proteins_df, 'columns', []) else None
    needs_update = (
        post.get('mass') != mass_kda_rounded or
        post.get('alignment') != clean_str(protein_data.get('alignment', '')) or
        (background_setting_clean is not None and post.get('persona_background_setting') != background_setting_clean)
    )
    
    if not needs_update:
        print(f"  Skipped {md_file.name} ({uniprot_id}) - already up-to-date")
        # Still check for missing images (check static input, not build output)
        full_image_path = STATIC_PROTEINS_DIR / f"{uniprot_id}.png"
        if not full_image_path.exists():
            prompt = generate_image_prompt(protein_data)
            hexcode = protein_data.get('hexcode', '#cccccc')
            image_queue.append(f"{uniprot_id} [{hexcode}]: {prompt}")
        return
    
    print(f"  Enriching {md_file.name} ({uniprot_id})")
    
    # Populate molecular properties
    post['gene_symbol'] = clean_str(protein_data.get('gene_symbol', ''))
    post['full_name'] = clean_str(protein_data.get('full_name', ''))
    post['mass'] = mass_kda_rounded
    post['length (aa)'] = int(protein_data['length']) if pd.notna(protein_data.get('length')) else None
    post['domain_count'] = int(protein_data['domain_count']) if pd.notna(protein_data.get('domain_count')) else None
    post['domains_top3'] = clean_str(protein_data.get('domains_top3', ''))
    post['locations'] = clean_str(protein_data.get('locations', ''))
    post['alignment'] = clean_str(protein_data.get('alignment', ''))
    post['kegg_families'] = clean_str(protein_data.get('kegg_families', ''))
    post['percent_disordered'] = round(float(protein_data['percent_disordered'])) if pd.notna(protein_data.get('percent_disordered')) else None
    post['rvis_percentile'] = round(float(protein_data['rvis_percentile'])) if pd.notna(protein_data.get('rvis_percentile')) else None
    post['first_letter'] = clean_str(protein_data.get('first_letter', ''))
    post['Has transmembrane domains'] = clean_str(protein_data.get('Has transmembrane domains', ''))
    post['membrane_depth'] = int(protein_data['membrane_depth']) if pd.notna(protein_data.get('membrane_depth')) else None
    post['tissue_tau'] = round(float(protein_data['tissue_tau']) * 100) if pd.notna(protein_data.get('tissue_tau')) else None
    
    # Populate persona properties
    post['persona_height'] = round(float(protein_data['height'])) if pd.notna(protein_data.get('height')) else None
    post['persona_sex'] = clean_str(protein_data.get('Sex', ''))
    post['persona_politics'] = clean_str(protein_data.get('Politics', ''))
    post['persona_skintone_hue'] = int(protein_data['Skintone Hue ']) if pd.notna(protein_data.get('Skintone Hue ')) else None
    post['persona_skintone_saturation'] = int(protein_data['Skintone Saturation']) if pd.notna(protein_data.get('Skintone Saturation')) else None
    post['persona_skintone_lightness'] = round(float(protein_data['Skintone Lightness'])) if pd.notna(protein_data.get('Skintone Lightness')) else None
    post['persona_hexcode'] = clean_str(protein_data.get('hexcode', '#cccccc'))
    post['persona_aesthetics'] = clean_str(protein_data.get('Aesthetics', ''))
    post['persona_age'] = round(float(protein_data['Age'])) if pd.notna(protein_data.get('Age')) else None
    if background_setting_clean is not None:
        post['persona_background_setting'] = background_setting_clean
    
    # Handle persona image
    image_path = f"/static/proteins/{uniprot_id}.png"
    
    # Check for manual override in existing frontmatter
    existing_image = post.get('persona_image')
    if existing_image and '[[' in str(existing_image):
        # Obsidian attachment format: [[Attachments/file.png]]
        # Extract filename and copy to static folder
        import re
        match = re.search(r'\[\[Attachments/([^\]]+)\]\]', str(existing_image))
        if match:
            attachment_name = match.group(1)
            attachment_path = ATTACHMENTS_DIR / attachment_name
            if attachment_path.exists():
                STATIC_PROTEINS_DIR.mkdir(parents=True, exist_ok=True)
                target_path = STATIC_PROTEINS_DIR / f"{uniprot_id}.png"
                import shutil
                shutil.copy2(attachment_path, target_path)
                print(f"    Copied {attachment_name} to static/proteins/")
                post['persona_image'] = image_path
            else:
                print(f"    WARNING: Attachment {attachment_name} not found")
                post['persona_image'] = image_path
    else:
        # Use standard path
        post['persona_image'] = image_path
    
    # Check if image needs generation (look in static input, which Quartz copies into public)
    full_image_path = STATIC_PROTEINS_DIR / f"{uniprot_id}.png"
    if not full_image_path.exists():
        prompt = generate_image_prompt(protein_data)
        hexcode = protein_data.get('hexcode', '#cccccc')
        queue_entry = f"{uniprot_id} [{hexcode}]: {prompt}"
        image_queue.append(queue_entry)
        print(f"    Image missing - added to queue")
    
    # Save enriched frontmatter
    with open(md_file, 'wb') as f:
        frontmatter.dump(post, f)


def main():
    """Main enrichment workflow."""
    print("=" * 60)
    print("Protein Page Enrichment Script")
    print("=" * 60)
    
    # Load Thoteins data
    proteins_df, mapping_config = load_thoteins_data()
    if proteins_df is None:
        print("[OK] No Thoteins data available; skipping enrichment.")
        return
    
    # Find protein pages
    protein_pages = find_protein_pages()
    
    if not protein_pages:
        print("No protein pages found. Exiting.")
        return
    
    # Process each page
    image_queue = []
    print(f"\nEnriching {len(protein_pages)} protein pages...")
    
    for md_file in protein_pages:
        enrich_protein_page(md_file, proteins_df, mapping_config, image_queue)
    
    # Write image generation queue
    if image_queue:
        with open(IMAGE_QUEUE_FILE, 'w', encoding='utf-8') as f:
            f.write('\n\n'.join(image_queue))
        print(f"\n[OK] Wrote {len(image_queue)} prompts to {IMAGE_QUEUE_FILE}")
    else:
        print("\n[OK] All proteins have images")
    
    print(f"\n[OK] Enrichment complete: {len(protein_pages)} pages processed")
    print("=" * 60)


if __name__ == '__main__':
    main()
