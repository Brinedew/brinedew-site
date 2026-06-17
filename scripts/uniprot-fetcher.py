#!/usr/bin/env python3
"""
UniProt API Integration Script

Fetches protein data from UniProt REST API and caches it locally.
Provides functions for:
1. Looking up protein data by UniProt ID
2. Searching proteins by gene name  
3. Caching results to avoid API rate limits

Usage: 
    python uniprot-fetcher.py P04637  # Fetch p53 data
    python uniprot-fetcher.py --search "TP53 human"  # Search by gene
"""

import requests
import json
import time
import argparse
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlencode

class UniProtFetcher:
    def __init__(self, cache_dir: str = "scripts/uniprot_cache"):
        self.base_url = "https://rest.uniprot.org"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        
        # Rate limiting
        self.last_request_time = 0
        self.min_request_interval = 0.5  # 500ms between requests
        
    def _rate_limit(self):
        """Ensure we don't hit UniProt too frequently."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self.last_request_time = time.time()
    
    def _get_cache_path(self, uniprot_id: str) -> Path:
        """Get cache file path for UniProt ID."""
        return self.cache_dir / f"{uniprot_id.upper()}.json"
    
    def _load_from_cache(self, uniprot_id: str) -> Optional[Dict]:
        """Load protein data from cache if available."""
        cache_path = self._get_cache_path(uniprot_id)
        if cache_path.exists():
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return None
    
    def _save_to_cache(self, uniprot_id: str, data: Dict):
        """Save protein data to cache."""
        cache_path = self._get_cache_path(uniprot_id)
        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Warning: Could not cache data for {uniprot_id}: {e}")
    
    def fetch_protein_data(self, uniprot_id: str, use_cache: bool = True) -> Optional[Dict]:
        """
        Fetch protein data from UniProt API.
        
        Args:
            uniprot_id: UniProt accession (e.g., 'P04637')
            use_cache: Whether to use/update cache
        
        Returns:
            Dictionary with protein data or None if not found
        """
        uniprot_id = uniprot_id.upper()
        
        # Check cache first
        if use_cache:
            cached_data = self._load_from_cache(uniprot_id)
            if cached_data:
                print(f"[CACHE] Using cached data for {uniprot_id}")
                return cached_data
        
        # Fetch from API
        self._rate_limit()
        url = f"{self.base_url}/uniprotkb/{uniprot_id}.json"
        
        try:
            print(f"[FETCH] Fetching {uniprot_id} from UniProt API...")
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                processed_data = self._process_protein_data(data)
                
                if use_cache:
                    self._save_to_cache(uniprot_id, processed_data)
                
                return processed_data
                
            elif response.status_code == 404:
                print(f"[ERROR] UniProt ID {uniprot_id} not found")
                return None
            else:
                print(f"[ERROR] API request failed: {response.status_code}")
                return None
                
        except requests.RequestException as e:
            print(f"[ERROR] Network error fetching {uniprot_id}: {e}")
            return None
    
    def _process_protein_data(self, raw_data: Dict) -> Dict:
        """Extract relevant fields from UniProt JSON response."""
        processed = {
            'uniprot_id': raw_data.get('primaryAccession', ''),
            'title': raw_data.get('proteinDescription', {}).get('recommendedName', {}).get('fullName', {}).get('value', ''),
            'gene_symbol': '',
            'organism': raw_data.get('organism', {}).get('scientificName', ''),
            'mass_da': 0,
            'length_aa': 0,
            'function': '',
            'pathways': [],
            'subcellular_location': [],
            'domains': [],
            'raw_data': raw_data  # Keep full data for debugging
        }
        
        # Gene names
        gene_names = raw_data.get('genes', [])
        if gene_names and gene_names[0].get('geneName'):
            processed['gene_symbol'] = gene_names[0]['geneName']['value']
        
        # Sequence info
        sequence = raw_data.get('sequence', {})
        processed['mass_da'] = sequence.get('molWeight', 0)
        processed['length_aa'] = sequence.get('length', 0)
        
        # Convert mass from Da to kDa
        if processed['mass_da']:
            processed['mass_kda'] = round(processed['mass_da'] / 1000, 1)
        else:
            processed['mass_kda'] = 0
        
        # Function description
        comments = raw_data.get('comments', [])
        for comment in comments:
            if comment.get('commentType') == 'FUNCTION':
                texts = comment.get('texts', [])
                if texts:
                    processed['function'] = texts[0].get('value', '')
                break
        
        # Pathways
        processed['pathways'] = self._extract_pathways(raw_data)
        
        # Subcellular location
        processed['subcellular_location'] = self._extract_subcellular_location(raw_data)
        
        # Domains/features
        processed['domains'] = self._extract_domains(raw_data)
        
        return processed
    
    def _extract_pathways(self, data: Dict) -> List[str]:
        """Extract pathway information from UniProt data."""
        pathways = []
        
        # Look for pathway comments
        comments = data.get('comments', [])
        for comment in comments:
            if comment.get('commentType') == 'PATHWAY':
                texts = comment.get('texts', [])
                for text in texts:
                    pathway_text = text.get('value', '')
                    if pathway_text:
                        pathways.append(pathway_text)
        
        # Look for cross-references to pathway databases
        cross_refs = data.get('uniProtKBCrossReferences', [])
        for ref in cross_refs:
            database = ref.get('database', '')
            if database in ['KEGG', 'Reactome', 'WikiPathways']:
                properties = ref.get('properties', [])
                for prop in properties:
                    if prop.get('key') == 'PathwayName':
                        pathways.append(f"{database}: {prop.get('value', '')}")
        
        return list(set(pathways))  # Remove duplicates
    
    def _extract_subcellular_location(self, data: Dict) -> List[str]:
        """Extract subcellular location information."""
        locations = []
        
        comments = data.get('comments', [])
        for comment in comments:
            if comment.get('commentType') == 'SUBCELLULAR_LOCATION':
                subcellular_locations = comment.get('subcellularLocations', [])
                for loc in subcellular_locations:
                    location = loc.get('location', {})
                    if location and location.get('value'):
                        locations.append(location['value'])
        
        return locations
    
    def _extract_domains(self, data: Dict) -> List[str]:
        """Extract domain/feature information."""
        domains = []
        
        features = data.get('features', [])
        for feature in features:
            feature_type = feature.get('type')
            if feature_type in ['DOMAIN', 'REGION', 'MOTIF']:
                description = feature.get('description')
                if description:
                    domains.append(description)
        
        return domains
    
    def search_proteins(self, query: str, organism: str = "human", limit: int = 10) -> List[Dict]:
        """
        Search for proteins by gene name or description.
        
        Args:
            query: Search term (gene name, protein name, etc.)
            organism: Organism filter (default: human) 
            limit: Maximum results to return
        
        Returns:
            List of protein data dictionaries
        """
        self._rate_limit()
        
        # Build search URL
        params = {
            'query': f'{query} AND organism_name:"{organism}"',
            'format': 'json',
            'size': limit
        }
        
        url = f"{self.base_url}/uniprotkb/search?" + urlencode(params)
        
        try:
            print(f"[SEARCH] Searching for '{query}' in {organism}...")
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                results = []
                
                for entry in data.get('results', []):
                    processed = self._process_protein_data(entry)
                    results.append(processed)
                
                print(f"[SUCCESS] Found {len(results)} results")
                return results
            else:
                print(f"[ERROR] Search failed: {response.status_code}")
                return []
                
        except requests.RequestException as e:
            print(f"[ERROR] Network error during search: {e}")
            return []
    
    def bulk_fetch(self, uniprot_ids: List[str]) -> Dict[str, Dict]:
        """Fetch multiple proteins efficiently."""
        results = {}
        
        print(f"[BULK] Fetching {len(uniprot_ids)} proteins...")
        for i, uniprot_id in enumerate(uniprot_ids, 1):
            print(f"Progress: {i}/{len(uniprot_ids)} - {uniprot_id}")
            
            data = self.fetch_protein_data(uniprot_id)
            if data:
                results[uniprot_id] = data
            
            # Progress indicator
            if i % 5 == 0:
                print(f"[PROGRESS] Completed {i}/{len(uniprot_ids)}")
        
        return results

def main():
    parser = argparse.ArgumentParser(description="Fetch protein data from UniProt")
    parser.add_argument('uniprot_id', nargs='?', help='UniProt ID to fetch (e.g., P04637)')
    parser.add_argument('--search', '-s', help='Search for proteins by name')
    parser.add_argument('--organism', '-o', default='human', help='Organism filter for search')
    parser.add_argument('--no-cache', action='store_true', help='Skip cache')
    
    args = parser.parse_args()
    
    fetcher = UniProtFetcher()
    
    if args.search:
        results = fetcher.search_proteins(args.search, args.organism)
        
        print(f"\nSearch Results for '{args.search}':")
        print("=" * 50)
        
        for result in results:
            print(f"PROTEIN: {result['gene_symbol']} ({result['uniprot_id']})")
            print(f"   Title: {result['title']}")
            print(f"   Mass: {result['mass_kda']} kDa, Length: {result['length_aa']} aa")
            if result['function']:
                print(f"   Function: {result['function'][:100]}...")
            print()
    
    elif args.uniprot_id:
        use_cache = not args.no_cache
        data = fetcher.fetch_protein_data(args.uniprot_id, use_cache)
        
        if data:
            print(f"\nProtein Data for {args.uniprot_id}:")
            print("=" * 50)
            print(f"Gene Symbol: {data['gene_symbol']}")
            print(f"Title: {data['title']}")
            print(f"Mass: {data['mass_kda']} kDa")
            print(f"Length: {data['length_aa']} amino acids")
            print(f"Organism: {data['organism']}")
            
            if data['function']:
                print(f"Function: {data['function']}")
            
            if data['pathways']:
                print(f"Pathways: {', '.join(data['pathways'][:3])}")
            
            if data['domains']:
                print(f"Domains: {', '.join(data['domains'][:3])}")
            
            print(f"\n[CACHE] Full data cached in: scripts/uniprot_cache/{args.uniprot_id.upper()}.json")
        
    else:
        parser.print_help()

if __name__ == "__main__":
    main()