#!/usr/bin/env node
// B-994: puts the workstation's rewritten characters on the site. Each rewrite
// becomes a NEW revision of the gene's system-seed lineage with its OWN new Tags,
// and becomes canonical only while the canonical is still that lineage's head,
// so a caretaker's text always wins. The old seed stays in history.
//
// WHY A MIGRATION. Today's authority commands cost about 110 to 180 D1 rows per
// rewrite (Tags submit alone is measured at 54, TAGS_DERIVATIVE_SUBMIT_ROWS),
// which makes 669 genes three to five evenings. A reviewed online migration that
// only INSERTs the rows a reader needs costs about 30. Nothing immutable is
// updated. The permanent route for future regenerations is B-1011, after
// B-859's Tier 1 cuts the per-save ceremony.
//
// WHY NOT B-977's IN-PLACE SWAP. That swap repoints the gene's accepted Tags onto
// the new body, which is right only for the same text. A rewrite needs its own
// Tags, or portraits keep drawing the old (copied) wardrobe.
//
// THREE STEPS, files under artifacts/b994-append-rewrites/:
//   1. plan    Reads the workstation export (Iconoplasm
//              scripts/export_pending_rewrites.py) and the nightly authoring copy.
//              Validates every body and Tags payload with the Worker's own
//              preparers, so a hash or framing difference stops here.
//   2. upload  PUTs each prose body and Tags body to NEW random keys in the
//              private authoring zone, read back (putManifestationBodyObject).
//              Nothing points at them until the migration. Resumable.
//   3. sql     Writes migrations-iconoplasm-authoring/0022 and
//              migrations-iconoplasm/0118. Every statement is guarded on the
//              copy's state (lineage head, canonical revision, head version, gene
//              revision), so a gene that changed since the copy is skipped whole.
//
//   node scripts/append-rewritten-system-revisions.mjs plan --rewrites <file.jsonl>
//   node scripts/append-rewritten-system-revisions.mjs upload [--max-genes N]
//   node scripts/append-rewritten-system-revisions.mjs sql
//
// The two upload-intent fences are dropped for the batch and recreated verbatim:
// the bodies were uploaded and verified from the laptop, as in B-977. No event
// rows are written; afterwards the workstation runs
// scripts/require_authority_snapshot.py (Iconoplasm repo), and the public gene
// objects are republished for their metadata. Delete this script after that.
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath, pathToFileURL } from "node:url"
import { prepareManifestationTagsPayload } from "../workers/iconoplasm/caretaker/manifestation-tags-payload.js"
import {
  createManifestationBodyObjectKey,
  putManifestationBodyObject,
} from "../workers/lib/iconoplasm-manifestation-body-storage.js"
import { prepareManifestationProse } from "../workers/lib/iconoplasm-manifestation-prose.js"

export const PARTS = Object.freeze({
  authoring: "0022_append_rewritten_system_revisions.sql",
  projection: "0118_append_rewritten_system_projection.sql",
})
export const BYPASSED_TRIGGERS = Object.freeze([
  "icono_revision_storage_upload_intent_fence",
  "icono_derivative_storage_upload_intent_fence",
])
// Event-replay protection on the main projection: refuses a changed payload
// under an unchanged event sequence. This batch writes no event (B-977, 0116).
export const BYPASSED_PROJECTION_TRIGGERS = Object.freeze(["icono_projection_epoch_guard_update"])
// Rows per statement, sized so each statement stays well under D1's 100 KB.
export const STATEMENT_ROWS = 40

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "artifacts", "b994-append-rewrites")
const LOCAL_COPIES = path.join(os.tmpdir(), "brinedew-d1-local")
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/
const SHA = /^[0-9a-f]{64}$/

