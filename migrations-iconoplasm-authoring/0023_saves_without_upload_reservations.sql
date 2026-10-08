-- B-859: a save stops writing an upload reservation before its body upload.
-- Measured 2026-10-08 (caretaker-save-cost.workerd.test.js): of an ordinary
-- caretaker save's 63 authoring rows, 14 were the two reservation inserts and
-- most of the 2 x 7 storage-row writes were the triggers flipping those
-- reservations to adopted. The reservation existed so a crash between upload
-- and commit left a findable orphan, and so a caretaker's lineage caps could be
-- checked before the upload. Now the Worker deletes the uploaded object itself
-- when a commit fails, and the caps below are checked in the commit.
--
-- Dropped: the four fences that refused a storage row without a live
-- reservation. Kept for now: the reservation table, its admission, reserve,
-- release and adoption triggers, and the sweeper, so a Worker still running the
-- old code during the deploy keeps adopting its own reservations (an unadopted
-- one would look abandoned and the sweeper would delete a committed body).
-- A later migration drops them once no live reservation is left.
DROP TRIGGER IF EXISTS icono_revision_storage_upload_intent_fence;
DROP TRIGGER IF EXISTS icono_derivative_storage_upload_intent_fence;
DROP TRIGGER IF EXISTS icono_revision_storage_restore_upload_intent_fence;
DROP TRIGGER IF EXISTS icono_derivative_storage_restore_upload_intent_fence;

-- A caretaker lineage's limits, unchanged from 0022 (256 revisions, 512 Tags
-- derivatives and 2 MiB of bodies over the last 30 days), now checked when the
-- revision or the Tags row commits. System and migration revisions carry no
-- assignment and are not limited here; the global byte cap still applies to
-- every storage row (icono_*_body_quota_validate, 0001).
-- No inner END: the online lane's D1 query parser refuses 'CASE ... END;'
-- inside a trigger (see 0022), so each limit is an iif.
CREATE TRIGGER icono_revision_caretaker_lineage_caps
BEFORE INSERT ON icono_manifestation_revisions
WHEN NEW.caretaker_assignment_id IS NOT NULL
BEGIN
  SELECT iif(
    revisions.n >= 256,
    RAISE(ABORT, 'caretaker_lineage_revision_limit_exceeded'),
    iif(
      revisions.bytes + derivatives.bytes + NEW.body_bytes > 2097152,
      RAISE(ABORT, 'caretaker_lineage_body_quota_exceeded'),
      1
    )
  )
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
    SELECT COALESCE(SUM(body_bytes), 0) AS bytes
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
  ) AS derivatives;
END;

CREATE TRIGGER icono_derivative_caretaker_lineage_caps
BEFORE INSERT ON icono_manifestation_derivatives
WHEN NEW.body_bytes IS NOT NULL AND EXISTS (
  SELECT 1 FROM icono_manifestation_revisions
   WHERE manifestation_revision_id = NEW.manifestation_revision_id
     AND caretaker_assignment_id IS NOT NULL
)
BEGIN
  SELECT iif(
    derivatives.n >= 512,
    RAISE(ABORT, 'caretaker_lineage_derivative_limit_exceeded'),
    iif(
      revisions.bytes + derivatives.bytes + NEW.body_bytes > 2097152,
      RAISE(ABORT, 'caretaker_lineage_body_quota_exceeded'),
      1
    )
  )
  FROM (
    SELECT COALESCE(SUM(body_bytes), 0) AS bytes
    FROM (
      SELECT body_bytes FROM icono_manifestation_revisions
      INDEXED BY idx_icono_revisions_caretaker_quota_window
      WHERE caretaker_assignment_id = (
          SELECT caretaker_assignment_id FROM icono_manifestation_revisions
           WHERE manifestation_revision_id = NEW.manifestation_revision_id
        )
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
        WHERE caretaker_assignment_id = (
            SELECT caretaker_assignment_id FROM icono_manifestation_revisions
             WHERE manifestation_revision_id = NEW.manifestation_revision_id
          )
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-30 days')
        LIMIT 257
      ) AS revision
      CROSS JOIN icono_manifestation_derivatives AS derivative
      INDEXED BY idx_icono_derivatives_revision
      ON derivative.manifestation_revision_id = revision.manifestation_revision_id
      LIMIT 513
    )
  ) AS derivatives;
END;
