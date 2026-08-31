-- Stable-account invitation inbox projected idempotently from the ordered
-- manifestation-authority event stream. One row follows one assignment from
-- offer through resolution; no Discord/provider identity is stored here.

CREATE TABLE IF NOT EXISTS icono_caretaker_assignment_notifications (
  caretaker_assignment_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  gene_id TEXT NOT NULL,
  canonical_symbol TEXT NOT NULL,
  assignment_status TEXT NOT NULL
    CHECK (assignment_status IN ('pending_acceptance', 'active', 'suspended', 'ended')),
  assignment_version INTEGER NOT NULL CHECK (assignment_version >= 1),
  notification_state TEXT NOT NULL
    CHECK (notification_state IN ('pending', 'resolved')),
  authority_event_id TEXT NOT NULL,
  authority_event_sequence INTEGER NOT NULL CHECK (authority_event_sequence >= 1),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  CHECK (
    (notification_state = 'pending' AND assignment_status = 'pending_acceptance' AND resolved_at IS NULL)
    OR
    (notification_state = 'resolved' AND assignment_status <> 'pending_acceptance' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_assignment_notifications_inbox
  ON icono_caretaker_assignment_notifications (
    account_id,
    notification_state,
    authority_event_sequence DESC
  );

CREATE TRIGGER IF NOT EXISTS icono_caretaker_assignment_notification_no_rewind
BEFORE UPDATE ON icono_caretaker_assignment_notifications
BEGIN
  SELECT case WHEN NEW.caretaker_assignment_id <> OLD.caretaker_assignment_id
    OR NEW.account_id <> OLD.account_id
    OR NEW.gene_id <> OLD.gene_id
    THEN RAISE(ABORT, 'caretaker_notification_identity_immutable') end;
  SELECT case WHEN NEW.authority_event_sequence < OLD.authority_event_sequence
    THEN RAISE(ABORT, 'caretaker_notification_event_sequence_cannot_rewind') end;
  SELECT case WHEN NEW.assignment_version < OLD.assignment_version
    THEN RAISE(ABORT, 'caretaker_notification_assignment_version_cannot_rewind') end;
  SELECT case WHEN OLD.notification_state = 'resolved' AND NEW.notification_state = 'pending'
    THEN RAISE(ABORT, 'caretaker_notification_cannot_reopen') end;
  SELECT case WHEN NEW.authority_event_sequence = OLD.authority_event_sequence
    AND (
      NEW.authority_event_id IS NOT OLD.authority_event_id
      OR NEW.assignment_status IS NOT OLD.assignment_status
      OR NEW.assignment_version IS NOT OLD.assignment_version
      OR NEW.notification_state IS NOT OLD.notification_state
    )
    THEN RAISE(ABORT, 'caretaker_notification_event_replay_mismatch') end;
end;
