-- B-1188: the admin home's counts, kept from the tables that are true.
--
-- icono_admin_dashboard_summary holds the admin home's gene counts: genes in the
-- catalogue, genes whose published card names a portrait that is not stored
-- (drift), and genes by how many candidates they have (none, one, two to five,
-- six or more). A candidate is a stored portrait that could become the card:
-- auto-pick on and not rejected.
--
-- Chesterton's fence: migration 0095 kept these counts exact in the same
-- transaction as every change, which was right, but it took each gene's numbers
-- from icono_admin_gene_rollup, a copy that only admin actions rebuilt. The
-- counts were exact sums of a wrong copy. On the 2026-10-29 copy they said 610
-- genes had no candidate (truth: 0; each had one), 174 had one (truth: 784)
-- and 18,771 had a card (truth: 19,381). These triggers read the catalogue,
-- the portraits and icono_publish_state instead, the tables the gallery and
-- the gene pages read.
--
-- The cards (with_live, no_live), pins (overrides) and stale and legacy
-- portraits are no longer kept here: the admin home reads them from
-- icono_asset_summary_counts and the pinned index. They are seeded once more
-- below, true, for the minutes until the new Worker replaces the old one.
--
-- Cost: a portrait write reads at most 7 of its gene's candidates and writes
-- this row only when the gene changes bucket; a card change probes two rows and
-- writes only when a card breaks or heals. 0095's portrait triggers wrote a
-- gallery count row on every portrait insert.
--
-- Online: the old Worker reads the same columns; the new one reads fewer.

DROP TRIGGER IF EXISTS trg_icono_admin_counts_rollup_insert;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_rollup_delete;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_rollup_update;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_catalog_insert;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_catalog_delete;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_catalog_update;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_asset_insert;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_asset_delete;
DROP TRIGGER IF EXISTS trg_icono_admin_counts_asset_update;

INSERT OR IGNORE INTO icono_admin_dashboard_summary (summary_key) VALUES ('default');

UPDATE icono_admin_dashboard_summary SET (genes, with_live, overrides, drift, current_asset_missing, missing, no_live,
                 stale_assets, legacy_assets, zero_candidates, one_candidate,
                 two_to_five_candidates, six_plus_candidates, updated_at) = (
  SELECT COUNT(*),
         COALESCE(SUM(g.card <> ''), 0),
         COALESCE(SUM(g.card <> '' AND g.pin = 1), 0),
         COALESCE(SUM(g.broken), 0),
         COALESCE(SUM(g.broken), 0),
         COALESCE(SUM(g.n = 0), 0),
         COALESCE(SUM(g.card = ''), 0),
         (SELECT stale_assets FROM icono_asset_summary_counts WHERE summary_key = 'default'),
         (SELECT legacy_assets FROM icono_asset_summary_counts WHERE summary_key = 'default'),
         COALESCE(SUM(g.n = 0), 0),
         COALESCE(SUM(g.n = 1), 0),
         COALESCE(SUM(g.n BETWEEN 2 AND 5), 0),
         COALESCE(SUM(g.n >= 6), 0),
         CURRENT_TIMESTAMP
    FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = gc.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n,
                 COALESCE(ps.current_asset_sha256, '') AS card,
                 COALESCE(ps.admin_override, 0) AS pin,
                 (COALESCE(ps.current_asset_sha256, '') <> ''
                  AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                                   WHERE b.gene_symbol = gc.gene_symbol
                                     AND b.asset_sha256 = ps.current_asset_sha256)) AS broken
            FROM icono_gene_catalog gc
            LEFT JOIN icono_publish_state ps ON ps.gene_symbol = gc.gene_symbol) g)
 WHERE summary_key = 'default';

CREATE TRIGGER trg_icono_dashboard_counts_catalog_insert AFTER INSERT ON icono_gene_catalog
BEGIN
  UPDATE icono_admin_dashboard_summary SET (genes, zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, drift, current_asset_missing, updated_at) = (
    SELECT icono_admin_dashboard_summary.genes + 1,
           icono_admin_dashboard_summary.zero_candidates + (s.n = 0),
           icono_admin_dashboard_summary.missing + (s.n = 0),
           icono_admin_dashboard_summary.one_candidate + (s.n = 1),
           icono_admin_dashboard_summary.two_to_five_candidates + (s.n BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates + (s.n >= 6),
           icono_admin_dashboard_summary.drift + s.b,
           icono_admin_dashboard_summary.current_asset_missing + s.b,
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = NEW.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = NEW.gene_symbol AND COALESCE(ps.current_asset_sha256, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                         WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = ps.current_asset_sha256)) AS b) s)
   WHERE summary_key = 'default';
