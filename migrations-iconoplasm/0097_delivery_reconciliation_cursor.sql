-- One durable checkpoint prevents unsent requests from starving later receipts.
-- No request history is copied or scanned by this migration.
CREATE TABLE icono_delivery_reconciliation_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL DEFAULT '',
  request_id INTEGER NOT NULL DEFAULT 0
);
INSERT INTO icono_delivery_reconciliation_cursor(id) VALUES (1);
