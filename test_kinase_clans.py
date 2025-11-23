import sys
sys.path.insert(0, r'D:\Coding\Website\tools\thoteins\scripts')
from populate_local_database import fetch_interpro_representative_domain_names

# Test on proteins known to have Pfam clan domains
# Protein kinases typically belong to Pfam clans
test_proteins = {
    'P00533': 'EGFR (epidermal growth factor receptor)',
    'P06239': 'LCK (lymphocyte-specific protein tyrosine kinase)',
    'P31749': 'AKT1 (RAC-alpha serine/threonine-protein kinase)'
}

print('Testing clan fetching on kinase proteins:\n')
for uniprot_id, desc in test_proteins.items():
    domains, had_error = fetch_interpro_representative_domain_names(uniprot_id)
    print(f'{uniprot_id} ({desc}):')
    if domains:
        for d in domains:
            print(f'  - {d}')
    else:
        print('  (no representative domains)')
    print()
