-- Account changes still target the open tenure first, then the latest ended
-- tenure, including the stable ID tie-breaker. Preserve that ordering without
-- sorting the account's growing history on every synchronization.
CREATE INDEX idx_icono_account_assignment_projection
ON icono_caretaker_assignments (
  account_id,
  CASE WHEN status IN ('pending_acceptance','active','suspended') THEN 0 ELSE 1 END,
  created_at DESC,
  caretaker_assignment_id DESC
);