function newestCopy(database) {
  const pattern = new RegExp(`^${database}-[0-9a-f]{64}\\.sqlite$`)
  const files = existsSync(LOCAL_COPIES) ? readdirSync(LOCAL_COPIES).filter((name) => pattern.test(name)) : []
  if (!files.length)
    throw new Error(`No unpacked ${database} copy in ${LOCAL_COPIES}; run: node scripts/d1-local.mjs ${database} "SELECT 1"`)
  return files.map((name) => path.join(LOCAL_COPIES, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

export function readTriggers(databasePath, names) {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return Object.fromEntries(
      names.map((name) => {
        const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)
        if (!row?.sql) throw new Error(`Trigger ${name} is missing from ${path.basename(databasePath)}`)
        return [name, row.sql]
      }),
    )
  } finally {
    db.close()
  }
}

// The gene's system-seed lineage and its canonical head, from the copy.
export function readLineage(authoring, symbol) {
  return authoring
    .prepare(
      `SELECT g.gene_id, g.canonical_symbol AS symbol, m.manifestation_id,
              m.manifestation_head_revision_id AS head_revision_id,
              r.revision_number, r.body_sha256 AS head_body_sha256,
              h.canonical_manifestation_id, h.canonical_revision_id,
              h.canonical_selection_id, h.head_version, h.gene_revision
         FROM icono_gene_identities g
         JOIN icono_manifestations m
           ON m.gene_id = g.gene_id AND m.origin = 'system_seed' AND m.status = 'active'
         JOIN icono_manifestation_revisions r
           ON r.manifestation_revision_id = m.manifestation_head_revision_id
         JOIN icono_manifestation_heads h ON h.gene_id = g.gene_id
        WHERE g.canonical_symbol = ? COLLATE NOCASE AND g.status = 'active'`,
    )
    .get(symbol)
}

// One rewrite against its lineage: validated with the Worker's own preparers.
export async function planRewrite(lineage, rewrite, idFactory = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`) {
  if (!lineage) return { skip: "no_system_seed_lineage" }
  let prose
  try {
    prose = await prepareManifestationProse(rewrite.prose)
  } catch (error) {
    return { skip: "prose_invalid", detail: error.code || error.message }
  }
  if (prose.body_sha256 === lineage.head_body_sha256) return { skip: "unchanged" }
  let tags
  try {
    tags = await prepareManifestationTagsPayload({
      tagsText: rewrite.tags_text,
      tagsSha256: rewrite.tags_sha256,
      fieldsJson: rewrite.fields_json,
      fieldsSha256: rewrite.fields_sha256,
    })
  } catch (error) {
    return { skip: "tags_invalid", detail: error.code || error.message }
  }
  for (const key of ["recipe_id", "recipe_version", "provider_id", "model_id"])
    if (!TOKEN.test(String(rewrite[key] ?? ""))) return { skip: "provenance_invalid", detail: key }
  if (!SHA.test(String(rewrite.tagger_config_sha256 ?? ""))) return { skip: "provenance_invalid", detail: "tagger_config_sha256" }
  const select =
    lineage.canonical_revision_id === lineage.head_revision_id &&
    lineage.canonical_manifestation_id === lineage.manifestation_id
  return {
    gene: {
      symbol: lineage.symbol,
      gene_id: lineage.gene_id,
      manifestation_id: lineage.manifestation_id,
      old_revision_id: lineage.head_revision_id,
      new_revision_number: Number(lineage.revision_number) + 1,
      base_selection_id: lineage.canonical_selection_id,
      old_head_version: Number(lineage.head_version),
      old_gene_revision: Number(lineage.gene_revision),
      select,
      new_revision_id: idFactory("revision"),
      derivative_id: idFactory("derivative"),
      selection_id: select ? idFactory("selection") : null,
      command_id: select ? idFactory("command_b994") : null,
      body_sha256: prose.body_sha256,
      body_bytes: prose.body_bytes,
      tags_body_sha256: tags.output_plain_sha256,
      tags_body_bytes: tags.output_plain_bytes,
      tags_sha256: tags.tags_sha256,
      tags_bytes: tags.tags_bytes,
      fields_sha256: tags.fields_sha256,
      fields_bytes: tags.fields_bytes,
      recipe_id: rewrite.recipe_id,
      recipe_version: rewrite.recipe_version,
      provider_id: rewrite.provider_id,
      model_id: rewrite.model_id,
      tagger_config_sha256: rewrite.tagger_config_sha256,
    },
  }
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "1" : "0"
  return `'${String(value).replace(/'/g, "''")}'`
}

