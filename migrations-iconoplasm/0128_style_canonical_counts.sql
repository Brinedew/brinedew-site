-- Canonical blots per style: how many genes' current portraits each style drew.
--
-- A style is the number after the dash in a portrait's emulsion code: legacy
-- `0-255`, edited `0-255-e` and factory `C9-255` / `A9-255` are all style 255.
-- The picker's request-option rollups carried this as live_count, rebuilt
-- per vision and per factory code, and both went stale (2026-10-14 copy: the
-- vision rollups summed to 20,663 against 19,380 genes; the factory rollup to
-- 1,727 against 2,203), and a factory card summed only its factory codes, so
-- style 255 showed 7 of its 39 canonical blots. These triggers keep the count
-- exact in the same transaction as every write that can change it: a gene's
-- portrait changing (icono_publish_state), or the asset it points at gaining,
-- changing or losing its emulsion code (icono_portrait_assets).
CREATE TABLE icono_style_canonical_counts (
  style_slot INTEGER PRIMARY KEY CHECK (style_slot > 0),
  canonical INTEGER NOT NULL DEFAULT 0 CHECK (canonical >= 0)
) WITHOUT ROWID;

INSERT INTO icono_style_canonical_counts (style_slot, canonical)
SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) AS slot, COUNT(*)
FROM icono_publish_state ps
JOIN icono_portrait_assets pa
  ON pa.gene_symbol = ps.gene_symbol AND pa.asset_sha256 = ps.current_asset_sha256
WHERE COALESCE(ps.current_asset_sha256, '') <> ''
GROUP BY slot
HAVING slot > 0;

CREATE TRIGGER trg_icono_style_canonical_publish_insert AFTER INSERT ON icono_publish_state
BEGIN
INSERT INTO icono_style_canonical_counts (style_slot, canonical)
SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER), 1
FROM icono_portrait_assets pa
WHERE pa.gene_symbol = NEW.gene_symbol AND pa.asset_sha256 = NEW.current_asset_sha256
  AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0
ON CONFLICT(style_slot) DO UPDATE SET canonical = canonical + 1;
END;

CREATE TRIGGER trg_icono_style_canonical_publish_delete AFTER DELETE ON icono_publish_state
BEGIN
UPDATE icono_style_canonical_counts SET canonical = canonical - 1
WHERE style_slot = (
  SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER)
  FROM icono_portrait_assets pa
  WHERE pa.gene_symbol = OLD.gene_symbol AND pa.asset_sha256 = OLD.current_asset_sha256
);
END;

CREATE TRIGGER trg_icono_style_canonical_publish_update
AFTER UPDATE OF gene_symbol, current_asset_sha256 ON icono_publish_state
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol OR OLD.current_asset_sha256 IS NOT NEW.current_asset_sha256
BEGIN
UPDATE icono_style_canonical_counts SET canonical = canonical - 1
WHERE style_slot = (
  SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER)
  FROM icono_portrait_assets pa
  WHERE pa.gene_symbol = OLD.gene_symbol AND pa.asset_sha256 = OLD.current_asset_sha256
);
INSERT INTO icono_style_canonical_counts (style_slot, canonical)
SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER), 1
FROM icono_portrait_assets pa
WHERE pa.gene_symbol = NEW.gene_symbol AND pa.asset_sha256 = NEW.current_asset_sha256
  AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0
ON CONFLICT(style_slot) DO UPDATE SET canonical = canonical + 1;
END;

-- An asset row can arrive after the publish row that points at it, and an
-- upsert or an account erasure can rewrite a canonical asset's emulsion code.
CREATE TRIGGER trg_icono_style_canonical_asset_insert AFTER INSERT ON icono_portrait_assets
WHEN CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER) > 0
  AND EXISTS (
    SELECT 1 FROM icono_publish_state ps
    WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256
  )
BEGIN
INSERT INTO icono_style_canonical_counts (style_slot, canonical)
VALUES (CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER), 1)
ON CONFLICT(style_slot) DO UPDATE SET canonical = canonical + 1;
END;

CREATE TRIGGER trg_icono_style_canonical_asset_delete AFTER DELETE ON icono_portrait_assets
WHEN EXISTS (
  SELECT 1 FROM icono_publish_state ps
  WHERE ps.gene_symbol = OLD.gene_symbol AND ps.current_asset_sha256 = OLD.asset_sha256
)
BEGIN
UPDATE icono_style_canonical_counts SET canonical = canonical - 1
WHERE style_slot = CAST(substr(OLD.emulsion_id, instr(OLD.emulsion_id, '-') + 1) AS INTEGER);
END;

CREATE TRIGGER trg_icono_style_canonical_asset_update
AFTER UPDATE OF gene_symbol, asset_sha256, emulsion_id ON icono_portrait_assets
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol
  OR OLD.asset_sha256 IS NOT NEW.asset_sha256
  OR OLD.emulsion_id IS NOT NEW.emulsion_id
BEGIN
UPDATE icono_style_canonical_counts SET canonical = canonical - 1
WHERE style_slot = CAST(substr(OLD.emulsion_id, instr(OLD.emulsion_id, '-') + 1) AS INTEGER)
  AND EXISTS (
    SELECT 1 FROM icono_publish_state ps
    WHERE ps.gene_symbol = OLD.gene_symbol AND ps.current_asset_sha256 = OLD.asset_sha256
  );
INSERT INTO icono_style_canonical_counts (style_slot, canonical)
SELECT CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER), 1
WHERE CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER) > 0
  AND EXISTS (
    SELECT 1 FROM icono_publish_state ps
    WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256
  )
ON CONFLICT(style_slot) DO UPDATE SET canonical = canonical + 1;
END;
