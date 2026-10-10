// B-1065: copies every gene's text out of the old authority (rows that point
// at encrypted or plain objects in the private Bunny zone) into the plain
// tables of migration 0024. One request copies one page: 20 factory texts, or
// 20 caretaker versions, each with its Tags. A text and its Tags are two Bunny
// GETs, so a page spends 40 of the 50 subrequests Cloudflare's free plan allows
// one request; the GETs are not retried, a failure is reported per row and the
// next run picks it up.
//
// Reruns are cheap: a row already copied is skipped without touching Bunny
// unless its source moved (a new head revision, a new choice of caretaker
// version, a new readers-see flag, Tags that changed length). `force` copies
// every row on the page again.
import {
  canonicalManifestationFieldsJson,
  splitManifestationTagsPayload,
} from "./caretaker/manifestation-tags-payload.js"
import { openManifestationBody } from "../lib/iconoplasm-manifestation-body-reader.js"
import { readManifestationBodyObject } from "../lib/iconoplasm-manifestation-body-storage.js"

export const TEXTS_PER_REQUEST = 20

const DECODER = new TextDecoder("utf-8", { fatal: true })

const STORAGE_COLUMNS = (alias, prefix) =>
  ["object_key", "ciphertext_sha256", "ciphertext_bytes", "body_iv_base64", "wrapped_dek_base64"]
    .concat(["wrap_iv_base64", "key_version", "aad_version"])
    .map((column) => `${alias}.${column} AS ${prefix}${column}`)
    .join(", ")

const TAGS_COLUMNS = `d.manifestation_derivative_id AS derivative_id,
       d.source_body_sha256 AS tags_source_body_sha256,
       d.body_sha256 AS tags_body_sha256, d.body_bytes AS tags_body_bytes,
       d.tags_sha256, d.tags_bytes, d.fields_sha256, d.fields_bytes,
       ${STORAGE_COLUMNS("ds", "tags_")}`

const TAGS_JOINS = `LEFT JOIN icono_manifestation_derivative_heads dh
         ON dh.manifestation_revision_id = r.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivatives d
         ON d.manifestation_derivative_id = dh.accepted_derivative_id
       LEFT JOIN icono_manifestation_derivative_storage_secrets ds
         ON ds.manifestation_derivative_id = d.manifestation_derivative_id`

// Walks the active factory texts in gene order through the partial unique
// index uq_icono_active_system_seed. `chosen` is the caretaker version a gene
// uses instead, when its canonical line is a caretaker's.
const FACTORY_SQL = (where) => `
SELECT s.gene_id, r.manifestation_revision_id AS revision_id, r.revision_number,
       r.body_sha256, r.body_bytes, s.public_page_visible AS readers_see,
       ${STORAGE_COLUMNS("rs", "")},
       ${TAGS_COLUMNS},
       CASE WHEN c.origin IN ('caretaker', 'fork') THEN h.canonical_revision_id END AS chosen,
       g.text_id AS have_text_id, g.version AS have_version,
       g.chosen_caretaker_version_id AS have_chosen,
       g.readers_see AS have_readers_see,
       length(CAST(g.tags AS BLOB)) AS have_tags_bytes
  FROM icono_manifestations s
  JOIN icono_manifestation_revisions r
    ON r.manifestation_revision_id = s.manifestation_head_revision_id
  LEFT JOIN icono_manifestation_revision_storage_secrets rs
    ON rs.manifestation_revision_id = r.manifestation_revision_id
  ${TAGS_JOINS}
  LEFT JOIN icono_manifestation_heads h ON h.gene_id = s.gene_id
  LEFT JOIN icono_manifestations c ON c.manifestation_id = h.canonical_manifestation_id
  LEFT JOIN icono_gene_texts g ON g.gene_id = s.gene_id
 WHERE s.origin = 'system_seed' AND s.status = 'active' AND ${where}
 ORDER BY s.gene_id
 LIMIT ${TEXTS_PER_REQUEST}`