END;

CREATE TRIGGER trg_icono_dashboard_counts_catalog_delete AFTER DELETE ON icono_gene_catalog
BEGIN
  UPDATE icono_admin_dashboard_summary SET (genes, zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, drift, current_asset_missing, updated_at) = (
    SELECT icono_admin_dashboard_summary.genes - 1,
           icono_admin_dashboard_summary.zero_candidates - (s.n = 0),
           icono_admin_dashboard_summary.missing - (s.n = 0),
           icono_admin_dashboard_summary.one_candidate - (s.n = 1),
           icono_admin_dashboard_summary.two_to_five_candidates - (s.n BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates - (s.n >= 6),
           icono_admin_dashboard_summary.drift - s.b,
           icono_admin_dashboard_summary.current_asset_missing - s.b,
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = OLD.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = OLD.gene_symbol AND COALESCE(ps.current_asset_sha256, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                         WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = ps.current_asset_sha256)) AS b) s)
   WHERE summary_key = 'default';
END;

CREATE TRIGGER trg_icono_dashboard_counts_catalog_update AFTER UPDATE OF gene_symbol ON icono_gene_catalog
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol
BEGIN
  UPDATE icono_admin_dashboard_summary SET (genes, zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, drift, current_asset_missing, updated_at) = (
    SELECT icono_admin_dashboard_summary.genes - 1,
           icono_admin_dashboard_summary.zero_candidates - (s.n = 0),
           icono_admin_dashboard_summary.missing - (s.n = 0),
           icono_admin_dashboard_summary.one_candidate - (s.n = 1),
           icono_admin_dashboard_summary.two_to_five_candidates - (s.n BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates - (s.n >= 6),
           icono_admin_dashboard_summary.drift - s.b,
           icono_admin_dashboard_summary.current_asset_missing - s.b,
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = OLD.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = OLD.gene_symbol AND COALESCE(ps.current_asset_sha256, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                         WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = ps.current_asset_sha256)) AS b) s)
   WHERE summary_key = 'default';
  UPDATE icono_admin_dashboard_summary SET (genes, zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, drift, current_asset_missing, updated_at) = (
    SELECT icono_admin_dashboard_summary.genes + 1,
           icono_admin_dashboard_summary.zero_candidates + (s.n = 0),
           icono_admin_dashboard_summary.missing + (s.n = 0),
           icono_admin_dashboard_summary.one_candidate + (s.n = 1),
           icono_admin_dashboard_summary.two_to_five_candidates + (s.n BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates + (s.n >= 6),
           icono_admin_dashboard_summary.drift + s.b,
           icono_admin_dashboard_summary.current_asset_missing + s.b,
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = NEW.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = NEW.gene_symbol AND COALESCE(ps.current_asset_sha256, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                         WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = ps.current_asset_sha256)) AS b) s)
   WHERE summary_key = 'default';
END;

-- A new portrait: one more candidate if eligible, and a card that named it is
-- no longer broken.
CREATE TRIGGER trg_icono_dashboard_counts_portrait_insert AFTER INSERT ON icono_portrait_assets
WHEN EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
BEGIN
  UPDATE icono_admin_dashboard_summary SET (zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, updated_at) = (
    SELECT icono_admin_dashboard_summary.zero_candidates + (s.n = 0) - ((s.n + s.d) = 0),
           icono_admin_dashboard_summary.missing + (s.n = 0) - ((s.n + s.d) = 0),
           icono_admin_dashboard_summary.one_candidate + (s.n = 1) - ((s.n + s.d) = 1),
           icono_admin_dashboard_summary.two_to_five_candidates + (s.n BETWEEN 2 AND 5) - ((s.n + s.d) BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates + (s.n >= 6) - ((s.n + s.d) >= 6),
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = NEW.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, -(COALESCE(NEW.autopick_eligible, 1) = 1 AND COALESCE(NEW.status, 'draft') <> 'rejected' AND COALESCE(NEW.asset_sha256, '') <> '') AS d) s)
   WHERE summary_key = 'default'
     AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
     AND (SELECT CASE WHEN n = 0 THEN 0 WHEN n = 1 THEN 1 WHEN n <= 5 THEN 2 ELSE 3 END <> CASE WHEN (n + d) = 0 THEN 0 WHEN (n + d) = 1 THEN 1 WHEN (n + d) <= 5 THEN 2 ELSE 3 END FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = NEW.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, -(COALESCE(NEW.autopick_eligible, 1) = 1 AND COALESCE(NEW.status, 'draft') <> 'rejected' AND COALESCE(NEW.asset_sha256, '') <> '') AS d));
  UPDATE icono_admin_dashboard_summary SET drift = drift + (-(COALESCE(NEW.asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256))), current_asset_missing = current_asset_missing + (-(COALESCE(NEW.asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256))),
         updated_at = CURRENT_TIMESTAMP
   WHERE summary_key = 'default' AND (-(COALESCE(NEW.asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = NEW.gene_symbol AND ps.current_asset_sha256 = NEW.asset_sha256))) <> 0;
