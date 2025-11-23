import requests
import json

proteins = [
    ('TP53', 'P04637'),
    ('PTEN', 'P60484'),
    ('BRCA1', 'P38398'),
    ('GP2', 'P55259'),
    ('Insulin', 'P01308')
]

print('Testing /entry/all/ endpoint (consultant recommended):')
print('=' * 60)

for name, acc in proteins:
    try:
        url = f'https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/{acc}?page_size=50'
        resp = requests.get(url, timeout=20)
        data = resp.json()
        
        total_entries = len(data.get('results', []))
        rep_fragments = 0
        
        for entry in data.get('results', []):
            for protein in entry.get('proteins', []):
                if protein.get('accession', '').upper() != acc.upper():
                    continue
                for loc in protein.get('entry_protein_locations', []):
                    for frag in loc.get('fragments', []):
                        if frag.get('representative') is True:
                            rep_fragments += 1
        
        print(f'{name:10} ({acc}): {total_entries:3} entries, {rep_fragments:3} rep fragments')
        
    except Exception as e:
        print(f'{name:10} ({acc}): ERROR - {str(e)[:40]}')

print('\n' + '=' * 60)
print('Conclusion: Checking if ANY protein has representative=true')
