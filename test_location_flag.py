import requests
import json

# Test Q7X923 (consultant's example that should have representative=true)
test_proteins = [
    ('Q7X923_example', 'Q7X923'),  # Should have representative=true
    ('TP53', 'P04637'),
    ('PTEN', 'P60484'),
    ('GP2', 'P55259'),
]

print('Testing LOCATION-level representative flag (corrected):')
print('=' * 70)

for name, acc in test_proteins:
    try:
        url = f'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/{acc}?page_size=100'
        resp = requests.get(url, timeout=30)
        data = resp.json()
        
        total_entries = len(data.get('results', []))
        rep_locations = 0
        rep_domains = []
        
        for entry in data.get('results', []):
            meta = entry.get('metadata', {})
            entry_name = meta.get('name', '')
            if isinstance(entry_name, dict):
                entry_name = entry_name.get('name', '') or entry_name.get('short', '')
            
            for protein in entry.get('proteins', []):
                if protein.get('accession', '').upper() != acc.upper():
                    continue
                    
                # Check LOCATION level (not fragment level)
                for loc in protein.get('entry_protein_locations', []):
                    if loc.get('representative') is True:
                        rep_locations += 1
                        if entry_name and entry_name not in rep_domains:
                            rep_domains.append(entry_name)
        
        status = 'FOUND!' if rep_locations > 0 else 'none'
        print(f'{name:15} ({acc}): {total_entries:3} entries, {rep_locations:3} rep locations [{status}]')
        if rep_domains:
            print(f'  → Domains: {rep_domains[:3]}')
        
    except Exception as e:
        print(f'{name:15} ({acc}): ERROR - {str(e)[:50]}')

print('\n' + '=' * 70)
