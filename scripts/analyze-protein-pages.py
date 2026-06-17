#!/usr/bin/env python3
"""
Protein Page Migration Analysis Script

Analyzes current protein pages to identify:
1. Family pages that need splitting into individual UniProt entries
2. Pages that already have UniProt IDs
3. Missing or incomplete protein metadata

Usage: python analyze-protein-pages.py
"""

import os
import re
import yaml
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

class ProteinPageAnalyzer:
    def __init__(self, content_dir: str = "content"):
        self.content_dir = Path(content_dir)
        self.wiki_dir = self.content_dir / "wiki"
        
    def extract_frontmatter(self, file_path: Path) -> Tuple[Dict, str]:
        """Extract YAML frontmatter and content from markdown file."""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if not content.startswith('---'):
            return {}, content
            
        try:
            parts = content.split('---', 2)
            if len(parts) >= 3:
                frontmatter = yaml.safe_load(parts[1]) or {}
                body = parts[2].strip()
                return frontmatter, body
        except yaml.YAMLError as e:
            print(f"YAML error in {file_path}: {e}")
            return {}, content
            
        return {}, content
    
    def analyze_protein_page(self, file_path: Path) -> Dict:
        """Analyze a single protein page."""
        frontmatter, content = self.extract_frontmatter(file_path)
        
        # Basic page info
        analysis = {
            'filename': file_path.name,
            'path': str(file_path.relative_to(self.content_dir)),
            'title': frontmatter.get('title', 'No title'),
            'has_protein_tag': 'protein' in frontmatter.get('tags', []),
        }
        
        # Check for UniProt ID
        uniprot_id = frontmatter.get('uniprot_id')
        analysis['uniprot_id'] = uniprot_id
        analysis['has_uniprot_id'] = bool(uniprot_id)
        
        # Check for other protein metadata
        analysis['symbol'] = frontmatter.get('symbol')
        analysis['mass'] = frontmatter.get('mass')
        analysis['length_aa'] = frontmatter.get('length (aa)')
        analysis['protein_type'] = frontmatter.get('protein_type')
        analysis['pathways'] = frontmatter.get('pathways', [])
        
        # Detect if this is likely a family page
        filename = file_path.stem.lower()
        title = analysis['title'].lower()
        
        family_indicators = [
            'proteins', 'family', 'class', 'group', 'factors',
            'receptors', 'kinases', 'phosphatases'
        ]
        
        is_family = any(indicator in filename or indicator in title 
                       for indicator in family_indicators)
        analysis['likely_family_page'] = is_family
        
        # Check for multiple proteins mentioned in content
        uniprot_pattern = r'\b[A-NR-Z][0-9][A-Z][A-Z0-9][A-Z0-9][0-9]\b'
        uniprot_mentions = re.findall(uniprot_pattern, content)
        analysis['uniprot_mentions_in_content'] = len(set(uniprot_mentions))
        
        # Migration status
        if analysis['has_uniprot_id'] and not is_family:
            analysis['migration_status'] = 'single_protein'
        elif is_family or analysis['uniprot_mentions_in_content'] > 1:
            analysis['migration_status'] = 'needs_split'
        else:
            analysis['migration_status'] = 'needs_uniprot_id'
            
        return analysis
    
    def find_protein_pages(self) -> List[Path]:
        """Find all files with 'protein' tag."""
        protein_pages = []
        
        for md_file in self.wiki_dir.glob('*.md'):
            frontmatter, _ = self.extract_frontmatter(md_file)
            tags = frontmatter.get('tags', [])
            # Handle case where tags might be None or a string
            if tags is None:
                tags = []
            elif isinstance(tags, str):
                tags = [tags]
            
            if 'protein' in tags:
                protein_pages.append(md_file)
                
        return sorted(protein_pages)
    
    def generate_report(self) -> Dict:
        """Generate comprehensive analysis report."""
        protein_pages = self.find_protein_pages()
        analyses = []
        
        for page in protein_pages:
            analysis = self.analyze_protein_page(page)
            analyses.append(analysis)
        
        # Summary statistics
        total_pages = len(analyses)
        single_protein = sum(1 for a in analyses if a['migration_status'] == 'single_protein')
        needs_split = sum(1 for a in analyses if a['migration_status'] == 'needs_split')
        needs_uniprot = sum(1 for a in analyses if a['migration_status'] == 'needs_uniprot_id')
        
        report = {
            'summary': {
                'total_protein_pages': total_pages,
                'single_protein_pages': single_protein,
                'family_pages_needing_split': needs_split,
                'pages_needing_uniprot_id': needs_uniprot
            },
            'pages': analyses
        }
        
        return report
    
    def print_report(self, report: Dict):
        """Print human-readable analysis report."""
        summary = report['summary']
        
        print("Protein Page Migration Analysis")
        print("=" * 40)
        print(f"Total protein pages: {summary['total_protein_pages']}")
        print(f"[OK] Single protein pages: {summary['single_protein_pages']}")
        print(f"[SPLIT] Family pages needing split: {summary['family_pages_needing_split']}")
        print(f"[MISSING] Pages needing UniProt ID: {summary['pages_needing_uniprot_id']}")
        print()
        
        # Group by migration status
        by_status = {}
        for page in report['pages']:
            status = page['migration_status']
            if status not in by_status:
                by_status[status] = []
            by_status[status].append(page)
        
        for status, pages in by_status.items():
            if not pages:
                continue
                
            print(f"{status.upper().replace('_', ' ')} ({len(pages)} pages):")
            print("-" * 30)
            
            for page in pages:
                # Handle encoding issues by cleaning title
                clean_title = page['title'].encode('ascii', 'ignore').decode('ascii')
                print(f"FILE: {page['filename']}")
                print(f"   Title: {clean_title}")
                if page['uniprot_id']:
                    print(f"   UniProt ID: {page['uniprot_id']}")
                if page['likely_family_page']:
                    print(f"   [FAMILY] Detected as family page")
                if page['uniprot_mentions_in_content'] > 0:
                    print(f"   [IDS] {page['uniprot_mentions_in_content']} UniProt IDs in content")
                print()
    
    def save_report(self, report: Dict, output_file: str = "protein-migration-analysis.json"):
        """Save detailed report to JSON file."""
        output_path = Path("scripts") / output_file
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"Detailed report saved to: {output_path}")

def main():
    analyzer = ProteinPageAnalyzer()
    report = analyzer.generate_report()
    analyzer.print_report(report)
    analyzer.save_report(report)
    
    print()
    print("Next steps:")
    print("1. Run 'python scripts/uniprot-fetcher.py' to build UniProt database")
    print("2. Run 'python scripts/generate-protein-pages.py' to create individual pages")

if __name__ == "__main__":
    main()