ALTER TABLE icono_manifestation_canonical_projection
  ADD COLUMN canonical_public_page_visible INTEGER NOT NULL DEFAULT 0
  CHECK (canonical_public_page_visible IN (0, 1));

