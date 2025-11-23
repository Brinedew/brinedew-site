import requests
import json

# Check what fields are in protein-level query
url = 'https://www.ebi.ac.uk/interpro/api/entry/pfam/protein/uniprot/P04637'
resp = requests.get(url, timeout=30)
data = resp.json()

# Check first Pfam entry
first_entry = data.get('results', [{}])[0]
meta = first_entry.get('metadata', {})
print(f"Metadata keys: {list(meta.keys())}")
print(f"\nset_info: {meta.get('set_info')}")
