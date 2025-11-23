import sys
sys.path.insert(0, r'D:\Coding\Website\tools\thoteins\scripts')
from populate_local_database import fetch_interpro_representative_domain_names

# Test on 5 popular proteins
test_proteins = {
    'P04637': 'TP53 (tumor protein p53)',
    'P60484': 'PTEN',
    'P55259': 'GP2 (glycoprotein 2)',  
    'P01308': 'INS (insulin)',
    'P68871': 'HBB (hemoglobin subunit beta)'
}

print('Testing clan fetching on 5 example proteins:\n')
for uniprot_id, desc in test_proteins.items():
    domains, had_error = fetch_interpro_representative_domain_names(uniprot_id)
    print(f'{uniprot_id} ({desc}):')
    if domains:
        for d in domains:
            print(f'  - {d}')
    else:
        print('  (no representative domains)')
    print()
