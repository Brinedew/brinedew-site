ALTER TABLE icono_manifestations
  ADD COLUMN public_page_visible INTEGER NOT NULL DEFAULT 0
  CHECK (public_page_visible IN (0, 1));

