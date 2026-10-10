-- B-1065: a gene's text as plain rows. A text is the input to the gene's
-- portrait prompt; readers see it only when its "readers see it" flag is on.
-- Until now each text was an encrypted object in a private Bunny zone behind an
-- event log, a replica, cutover backups and an outbox. These two tables replace
-- all of that; the old tables go once every reader and writer has moved here.
--
-- One row per gene: the factory's current text and its Tags. The factory
-- overwrites the text in place (its own history lives on the workstation).
-- `chosen_caretaker_version_id` names the caretaker version the gene uses
-- instead, so a factory rewrite never replaces a caretaker's choice.
-- `text_id` is what a portrait request records as the text it was drawn from.
CREATE TABLE icono_gene_texts (
  gene_id TEXT PRIMARY KEY REFERENCES icono_gene_identities(gene_id),
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

-- A caretaker's saved versions. A version never changes after it is saved;
-- only its flags do (withdrawn, readers see it). `line_id` groups one
-- caretaker's versions on one gene, numbered from 1.
CREATE TABLE icono_caretaker_text_versions (
  version_id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL REFERENCES icono_gene_identities(gene_id),
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
  ON icono_caretaker_text_versions (gene_id, created_at DESC);
