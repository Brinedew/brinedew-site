-- B-1065 B2b: caretaking moves into the main database as three plain tables,
-- keyed by gene symbol like every other table here. Until now it lived in a
-- second database (iconoplasm-authoring) and reached this one through copies:
-- a vote assignment projection, an assignment notification table and an
-- account projection, each fed by an event replay. With one database a save,
-- a supervote and a comment read the same rows, so the copies can go.
--
-- The rows arrive from the authoring database through the one-shot admin copy
-- (POST /api/iconoplasm/admin/caretaking/copy), which keeps each source row's
-- own updated_at so a second pass can tell which side changed last.

-- One row per gene: the factory's current text and its Tags, and which
-- caretaker version the gene uses instead. `text_id` is what a portrait request
-- records as the text it was drawn from, next to the gene's `gene_id`: the ID
-- every stored request and card already carries (a new gene's is derived from
-- its symbol, catalogueGeneId).
CREATE TABLE icono_gene_texts (
  gene_symbol TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL UNIQUE,
  text_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  text TEXT NOT NULL CHECK (length(CAST(text AS BLOB)) BETWEEN 1 AND 16384),
  text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
  tags TEXT,
  fields_json TEXT,
  readers_see INTEGER NOT NULL DEFAULT 0 CHECK (readers_see IN (0, 1)),
  chosen_caretaker_version_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The workstation polls the genes whose caretaker choice replaces the
-- factory's text; few genes have one.
CREATE INDEX icono_gene_texts_caretaker_chosen
  ON icono_gene_texts (gene_symbol) WHERE chosen_caretaker_version_id IS NOT NULL;

-- A caretaker's saved versions. A version's text never changes after it is
-- saved; only its flags do (withdrawn, readers see it). `line_id` groups one
-- caretaker's versions on one gene, numbered from 1.
CREATE TABLE icono_caretaker_text_versions (
  version_id TEXT PRIMARY KEY,
  gene_symbol TEXT NOT NULL,
  line_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  account_id TEXT NOT NULL,
  caretaker_assignment_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(CAST(text AS BLOB)) BETWEEN 1 AND 16384),
  text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
  tags TEXT,
  fields_json TEXT,
  readers_see INTEGER NOT NULL DEFAULT 0 CHECK (readers_see IN (0, 1)),
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (line_id, version)
);

-- A gene's caretaker page lists its versions newest first.
CREATE INDEX icono_caretaker_text_versions_by_gene
  ON icono_caretaker_text_versions (gene_symbol, created_at DESC);

-- Who looks after which gene. One row per role, from the offer or claim to its
-- end. Every state a role can be in stays: an admin's offer waits for the
-- person's answer (pending_acceptance, B-1083 brings the offer back), a role can
-- be suspended by the admin and resumed, and ends by the caretaker leaving,
-- switching genes, or the admin. `assignment_version` counts changes, so a page
-- acting on an old copy of the role is refused instead of overwriting it.
-- `comments_read_through_id` is the newest gene comment the caretaker has seen.
CREATE TABLE icono_caretaker_assignments (
  caretaker_assignment_id TEXT PRIMARY KEY,
  gene_symbol TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_acceptance', 'active', 'suspended', 'ended')),
  assignment_version INTEGER NOT NULL DEFAULT 1 CHECK (assignment_version >= 1),
  terms_version_id TEXT,
  terms_accepted_at TEXT,
  relinquish_policy TEXT CHECK (relinquish_policy IN ('retain', 'withdraw')),
  invited_by_account_id TEXT NOT NULL,
  ended_by_account_id TEXT,
  end_reason TEXT,
  started_at TEXT,
  suspended_at TEXT,
  suspension_reason TEXT,
  ended_at TEXT,
  comments_read_through_id INTEGER NOT NULL DEFAULT 0 CHECK (comments_read_through_id >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
  CHECK (status <> 'ended' OR end_reason IS NOT NULL),
  CHECK (status NOT IN ('active', 'suspended') OR (terms_accepted_at IS NOT NULL AND started_at IS NOT NULL)),
  CHECK ((status = 'suspended') = (suspended_at IS NOT NULL))
);

-- A gene has at most one open role, and so does a person.
CREATE UNIQUE INDEX icono_caretaker_assignments_open_gene
  ON icono_caretaker_assignments (gene_symbol)
  WHERE status IN ('pending_acceptance', 'active', 'suspended');
CREATE UNIQUE INDEX icono_caretaker_assignments_open_account
  ON icono_caretaker_assignments (account_id)
  WHERE status IN ('pending_acceptance', 'active', 'suspended');
-- The switch cooldown reads a person's latest start.
CREATE INDEX icono_caretaker_assignments_by_account
  ON icono_caretaker_assignments (account_id, started_at);
