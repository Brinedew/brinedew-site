SELECT COUNT(*) AS essence_rows, COUNT(DISTINCT gene_symbol) AS distinct_gene_symbols FROM icono_gene_essence;
SELECT COUNT(*) AS catalog_rows, COUNT(DISTINCT gene_symbol) AS distinct_gene_symbols FROM icono_gene_catalog;
