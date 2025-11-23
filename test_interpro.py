import requests
import json

resp = requests.get('https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P60484/?page_size=10', timeout=30)
data = resp.json()

print(f'Total entries: {len(data.get("results", []))}')

rep_count = 0
rep_domains = []

for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    entry_name = meta.get('name', '')
    
    for protein in entry.get('proteins', []):
        if protein.get('accession', '').upper() != 'P60484':
            continue
            
        for loc in protein.get('entry_protein_locations', []):
            for frag in loc.get('fragments', []):
                if frag.get('representative') is True:
                    rep_count += 1
                    if entry_name not in rep_domains:
                        rep_domains.append(entry_name)

print(f'Representative fragments: {rep_count}')
print(f'Unique representative domains: {len(rep_domains)}')
print(f'Domain names: {rep_domains}')

# Show structure of first entry
if data.get('results'):
    print('\n--- First entry structure ---')
    first = data['results'][0]
    print(f'Entry: {first.get("metadata", {}).get("accession")}')
    print(f'Name: {first.get("metadata", {}).get("name")}')
    if first.get('proteins'):
        first_prot = first['proteins'][0]
        if first_prot.get('entry_protein_locations'):
            first_loc = first_prot['entry_protein_locations'][0]
            print(f'Has fragments: {len(first_loc.get("fragments", []))}')
            if first_loc.get('fragments'):
                first_frag = first_loc['fragments'][0]
                print(f'Fragment representative flag: {first_frag.get("representative")}')
                print(f'Fragment coords: {first_frag.get("start")}-{first_frag.get("end")}')
