import requests
import json

# Query a specific Pfam entry
pfam_id = 'PF00870'
url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{pfam_id}'
resp = requests.get(url, timeout=30)
data = resp.json()

meta = data.get('metadata', {})

print(f'Pfam entry {pfam_id}:')
print('=' * 70)
print(json.dumps(meta, indent=2)[:2000])
