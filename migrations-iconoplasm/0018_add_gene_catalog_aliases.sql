-- Published Iconoplasm aliases for extension/search consumers.
--
-- Chesterton's fence: these aliases come from the upstream workstation control
-- plane at `d:\Coding\Datasets\iconoplasm`, which derives them from HGNC and
-- publishes only conservative, uniquely-resolved symbol-like aliases. The
-- website/runtime stores them here; it should not invent alias facts locally.

ALTER TABLE icono_gene_catalog
  ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';