const FACTORY_PAGE_SQL = FACTORY_SQL("s.gene_id > ?")
const FACTORY_GENE_SQL = FACTORY_SQL("s.gene_id = ?")

// Every caretaker version that was not purged. Readers see a version only when
// its line is shown and it is the line's head, which is what the old per-line
// flag showed them. A withdrawn version keeps its text and gets its date.
const CARETAKER_SQL = (where, limit) => `
SELECT r.manifestation_revision_id AS version_id, m.gene_id,
       m.manifestation_id AS line_id, r.revision_number,
       COALESCE(r.author_account_id, m.author_account_id) AS account_id,
       COALESCE(r.caretaker_assignment_id, m.caretaker_assignment_id) AS caretaker_assignment_id,
       r.body_sha256, r.body_bytes, r.created_at,
       CASE WHEN m.manifestation_head_revision_id = r.manifestation_revision_id
            THEN m.public_page_visible ELSE 0 END AS readers_see,
       COALESCE(CASE WHEN l.status <> 'active' THEN l.changed_at END,
                m.withdrawn_at,
                CASE WHEN m.status <> 'active' THEN m.updated_at END) AS withdrawn_at,
       ${STORAGE_COLUMNS("rs", "")},
       ${TAGS_COLUMNS},
       v.version_id AS have_version_id, v.readers_see AS have_readers_see,
       v.withdrawn_at AS have_withdrawn_at,
       length(CAST(v.tags AS BLOB)) AS have_tags_bytes
  FROM icono_manifestation_revisions r
  JOIN icono_manifestations m ON m.manifestation_id = r.manifestation_id
  LEFT JOIN icono_manifestation_revision_lifecycle l
    ON l.manifestation_revision_id = r.manifestation_revision_id
  LEFT JOIN icono_manifestation_revision_storage_secrets rs
    ON rs.manifestation_revision_id = r.manifestation_revision_id
  ${TAGS_JOINS}
  LEFT JOIN icono_caretaker_text_versions v ON v.version_id = r.manifestation_revision_id
 WHERE m.origin IN ('caretaker', 'fork') AND m.status <> 'purged'
   AND COALESCE(l.status, 'active') <> 'purged'
   AND ${where}
 ORDER BY r.manifestation_revision_id
 LIMIT ${limit}`
const CARETAKER_PAGE_SQL = CARETAKER_SQL("r.manifestation_revision_id > ?", TEXTS_PER_REQUEST)
// One gene's versions; a caretaker line holds a few dozen at most.
const CARETAKER_GENE_SQL = CARETAKER_SQL("m.gene_id = ?", 500)

const FACTORY_UPSERT_SQL = `
INSERT INTO icono_gene_texts
  (gene_id, text_id, version, text, text_sha256, tags, fields_json, readers_see,
   chosen_caretaker_version_id, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT (gene_id) DO UPDATE SET
  text_id = excluded.text_id, version = excluded.version, text = excluded.text,
  text_sha256 = excluded.text_sha256, tags = excluded.tags,
  fields_json = excluded.fields_json, readers_see = excluded.readers_see,
  chosen_caretaker_version_id = excluded.chosen_caretaker_version_id,
  updated_at = CURRENT_TIMESTAMP`

const CARETAKER_UPSERT_SQL = `
INSERT INTO icono_caretaker_text_versions
  (version_id, gene_id, line_id, version, account_id, caretaker_assignment_id,
   text, text_sha256, tags, fields_json, readers_see, withdrawn_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (version_id) DO UPDATE SET
  tags = excluded.tags, fields_json = excluded.fields_json,
  readers_see = excluded.readers_see, withdrawn_at = excluded.withdrawn_at`

// The factory saved a newer text through PUT /admin/genes/:symbol/text: the old
// authority's text is behind, so only the gene's flags come across.
const FACTORY_FLAGS_SQL = `
UPDATE icono_gene_texts SET readers_see = ?, chosen_caretaker_version_id = ?,
       updated_at = CURRENT_TIMESTAMP
 WHERE gene_id = ?`

