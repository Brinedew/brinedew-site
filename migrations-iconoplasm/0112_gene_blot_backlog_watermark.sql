-- B-898 Stage 1 (step B): the workstation blot drain asks
-- POST /api/iconoplasm/admin/blots/backlog {scope:"candidate"} which genes
-- need a print-copy blot. That answer used to come from the publication
-- coordinator's watermark plus the delta chain and immutable card objects
-- (2-8 s per call, hangs past 35 s on 3 of 15 probes, B-894). The whole tree
-- is being deleted, so the backlog now answers from D1 and the stable gene
-- objects alone, and this one row is where "examined through which publish
-- event" lives. One row, one key; readers cost one indexed row, and the row
-- is written only when the drain's examined window actually advanced.
--
-- Semantics of through_event_id: every canonical-affecting
-- icono_publish_events row with id <= through_event_id has been examined by
-- the backlog and its gene either already had a current blot, or was handed
-- to the drain in a backlog page. A gene whose stable object was missing or
-- behind D1 (the Actions publisher had not rewritten it yet) holds the mark,
-- so the next poll re-examines it instead of losing it.
CREATE TABLE IF NOT EXISTS icono_gene_blot_backlog_watermark (
  watermark_key TEXT PRIMARY KEY CHECK (watermark_key = 'candidate'),
  through_event_id INTEGER NOT NULL DEFAULT 0 CHECK (through_event_id >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
