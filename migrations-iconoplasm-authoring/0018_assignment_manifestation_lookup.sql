-- Caretaker reads need the latest manifestation for one assignment, including
-- a withdrawn one. Most system manifestations have no assignment, so leave
-- those rows out of this index.
CREATE INDEX idx_icono_manifestations_assignment_latest
ON icono_manifestations (caretaker_assignment_id, created_at DESC)
WHERE caretaker_assignment_id IS NOT NULL;
