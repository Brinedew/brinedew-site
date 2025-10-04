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
STATIC_PROTEINS_DIR = PUBLIC_DIR / "static" / "proteins"
ATTACHMENTS_DIR = CONTENT_DIR / "Attachments"

# Thoteins data - READ DIRECTLY FROM SOURCE, NOT COPIES
THOTEINS_ROOT = Path("D:/Coding/Thoteins")
DATA_DIR = THOTEINS_ROOT / "data" / "proteins"
FEATURES_CSV = DATA_DIR / "features.csv"
PERSONA_CSV = DATA_DIR / "persona.csv"
MAPPING_JSON = THOTEINS_ROOT / "data" / "mapping.json"

# Check if Thoteins data exists (skip in CI if not available)
if not FEATURES_CSV.exists():
    print("=" * 60)
    print("Thoteins data not found - skipping enrichment")
    print("This is expected in CI - markdown files are enriched locally")
    print("=" * 60)
    sys.exit(0)

# Output
IMAGE_QUEUE_FILE = WEBSITE_ROOT / "image_generation_queue.txt"

# Template from Thoteins logic.js
PROMPT_TEMPLATE = """Editorial magazine cover portrait photo. Magazine title: "{symbol} MONTHLY".
Subject: {age} year old {gender}, {height} cm tall, {ethnicity} appearance, {hair_color} hair, {expression} expression, wearing {clothing_style} with {accessories_count} accessories, {pose_description}, {background_setting}.
Professional studio lighting, high fashion photography style, sharp focus on face, shallow depth of field.
Subheads: {title}; {domains}."""


def load_thoteins_data():
    """Load Thoteins CSVs and mapping configuration."""
    print("Loading Thoteins data...")
    
    if not FEATURES_CSV.exists():
        print(f"ERROR: Features CSV not found at {FEATURES_CSV}")
        print("Please copy Thoteins data: cp -r D:/Coding/Thoteins/data/proteins/*.csv data/thoteins/")
        sys.exit(1)
    
    features = pd.read_csv(FEATURES_CSV)
    persona = pd.read_csv(PERSONA_CSV)
    
    with open(MAPPING_JSON, 'r') as f:
        mapping_config = json.load(f)
    
    # Merge on uniprot_id
    combined = features.merge(persona, on='uniprot_id', how='left', suffixes=('', '_persona'))
    
    # Clean up duplicate columns
    combined = combined.loc[:, ~combined.columns.str.endswith('_persona')]
    
    print(f"Loaded {len(combined)} proteins from Thoteins")
    return combined, mapping_config


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
        if pd.isna(value) or str(value).lower() == 'nan':
            return None
        return str(value)
    
    # Check if already enriched (compare key fields)
    needs_update = (
        post.get('mass') != (round(float(protein_data['mass'])) if pd.notna(protein_data.get('mass')) else None) or
        post.get('alignment') != clean_str(protein_data.get('alignment', '')) or
        post.get('persona_background_setting') != clean_str(protein_data.get('background_setting', ''))
    )
    
    if not needs_update:
        print(f"  Skipped {md_file.name} ({uniprot_id}) - already up-to-date")
        # Still check for missing images
        full_image_path = PUBLIC_DIR / f"static/proteins/{uniprot_id}.png"
        if not full_image_path.exists():
            prompt = generate_image_prompt(protein_data)
            hexcode = protein_data.get('hexcode', '#cccccc')
            image_queue.append(f"{uniprot_id} [{hexcode}]: {prompt}")
        return
    
    print(f"  Enriching {md_file.name} ({uniprot_id})")
    
    # Populate molecular properties
    post['gene_symbol'] = clean_str(protein_data.get('gene_symbol', ''))
    post['full_name'] = clean_str(protein_data.get('full_name', ''))
    post['mass'] = round(float(protein_data['mass'])) if pd.notna(protein_data.get('mass')) else None
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
    post['persona_background_setting'] = clean_str(protein_data.get('background_setting', ''))
    
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
    
    # Check if image needs generation
    full_image_path = PUBLIC_DIR / image_path.lstrip('/')
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
