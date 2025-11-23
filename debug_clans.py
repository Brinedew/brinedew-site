import requests

# Check EGFR manually - we saw GF_recep_C-rich clan earlier
url = 'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P00533'
resp = requests.get(url, timeout=30)
data = resp.json()

print('EGFR representative Pfam domains:')
for entry in data.get('results', []):
    meta = entry.get('metadata', {})
    source = meta.get('source_database')
    acc = meta.get('accession')
    
    # Check representative
    for protein in entry.get('proteins', []):
        if protein.get('accession', '').upper() == 'P00533':
            for loc in protein.get('entry_protein_locations', []):
                if loc.get('representative') and source == 'pfam':
                    print(f'  {acc} ({source})')
                    
                    # Query for clan
                    pfam_url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{acc}'
                    pfam_resp = requests.get(pfam_url, timeout=10)
                    if pfam_resp.ok:
                        pfam_data = pfam_resp.json()
                        set_info = pfam_data.get('metadata', {}).get('set_info')
                        print(f'    set_info: {set_info}')
                    break
