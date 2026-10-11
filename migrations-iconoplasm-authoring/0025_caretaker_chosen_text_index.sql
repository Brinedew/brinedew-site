-- B-1065: the workstation polls the genes whose caretaker choice replaces the
-- factory's text (GET /api/iconoplasm/admin/texts?chosen=caretaker). Few genes
-- have one, so the poll reads those rows, not every gene's text.
CREATE INDEX icono_gene_texts_caretaker_chosen
  ON icono_gene_texts (gene_id) WHERE chosen_caretaker_version_id IS NOT NULL;
