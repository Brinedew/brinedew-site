-- Public gene surfaces resolve the current caretaker by canonical symbol.
-- Keep this read bounded to current tenures instead of scanning the assignment
-- notification projection for every frozen /genes range document.

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_assignment_notifications_public_gene
  ON icono_caretaker_assignment_notifications (
    canonical_symbol,
    assignment_status,
    authority_event_sequence DESC
  );
