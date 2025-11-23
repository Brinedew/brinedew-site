import requests
import json

pfam_id = 'PF00870'  # p53-like tetramerisation domain
url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{pfam_id}'
resp = requests.get(url, timeout=30)
data = resp.json()

# Pretty print full response to find clan
print(json.dumps(data, indent=2))
