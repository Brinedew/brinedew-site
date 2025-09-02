#!/usr/bin/env python3
"""
Automated Protein Page Generator

Creates individual UniProt ID-based protein pages from:
1. Direct UniProt ID input
2. Family page splitting (identifies major family members)
3. Batch generation from UniProt ID lists

Usage:
    python generate-protein-pages.py P04637  # Generate p53 page
    python generate-protein-pages.py --family wnt-proteins.md  # Split family page  
    python generate-protein-pages.py --batch uniprot_ids.txt  # Batch generate
"""

import argparse
import re
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import yaml

# Import the UniProtFetcher class directly
import importlib.util
uniprot_module_path = Path(__file__).parent / "uniprot-fetcher.py"
spec = importlib.util.spec_from_file_location("uniprot_fetcher", uniprot_module_path)
uniprot_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uniprot_module)
UniProtFetcher = uniprot_module.UniProtFetcher

class ProteinPageGenerator:
    def __init__(self, content_dir: str = "content"):
        self.content_dir = Path(content_dir)
        self.wiki_dir = self.content_dir / "wiki"
        self.templates_dir = self.content_dir / "Templates"
        self.uniprot_fetcher = UniProtFetcher()
        
        # Load template
        self.template = self._load_template()
        
    def _load_template(self) -> str:
        """Load the protein page template."""
        # Use the default template since QuickAdd template has different syntax
        return self._get_default_template()
    
    def _get_default_template(self) -> str:
        """Default protein page template - concise style matching existing wiki pages."""
        return """---
title: {gene_symbol}
tags:
  - protein
  - content/wiki
date: {date}
draft: true
aliases:
  - {gene_symbol}
symbol: {gene_symbol}
mass: {mass_kda}
length (aa): {length_aa}
protein_type: {protein_type}
Domains: {domains}
pathways:
{pathways_yaml}
uniprot_id: {uniprot_id}
image_link: 
---
# {gene_symbol}

**What it is.** {function}

**Why it matters here.** {significance}

**Notes.** Type: {protein_type}; Pathways: {pathways_brief}.
"""
    
    def generate_page_filename(self, gene_symbol: str, uniprot_id: str) -> str:
        """Generate filename following pattern: gene-symbol-uniprot-id.md"""
        # Sanitize gene symbol for filename
        clean_symbol = re.sub(r'[^\w-]', '', gene_symbol.lower())
        clean_uniprot = uniprot_id.lower()
        
        return f"{clean_symbol}-{clean_uniprot}.md"
    
    def _extract_first_sentence(self, function_text: str) -> str:
        """Extract just the first sentence from function description."""
        if not function_text or function_text == 'Function not available.':
            return 'Function not available.'
        
        # Split on period followed by space and capital letter, or PubMed reference
        import re
        sentences = re.split(r'\.(?:\s+[A-Z]|\s+\(PubMed)', function_text)
        
        if sentences:
            first_sentence = sentences[0].strip()
            # Make sure it ends with a period
            if not first_sentence.endswith('.'):
                first_sentence += '.'
            return first_sentence
        
        return function_text
    
    def _format_pathways_brief(self, pathways: List[str]) -> str:
        """Format pathways as brief comma-separated string."""
        if not pathways:
            return ''
        
        # Take first 3 pathways and clean them
        brief_pathways = []
        for pathway in pathways[:3]:
            # Remove "Reactome:" prefix and keep it short
            clean = pathway.replace('Reactome: ', '').strip()
            brief_pathways.append(clean)
        
        return ', '.join(brief_pathways)
    
    def _format_pathways_yaml(self, pathways: List[str]) -> str:
        """Format pathways list as YAML."""
        if not pathways:
            return "  - "
        
        formatted = []
        for pathway in pathways[:5]:  # Limit to first 5 pathways
            # Clean pathway text for YAML
            clean_pathway = pathway.replace('"', '\\"')
            formatted.append(f'  - "{clean_pathway}"')
        
        return "\n".join(formatted)
    
    def _infer_protein_type(self, data: Dict) -> str:
        """Extract protein type from UniProt data."""
        # Use the protein description or let it be empty
        return ''
    
    def _generate_significance_text(self, data: Dict) -> str:
        """Generate 'Why it matters here' text based on protein function."""
        # Leave empty for manual editing
        return ""
    
    def _generate_additional_sections(self, data: Dict) -> str:
        """Generate additional content sections."""
        sections = []
        
        # Subcellular location
        if data.get('subcellular_location'):
            locations = ', '.join(data['subcellular_location'])
            sections.append(f"## Localization\n\n{locations}")
        
        # Domains
        if data.get('domains'):
            domains_text = '\n'.join(f"- {domain}" for domain in data['domains'][:5])
            sections.append(f"## Domains/Features\n\n{domains_text}")
        
        # Pathways detail
        if data.get('pathways') and len(data['pathways']) > 3:
            pathways_text = '\n'.join(f"- {pathway}" for pathway in data['pathways'])
            sections.append(f"## Pathways\n\n{pathways_text}")
        
        return '\n\n'.join(sections)
    
    def create_protein_page(self, uniprot_id: str, overwrite: bool = False) -> Optional[Path]:
        """
        Create a new protein page from UniProt ID.
        
        Args:
            uniprot_id: UniProt accession (e.g., 'P04637')
            overwrite: Whether to overwrite existing files
        
        Returns:
            Path to created file or None if failed
        """
        # Fetch UniProt data
        print(f"[CREATE] Creating page for {uniprot_id}...")
        data = self.uniprot_fetcher.fetch_protein_data(uniprot_id)
        
        if not data:
            print(f"[ERROR] Could not fetch data for {uniprot_id}")
            return None
        
        # Generate filename
        gene_symbol = data.get('gene_symbol', uniprot_id)
        filename = self.generate_page_filename(gene_symbol, uniprot_id)
        output_path = self.wiki_dir / filename
        
        # Check if file already exists
        if output_path.exists() and not overwrite:
            print(f"[EXISTS] File {filename} already exists. Use --overwrite to replace.")
            return output_path
        
        # Prepare template variables
        template_vars = {
            'gene_symbol': gene_symbol,
            'uniprot_id': uniprot_id,
            'mass_kda': data.get('mass_kda', ''),
            'length_aa': data.get('length_aa', ''),
            'protein_type': self._infer_protein_type(data),
            'pathways_yaml': self._format_pathways_yaml(data.get('pathways', [])),
            'function': self._extract_first_sentence(data.get('function', 'Function not available.')),
            'significance': self._generate_significance_text(data),
            'date': datetime.now().strftime('%Y-%m-%d'),
            'pathways_brief': self._format_pathways_brief(data.get('pathways', [])),
            'domains': ', '.join(data.get('domains', [])[:3]) if data.get('domains') else ''
        }
        
        # Generate page content
        page_content = self.template.format(**template_vars)
        
        # Write file
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(page_content)
            
            print(f"[SUCCESS] Created: {filename}")
            return output_path
            
        except IOError as e:
            print(f"[ERROR] Failed to write {filename}: {e}")
            return None
    
    def split_family_page(self, family_page_path: str, max_members: int = 5) -> List[Path]:
        """
        Split a family page into individual protein pages.
        
        Args:
            family_page_path: Path to existing family page
            max_members: Maximum number of family members to create
        
        Returns:
            List of paths to created individual pages
        """
        family_path = Path(family_page_path)
        
        if not family_path.exists():
            # Try relative to wiki directory
            family_path = self.wiki_dir / family_page_path
            
        if not family_path.exists():
            print(f"[ERROR] Family page not found: {family_page_path}")
            return []
        
        print(f"[SPLIT] Splitting family page: {family_path.name}")
        
        # Read family page content
        with open(family_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract UniProt IDs from content
        uniprot_pattern = r'\b[A-NR-Z][0-9][A-Z][A-Z0-9][A-Z0-9][0-9]\b'
        found_ids = list(set(re.findall(uniprot_pattern, content)))
        
        if not found_ids:
            # Try to infer family from filename and search
            family_name = family_path.stem.replace('-', ' ').replace('_', ' ')
            print(f"[SEARCH] No UniProt IDs in content, searching for '{family_name}'")
            
            search_results = self.uniprot_fetcher.search_proteins(family_name, limit=max_members)
            found_ids = [result['uniprot_id'] for result in search_results]
        
        if not found_ids:
            print(f"[ERROR] No UniProt IDs found for family page: {family_path.name}")
            return []
        
        print(f"[FOUND] Found {len(found_ids)} UniProt IDs: {', '.join(found_ids[:max_members])}")
        
        # Create individual pages
        created_pages = []
        for uniprot_id in found_ids[:max_members]:
            page_path = self.create_protein_page(uniprot_id)
            if page_path:
                created_pages.append(page_path)
        
        print(f"[SUCCESS] Created {len(created_pages)} individual protein pages")
        return created_pages
    
    def batch_generate(self, uniprot_ids: List[str], overwrite: bool = False) -> List[Path]:
        """Generate multiple protein pages from a list of UniProt IDs."""
        created_pages = []
        
        print(f"[BATCH] Batch generating {len(uniprot_ids)} protein pages...")
        
        for i, uniprot_id in enumerate(uniprot_ids, 1):
            print(f"\nProgress: {i}/{len(uniprot_ids)}")
            page_path = self.create_protein_page(uniprot_id, overwrite)
            if page_path:
                created_pages.append(page_path)
        
        print(f"\n[SUCCESS] Batch complete: {len(created_pages)}/{len(uniprot_ids)} pages created")
        return created_pages

def main():
    parser = argparse.ArgumentParser(description="Generate protein pages from UniProt data")
    
    # Main command options
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('uniprot_id', nargs='?', help='Single UniProt ID to generate')
    group.add_argument('--family', '-f', help='Split family page into individual pages')
    group.add_argument('--batch', '-b', help='File containing list of UniProt IDs')
    
    # Options
    parser.add_argument('--overwrite', action='store_true', help='Overwrite existing pages')
    parser.add_argument('--max-members', type=int, default=5, 
                       help='Maximum family members to create (default: 5)')
    
    args = parser.parse_args()
    
    generator = ProteinPageGenerator()
    
    if args.uniprot_id:
        # Generate single page
        generator.create_protein_page(args.uniprot_id, args.overwrite)
        
    elif args.family:
        # Split family page
        generator.split_family_page(args.family, args.max_members)
        
    elif args.batch:
        # Batch generate from file
        batch_file = Path(args.batch)
        if not batch_file.exists():
            print(f"[ERROR] Batch file not found: {args.batch}")
            return
        
        with open(batch_file, 'r') as f:
            uniprot_ids = [line.strip() for line in f if line.strip()]
        
        generator.batch_generate(uniprot_ids, args.overwrite)

if __name__ == "__main__":
    main()