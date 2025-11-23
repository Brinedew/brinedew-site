import sys
sys.path.insert(0, r'D:\Coding\Website\tools\thoteins\scripts')
from populate_local_database import fetch_interpro_representative_domain_names

domains, err = fetch_interpro_representative_domain_names('P00533')
print('EGFR domains from backward-compatible function:')
for d in domains:
    print(f'  - {d}')
