import requests

url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P00533'
resp = requests.get(url, timeout=30)
data = resp.json()

print('EGFR - ALL representative domains with source:')
for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    source = meta.get('source_database')
    acc = meta.get('accession')
    name = meta.get('name')
    if isinstance(name, dict):
        name = name.get('name', name.get('short'))
    
    for protein in entry.get('proteins', []):
        if protein.get('accession', '').upper() == 'P00533':
            for loc in protein.get('entry_protein_locations', []):
                if loc.get('representative'):
                    print(f'{source}: {acc} - {name}')
                    
                    # For non-CATH, check if there's clan-like info
                    if source not in ['pfam', 'cathgene3d']:
                        # Check the full entry for set_info
                        entry_url = f'https://www.ebi.ac.uk/interpro/api/entry/{source}/{acc}'
                        try:
                            entry_resp = requests.get(entry_url, timeout=10)
                            if entry_resp.ok:
                                entry_data = entry_resp.json()
                                set_info = entry_data.get('metadata', {}).get('set_info')
                                if set_info:
                                    print(f'  -> has set_info: {set_info}')
                        except:
                            pass
                    break
