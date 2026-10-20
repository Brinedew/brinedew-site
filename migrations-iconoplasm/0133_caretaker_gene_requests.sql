-- B-1137: a person asks a gene's caretaker for the gene. If the asker looks
-- after a gene of their own, accepting swaps the two genes; if not, accepting
-- hands the gene over. Until now a taken gene was a dead end: the claim button
-- vanished and nothing said why.
--
-- One row per request. A request names the two roles as they were when it was
-- sent; it stays pending only while both are still active, and the change that
-- ends or suspends either role voids it in the same batch
-- (caretaker-gene-requests.js). `seen_at` is when the caretaker's gene page
-- first showed the request: a gene's caretaker gets one Discord message for a
-- run of unseen requests, not one per request.
CREATE TABLE icono_caretaker_gene_requests (
  request_id TEXT PRIMARY KEY,
  gene_symbol TEXT NOT NULL,
  holder_assignment_id TEXT NOT NULL,
  holder_account_id TEXT NOT NULL,
  requester_account_id TEXT NOT NULL,
  requester_assignment_id TEXT,
  offered_gene_symbol TEXT,
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  terms_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'void', 'expired')),
  void_reason TEXT,
  seen_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((requester_assignment_id IS NULL) = (offered_gene_symbol IS NULL)),
  CHECK (offered_gene_symbol IS NULL OR offered_gene_symbol <> gene_symbol)
);

-- The Caretaker's Handbook: "You can only have one swap request active at a time."
CREATE UNIQUE INDEX icono_caretaker_gene_requests_one_pending
  ON icono_caretaker_gene_requests (requester_account_id) WHERE status = 'pending';

-- A caretaker's gene page lists the gene's pending requests, oldest first.
CREATE INDEX icono_caretaker_gene_requests_pending_by_gene
  ON icono_caretaker_gene_requests (gene_symbol, created_at) WHERE status = 'pending';

-- A rejected request blocks asking for the same gene again for a while.
CREATE INDEX icono_caretaker_gene_requests_by_requester
  ON icono_caretaker_gene_requests (requester_account_id, gene_symbol);

-- The Discord messages a request sends, through the same kind of durable outbox
-- as comment and supervote messages: to the caretaker when a request arrives,
-- and to the asker when it is accepted or rejected, or when the caretaker
-- leaves the gene so it can be claimed. The recipient's Discord id is read when
-- the message is sent, never stored here.
CREATE TABLE icono_caretaker_gene_request_notifications (
  notification_key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('requested', 'accepted', 'rejected', 'freed')),
  recipient_account_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  discord_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (discord_status IN ('pending', 'sending', 'retry', 'sent', 'failed', 'unknown', 'suppressed')),
  discord_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (discord_attempt_count >= 0),
  discord_next_attempt_at TEXT,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  discord_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX icono_caretaker_gene_request_notifications_due
  ON icono_caretaker_gene_request_notifications (
    discord_status,
    discord_next_attempt_at,
    created_at
  );
