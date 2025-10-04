#!/usr/bin/env python3
"""
Single-command protein addition pipeline.

Takes UniProt IDs and does everything:
1. Generates markdown pages
2. Adds to Thoteins database (features.csv)
3. Rebuilds persona.csv with mappings
4. Enriches markdown with persona data
5. Sets draft=false

Usage:
    python add-proteins.py O15527 P26358 O60674
"""

import sys
import subprocess
from pathlib import Path

def run(cmd, cwd=None):
    """Run command and return success status."""
    print(f"\n> {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        return False
    return True

def main():
    if len(sys.argv) < 2:
        print("Usage: python add-proteins.py <uniprot_id> [<uniprot_id> ...]")
        sys.exit(1)
    
    uniprot_ids = sys.argv[1:]
    repo_root = Path(__file__).parent.parent
    
    print(f"=== ADDING {len(uniprot_ids)} PROTEINS ===")
    print(f"IDs: {' '.join(uniprot_ids)}\n")
    
    # Step 1: Generate markdown pages
    print("STEP 1: Generate markdown pages")
    for uid in uniprot_ids:
        if not run(["python", "scripts/generate-protein-pages.py", uid], cwd=repo_root):
            print(f"Failed to generate page for {uid}")
            sys.exit(1)
    
    # Step 2: Add to Thoteins database
    print("\nSTEP 2: Add to Thoteins features.csv")
    protein_db = repo_root / "tools" / "thoteins" / "scripts" / "protein_db.py"
    if not run(["python", str(protein_db), "fetch"] + uniprot_ids, cwd=repo_root):
        print("Failed to add proteins to Thoteins")
        sys.exit(1)
    
    # Step 3: Rebuild persona.csv
    print("\nSTEP 3: Rebuild persona.csv with mappings")
    if not run(["python", str(protein_db), "rebuild-persona"], cwd=repo_root):
        print("Failed to rebuild persona.csv")
        sys.exit(1)
    
    # Step 4: Enrich markdown with persona data
    print("\nSTEP 4: Enrich markdown pages")
    if not run(["python", "scripts/enrich-proteins.py"], cwd=repo_root):
        print("Failed to enrich pages")
        sys.exit(1)
    
    # Step 5: Set draft=false
    print("\nSTEP 5: Set draft=false")
    for uid in uniprot_ids:
        # Find the markdown file for this UniProt ID
        wiki_dir = repo_root / "content" / "wiki"
        matches = list(wiki_dir.glob(f"*-{uid.lower()}.md"))
        
        if not matches:
            print(f"Warning: Could not find markdown file for {uid}")
            continue
        
        md_file = matches[0]
        content = md_file.read_text(encoding='utf-8')
        
        # Replace draft: true with draft: false
        if 'draft: true' in content:
            content = content.replace('draft: true', 'draft: false')
            md_file.write_text(content, encoding='utf-8')
            print(f"  OK {md_file.name}")
    
    print("\n=== COMPLETE ===")
    print(f"Added {len(uniprot_ids)} proteins successfully!")
    print("Run 'npx quartz build' to rebuild the site.")

if __name__ == "__main__":
    main()
