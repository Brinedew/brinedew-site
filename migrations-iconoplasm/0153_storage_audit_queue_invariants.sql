-- B-1210: enforce closed state vocabularies and (status, audit_state)
-- invariants on icono_storage_audit_queue without rewriting existing rows.
--
-- Allowed states:
--   status      IN ('queued', 'retrying', 'completed')
--   audit_state IN ('unknown', 'renderable', 'regionally_divergent', 'broken')
--   asset_status IN ('', 'draft', 'approved', 'rejected')
--
-- Invariants:
--   1. completed implies a known audit result (audit_state <> 'unknown').
--   2. queued implies no audit result yet (audit_state = 'unknown').

CREATE TRIGGER IF NOT EXISTS trg_icono_storage_audit_queue_insert_check
BEFORE INSERT ON icono_storage_audit_queue
WHEN NEW.status NOT IN ('queued', 'retrying', 'completed')
  OR NEW.audit_state NOT IN ('unknown', 'renderable', 'regionally_divergent', 'broken')
  OR lower(COALESCE(NEW.asset_status, '')) NOT IN ('', 'draft', 'approved', 'rejected')
  OR (NEW.status = 'completed' AND NEW.audit_state = 'unknown')
  OR (NEW.status = 'queued' AND NEW.audit_state <> 'unknown')
BEGIN
  SELECT RAISE(ABORT, 'INVALID_STORAGE_AUDIT_QUEUE_STATE');
END;

CREATE TRIGGER IF NOT EXISTS trg_icono_storage_audit_queue_update_check
BEFORE UPDATE OF status, audit_state, asset_status ON icono_storage_audit_queue
WHEN NEW.status NOT IN ('queued', 'retrying', 'completed')
  OR NEW.audit_state NOT IN ('unknown', 'renderable', 'regionally_divergent', 'broken')
  OR lower(COALESCE(NEW.asset_status, '')) NOT IN ('', 'draft', 'approved', 'rejected')
  OR (NEW.status = 'completed' AND NEW.audit_state = 'unknown')
  OR (NEW.status = 'queued' AND NEW.audit_state <> 'unknown')
BEGIN
  SELECT RAISE(ABORT, 'INVALID_STORAGE_AUDIT_QUEUE_STATE');
END;
