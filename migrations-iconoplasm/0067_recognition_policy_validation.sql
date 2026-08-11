-- One bounded control-plane receipt proves that the exact desired alias and
-- blocklist pair was validated against one published scanner build. KV
-- propagation retries consume this receipt instead of reparsing the scanner.
-- ARCHITECTURE FENCE [IPD-005]: this is one singleton control row, not history.
-- ARCHITECTURE FENCE [IPD-008]: anonymous reads never query this table.

CREATE TABLE IF NOT EXISTS icono_recognition_policy_validation (
  policy_key TEXT PRIMARY KEY CHECK (policy_key = 'shared'),
  state TEXT NOT NULL CHECK (state IN ('unvalidated', 'valid', 'invalid')),
  validator_revision INTEGER NOT NULL CHECK (validator_revision >= 1),
  scanner_version TEXT NOT NULL,
  alias_revision INTEGER NOT NULL CHECK (alias_revision >= 1),
  alias_version TEXT NOT NULL,
  blocklist_revision INTEGER NOT NULL CHECK (blocklist_revision >= 1),
  blocklist_version TEXT NOT NULL,
  validated_at TEXT,
  validation_lease_token TEXT,
  validation_lease_expires_at TEXT,
  last_validation_error TEXT,
  CHECK (length(trim(alias_version)) > 0),
  CHECK (length(trim(blocklist_version)) > 0),
  CHECK (state = 'unvalidated' OR length(trim(scanner_version)) > 0),
  CHECK (
    (
      state = 'valid'
      AND validated_at IS NOT NULL
      AND validation_lease_token IS NULL
      AND validation_lease_expires_at IS NULL
      AND last_validation_error IS NULL
    )
    OR (
      state = 'invalid'
      AND validated_at IS NULL
      AND validation_lease_token IS NULL
      AND validation_lease_expires_at IS NULL
      AND last_validation_error IS NOT NULL
      AND length(trim(last_validation_error)) > 0
    )
    OR (
      state = 'unvalidated'
      AND validated_at IS NULL
      AND (
        (validation_lease_token IS NULL AND validation_lease_expires_at IS NULL)
        OR
        (validation_lease_token IS NOT NULL AND validation_lease_expires_at IS NOT NULL)
      )
    )
  )
);

INSERT OR IGNORE INTO icono_recognition_policy_validation (
  policy_key,
  state,
  validator_revision,
  scanner_version,
  alias_revision,
  alias_version,
  blocklist_revision,
  blocklist_version
)
SELECT
  'shared',
  'unvalidated',
  1,
  '',
  aliases.revision,
  aliases.version,
  blocklist.revision,
  blocklist.version
FROM icono_publication_alias_policy AS aliases
CROSS JOIN icono_extension_blocklist_policy AS blocklist
WHERE aliases.policy_key = 'curated'
  AND blocklist.policy_key = 'shared';
