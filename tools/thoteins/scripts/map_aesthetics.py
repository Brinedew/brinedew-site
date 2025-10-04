#!/usr/bin/env python3
"""
Data-driven aesthetic mapper for protein families.

Dynamically discovers families from features.csv, gets descriptions from KEGG cache,
and uses Gemini to suggest aesthetics. No hardcoded family lists or counts.

Usage:
    python map_aesthetics.py                    # Show unmapped families and generate suggestions
    python map_aesthetics.py --apply            # Auto-apply suggestions
    python map_aesthetics.py --force-remap      # Re-map everything including existing mappings
"""

import json
import sys
import csv
import subprocess
from pathlib import Path
from collections import defaultdict

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
MAPPING_FILE = PROJECT_ROOT / "data" / "mapping.json"
AESTHETICS_INDEX = PROJECT_ROOT / "data" / "aesthetics" / "aesthetics_index.json"
WORLDBUILDING_FILE = PROJECT_ROOT / "docs" / "WORLDBUILDING.md"
FEATURES_CSV = PROJECT_ROOT / "data" / "proteins" / "features.csv"
KEGG_BRITE_DIR = PROJECT_ROOT / "data" / "proteins" / "kegg_brite"


def discover_families_from_data():
    """
    Dynamically discover all protein families from features.csv.
    Returns dict of {family_name: count_of_proteins_with_this_family}
    """
    families = defaultdict(int)

    with open(FEATURES_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            kegg_families = row.get('kegg_families', '')
            if kegg_families:
                # Split by semicolon delimiter
                for family in kegg_families.split(';'):
                    family = family.strip()
                    if family:
                        families[family] += 1

    return dict(families)


def get_family_descriptions(families):
    """
    Extract descriptions for protein families from cached KEGG BRITE data.
    Falls back to generic description if no cache available.
    """
    descriptions = {}

    # Try to parse BRITE cache files for descriptions
    if KEGG_BRITE_DIR.exists():
        for brite_file in KEGG_BRITE_DIR.glob("*.json"):
            try:
                with open(brite_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # BRITE files have protein_families field with family names
                    # We can use the full BRITE hierarchy as description context
                    raw_response = data.get('raw_response', '')
                    if raw_response:
                        # Parse BRITE hierarchy to extract family categories
                        for family in families:
                            if family in raw_response:
                                # Extract context around the family mention
                                idx = raw_response.find(family)
                                context = raw_response[max(0, idx-100):idx+200]
                                descriptions[family] = f"From KEGG: {context[:150]}"
            except:
                pass

    # Fill in missing descriptions with generic text
    for family in families:
        if family not in descriptions:
            descriptions[family] = f"KEGG protein family: {family}"

    return descriptions


def get_unmapped_families(discovered_families):
    """
    Compare discovered families against mapping.json.
    Returns dict of families that need mapping (either missing or placeholder).
    """
    with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    # Find the kegg_families mapping
    kegg_map = next((m for m in mapping['mappings'] if m.get('source') == 'kegg_families'), None)

    if not kegg_map:
        # No existing mapping - need to create one
        return discovered_families

    current_bins = kegg_map.get('bins', {})
    unmapped = {}

    for family, count in discovered_families.items():
        aesthetic = current_bins.get(family, 'placeholder')
        if 'placeholder' in aesthetic.lower() or family not in current_bins:
            unmapped[family] = count

    return unmapped


def query_gemini_for_aesthetics(families_to_map, family_descriptions, force_remap=False):
    """
    Query Gemini to suggest aesthetics for protein families.

    Args:
        families_to_map: Dict of {family_name: protein_count}
        family_descriptions: Dict of {family_name: description}
        force_remap: If True, remap everything including existing mappings
    """
    # Load context
    with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    with open(AESTHETICS_INDEX, 'r', encoding='utf-8') as f:
        aesthetics = json.load(f)

    with open(WORLDBUILDING_FILE, 'r', encoding='utf-8') as f:
        worldbuilding = f.read()

    # Get current kegg_families mapping
    kegg_map = next((m for m in mapping['mappings'] if m.get('source') == 'kegg_families'), None)
    current_bins = kegg_map['bins'] if kegg_map else {}

    # Find already-mapped aesthetics to avoid duplicates
    already_mapped = set()
    if not force_remap:
        for family, aesthetic in current_bins.items():
            if 'placeholder' not in aesthetic.lower():
                already_mapped.add(aesthetic)

    # Build prompt
    prompt = f"""You are helping map protein families to aesthetics for a creative worldbuilding project.

WORLDBUILDING CONTEXT:
{worldbuilding}

CURRENT MAPPING (kegg_families → Aesthetics):
{json.dumps(current_bins, indent=2)}

FAMILIES NEEDING AESTHETICS ({len(families_to_map)} total):
{json.dumps({f: {'description': family_descriptions[f], 'protein_count': families_to_map[f]} for f in families_to_map}, indent=2)}

AVAILABLE AESTHETICS ({len(aesthetics)} total):
{json.dumps({k: v['description'] for k, v in aesthetics.items()}, indent=2)}

TASK:
Suggest fitting aesthetics for the families listed above.

CONSTRAINTS:
- Don't reuse these already-mapped aesthetics: {sorted(already_mapped)}
- Match family function/behavior to aesthetic themes
- Consider worldbuilding factions (Growth, Control, Maintenance) when relevant
- Use existing mappings as reference for tone/style

Return ONLY a JSON object with your suggestions:
{{
  "Family Name 1": "suggested_aesthetic_name",
  "Family Name 2": "suggested_aesthetic_name",
  ...
}}

Include brief reasoning as a comment after this JSON."""

    # Save prompt
    prompt_file = PROJECT_ROOT / "data" / "aesthetics" / "gemini_prompt.txt"
    with open(prompt_file, 'w', encoding='utf-8') as f:
        f.write(prompt)

    print(f"Prompt saved to: {prompt_file.relative_to(PROJECT_ROOT)}")
    print(f"Prompt size: {len(prompt):,} characters")
    print(f"Families to map: {len(families_to_map)}")
    print("\nQuerying Gemini...")

    # Query Gemini - use PowerShell Get-Content on Windows
    import platform
    if platform.system() == "Windows":
        cmd = f'powershell -Command "Get-Content \'{prompt_file}\' | gemini"'
        manual_cmd = f"powershell -Command \"Get-Content data\\aesthetics\\gemini_prompt.txt | gemini\""
    else:
        cmd = f'cat "{prompt_file}" | gemini'
        manual_cmd = "cat data/aesthetics/gemini_prompt.txt | gemini"

    result = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=600,  # 10 minutes
        shell=True
    )

    if result.returncode != 0:
        print(f"Gemini error: {result.stderr}")
        print(f"\nManually run: {manual_cmd}")
        return None

    # Save output
    output = result.stdout.strip()
    output_file = PROJECT_ROOT / "data" / "aesthetics" / "gemini_suggestions.txt"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(output)

    print(f"Output saved to: {output_file.relative_to(PROJECT_ROOT)}")

    # Parse JSON
    if '```' in output:
        parts = output.split('```')
        json_part = parts[1]
        if json_part.startswith('json'):
            json_part = json_part[4:]
        output = json_part.strip()

    try:
        suggestions = json.loads(output)
        return suggestions
    except json.JSONDecodeError as e:
        print(f"Failed to parse Gemini response: {e}")
        print(f"Check: {output_file.relative_to(PROJECT_ROOT)}")
        return None


def apply_suggestions(suggestions):
    """Update mapping.json with suggested aesthetics"""
    with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    # Find or create kegg_families mapping
    kegg_map = next((m for m in mapping['mappings'] if m.get('source') == 'kegg_families'), None)

    if not kegg_map:
        # Create new mapping entry
        kegg_map = {
            "id": f"map-{len(mapping['mappings']):04d}",
            "type": "Categorical (bins)",
            "source": "kegg_families",
            "target": "Aesthetics",
            "bins": {}
        }
        mapping['mappings'].append(kegg_map)

    # Apply suggestions
    updated = 0
    for family, aesthetic in suggestions.items():
        if family not in kegg_map['bins'] or 'placeholder' in kegg_map['bins'].get(family, '').lower():
            kegg_map['bins'][family] = aesthetic
            print(f"✓ {family} → {aesthetic}")
            updated += 1
        else:
            print(f"- Skipped {family} (already mapped to {kegg_map['bins'][family]})")

    # Save
    with open(MAPPING_FILE, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, indent=2)

    print(f"\nUpdated {updated} mappings")
    return updated


def main():
    force_remap = '--force-remap' in sys.argv
    auto_apply = '--apply' in sys.argv

    print("Discovering protein families from data...")
    all_families = discover_families_from_data()
    print(f"Found {len(all_families)} unique families across {sum(all_families.values())} protein instances\n")

    if force_remap:
        families_to_map = all_families
        print("Force-remap mode: will re-map ALL families")
    else:
        families_to_map = get_unmapped_families(all_families)
        print(f"Unmapped families: {len(families_to_map)}")

    if not families_to_map:
        print("All families are mapped!")
        return

    print("\nFamilies needing aesthetics:")
    for family, count in sorted(families_to_map.items(), key=lambda x: -x[1]):
        print(f"  {family} ({count} proteins)")

    print("\nGetting descriptions...")
    descriptions = get_family_descriptions(families_to_map)

    print("\nQuerying Gemini for suggestions...")
    suggestions = query_gemini_for_aesthetics(families_to_map, descriptions, force_remap)

    if not suggestions:
        print("Failed to get suggestions")
        return

    print("\n" + "="*60)
    print("GEMINI'S SUGGESTIONS:")
    print("="*60)
    for family, aesthetic in suggestions.items():
        print(f"  {family} → {aesthetic}")
    print("="*60)

    if auto_apply:
        print("\nApplying suggestions...")
        apply_suggestions(suggestions)
        print("\nDone! Run 'python scripts/protein_db.py rebuild-persona' to see results")
    else:
        print("\nTo apply these suggestions, run:")
        print("  python scripts/map_aesthetics.py --apply")


if __name__ == '__main__':
    main()
