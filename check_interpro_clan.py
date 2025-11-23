import requests
import json

url = 'https://www.ebi.ac.uk/interpro/api/entry/interpro/IPR006211'
resp = requests.get(url, timeout=30)
data = resp.json()

set_info = data.get('metadata', {}).get('set_info')
print(f'IPR006211 set_info: {json.dumps(set_info, indent=2)}')