function chunks(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const FIX_COLUMNS = Object.freeze([
  "gene_id", "manifestation_id", "old_revision_id", "new_revision_id", "new_revision_number",
  "base_selection_id", "old_head_version", "old_gene_revision", "do_select", "selection_id",
  "command_id", "body_sha256", "body_bytes", "prose_key", "prose_etag", "derivative_id",
  "tags_body_sha256", "tags_body_bytes", "tags_sha256", "tags_bytes", "fields_sha256",
  "fields_bytes", "recipe_id", "recipe_version", "provider_id", "model_id",
  "tagger_config_sha256", "tags_key", "tags_etag",
])

function fixRow(u) {
  const values = {
    ...u,
    do_select: u.select ? 1 : 0,
    prose_etag: u.prose_etag ?? "",
    tags_etag: u.tags_etag ?? "",
  }
  return `(${FIX_COLUMNS.map((column) => sqlValue(values[column])).join(", ")})`
}

// The authoring migration: INSERTs in the order the schema's triggers require,
// then the lineage head, the Tags head and (where still the seed's) the canonical
// selection, whose own trigger moves the gene head.
export function authoringMigrationSql({ uploads, triggers, now }) {
  const at = sqlValue(now)
  const lines = [
    "-- B-994: append each workstation rewrite as a new system-seed revision with its own Tags",
    "-- (scripts/append-rewritten-system-revisions.mjs). Every statement is guarded on the",
    "-- nightly copy's state; a gene that changed since is skipped whole. The two upload-intent",
    "-- fences are dropped for this batch (bodies were uploaded and read back from the laptop)",
    "-- and recreated verbatim at the end.",
    ...BYPASSED_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name};`),
  ]
  for (const part of chunks(uploads, STATEMENT_ROWS)) {
    const cte = `WITH fix(${FIX_COLUMNS.join(", ")}) AS (VALUES\n  ${part.map(fixRow).join(",\n  ")}\n)`
    const revisionExists = `EXISTS (SELECT 1 FROM icono_manifestation_revisions r WHERE r.manifestation_revision_id = fix.new_revision_id)`
    lines.push(
      `${cte}
INSERT INTO icono_manifestation_revisions (
  manifestation_revision_id, manifestation_id, revision_number, parent_revision_id,
  source_revision_id, base_canonical_selection_id, body_sha256, body_bytes,
  sample_label, sample_number, sample_text_sha256, author_account_id,
  caretaker_assignment_id, created_at)
SELECT fix.new_revision_id, fix.manifestation_id, fix.new_revision_number, fix.old_revision_id,
       NULL, fix.base_selection_id, fix.body_sha256, fix.body_bytes, NULL, NULL, NULL, NULL, NULL, ${at}
  FROM fix
  JOIN icono_manifestations m
    ON m.manifestation_id = fix.manifestation_id AND m.manifestation_head_revision_id = fix.old_revision_id
   AND m.origin = 'system_seed' AND m.status = 'active';`,
      `${cte}
INSERT INTO icono_manifestation_revision_storage_secrets (
  manifestation_revision_id, object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64,
  wrapped_dek_base64, wrap_iv_base64, key_version, aad_version, object_etag, verified_at, created_at)
SELECT fix.new_revision_id, fix.prose_key, fix.body_sha256, fix.body_bytes + 16, '', '', '', 1, 1,
       NULLIF(fix.prose_etag, ''), ${at}, ${at}
  FROM fix WHERE ${revisionExists};`,
      `${cte}
INSERT INTO icono_manifestation_revision_lifecycle (manifestation_revision_id, status, changed_by_account_id, changed_at)
SELECT fix.new_revision_id, 'active', NULL, ${at} FROM fix WHERE ${revisionExists};`,
      `${cte}
UPDATE icono_manifestations AS m
   SET manifestation_head_revision_id = fix.new_revision_id, row_version = m.row_version + 1, updated_at = ${at}
  FROM fix
 WHERE m.manifestation_id = fix.manifestation_id AND m.manifestation_head_revision_id = fix.old_revision_id
   AND ${revisionExists};`,
      `${cte}
INSERT INTO icono_manifestation_derivatives (
  manifestation_derivative_id, manifestation_revision_id, derivative_kind, status,
  source_body_sha256, body_sha256, body_bytes, tags_sha256, tags_bytes, fields_sha256,
  fields_bytes, recipe_id, recipe_version, provider_id, model_id, tagger_config_sha256,
  provenance_status, failure_code, created_at, completed_at)
SELECT fix.derivative_id, fix.new_revision_id, 'tags', 'complete', fix.body_sha256,
       fix.tags_body_sha256, fix.tags_body_bytes, fix.tags_sha256, fix.tags_bytes,
       fix.fields_sha256, fix.fields_bytes, fix.recipe_id, fix.recipe_version,
       fix.provider_id, fix.model_id, fix.tagger_config_sha256, 'generated', NULL, ${at}, ${at}
  FROM fix WHERE ${revisionExists};`,
      `${cte}
INSERT INTO icono_manifestation_derivative_storage_secrets (
  manifestation_derivative_id, object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64,
  wrapped_dek_base64, wrap_iv_base64, key_version, aad_version, object_etag, verified_at, created_at)
SELECT fix.derivative_id, fix.tags_key, fix.tags_body_sha256, fix.tags_body_bytes + 16, '', '', '',
       1, 1, NULLIF(fix.tags_etag, ''), ${at}, ${at}
  FROM fix
 WHERE EXISTS (SELECT 1 FROM icono_manifestation_derivatives d WHERE d.manifestation_derivative_id = fix.derivative_id);`,
      `${cte}
UPDATE icono_manifestation_derivative_heads AS dh
   SET accepted_derivative_id = fix.derivative_id,
       derivative_head_version = dh.derivative_head_version + 1, updated_at = ${at}
  FROM fix
 WHERE dh.manifestation_revision_id = fix.new_revision_id AND dh.derivative_head_version = 0
   AND dh.accepted_derivative_id IS NULL
   AND EXISTS (SELECT 1 FROM icono_manifestation_derivative_storage_secrets s
                WHERE s.manifestation_derivative_id = fix.derivative_id);`,
      `${cte}
INSERT INTO icono_manifestation_canonical_selections (
  canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
  selected_manifestation_id, selected_revision_id, actor_account_id, caretaker_assignment_id,
  reason, command_id, head_version, gene_revision, created_at)
SELECT fix.selection_id, fix.gene_id, h.canonical_selection_id, h.canonical_revision_id,
       fix.manifestation_id, fix.new_revision_id, NULL, NULL, 'select', fix.command_id,
       h.head_version + 1, h.gene_revision + 1, ${at}
  FROM fix
  JOIN icono_manifestation_heads h
    ON h.gene_id = fix.gene_id AND h.canonical_manifestation_id = fix.manifestation_id
   AND h.canonical_revision_id = fix.old_revision_id AND h.head_version = fix.old_head_version
   AND h.gene_revision = fix.old_gene_revision
 WHERE fix.do_select = 1
   AND EXISTS (SELECT 1 FROM icono_manifestations m
                WHERE m.manifestation_id = fix.manifestation_id
                  AND m.manifestation_head_revision_id = fix.new_revision_id)
   AND EXISTS (SELECT 1 FROM icono_manifestation_derivative_heads dh
                WHERE dh.manifestation_revision_id = fix.new_revision_id
                  AND dh.accepted_derivative_id = fix.derivative_id);`,
    )
  }
  lines.push(...BYPASSED_TRIGGERS.map((name) => `${String(triggers[name]).trim().replace(/;$/, "")};`))
  return `${lines.join("\n\n")}\n`
}

// The main database's projection for the genes whose canonical moved, guarded
// on the copy's canonical revision, head version and gene revision.
export function projectionMigrationSql({ uploads, triggers }) {
  const columns = [
    "gene_id", "old_revision_id", "old_head_version", "old_gene_revision", "new_revision_id",
    "selection_id", "body_sha256", "body_bytes", "derivative_id", "tags_body_sha256",
    "tags_body_bytes", "tags_sha256", "tags_bytes", "fields_sha256", "fields_bytes",
    "recipe_id", "recipe_version", "provider_id", "model_id", "tagger_config_sha256",
  ]
  const lines = [
    "-- B-994: the canonical projection follows the appended rewrites",
    "-- (migrations-iconoplasm-authoring/0022). Guarded on the copy's canonical state.",
    "-- The event-replay guard is dropped for this batch (no event rows) and recreated verbatim.",
    ...BYPASSED_PROJECTION_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name};`),
  ]
  for (const part of chunks(uploads.filter((u) => u.select), STATEMENT_ROWS)) {
    const values = part.map((u) => `(${columns.map((column) => sqlValue(u[column])).join(", ")})`).join(",\n  ")
    lines.push(`WITH fix(${columns.join(", ")}) AS (VALUES
  ${values}
)
UPDATE icono_manifestation_canonical_projection AS p
   SET canonical_revision_id = fix.new_revision_id, canonical_selection_id = fix.selection_id,
       canonical_body_sha256 = fix.body_sha256, canonical_body_bytes = fix.body_bytes,
       canonical_revision_lifecycle = 'active',
       accepted_tags_derivative_id = fix.derivative_id, accepted_tags_derivative_head_version = 1,
       accepted_tags_status = 'complete', accepted_tags_source_body_sha256 = fix.body_sha256,
       accepted_tags_body_sha256 = fix.tags_body_sha256, accepted_tags_body_bytes = fix.tags_body_bytes,
       accepted_tags_text_sha256 = fix.tags_sha256, accepted_tags_text_bytes = fix.tags_bytes,
       accepted_tags_fields_sha256 = fix.fields_sha256, accepted_tags_fields_bytes = fix.fields_bytes,
       accepted_tags_recipe_id = fix.recipe_id, accepted_tags_recipe_version = fix.recipe_version,
       accepted_tags_provider_id = fix.provider_id, accepted_tags_model_id = fix.model_id,
       accepted_tags_config_sha256 = fix.tagger_config_sha256,
       accepted_tags_provenance_status = 'generated',
       head_version = p.head_version + 1, gene_revision = p.gene_revision + 1,
       public_material_version = p.public_material_version + 1,
       projection_version = p.projection_version + 1, projected_at = CURRENT_TIMESTAMP
  FROM fix
 WHERE p.gene_id = fix.gene_id AND p.canonical_revision_id = fix.old_revision_id
   AND p.head_version = fix.old_head_version AND p.gene_revision = fix.old_gene_revision;`)
  }
  lines.push(...BYPASSED_PROJECTION_TRIGGERS.map((name) => `${String(triggers[name]).trim().replace(/;$/, "")};`))
  return `${lines.join("\n\n")}\n`
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`)
}

function readRewrites(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

async function plan({ rewritesPath, authoringPath }) {
  const authoring = new DatabaseSync(authoringPath, { readOnly: true })
  const genes = []
  const skipped = {}
  try {
    for (const rewrite of readRewrites(rewritesPath)) {
      const result = await planRewrite(readLineage(authoring, rewrite.symbol), rewrite)
      if (result.gene) genes.push(result.gene)
      else (skipped[result.skip] ||= []).push(rewrite.symbol)
    }
  } finally {
    authoring.close()
  }
  const triggers = readTriggers(authoringPath, BYPASSED_TRIGGERS)
  writeJson(path.join(OUT, "plan.json"), {
    authoring_copy: path.basename(authoringPath),
    rewrites: path.resolve(rewritesPath),
    genes,
    skipped,
    triggers,
  })
  console.log(
    JSON.stringify({
      genes: genes.length,
      selected: genes.filter((g) => g.select).length,
      skipped: Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.length])),
    }),
  )
}

async function putVerified(env, key, bytes, expectedSha256) {
  // A slow Bunny request aborts after its own timeout (B-977: once in 1,207).
  // Retry the same key; the PUT is idempotent.
  for (let attempt = 1; ; attempt++) {
    try {
      return await putManifestationBodyObject(env, key, bytes, { expectedSha256 })
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
}

async function upload({ maxGenes }) {
  const planned = readJson(path.join(OUT, "plan.json"))
  const rewrites = new Map(readRewrites(planned.rewrites).map((r) => [String(r.symbol).toUpperCase(), r]))
  const receiptPath = path.join(OUT, "uploads.json")
  const receipt = existsSync(receiptPath) ? readJson(receiptPath) : { uploads: [] }
  const done = new Set(receipt.uploads.map((u) => u.new_revision_id))
  const env = {
    ICONOPLASM_AUTHORING_STORAGE_ZONE: process.env.ICONOPLASM_AUTHORING_STORAGE_ZONE || "iconoplasm-authoring",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: process.env.ICONOPLASM_AUTHORING_STORAGE_PASSWORD,
  }
  if (!env.ICONOPLASM_AUTHORING_STORAGE_PASSWORD) throw new Error("Set ICONOPLASM_AUTHORING_STORAGE_PASSWORD to upload")
  let sent = 0
  try {
    for (const gene of planned.genes) {
      if (done.has(gene.new_revision_id)) continue
      if (sent >= maxGenes) break
      const rewrite = rewrites.get(gene.symbol.toUpperCase())
      const prose = await prepareManifestationProse(rewrite?.prose ?? "")
      if (prose.body_sha256 !== gene.body_sha256) throw new Error(`${gene.symbol}: the rewrite changed since plan`)
      const tags = await prepareManifestationTagsPayload({
        tagsText: rewrite.tags_text,
        tagsSha256: rewrite.tags_sha256,
        fieldsJson: rewrite.fields_json,
        fieldsSha256: rewrite.fields_sha256,
      })
      if (tags.output_plain_sha256 !== gene.tags_body_sha256) throw new Error(`${gene.symbol}: the Tags changed since plan`)
      const proseKey = await createManifestationBodyObjectKey()
      const tagsKey = await createManifestationBodyObjectKey()
      const proseResult = await putVerified(env, proseKey, prose.bytes, gene.body_sha256)
      const tagsResult = await putVerified(env, tagsKey, tags.output_bytes, gene.tags_body_sha256)
      receipt.uploads.push({
        ...gene,
        prose_key: proseKey,
        prose_etag: proseResult.etag || null,
        tags_key: tagsKey,
        tags_etag: tagsResult.etag || null,
      })
      sent++
      if (sent % 25 === 0) {
        writeJson(receiptPath, receipt)
        console.log(`${receipt.uploads.length} of ${planned.genes.length} uploaded`)
      }
    }
  } finally {
    writeJson(receiptPath, receipt)
  }
  console.log(JSON.stringify({ uploaded_now: sent, uploaded_total: receipt.uploads.length, planned: planned.genes.length }))
}

// A D1-shaped wrapper over node:sqlite, enough for the authority and public readers.
function sqliteD1(raw) {
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    first: async () => raw.prepare(sql).get(...params) || null,
    all: async () => ({ results: raw.prepare(sql).all(...params) }),
    run: async () => ({ success: true, meta: { changes: Number(raw.prepare(sql).run(...params).changes) } }),
  })
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) }
}

// Local only: applies the real generated SQL to copies of the nightly production
// databases (real rows, every real trigger), then runs the public reader on every
// planned gene. Bodies are served from memory under rehearsal keys; no network.
async function rehearse({ authoringPath, mainPath }) {
  const { splitMigrationSql } = await import("./generate-operation-cost-migrations.mjs")
  const { readPublicCanonicalMaterial } = await import(
    "../workers/iconoplasm/caretaker/manifestation-public-canonical-material.js"
  )
  const { copyFileSync } = await import("node:fs")
  const planned = readJson(path.join(OUT, "plan.json"))
  const rewrites = new Map(readRewrites(planned.rewrites).map((r) => [String(r.symbol).toUpperCase(), r]))
  const objects = new Map()
  const uploads = []
  for (const gene of planned.genes) {
    const rewrite = rewrites.get(gene.symbol.toUpperCase())
    const prose = await prepareManifestationProse(rewrite.prose)
    const proseKey = await createManifestationBodyObjectKey()
    const tagsKey = await createManifestationBodyObjectKey()
    objects.set(proseKey, prose.bytes)
    uploads.push({ ...gene, prose_key: proseKey, prose_etag: '"r"', tags_key: tagsKey, tags_etag: '"r"' })
  }
  const work = path.join(os.tmpdir(), "b994-rehearsal")
  mkdirSync(work, { recursive: true })
  const authoringCopy = path.join(work, "authoring.sqlite")
  const mainCopy = path.join(work, "main.sqlite")
  copyFileSync(authoringPath, authoringCopy)
  copyFileSync(mainPath, mainCopy)
  const authoring = new DatabaseSync(authoringCopy)
  const main = new DatabaseSync(mainCopy)
  const now = new Date().toISOString()
  try {
    const authoringSql = authoringMigrationSql({ uploads, triggers: readTriggers(authoringCopy, BYPASSED_TRIGGERS), now })
    const projectionSql = projectionMigrationSql({ uploads, triggers: readTriggers(mainCopy, BYPASSED_PROJECTION_TRIGGERS) })
    const before = authoring.prepare("SELECT total_changes() AS n").get().n
    for (const s of splitMigrationSql(authoringSql, PARTS.authoring)) authoring.exec(s)
    const authoringRows = authoring.prepare("SELECT total_changes() AS n").get().n - before
    for (const s of splitMigrationSql(projectionSql, PARTS.projection)) main.exec(s)
    const original = globalThis.fetch
    globalThis.fetch = async (url) => {
      const parts = new URL(String(url)).pathname.split("/").filter(Boolean)
      parts.shift()
      const bytes = objects.get(parts.join("/"))
      return bytes ? new Response(bytes, { status: 200, headers: { etag: '"r"' } }) : new Response(null, { status: 404 })
    }
    const env = {
      ICONOPLASM_AUTHORING_STORAGE_HOST: "rehearsal.invalid",
      ICONOPLASM_AUTHORING_STORAGE_ZONE: "rehearsal",
      ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "rehearsal",
      ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "2000",
    }
    const failures = []
    let served = 0
    try {
      for (const u of uploads) {
        try {
          const material = await readPublicCanonicalMaterial({
            primaryDb: sqliteD1(main),
            authoringDb: sqliteD1(authoring),
            env,
            geneId: u.gene_id,
          })
          if (material.canonical?.manifestation_revision_id !== (u.select ? u.new_revision_id : material.canonical?.manifestation_revision_id))
            failures.push({ symbol: u.symbol, error: "canonical_not_switched" })
          else served++
        } catch (error) {
          failures.push({ symbol: u.symbol, error: error.code || error.message })
        }
      }
    } finally {
      globalThis.fetch = original
    }
    const result = {
      genes: uploads.length,
      authoring_changes: authoringRows,
      changes_per_gene: Number((authoringRows / uploads.length).toFixed(1)),
      public_reader_ok: served,
      failures: failures.slice(0, 20),
      failure_count: failures.length,
    }
    writeJson(path.join(OUT, "rehearsal.json"), result)
    console.log(JSON.stringify(result))
  } finally {
    authoring.close()
    main.close()
  }
}

async function main(argv) {
  const [step, ...rest] = argv
  const flag = (name, fallback) => {
    const at = rest.indexOf(name)
    return at >= 0 ? rest[at + 1] : fallback
  }
  if (step === "plan") {
    const rewritesPath = flag("--rewrites")
    if (!rewritesPath) throw new Error("plan needs --rewrites <file.jsonl> from export_pending_rewrites.py")
    await plan({ rewritesPath, authoringPath: flag("--authoring", newestCopy("iconoplasm-authoring")) })
  } else if (step === "rehearse") {
    await rehearse({
      authoringPath: flag("--authoring", newestCopy("iconoplasm-authoring")),
      mainPath: flag("--main", newestCopy("iconoplasm")),
    })
  } else if (step === "upload") {
    await upload({ maxGenes: Number(flag("--max-genes", Infinity)) })
  } else if (step === "sql") {
    const planned = readJson(path.join(OUT, "plan.json"))
    const { uploads } = readJson(path.join(OUT, "uploads.json"))
    if (uploads.length !== planned.genes.length)
      throw new Error(`Only ${uploads.length} of ${planned.genes.length} genes are uploaded; finish upload first`)
    const now = new Date().toISOString()
    const projectionTriggers = readTriggers(flag("--main", newestCopy("iconoplasm")), BYPASSED_PROJECTION_TRIGGERS)
    writeFileSync(
      path.join(ROOT, "migrations-iconoplasm-authoring", PARTS.authoring),
      authoringMigrationSql({ uploads, triggers: planned.triggers, now }),
    )
    writeFileSync(
      path.join(ROOT, "migrations-iconoplasm", PARTS.projection),
      projectionMigrationSql({ uploads, triggers: projectionTriggers }),
    )
    console.log(JSON.stringify({ ...PARTS, genes: uploads.length, selected: uploads.filter((u) => u.select).length }))
  } else {
    throw new Error("Usage: append-rewritten-system-revisions.mjs plan --rewrites FILE | upload [--max-genes N] | sql")
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
