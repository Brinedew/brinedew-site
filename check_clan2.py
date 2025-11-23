import requests

# Try a Pfam entry that's known to be in a clan (Piwi domain is in CL0219)
pfam_id = 'PF02171'  # Piwi domain
url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{pfam_id}'
resp = requests.get(url, timeout=30)
data = resp.json()

meta = data.get('metadata', {})

print(f'Checking Piwi domain (PF02171) for clan:')
print('=' * 70)
print(f'Keys: {list(meta.keys())}')
print(f'Hierarchy: {meta.get("hierarchy")}')

# Try the relationships endpoint
print('\nTrying relationships endpoint:')
rel_url = f'https://www.ebi.ac.uk/interpro/api/entry/pfam/{pfam_id}?extra_fields=hierarchy'
resp2 = requests.get(rel_url, timeout=30)
print(f'Status: {resp2.status_code}')

# Check if there's a clan field anywhere
import json
full_json = json.dumps(data, indent=2)
if 'clan' in full_json.lower():
    print('Found clan in response!')
    # Find and print that section
    for line in full_json.split('\n'):
        if 'clan' in line.lower():
            print(line)
else:
    print('No clan field found')