const CARETAKER_FLAGS_SQL = `
UPDATE icono_caretaker_text_versions SET readers_see = ?, withdrawn_at = ?
 WHERE version_id = ?`

function storageOf(row, prefix) {
  return {
    object_key: row[`${prefix}object_key`],
    ciphertext_sha256: row[`${prefix}ciphertext_sha256`],
    ciphertext_bytes: row[`${prefix}ciphertext_bytes`],
    body_iv_base64: row[`${prefix}body_iv_base64`],
    wrapped_dek_base64: row[`${prefix}wrapped_dek_base64`],
    wrap_iv_base64: row[`${prefix}wrap_iv_base64`],
    key_version: row[`${prefix}key_version`],
    aad_version: row[`${prefix}aad_version`],
  }
}

async function readBody(env, kind, storage, ids) {
  if (!storage.object_key) throw new Error(`${kind}_storage_missing`)
  const stored = await readManifestationBodyObject(env, storage.object_key, { maxAttempts: 1 })
  if (!stored) throw new Error(`${kind}_body_missing`)
  const opened = await openManifestationBody(env, kind, stored.bytes, storage, ids)
  return DECODER.decode(opened.bytes)
}

// The text and its Tags, read in parallel. Tags are null when the text has
// none accepted.
async function readTextAndTags(env, row, geneId) {
  const textRead = readBody(env, "prose", storageOf(row, ""), {
    revisionId: row.revision_id ?? row.version_id,
    geneId,
    bodySha256: row.body_sha256,
    bodyBytes: Number(row.body_bytes),
  })
  const tagsRead = row.derivative_id
    ? readBody(env, "tags", storageOf(row, "tags_"), {
        derivativeId: row.derivative_id,
        revisionId: row.revision_id ?? row.version_id,
        sourceBodySha256: row.tags_source_body_sha256,
        bodySha256: row.tags_body_sha256,
        bodyBytes: Number(row.tags_body_bytes),
      }).then(async (combined) => {
        const split = await splitManifestationTagsPayload(combined, {
          tagsBytes: row.tags_bytes,
          tagsSha256: row.tags_sha256,
          fieldsBytes: row.fields_bytes,
          fieldsSha256: row.fields_sha256,
        })
        return {
          tags: split.tags_text,
          fields_json: canonicalManifestationFieldsJson(split.fields_json),
        }
      })
    : Promise.resolve({ tags: null, fields_json: null })
  const [text, tags] = await Promise.all([textRead, tagsRead])
  return { text, ...tags }
}

function tagsUnchanged(row) {
  return row.derivative_id
    ? Number(row.have_tags_bytes) === Number(row.tags_bytes)
    : row.have_tags_bytes == null
}

// The plain row is ahead when the factory saved a newer text through the PUT
// route; then the old authority's text and Tags no longer count.
function factoryRowAhead(row) {
  return Boolean(row.have_text_id) && Number(row.have_version) > Number(row.revision_number)
}

function factoryRowCurrent(row) {
  return (
    (factoryRowAhead(row) || (row.have_text_id === row.revision_id && tagsUnchanged(row))) &&
    (row.have_chosen ?? null) === (row.chosen ?? null) &&
    Number(row.have_readers_see) === Number(row.readers_see)
  )
}

