-- Administrator-owned desired state for the small curated publication-alias
-- overlay. The public manifest/search/resolve plane reads only the separately
-- published immutable KV projection.
-- ARCHITECTURE FENCE [IPD-005]: retain only the newest 100 revisions.
-- ARCHITECTURE FENCE [IPD-008]: anonymous reads never query these tables.

ALTER TABLE icono_extension_blocklist_policy
  ADD COLUMN depends_on_alias_revision INTEGER CHECK (
    depends_on_alias_revision IS NULL OR depends_on_alias_revision >= 1
  );

ALTER TABLE icono_extension_blocklist_policy_history
  ADD COLUMN depends_on_alias_revision INTEGER CHECK (
    depends_on_alias_revision IS NULL OR depends_on_alias_revision >= 1
  );

CREATE TABLE IF NOT EXISTS icono_publication_alias_policy (
  policy_key TEXT PRIMARY KEY CHECK (policy_key = 'curated'),
  policy_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  depends_on_blocklist_revision INTEGER CHECK (
    depends_on_blocklist_revision IS NULL OR depends_on_blocklist_revision >= 1
  ),
  published_revision INTEGER,
  published_version TEXT,
  published_at TEXT,
  projection_lease_token TEXT,
  projection_lease_expires_at TEXT,
  last_projection_error TEXT
);

CREATE TABLE IF NOT EXISTS icono_publication_alias_policy_history (
  policy_key TEXT NOT NULL CHECK (policy_key = 'curated'),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  version TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  depends_on_blocklist_revision INTEGER CHECK (
    depends_on_blocklist_revision IS NULL OR depends_on_blocklist_revision >= 1
  ),
  PRIMARY KEY (policy_key, revision)
);

INSERT OR IGNORE INTO icono_publication_alias_policy (
  policy_key,
  policy_json,
  revision,
  version,
  updated_at,
  updated_by,
  depends_on_blocklist_revision
) VALUES (
  'curated',
  '{"schema_version":1,"alias_count":45,"removal_count":1,"by_symbol":{"BABAM2":["BRE"],"CCNH":["Cyclin H","Cyclin-H"],"CDH1":["E-cadherin","E-Cadherin","E cadherin","E Cadherin","E-cadherins","E-Cadherins","E cadherins","E Cadherins"],"CDH2":["N-cadherin","N-Cadherin","N cadherin","N Cadherin","N-cadherins","N-Cadherins","N cadherins","N Cadherins"],"CDK1":["Cdk1"],"CDKN1A":["p21"],"CDKN1B":["p27"],"CDKN1C":["p57"],"CDKN2A":["p16"],"CDKN2B":["p15"],"CDKN2C":["p18"],"CDKN2D":["p19"],"CEBPB":["C/EBPβ"],"CGAS":["cGAS"],"CUL9":["PARC"],"EGR1":["EGR-1"],"ERCC3":["XPB"],"HTT":["Huntingtin","Htt"],"IL1A":["IL-1","IL-1α"],"IL1B":["IL-1β"],"MDM2":["Mdm2"],"NOTCH1":["N1ICD"],"RELA":["p65"],"RPRM":["Reprimo"],"TGFB1":["TGF-β"],"TP53":["p53"],"TP63":["p63"],"TP73":["p73"]},"remove_by_symbol":{"CDH17":["cadherin"]}}',
  1,
  'v1-bf7d4149d6b2df6c',
  '2026-08-11T00:00:00.000Z',
  'migration:0066',
  (SELECT revision FROM icono_extension_blocklist_policy WHERE policy_key = 'shared')
);

INSERT OR IGNORE INTO icono_publication_alias_policy_history (
  policy_key,
  revision,
  version,
  policy_json,
  changed_at,
  changed_by,
  depends_on_blocklist_revision
)
SELECT
  policy_key,
  revision,
  version,
  policy_json,
  updated_at,
  updated_by,
  depends_on_blocklist_revision
FROM icono_publication_alias_policy
WHERE policy_key = 'curated';
