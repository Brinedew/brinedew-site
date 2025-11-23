import requests
import json

url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P04637?page_size=10'
resp = requests.get(url, timeout=30)
data = resp.json()

print('Checking for Pfam clan information in API response:')
print('=' * 70)

for entry in data.get('results', [])[:3]:
    meta = entry.get('metadata', {})
    name = meta.get('name')
    if isinstance(name, dict):
        name = name.get('name') or name.get('short')
    
    source_db = meta.get('source_database', 'unknown')
    member_db = meta.get('member_databases')
    integrated = meta.get('integrated')
    
    print(f'\nEntry: {name}')
    print(f'  Source: {source_db}')
    print(f'  Member DBs: {member_db}')
    print(f'  Integrated: {integrated}')
    
    # Check for clan info
    if 'clan' in str(meta).lower():
        print(f'  Has clan data!')
    
    # Show all metadata keys
    print(f'  Keys: {list(meta.keys())}')
