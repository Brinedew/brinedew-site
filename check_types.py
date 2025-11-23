import requests

url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P04637?page_size=50'
resp = requests.get(url, timeout=30)
data = resp.json()

for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    name = meta.get('name')
    if isinstance(name, dict):
        name = name.get('name') or name.get('short')
    entry_type = meta.get('type', 'unknown')
    source_db = meta.get('source_database', 'unknown')
    
    for protein in entry.get('proteins', []):
        if protein.get('accession', '').upper() != 'P04637':
            continue
        for loc in protein.get('entry_protein_locations', []):
            if loc.get('representative') is True:
                print(f'{name}')
                print(f'  Type: {entry_type}, Source: {source_db}')
                break
