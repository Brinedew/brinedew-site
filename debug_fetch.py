import requests
import json

url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P04637?page_size=50'
resp = requests.get(url, timeout=30)
data = resp.json()

total = len(data.get('results', []))
print(f'Fetched {total} entries')

rep_count = 0
rep_names = []

for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    name = meta.get('name', '')
    
    for protein in entry.get('proteins', []):
        acc = protein.get('accession', '').upper()
        if acc != 'P04637':
            continue
        
        for loc in protein.get('entry_protein_locations', []):
            rep_flag = loc.get('representative')
            if rep_flag is True:
                rep_count += 1
                if name not in rep_names:
                    rep_names.append(name)
                print(f'Found representative: {name}')

print(f'\nTotal: {rep_count} representative locations')
print(f'Unique domains: {len(rep_names)}')