async function factoryPage(env, db, after, force, sql = FACTORY_PAGE_SQL) {
  const { results: rows = [] } = await db.prepare(sql).bind(after).all()
  const writes = []
  const errors = []
  let skipped = 0
  await Promise.all(
    rows.map(async (row) => {
      if (!force && factoryRowCurrent(row)) {
        skipped += 1
        return
      }
      if (factoryRowAhead(row)) {
        writes.push(
          db
            .prepare(FACTORY_FLAGS_SQL)
            .bind(Number(row.readers_see) ? 1 : 0, row.chosen ?? null, row.gene_id),
        )
        return
      }
      try {
        const { text, tags, fields_json } = await readTextAndTags(env, row, row.gene_id)
        writes.push(
          db
            .prepare(FACTORY_UPSERT_SQL)
            .bind(
              row.gene_id,
              row.revision_id,
              Number(row.revision_number),
              text,
              row.body_sha256,
              tags,
              fields_json,
              Number(row.readers_see) ? 1 : 0,
              row.chosen ?? null,
            ),
        )
      } catch (error) {
        errors.push({ id: row.gene_id, error: String(error?.message || error).slice(0, 200) })
      }
    }),
  )
  return { rows, writes, errors, skipped, cursor: rows.at(-1)?.gene_id }
}

async function caretakerPage(env, db, after, force, sql = CARETAKER_PAGE_SQL) {
  const { results: rows = [] } = await db.prepare(sql).bind(after).all()
  const writes = []
  const errors = []
  let skipped = 0
  await Promise.all(
    rows.map(async (row) => {
      const readersSee = Number(row.readers_see) ? 1 : 0
      const withdrawnAt = row.withdrawn_at ?? null
      // A saved version's text never changes, so a copied one only needs its
      // flags brought up to date.
      if (!force && row.have_version_id && tagsUnchanged(row)) {
        if (
          Number(row.have_readers_see) === readersSee &&
          (row.have_withdrawn_at ?? null) === withdrawnAt
        )
          skipped += 1
        else
          writes.push(db.prepare(CARETAKER_FLAGS_SQL).bind(readersSee, withdrawnAt, row.version_id))
        return
      }
      try {
        const { text, tags, fields_json } = await readTextAndTags(env, row, row.gene_id)
        writes.push(
          db
            .prepare(CARETAKER_UPSERT_SQL)
            .bind(
              row.version_id,
              row.gene_id,
              row.line_id,
              Number(row.revision_number),
              row.account_id,
              row.caretaker_assignment_id,
              text,
              row.body_sha256,
              tags,
              fields_json,
              readersSee,
              withdrawnAt,
              row.created_at,
            ),
        )
      } catch (error) {
        errors.push({ id: row.version_id, error: String(error?.message || error).slice(0, 200) })
      }
    }),
  )
  return { rows, writes, errors, skipped, cursor: rows.at(-1)?.version_id }
}

// `kind` is "factory" (cursor: gene id) or "caretaker" (cursor: version id).
// `next_after` is null once the walk has reached the end.
export async function backfillGeneTexts(env, { kind, after = null, force = false } = {}) {
  const db = env.ICONOPLASM_AUTHORING_DB
  const page = kind === "caretaker" ? caretakerPage : factoryPage
  const { rows, writes, errors, skipped, cursor } = await page(env, db, after ?? "", force)
  if (writes.length) await db.batch(writes)
  return {
    ok: errors.length === 0,
    kind,
    examined: rows.length,
    written: writes.length,
    skipped,
    errors,
    next_after: rows.length < TEXTS_PER_REQUEST ? null : cursor,
  }
}

// Until the factory and the caretaker pages write the plain tables themselves,
// every text the old authority accepts is copied here as part of its event, so
// cards and portraits never wait for the next backfill. The event's delivery
// retries a failed copy a minute later.
export async function copyGeneTextFromAuthority(env, geneId) {
  const db = env.ICONOPLASM_AUTHORING_DB
  const id = String(geneId || "")
  if (!db || !id) return { written: 0 }
  const factory = await factoryPage(env, db, id, false, FACTORY_GENE_SQL)
  const caretaker = await caretakerPage(env, db, id, false, CARETAKER_GENE_SQL)
  const writes = [...factory.writes, ...caretaker.writes]
  if (writes.length) await db.batch(writes)
  const errors = [...factory.errors, ...caretaker.errors]
  if (errors.length) {
    throw new Error(`Gene text copy failed: ${errors.map((e) => `${e.id} ${e.error}`).join("; ")}`)
  }
  return { written: writes.length }
}
