-- Undo migration 0023. A dead SWISS-MODEL URL makes IMMP2L ineligible for
-- automatic daily selection; it does not permit promoting the AlphaFold model
-- to Structure of the Day. Availability is enforced by the selector instead.
UPDATE proteins
SET structure_source = 'swissmodel'
WHERE uniprot = 'Q96T52'
  AND gene = 'IMMP2L'
  AND swissmodel_url IS NOT NULL;
