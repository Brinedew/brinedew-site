import sys
sys.path.insert(0, r'D:\Coding\Website\tools\thoteins\scripts')
from populate_local_database import fetch_interpro_domains_and_clans

# Test immunoglobulins and kinases
test_proteins = {
    'P01857': 'IGHG1 (Ig gamma-1)',
    'P01834': 'IGKC (Ig kappa)',
    'P42224': 'STAT1 (signal transducer)',
    'P06241': 'FYN (proto-oncogene tyrosine-protein kinase)',
    'P27361': 'MAPK3 (mitogen-activated protein kinase 3)'
}

print('Testing clan fetching:\n')
for uniprot_id, desc in test_proteins.items():
    domains, clans, had_error = fetch_interpro_domains_and_clans(uniprot_id)
    print(f'{desc}:')
    print(f'  Domains: {domains[:3] if domains else "(none)"}')
    print(f'  Clans: {", ".join(clans) if clans else "(none)"}')
    print()
