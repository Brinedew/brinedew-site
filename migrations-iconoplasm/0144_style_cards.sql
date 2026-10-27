-- A style card, stored: how many blots the style has and its four most upvoted
-- published portraits, one row per style number. Before it, every card was
-- worked out on read from all of its style's blots and one vote seek each. The
-- picker job did that every 15 minutes for its 120 styles (about 1,450 rows a
-- run, 138,300 of the database's 258,000 rows read on 2026-10-27, and 88 of 92
-- runs that day rebuilt identical bytes), and a reader with 26 favourite styles
-- paid about 1,160 rows per open of the order panel (B-1154). Now a card costs
-- one row.
--
-- The triggers keep each card equal to icono_style_published_portraits in the
-- same transaction as every write to it, whichever of 0130's triggers made
-- that write. They fire only when a published portrait changes: a caretaker or
-- admin picks another drawing, or a published asset arrives or changes code.
-- Votes do not refresh a card: its four pictures stay ranked by the upvotes
-- they had when the style last changed. Readers never see vote numbers on a
-- card, and a trigger on every vote would add a row written to each one, the
-- write that runs out first in a burst. `portraits_json` holds
-- [gene_symbol, asset_sha256, upvotes] triples; the worker sorts them.
CREATE TABLE icono_style_cards (
  style_slot INTEGER PRIMARY KEY CHECK (style_slot > 0),
  blot_count INTEGER NOT NULL,
  portraits_json TEXT NOT NULL
);

INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT style_slot, MAX(blots),
  json_group_array(json_array(gene_symbol, asset_sha256, upvotes)) FILTER (WHERE place <= 4)
FROM (
  SELECT m.style_slot, m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes,
    row_number() OVER (
      PARTITION BY m.style_slot ORDER BY COALESCE(v.upvotes, 0) DESC, m.asset_sha256
    ) AS place,
    COUNT(*) OVER (PARTITION BY m.style_slot) AS blots
  FROM icono_style_published_portraits m
  LEFT JOIN icono_vote_asset_summary v
    ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
)
GROUP BY style_slot;

CREATE TRIGGER trg_icono_style_cards_insert AFTER INSERT ON icono_style_published_portraits
BEGIN
INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT NEW.style_slot,
  (SELECT COUNT(*) FROM icono_style_published_portraits WHERE style_slot = NEW.style_slot),
  (SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = NEW.style_slot
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;

CREATE TRIGGER trg_icono_style_cards_delete AFTER DELETE ON icono_style_published_portraits
BEGIN
INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT OLD.style_slot,
  (SELECT COUNT(*) FROM icono_style_published_portraits WHERE style_slot = OLD.style_slot),
  (SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = OLD.style_slot
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;

-- 0130's upserts change a gene's asset within its style; the style number is
-- the key and never changes in place.
CREATE TRIGGER trg_icono_style_cards_update
AFTER UPDATE OF asset_sha256 ON icono_style_published_portraits
WHEN OLD.asset_sha256 IS NOT NEW.asset_sha256
BEGIN
INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
SELECT NEW.style_slot,
  (SELECT COUNT(*) FROM icono_style_published_portraits WHERE style_slot = NEW.style_slot),
  (SELECT json_group_array(json_array(gene_symbol, asset_sha256, upvotes)) FROM (
    SELECT m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes
    FROM icono_style_published_portraits m
    LEFT JOIN icono_vote_asset_summary v
      ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256
    WHERE m.style_slot = NEW.style_slot
    ORDER BY upvotes DESC, m.asset_sha256 LIMIT 4))
ON CONFLICT(style_slot) DO UPDATE SET
  blot_count = excluded.blot_count, portraits_json = excluded.portraits_json;
END;
