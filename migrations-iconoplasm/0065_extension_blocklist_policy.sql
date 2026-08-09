-- Canonical, administrator-owned policy for the extension's shared string
-- blocklist. D1 owns desired state and a bounded revision audit trail. Public
-- extension traffic reads only the separately published KV projection.
-- ARCHITECTURE FENCE [IPD-005]: history is pruned transactionally to the newest
-- 100 revisions by the policy writer; this table is never an unbounded hot-D1 ledger.
-- ARCHITECTURE FENCE [IPD-008]: public requests never read these authoring tables.

CREATE TABLE IF NOT EXISTS icono_extension_blocklist_policy (
  policy_key TEXT PRIMARY KEY CHECK (policy_key = 'shared'),
  terms_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  published_revision INTEGER,
  published_version TEXT,
  published_at TEXT,
  projection_lease_token TEXT,
  projection_lease_expires_at TEXT,
  last_projection_error TEXT
);

CREATE TABLE IF NOT EXISTS icono_extension_blocklist_policy_history (
  policy_key TEXT NOT NULL CHECK (policy_key = 'shared'),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  version TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  PRIMARY KEY (policy_key, revision)
);

INSERT OR IGNORE INTO icono_extension_blocklist_policy (
  policy_key,
  terms_json,
  revision,
  version,
  updated_at,
  updated_by
) VALUES (
  'shared',
  '["AMID","ARCH","ARTS","BANK","BASE","BEST","BIKE","BITE","BOMB","CAGE","CALL","CART","CASH","CHIP","CHOP","CLAN","CLAP","CROP","FACE","FACT","FAME","FAST","FATE","FEAT","FELL","FIND","FISH","FLAP","FLIP","FLOWER","GALA","GOAT","GRAB","GRIT","HEED","HINT","JERKY","LIME","LORD","MAIL","MARK","MARS","MASS","MEMO","NAIL","PACE","POEM","POKEMON","PREY","RACE","RAIN","RANK","SAGE","SHIP","SHOT","SINK","SLAM","SNAP","SOUL","SPAR","SPATIAL","STAT","STEP","STOP","STUD","TAPE","TASK","TAUT","TIED","TRIM","TUBE","TYPE","WARP","WAVE","WIRE","WISH"]',
  1,
  'ebl1-37f5cea6aae77193',
  '2026-08-09T00:00:00.000Z',
  'migration:0065'
);

INSERT OR IGNORE INTO icono_extension_blocklist_policy_history (
  policy_key,
  revision,
  version,
  terms_json,
  changed_at,
  changed_by
)
SELECT
  policy_key,
  revision,
  version,
  terms_json,
  updated_at,
  updated_by
FROM icono_extension_blocklist_policy
WHERE policy_key = 'shared';