END;

CREATE TRIGGER trg_icono_dashboard_counts_portrait_delete AFTER DELETE ON icono_portrait_assets
WHEN EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
BEGIN
  UPDATE icono_admin_dashboard_summary SET (zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, updated_at) = (
    SELECT icono_admin_dashboard_summary.zero_candidates + (s.n = 0) - ((s.n + s.d) = 0),
           icono_admin_dashboard_summary.missing + (s.n = 0) - ((s.n + s.d) = 0),
           icono_admin_dashboard_summary.one_candidate + (s.n = 1) - ((s.n + s.d) = 1),
           icono_admin_dashboard_summary.two_to_five_candidates + (s.n BETWEEN 2 AND 5) - ((s.n + s.d) BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates + (s.n >= 6) - ((s.n + s.d) >= 6),
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = OLD.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, (COALESCE(OLD.autopick_eligible, 1) = 1 AND COALESCE(OLD.status, 'draft') <> 'rejected' AND COALESCE(OLD.asset_sha256, '') <> '') AS d) s)
   WHERE summary_key = 'default'
     AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
     AND (SELECT CASE WHEN n = 0 THEN 0 WHEN n = 1 THEN 1 WHEN n <= 5 THEN 2 ELSE 3 END <> CASE WHEN (n + d) = 0 THEN 0 WHEN (n + d) = 1 THEN 1 WHEN (n + d) <= 5 THEN 2 ELSE 3 END FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = OLD.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, (COALESCE(OLD.autopick_eligible, 1) = 1 AND COALESCE(OLD.status, 'draft') <> 'rejected' AND COALESCE(OLD.asset_sha256, '') <> '') AS d));
  UPDATE icono_admin_dashboard_summary SET drift = drift + ((COALESCE(OLD.asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = OLD.gene_symbol AND ps.current_asset_sha256 = OLD.asset_sha256))), current_asset_missing = current_asset_missing + ((COALESCE(OLD.asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = OLD.gene_symbol AND ps.current_asset_sha256 = OLD.asset_sha256))),
         updated_at = CURRENT_TIMESTAMP
   WHERE summary_key = 'default' AND ((COALESCE(OLD.asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_publish_state ps
      WHERE ps.gene_symbol = OLD.gene_symbol AND ps.current_asset_sha256 = OLD.asset_sha256))) <> 0;
END;

