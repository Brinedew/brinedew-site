import requests

# Try serine proteases - they typically have clans
test_ids = ['P00734', 'P00742', 'P07204']  # Thrombin, Factor X, Thrombomodulin

for uniprot_id in test_ids:
    url = f'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/{uniprot_id}'
    resp = requests.get(url, timeout=30)
    data = resp.json()
    
    print(f'\n{uniprot_id}:')
    for entry in data.get('results', []):
        meta = entry.get('metadata', {})
        source = meta.get('source_database')
        acc = meta.get('accession')
        
        for protein in entry.get('proteins', []):
            if protein.get('accession', '').upper() == uniprot_id:
                for loc in protein.get('entry_protein_locations', []):
                    if loc.get('representative') and source == 'pfam':
                        pfam_url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{acc}'
                        pfam_resp = requests.get(pfam_url, timeout=10)
                        if pfam_resp.ok:
                            pfam_data = pfam_resp.json()
                            set_info = pfam_data.get('metadata', {}).get('set_info')
                            if set_info:
                                clan_name = set_info.get('name')
                                print(f'  {acc}: {clan_name}')
                        break
