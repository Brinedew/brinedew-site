-- Vote identity guard for Iconoplasm.
--
-- Chesterton's fence:
-- The table still keeps `candidate_ref` so historical imports can preserve the
-- original workstation reference, but canon ranking and user intent are really
-- keyed by `(gene_symbol, asset_sha256, user_id)`. Without this extra unique
-- guard, a legacy `c:<id>` ref and a durable `a:SYMBOL|sha` ref can silently
-- fork the same person's vote ledger for one image.

CREATE UNIQUE INDEX IF NOT EXISTS idx_icono_image_votes_asset_user_unique
  ON icono_image_votes (gene_symbol, asset_sha256, user_id);
