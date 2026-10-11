// B-1065 B2b: copies caretaking from the authoring database into the main one
// (migration 0125), keyed by gene symbol. One request copies one page of one
// table; the operator calls it until `next_after` is null, once before the
// readers and writers move to the main database and once right after.
//
// Each row keeps its source updated_at, so the second pass takes a gene's text
// or a role from the authoring side only when that side changed later. A
// version's text never changes; its flags (withdrawn, readers see it) take the
// authoring value, which is right for the minutes between the switch and the
// second pass. Rows that are already equal write nothing.
//
// Deleted with the authoring database (B-1065 PR C).

export const COPY_TABLES = ["texts", "versions", "assignments"]

// Rows go to D1 as one JSON parameter (json_each), and one D1 value holds at
// most 2 MB. A text is at most 16 KiB and its Tags 32 KiB, so a page stops at
// 1 MB of JSON.
const PAGE_ROWS = 50
const PAGE_JSON_BYTES = 1_000_000

const SOURCE_SQL = {
  texts: `SELECT t.gene_id AS cursor, i.canonical_symbol AS gene_symbol, t.text_id, t.version,
                 t.text, t.text_sha256, t.tags, t.fields_json, t.readers_see,
                 t.chosen_caretaker_version_id, t.updated_at
            FROM icono_gene_texts t
            JOIN icono_gene_identities i ON i.gene_id = t.gene_id
           WHERE t.gene_id > ? ORDER BY t.gene_id LIMIT ${PAGE_ROWS}`,
  versions: `SELECT v.version_id AS cursor, i.canonical_symbol AS gene_symbol, v.version_id,
                    v.line_id, v.version, v.account_id, v.caretaker_assignment_id, v.text,
                    v.text_sha256, v.tags, v.fields_json, v.readers_see, v.withdrawn_at,
                    v.created_at
               FROM icono_caretaker_text_versions v
               JOIN icono_gene_identities i ON i.gene_id = v.gene_id
              WHERE v.version_id > ? ORDER BY v.version_id LIMIT ${PAGE_ROWS}`,
  // Every role in one page (38 on 2026-10-10), so an ended role is copied
  // before the open role that replaced it on the same gene or account.
  assignments: `SELECT a.caretaker_assignment_id AS cursor, i.canonical_symbol AS gene_symbol,
                       a.caretaker_assignment_id, a.account_id, a.status, a.assignment_version,
                       a.terms_version_id, a.terms_accepted_at, a.relinquish_policy,
                       a.invited_by_account_id, a.ended_by_account_id, a.end_reason,
                       a.started_at, a.suspended_at, a.suspension_reason, a.ended_at,
                       a.created_at, a.updated_at
                  FROM icono_caretaker_assignments a
                  JOIN icono_gene_identities i ON i.gene_id = a.gene_id
                 WHERE a.caretaker_assignment_id > ? ORDER BY a.caretaker_assignment_id
                 LIMIT 1000`,
}

const field = (name) => `json_extract(value, '$.${name}')`
const fields = (names) => names.map(field).join(", ")

const TEXT_COLUMNS = [
  "gene_symbol",
  "text_id",
  "version",
  "text",
  "text_sha256",
  "tags",
  "fields_json",
  "readers_see",
  "chosen_caretaker_version_id",
  "updated_at",
]
const VERSION_COLUMNS = [
  "version_id",
  "gene_symbol",
  "line_id",
  "version",
  "account_id",
  "caretaker_assignment_id",
  "text",
  "text_sha256",
  "tags",
  "fields_json",
  "readers_see",
  "withdrawn_at",
  "created_at",
]
const ASSIGNMENT_COLUMNS = [
  "caretaker_assignment_id",
  "gene_symbol",
  "account_id",
  "status",
  "assignment_version",
  "terms_version_id",
  "terms_accepted_at",
  "relinquish_policy",
  "invited_by_account_id",
  "ended_by_account_id",
  "end_reason",
  "started_at",
  "suspended_at",
  "suspension_reason",
  "ended_at",
  "created_at",
  "updated_at",
]
const updates = (table, names) =>
  names.map((name) => `${name} = excluded.${name}`).join(", ") +
  ` WHERE julianday(excluded.updated_at) > julianday(${table}.updated_at)`

// The WHERE true keeps SQLite from reading the upsert's ON as a join.
const TARGET_SQL = {
  texts: `INSERT INTO icono_gene_texts (${TEXT_COLUMNS.join(", ")})
          SELECT ${fields(TEXT_COLUMNS)} FROM json_each(?) WHERE true
          ON CONFLICT (gene_symbol) DO UPDATE SET
            ${updates("icono_gene_texts", TEXT_COLUMNS.slice(1))}`,
  versions: `INSERT INTO icono_caretaker_text_versions (${VERSION_COLUMNS.join(", ")})
             SELECT ${fields(VERSION_COLUMNS)} FROM json_each(?) WHERE true
             ON CONFLICT (version_id) DO UPDATE SET
               tags = excluded.tags, fields_json = excluded.fields_json,
               readers_see = excluded.readers_see, withdrawn_at = excluded.withdrawn_at
             WHERE icono_caretaker_text_versions.tags IS NOT excluded.tags
                OR icono_caretaker_text_versions.fields_json IS NOT excluded.fields_json
                OR icono_caretaker_text_versions.readers_see IS NOT excluded.readers_see
                OR icono_caretaker_text_versions.withdrawn_at IS NOT excluded.withdrawn_at`,
  // How far each caretaker has read their gene's comments lives in the old
  // notification copy, in this database.
  assignments: `INSERT INTO icono_caretaker_assignments
                  (${ASSIGNMENT_COLUMNS.join(", ")}, comments_read_through_id)
                SELECT ${fields(ASSIGNMENT_COLUMNS)},
                       COALESCE((SELECT n.comments_read_through_id
                                   FROM icono_caretaker_assignment_notifications n
                                  WHERE n.caretaker_assignment_id = ${field("caretaker_assignment_id")}), 0)
                  FROM json_each(?) WHERE true
                 ORDER BY ${field("status")} = 'ended' DESC
                ON CONFLICT (caretaker_assignment_id) DO UPDATE SET
                  ${updates("icono_caretaker_assignments", ASSIGNMENT_COLUMNS.slice(1))}`,
}

export async function copyCaretakingPage(env, { table, after = "" }) {
  const source = env?.ICONOPLASM_AUTHORING_DB
  const target = env?.ICONOPLASM_DB
  if (!source || !target) throw new Error("Both Iconoplasm databases must be bound")
  const { results = [] } = await source
    .prepare(SOURCE_SQL[table])
    .bind(after || "")
    .all()
  const rows = []
  let bytes = 2
  for (const { cursor, ...row } of results) {
    const json = JSON.stringify(row)
    if (rows.length && bytes + json.length + 1 > PAGE_JSON_BYTES) break
    rows.push({ cursor, json })
    bytes += json.length + 1
  }
  if (!rows.length) return { table, read: 0, written: 0, next_after: null }
  const written = await target
    .prepare(TARGET_SQL[table])
    .bind(`[${rows.map((row) => row.json).join(",")}]`)
    .run()
  const more = rows.length < results.length || results.length === PAGE_ROWS
  return {
    table,
    read: rows.length,
    written: Number(written?.meta?.changes || 0),
    next_after: table !== "assignments" && more ? rows.at(-1).cursor : null,
  }
}
