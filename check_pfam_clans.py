import requests

# Check TP53 domains
url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P04637'
resp = requests.get(url, timeout=30)
data = resp.json()

print('TP53 domains with representative flag:')
for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    source = meta.get('source_database')
    name = meta.get('name')
    if isinstance(name, dict):
        name = name.get('name', name.get('short'))
    acc = meta.get('accession')
    
    # Check if representative
    for protein in entry.get('proteins', []):
        if protein.get('accession', '').upper() == 'P04637':
            for loc in protein.get('entry_protein_locations', []):
                if loc.get('representative'):
                    print(f'  {acc} ({source}): {name}')
                    
                    # If Pfam, check for clan
                    if source == 'pfam':
                        pfam_url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{acc}'
                        pfam_resp = requests.get(pfam_url, timeout=10)
                        if pfam_resp.ok:
                            pfam_data = pfam_resp.json()
                            set_info = pfam_data.get('metadata', {}).get('set_info')
                            print(f'    Clan: {set_info}')
                    break
