-- B-1064: the Uniqueness rank moved to one catalogue-wide file
-- (catalog/v3/uniqueness.json), so nothing reads icono_gene_essence by
-- leakage_percent. The leakage_* columns stay unread: dropping a column rewrites
-- the whole table, about 20k rows plus their index entries.
DROP INDEX IF EXISTS idx_icono_gene_essence_leakage;
