-- A signed-in reader's own votes reach the gene page and the gallery through
-- /api/iconoplasm/votes/mine, which names genes, not portraits: a gene page asks
-- once whatever its portrait count, and the read follows the reader's own votes
-- on the named genes, not the gene's size or anyone else's votes. That needs the
-- reader's votes found by (user_id, gene_symbol).
--
-- idx_icono_image_votes_user (0149) held user_id alone; account erasure, its one
-- other reader, still finds a person's votes by the user_id prefix. A vote never
-- changes its gene, so a vote writes the same index rows as before: one entry
-- when the row appears or goes, none when its value changes.
--
-- Cost: rebuilding the index writes one row per vote (1,765 on the 2026-10-29
-- copy).
--
-- Online: the Worker installed before this change looks votes up by user_id
-- only in erasure, which the new index serves.

DROP INDEX IF EXISTS idx_icono_image_votes_user;
CREATE INDEX idx_icono_image_votes_user ON icono_image_votes (user_id, gene_symbol);
