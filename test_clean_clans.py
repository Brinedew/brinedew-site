import sys
sys.path.insert(0, r'D:\Coding\Website\tools\thoteins\scripts')
from populate_local_database import fetch_interpro_domains_and_clans

# Test on 5 example proteins
test_proteins = {
    'P00533': 'EGFR',
    'P06239': 'LCK',
    'P31749': 'AKT1',
    'P04637': 'TP53',
    'P60484': 'PTEN'
}

print('Pfam Clans by Gene Symbol:\n')
for uniprot_id, gene_symbol in test_proteins.items():
    domains, clans, had_error = fetch_interpro_domains_and_clans(uniprot_id)
    clan_str = ', '.join(clans) if clans else '(none)'
    print(f'{gene_symbol}: {clan_str}')
