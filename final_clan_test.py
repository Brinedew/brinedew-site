import sys
import os
sys.path.insert(0, r'D:\Coding\Website\tools\thoteins\scripts')

# Verify cache is gone
cache_path = r'D:\Coding\Website\tools\thoteins\data\interpro_cache\representative_domains.db'
print(f'Cache exists: {os.path.exists(cache_path)}\n')

from populate_local_database import fetch_interpro_domains_and_clans

# Test 5 diverse proteins
test_proteins = {
    'P00533': 'EGFR',
    'P01308': 'INS', 
    'P68871': 'HBB',
    'P04637': 'TP53',
    'P42224': 'STAT1'
}

print('Gene Symbol → Pfam Clans:\n')
for uniprot_id, gene_symbol in test_proteins.items():
    domains, clans, had_error = fetch_interpro_domains_and_clans(uniprot_id)
    clan_display = ', '.join(clans) if clans else '—'
    print(f'{gene_symbol}: {clan_display}')
