-- B-1018: a caretaker's lineage limits (2 MiB of bodies, 256 revisions, 512
-- Tags derivatives) count the last 30 days, not a lifetime. Autosave writes a
-- revision on every pause (11 in the busiest real 22-minute session, 2026-09-30
-- copy), revision rows are immutable, and nothing ever freed the allowance: a
-- dedicated caretaker would hit the cap after about 23 editing sessions and could
-- never save that gene again. The same caps over a rolling window keep their job
-- (bounding what one account can write) and keep every version in History.
-- The window starts from the upload intent's own timestamp, so the trigger stays
-- deterministic. Live reservations still count whatever their age.
CREATE INDEX IF NOT EXISTS idx_icono_revisions_caretaker_quota_window
ON icono_manifestation_revisions(caretaker_assignment_id, created_at, manifestation_revision_id, body_bytes)
WHERE caretaker_assignment_id IS NOT NULL;

DROP TRIGGER icono_upload_intent_admission;
CREATE TRIGGER icono_upload_intent_admission
BEFORE INSERT ON icono_manifestation_upload_intents
BEGIN
  SELECT CASE WHEN NEW.lease_expires_at <= NEW.created_at
    THEN RAISE(ABORT, 'upload_intent_lease_is_not_future') END;
  SELECT CASE WHEN NEW.entity_kind = 'revision' AND NEW.planned_body_bytes > 16384
    THEN RAISE(ABORT, 'revision_body_exceeds_16kib') END;
  SELECT CASE WHEN NEW.actor_kind = 'account' AND NOT EXISTS (
    SELECT 1 FROM icono_authority_accounts account
     WHERE account.account_id = NEW.actor_account_id AND account.status = 'active'
  ) THEN RAISE(ABORT, 'upload_actor_is_not_active') END;
  SELECT CASE WHEN NEW.caretaker_assignment_id IS NOT NULL AND NEW.actor_kind = 'account' AND NOT EXISTS (
    SELECT 1 FROM icono_caretaker_assignments assignment
     WHERE assignment.caretaker_assignment_id = NEW.caretaker_assignment_id
       AND assignment.status = 'active'
       AND assignment.account_id = NEW.actor_account_id
  ) THEN RAISE(ABORT, 'upload_assignment_is_not_active') END;
  SELECT CASE WHEN (
    SELECT body_admitted_bytes + body_reserved_bytes + NEW.planned_body_bytes
      FROM icono_authority_state WHERE singleton = 1
  ) > (
    SELECT body_admitted_limit_bytes FROM icono_authority_state WHERE singleton = 1
  ) THEN RAISE(ABORT, 'authoring_body_quota_exceeded') END;

  -- Read at most one more row than each quota can admit. Counts reject an
  -- oversized window before any truncated sum could admit it. CROSS JOIN fixes
  -- the revision-to-derivative indexed traversal direction.
  SELECT CASE
    WHEN revisions.n + intents.revisions > 256 - (NEW.entity_kind = 'revision')
      THEN RAISE(ABORT, 'caretaker_lineage_revision_limit_exceeded')
    WHEN derivatives.n + intents.derivatives > 512 - (NEW.entity_kind = 'derivative')
      THEN RAISE(ABORT, 'caretaker_lineage_derivative_limit_exceeded')
    WHEN revisions.bytes + derivatives.bytes + intents.bytes + NEW.planned_body_bytes > 2097152
      THEN RAISE(ABORT, 'caretaker_lineage_body_quota_exceeded')
    ELSE 1 END
  FROM (
    SELECT COUNT(*) AS n, COALESCE(SUM(body_bytes), 0) AS bytes
    FROM (
      SELECT body_bytes FROM icono_manifestation_revisions
      INDEXED BY idx_icono_revisions_caretaker_quota_window
      WHERE caretaker_assignment_id = NEW.caretaker_assignment_id
        AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-30 days')
      LIMIT 257
    )
  ) AS revisions
  CROSS JOIN (
    SELECT COUNT(*) AS n, COALESCE(SUM(body_bytes), 0) AS bytes
    FROM (
      SELECT derivative.body_bytes
      FROM (
        SELECT manifestation_revision_id FROM icono_manifestation_revisions
        INDEXED BY idx_icono_revisions_caretaker_quota_window
        WHERE caretaker_assignment_id = NEW.caretaker_assignment_id
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-30 days')
        LIMIT 257
      ) AS revision
      CROSS JOIN icono_manifestation_derivatives AS derivative
      INDEXED BY idx_icono_derivatives_revision
      ON derivative.manifestation_revision_id = revision.manifestation_revision_id
      LIMIT 513
    )
  ) AS derivatives
  CROSS JOIN (
    SELECT COALESCE(SUM(entity_kind = 'revision'), 0) AS revisions,
           COALESCE(SUM(entity_kind = 'derivative'), 0) AS derivatives,
           COALESCE(SUM(planned_body_bytes), 0) AS bytes
    FROM (
      SELECT entity_kind, planned_body_bytes FROM icono_manifestation_upload_intents
      INDEXED BY idx_icono_upload_intents_caretaker_quota
      WHERE caretaker_assignment_id = NEW.caretaker_assignment_id
        AND status IN ('uploading', 'deleting') LIMIT 769
    )
  ) AS intents
  WHERE NEW.caretaker_assignment_id IS NOT NULL;
END;

DROP INDEX IF EXISTS idx_icono_revisions_caretaker_quota;

-- B-859 step 2: three indexes nothing reads, each a write on every save.
-- idx_icono_revisions_manifestation_history repeats the UNIQUE
-- (manifestation_id, revision_number) autoindex; the only query on body_sha256
-- (manifestation-derivative-commands.js) reaches revisions by primary key first;
-- event_sequence is the events table's rowid. Checked 2026-10-05.
DROP INDEX IF EXISTS idx_icono_revisions_manifestation_history;
DROP INDEX IF EXISTS idx_icono_revisions_body_hash;
DROP INDEX IF EXISTS idx_icono_events_cursor;