-- A portrait that goes on or off auto-pick, or in or out of rejected. Its gene
-- and hash never change (icono_portrait_asset_caretaker_identity_immutable,
-- migration 0088), so its card cannot break or heal here.
CREATE TRIGGER trg_icono_dashboard_counts_portrait_update
AFTER UPDATE OF autopick_eligible, status ON icono_portrait_assets
WHEN (COALESCE(OLD.autopick_eligible, 1) = 1 AND COALESCE(OLD.status, 'draft') <> 'rejected' AND COALESCE(OLD.asset_sha256, '') <> '') <> (COALESCE(NEW.autopick_eligible, 1) = 1 AND COALESCE(NEW.status, 'draft') <> 'rejected' AND COALESCE(NEW.asset_sha256, '') <> '') AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
BEGIN
  UPDATE icono_admin_dashboard_summary SET (zero_candidates, missing, one_candidate, two_to_five_candidates, six_plus_candidates, updated_at) = (
    SELECT icono_admin_dashboard_summary.zero_candidates + (s.n = 0) - ((s.n + s.d) = 0),
           icono_admin_dashboard_summary.missing + (s.n = 0) - ((s.n + s.d) = 0),
           icono_admin_dashboard_summary.one_candidate + (s.n = 1) - ((s.n + s.d) = 1),
           icono_admin_dashboard_summary.two_to_five_candidates + (s.n BETWEEN 2 AND 5) - ((s.n + s.d) BETWEEN 2 AND 5),
           icono_admin_dashboard_summary.six_plus_candidates + (s.n >= 6) - ((s.n + s.d) >= 6),
           CURRENT_TIMESTAMP
      FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = NEW.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, (COALESCE(OLD.autopick_eligible, 1) = 1 AND COALESCE(OLD.status, 'draft') <> 'rejected' AND COALESCE(OLD.asset_sha256, '') <> '') - (COALESCE(NEW.autopick_eligible, 1) = 1 AND COALESCE(NEW.status, 'draft') <> 'rejected' AND COALESCE(NEW.asset_sha256, '') <> '') AS d) s)
   WHERE summary_key = 'default'
     AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
     AND (SELECT CASE WHEN n = 0 THEN 0 WHEN n = 1 THEN 1 WHEN n <= 5 THEN 2 ELSE 3 END <> CASE WHEN (n + d) = 0 THEN 0 WHEN (n + d) = 1 THEN 1 WHEN (n + d) <= 5 THEN 2 ELSE 3 END FROM (SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM icono_portrait_assets c
      WHERE c.gene_symbol = NEW.gene_symbol AND COALESCE(c.autopick_eligible, 1) = 1
        AND COALESCE(c.status, 'draft') <> 'rejected' AND c.asset_sha256 <> '' LIMIT 7)) AS n, (COALESCE(OLD.autopick_eligible, 1) = 1 AND COALESCE(OLD.status, 'draft') <> 'rejected' AND COALESCE(OLD.asset_sha256, '') <> '') - (COALESCE(NEW.autopick_eligible, 1) = 1 AND COALESCE(NEW.status, 'draft') <> 'rejected' AND COALESCE(NEW.asset_sha256, '') <> '') AS d));
END;

CREATE TRIGGER trg_icono_dashboard_counts_card_insert AFTER INSERT ON icono_publish_state
BEGIN
  UPDATE icono_admin_dashboard_summary SET drift = drift + ((COALESCE(NEW.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = NEW.current_asset_sha256))), current_asset_missing = current_asset_missing + ((COALESCE(NEW.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = NEW.current_asset_sha256))),
         updated_at = CURRENT_TIMESTAMP
   WHERE summary_key = 'default' AND ((COALESCE(NEW.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = NEW.current_asset_sha256))) <> 0;
END;

CREATE TRIGGER trg_icono_dashboard_counts_card_delete AFTER DELETE ON icono_publish_state
BEGIN
  UPDATE icono_admin_dashboard_summary SET drift = drift + (-(COALESCE(OLD.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = OLD.current_asset_sha256))), current_asset_missing = current_asset_missing + (-(COALESCE(OLD.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = OLD.current_asset_sha256))),
         updated_at = CURRENT_TIMESTAMP
   WHERE summary_key = 'default' AND (-(COALESCE(OLD.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = OLD.current_asset_sha256))) <> 0;
END;

CREATE TRIGGER trg_icono_dashboard_counts_card_update
AFTER UPDATE OF gene_symbol, current_asset_sha256 ON icono_publish_state
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol
  OR OLD.current_asset_sha256 IS NOT NEW.current_asset_sha256
BEGIN
  UPDATE icono_admin_dashboard_summary SET drift = drift + ((COALESCE(NEW.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = NEW.current_asset_sha256)) - (COALESCE(OLD.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = OLD.current_asset_sha256))), current_asset_missing = current_asset_missing + ((COALESCE(NEW.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = NEW.current_asset_sha256)) - (COALESCE(OLD.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = OLD.current_asset_sha256))),
         updated_at = CURRENT_TIMESTAMP
   WHERE summary_key = 'default' AND ((COALESCE(NEW.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = NEW.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = NEW.gene_symbol AND b.asset_sha256 = NEW.current_asset_sha256)) - (COALESCE(OLD.current_asset_sha256, '') <> '' AND EXISTS (SELECT 1 FROM icono_gene_catalog WHERE gene_symbol = OLD.gene_symbol)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                       WHERE b.gene_symbol = OLD.gene_symbol AND b.asset_sha256 = OLD.current_asset_sha256))) <> 0;
END;
