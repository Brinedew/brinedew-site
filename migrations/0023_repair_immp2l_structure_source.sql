-- The curated Swiss-Model URL for IMMP2L (Q96T52) now returns 404, while
-- AlphaFold still serves the complete structure. Preserve the historical
-- 2026-07-17 puzzle by moving the canonical source to the reachable model.
UPDATE proteins
SET structure_source = 'alphafold'
WHERE uniprot = 'Q96T52'
  AND gene = 'IMMP2L'
  AND structure_source = 'swissmodel'
  AND alphafold_url IS NOT NULL;
