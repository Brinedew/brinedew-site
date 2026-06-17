-- Materialize the public card renderer contract on the synced essence read
-- model. Homepage/gene first-paint card artifacts must copy these fields from
-- here instead of performing request-time protein joins or path-specific
-- renderer derivation.

ALTER TABLE icono_gene_essence ADD COLUMN molecular_weight_kda REAL;
ALTER TABLE icono_gene_essence ADD COLUMN first_publication_year INTEGER;
ALTER TABLE icono_gene_essence ADD COLUMN primary_tissue TEXT;

UPDATE icono_gene_essence
   SET molecular_weight_kda = CASE
         WHEN molecular_weight_kda IS NULL AND weight_kg IS NOT NULL AND weight_kg > 0
           THEN ROUND(weight_kg, 1)
         ELSE molecular_weight_kda
       END,
       first_publication_year = CASE
         WHEN first_publication_year IS NULL AND age_years IS NOT NULL AND age_years >= 0
           THEN 2020 - age_years
         ELSE first_publication_year
       END,
       primary_tissue = CASE
         WHEN (primary_tissue IS NULL OR TRIM(primary_tissue) = '') AND tissue_tau IS NOT NULL
           THEN CASE
             WHEN tissue_tau >= 0.85 THEN 'tissue-specific'
             WHEN tissue_tau >= 0.5 THEN 'group-enriched'
             ELSE 'ubiquitous'
           END
         ELSE primary_tissue
       END;
