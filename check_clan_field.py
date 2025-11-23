import requests
import json

# Query a known Pfam entry
pfam_id = 'PF00870'
url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{pfam_id}'
resp = requests.get(url, timeout=30)
data = resp.json()

# Check if 'clan' field exists in metadata
metadata = data.get('metadata', {})
print(f"Keys in metadata: {list(metadata.keys())}")
print(f"\nClan field: {metadata.get('clan', 'NOT FOUND')}")
