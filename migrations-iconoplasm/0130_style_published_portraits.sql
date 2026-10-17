-- A style's published portraits: one row per gene whose current portrait the
-- style drew, filed under the style number after the dash of the portrait's
-- emulsion code (legacy `0-255`, edited `0-255-e`, factory `C9-255` are all
-- style 255). The picker's style cards read their blot count and their
-- pictures from this one table, so the two cannot disagree (B-896,
-- 2026-10-17). Before it, the pictures came from per-vision rollup lists that
-- mixed in candidates and froze each portrait's "published" flag when built:
-- on the 2026-10-17 copy 66 of 717 cards showed more published portraits than
-- the style had, and TP53 was published in two styles at once.
--
-- The triggers fire at 0128's points: a gene's portrait changing
-- (icono_publish_state), or the asset it points at arriving, changing or
-- losing its emulsion code (icono_portrait_assets). Every delete names the
-- exact (style, gene, asset), so a stale row can never remove a live one.
-- 0128's count table stays until the code that reads it is gone.
CREATE TABLE icono_style_published_portraits (
  style_slot INTEGER NOT NULL CHECK (style_slot > 0),
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  PRIMARY KEY (style_slot, gene_symbol)
) WITHOUT ROWID;

INSERT INTO icono_style_published_portraits (style_slot, gene_symbol, asset_sha256)
SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER),
  ps.gene_symbol, ps.current_asset_sha256
FROM icono_publish_state ps
JOIN icono_portrait_assets pa
  ON pa.gene_symbol = ps.gene_symbol AND pa.asset_sha256 = ps.current_asset_sha256
WHERE COALESCE(ps.current_asset_sha256, '') <> ''
  AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0;

CREATE TRIGGER trg_icono_style_portraits_publish_insert AFTER INSERT ON icono_publish_state
BEGIN
INSERT INTO icono_style_published_portraits (style_slot, gene_symbol, asset_sha256)
SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER),
  NEW.gene_symbol, NEW.current_asset_sha256
FROM icono_portrait_assets pa
WHERE pa.gene_symbol = NEW.gene_symbol AND pa.asset_sha256 = NEW.current_asset_sha256
  AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0
ON CONFLICT(style_slot, gene_symbol) DO UPDATE SET asset_sha256 = excluded.asset_sha256;
END;

CREATE TRIGGER trg_icono_style_portraits_publish_delete AFTER DELETE ON icono_publish_state
BEGIN
DELETE FROM icono_style_published_portraits
WHERE gene_symbol = OLD.gene_symbol AND asset_sha256 = OLD.current_asset_sha256
  AND style_slot = (
    SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER)
    FROM icono_portrait_assets pa
    WHERE pa.gene_symbol = OLD.gene_symbol AND pa.asset_sha256 = OLD.current_asset_sha256
  );
END;

CREATE TRIGGER trg_icono_style_portraits_publish_update
AFTER UPDATE OF gene_symbol, current_asset_sha256 ON icono_publish_state
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol OR OLD.current_asset_sha256 IS NOT NEW.current_asset_sha256
BEGIN
DELETE FROM icono_style_published_portraits
WHERE gene_symbol = OLD.gene_symbol AND asset_sha256 = OLD.current_asset_sha256
  AND style_slot = (
    SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER)
    FROM icono_portrait_assets pa
    WHERE pa.gene_symbol = OLD.gene_symbol AND pa.asset_sha256 = OLD.current_asset_sha256
  );
INSERT INTO icono_style_published_portraits (style_slot, gene_symbol, asset_sha256)
SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER),
  NEW.gene_symbol, NEW.current_asset_sha256
FROM icono_portrait_assets pa
WHERE pa.gene_symbol = NEW.gene_symbol AND pa.asset_sha256 = NEW.current_asset_sha256
  AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0
ON CONFLICT(style_slot, gene_symbol) DO UPDATE SET asset_sha256 = excluded.asset_sha256;
END;

-- An asset row can arrive after the publish row that points at it, and an
-- upsert or an account erasure can rewrite a published asset's emulsion code.
CREATE TRIGGER trg_icono_style_portraits_asset_insert AFTER INSERT ON icono_portrait_assets
WHEN CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER) > 0
  AND EXISTS (
    SELECT 1 FROM icono_publish_state ps
    WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256
  )
BEGIN
INSERT INTO icono_style_published_portraits (style_slot, gene_symbol, asset_sha256)
VALUES (
  CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER),
  NEW.gene_symbol, NEW.asset_sha256
)
ON CONFLICT(style_slot, gene_symbol) DO UPDATE SET asset_sha256 = excluded.asset_sha256;
END;

CREATE TRIGGER trg_icono_style_portraits_asset_delete AFTER DELETE ON icono_portrait_assets
BEGIN
DELETE FROM icono_style_published_portraits
WHERE style_slot = CAST(substr(OLD.emulsion_id, instr(OLD.emulsion_id, '-') + 1) AS INTEGER)
  AND gene_symbol = OLD.gene_symbol AND asset_sha256 = OLD.asset_sha256;
END;

CREATE TRIGGER trg_icono_style_portraits_asset_update
AFTER UPDATE OF gene_symbol, asset_sha256, emulsion_id ON icono_portrait_assets
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol
  OR OLD.asset_sha256 IS NOT NEW.asset_sha256
  OR OLD.emulsion_id IS NOT NEW.emulsion_id
BEGIN
DELETE FROM icono_style_published_portraits
WHERE style_slot = CAST(substr(OLD.emulsion_id, instr(OLD.emulsion_id, '-') + 1) AS INTEGER)
  AND gene_symbol = OLD.gene_symbol AND asset_sha256 = OLD.asset_sha256;
INSERT INTO icono_style_published_portraits (style_slot, gene_symbol, asset_sha256)
SELECT CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER),
  NEW.gene_symbol, NEW.asset_sha256
WHERE CAST(substr(NEW.emulsion_id, instr(NEW.emulsion_id, '-') + 1) AS INTEGER) > 0
  AND EXISTS (
    SELECT 1 FROM icono_publish_state ps
    WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256
  )
ON CONFLICT(style_slot, gene_symbol) DO UPDATE SET asset_sha256 = excluded.asset_sha256;
END;
