-- Durable VoteCoordinator outbox idempotency.
--
-- A vote is authoritative once its per-gene Durable Object transaction commits.
-- Projection delivery to D1 may be retried after Worker interruption, so every
-- resulting audit event needs the stable mutation identity assigned by that
-- transaction. Historical events predate the outbox and legitimately remain
-- NULL; SQLite UNIQUE indexes allow multiple NULL values.

ALTER TABLE icono_vote_events ADD COLUMN mutation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_icono_vote_events_mutation_id_unique
  ON icono_vote_events (mutation_id)
  WHERE mutation_id IS NOT NULL;
