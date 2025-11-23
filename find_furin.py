import requests

url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P00533'
resp = requests.get(url, timeout=30)
data = resp.json()

print('Looking for "Furin-like" domain:')
for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    name = meta.get('name')
    if isinstance(name, dict):
        name = name.get('name', name.get('short'))
    
    if name and 'Furin' in name:
        source = meta.get('source_database')
        acc = meta.get('accession')
        print(f'Found: {acc} ({source}) - {name}')
        
        for protein in entry.get('proteins', []):
            if protein.get('accession', '').upper() == 'P00533':
                for loc in protein.get('entry_protein_locations', []):
                    if loc.get('representative'):
                        print(f'  IS REPRESENTATIVE')
                        
                        # Try querying this entry
                        entry_url = f'https://www.ebi.ac.uk/interpro/api/entry/{source}/{acc}'
                        entry_resp = requests.get(entry_url, timeout=10)
                        if entry_resp.ok:
                            entry_data = entry_resp.json()
                            set_info = entry_data.get('metadata', {}).get('set_info')
                            print(f'  set_info: {set_info}')
                    break
