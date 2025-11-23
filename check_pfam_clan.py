import requests
import json

# Get Pfam entries from TP53
url = 'https://www.ebi.ac.uk/interpro/api/entry/pfam/protein/uniprot/P04637'
resp = requests.get(url, timeout=30)
data = resp.json()

print('Pfam entries for TP53:')
print('=' * 70)

for entry in data.get('results', [])[:3]:
    meta = entry.get('metadata', {})
    acc = meta.get('accession')
    name = meta.get('name')
    if isinstance(name, dict):
        name = name.get('name') or name.get('short')
    
    print(f'\n{acc}: {name}')
    
    # Show metadata structure
    for key in meta.keys():
        if 'clan' in key.lower():
            print(f'  CLAN FOUND: {key} = {meta[key]}')
    
    # Check member_databases field
    member_dbs = meta.get('member_databases')
    if member_dbs:
        print(f'  Member DBs: {member_dbs}')
