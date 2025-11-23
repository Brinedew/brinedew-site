import requests
import json

# Query Pfam entry
pfam_id = 'PF00870'
url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{pfam_id}'
resp = requests.get(url, timeout=30)
data = resp.json()

# Check set_info
set_info = data.get('metadata', {}).get('set_info')
print(f"set_info: {json.dumps(set_info, indent=2)}")

# Try a few other Pfam entries to see pattern
for test_id in ['PF07710', 'PF08563']:
    url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{test_id}'
    resp = requests.get(url, timeout=30)
    test_data = resp.json()
    test_set = test_data.get('metadata', {}).get('set_info')
    print(f"\n{test_id} set_info: {test_set}")
