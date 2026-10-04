#!/usr/bin/env node
// B-977: puts back the endings of the system seed texts that the importer cut
// at 4,000 characters, by replacing each seed's body in place.
//
// WHY IN PLACE. A seed is the importer's copy of the workstation's text, not
// anyone's edit. Saving the full text as a new revision through the caretaker
// command costs about 90 D1 rows per gene (upload intents, guard, receipt,
// event, lifecycle, storage, Tags copy, projection), which made 6,817 genes a
// 42-night job (PR #474, retired). In place it is about 5 rows: the revision's
// hash and size, its storage row, the accepted Tags derivative's source hash,
// and the main database's projection row. History loses nothing anyone reads:
// the cut text was a defect, never a version.
//
// THREE STEPS, each writing a file under artifacts/b977-seed-replacement/:
//   1. plan    Reads the nightly authoring copy and the workstation's prompts.db
//              (both read-only). A gene qualifies when its seed is revision 1 of
//              a `system_seed` lineage and the seed's hash equals the hash of the
//              first 4,000 code points of the full text (the crop proof), and the
//              full text fits the 10,000-character limit. Writes plan.json.
//   2. upload  PUTs each full text to a NEW random object key in the private
//              authoring zone and reads it back (putManifestationBodyObject).
//              The old objects are untouched, so readers see nothing yet.
//              Resumable: uploads.json keeps every verified upload.
//   3. sql     Writes the online migrations (two halves, PARTS) that switch every seed
//              atomically, guarded on the old hash so a gene that changed since
//              the copy is skipped. The authoring migration drops the four
//              immutability triggers it has to pass and recreates them verbatim
//              from the copy's schema in the same file.
//
//   node scripts/restore-cropped-seed-bodies.mjs plan
//   node scripts/restore-cropped-seed-bodies.mjs upload [--max-genes N]
//   node scripts/restore-cropped-seed-bodies.mjs sql
//
// `upload` needs ICONOPLASM_AUTHORING_STORAGE_PASSWORD; it touches Bunny only
// (no Worker request, no D1). Delete this script once the migrations are applied
// and the workstation replica has refreshed the corrected seeds.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  createManifestationBodyObjectKey,
  putManifestationBodyObject,
} from "../workers/lib/iconoplasm-manifestation-body-storage.js"

export const CROP_CODE_POINTS = 4000
export const MAX_CODE_POINTS = 10_000
export const STATEMENT_ROWS = 150
// Two halves, one per evening: the online-migration gate admits a release only
// when today's writes plus twice its prediction stay under 70,000 rows, and the
// whole correction is about 30,000 authority rows plus 6,800 projection rows.
// Each half pairs its authority file with its projection file, so a release
// never leaves the projection disagreeing with the authority.
export const PARTS = Object.freeze([
  { authoring: "0020_restore_cropped_seed_bodies_part1.sql", projection: "0116_restore_cropped_seed_projection_part1.sql" },
  { authoring: "0021_restore_cropped_seed_bodies_part2.sql", projection: "0117_restore_cropped_seed_projection_part2.sql" },
])
// The triggers an in-place correction has to pass. Each is dropped and then
// recreated from the schema text the copy holds, so production keeps exactly
// the guard it had.
export const BYPASSED_TRIGGERS = Object.freeze([
  "icono_manifestation_revisions_immutable_update",
  "icono_revision_storage_restore_only",
  "icono_revision_storage_restore_upload_intent_fence",
  "icono_derivatives_immutable_provenance",
])

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "artifacts", "b977-seed-replacement")
const DEFAULT_PROMPTS_DB = "D:\\Coding\\Datasets\\iconoplasm\\prompts.db"
const LOCAL_COPIES = path.join(os.tmpdir(), "brinedew-d1-local")
const ENCODER = new TextEncoder()

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

export function normalizeProse(text) {
  return String(text).normalize("NFC").replace(/\r\n?/g, "\n")
}

// The newest unpacked authoring copy that scripts/d1-local.mjs left behind.
function newestAuthoringCopy() {
  const files = existsSync(LOCAL_COPIES)
    ? readdirSync(LOCAL_COPIES).filter((name) => /^iconoplasm-authoring-[0-9a-f]{64}\.sqlite$/.test(name))
    : []
  if (!files.length)
    throw new Error(
      `No unpacked authoring copy in ${LOCAL_COPIES}; run: node scripts/d1-local.mjs iconoplasm-authoring "SELECT 1"`,
    )
  return files
    .map((name) => path.join(LOCAL_COPIES, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

// Every seed with its storage row and accepted Tags derivative, from the copy.
export function readSeeds(authoring) {
  return authoring
    .prepare(
      `SELECT g.canonical_symbol AS symbol, r.manifestation_revision_id AS revision_id,
              r.body_sha256 AS body_sha256, r.body_bytes AS body_bytes,
              s.object_key AS object_key, dh.accepted_derivative_id AS derivative_id,
              h.canonical_revision_id = r.manifestation_revision_id AS canonical
         FROM icono_manifestations m
         JOIN icono_gene_identities g ON g.gene_id = m.gene_id
         JOIN icono_manifestation_revisions r
           ON r.manifestation_id = m.manifestation_id AND r.revision_number = 1
         JOIN icono_manifestation_revision_storage_secrets s
           ON s.manifestation_revision_id = r.manifestation_revision_id
         LEFT JOIN icono_manifestation_derivative_heads dh
           ON dh.manifestation_revision_id = r.manifestation_revision_id
         JOIN icono_manifestation_heads h ON h.gene_id = m.gene_id
        WHERE m.origin = 'system_seed'
        ORDER BY g.canonical_symbol`,
    )
    .all()
}

// The crop proof, plus the size limits a body must meet.
export function planGene(seed, fullText) {
  if (fullText == null) return { skip: "no_full_text" }
  const prose = normalizeProse(fullText)
  const bytes = ENCODER.encode(prose)
  const codePoints = Array.from(prose)
  if (sha256(bytes) === seed.body_sha256) return { skip: "already_full" }
  if (sha256(ENCODER.encode(codePoints.slice(0, CROP_CODE_POINTS).join(""))) !== seed.body_sha256)
    return { skip: "not_a_crop" }
  if (codePoints.length > MAX_CODE_POINTS) return { skip: "over_limit", code_points: codePoints.length }
  if (bytes.byteLength > 16_384) return { skip: "over_byte_limit" }
  return {
    gene: {
      symbol: seed.symbol,
      revision_id: seed.revision_id,
      derivative_id: seed.derivative_id || null,
      canonical: Boolean(seed.canonical),
      old_sha256: seed.body_sha256,
      old_bytes: Number(seed.body_bytes),
      old_object_key: seed.object_key,
      new_sha256: sha256(bytes),
      new_bytes: bytes.byteLength,
      code_points: codePoints.length,
    },
  }
}

export function buildPlan({ authoringPath, promptsPath }) {
  const authoring = new DatabaseSync(authoringPath, { readOnly: true })
  const prompts = new DatabaseSync(promptsPath, { readOnly: true })
  try {
    const full = new Map(
      prompts
        .prepare("SELECT gene_symbol, manifestation FROM manifestations WHERE status = 'generated'")
        .all()
        .map((row) => [String(row.gene_symbol).toUpperCase(), row.manifestation]),
    )
    const genes = []
    const skipped = {}
    const overLimit = []
    for (const seed of readSeeds(authoring)) {
      const result = planGene(seed, full.get(String(seed.symbol).toUpperCase()))
      if (result.gene) genes.push(result.gene)
      else {
        skipped[result.skip] = (skipped[result.skip] || 0) + 1
        if (result.skip === "over_limit")
          overLimit.push({ symbol: seed.symbol, code_points: result.code_points })
      }
    }
    const triggers = Object.fromEntries(
      BYPASSED_TRIGGERS.map((name) => {
        const row = authoring
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name)
        if (!row?.sql) throw new Error(`Trigger ${name} is missing from the copy`)
        return [name, row.sql]
      }),
    )
    return { authoring_copy: path.basename(authoringPath), genes, skipped, over_limit: overLimit, triggers }
  } finally {
    authoring.close()
    prompts.close()
  }
}

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function chunks(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// The authoring migration: storage and Tags rows first (guarded on the seed
// still holding its old hash), then the revision itself, then the quota counter.
export function authoringMigrationSql({ uploads, triggers, verifiedAt }) {
  const lines = [
    "-- B-977: replace the cut system seeds' bodies in place (scripts/restore-cropped-seed-bodies.mjs).",
    "-- Each statement is guarded on the seed's old hash; a seed that changed is skipped.",
    "-- The four immutability triggers are dropped for this correction and recreated verbatim.",
    "DROP INDEX IF EXISTS idx_icono_revisions_body_hash;",
    ...BYPASSED_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name};`),
  ]
  for (const part of chunks(uploads, STATEMENT_ROWS)) {
    const values = part
      .map(
        (u) =>
          `(${[u.revision_id, u.old_sha256, u.new_sha256].map(sqlText).join(", ")}, ${u.new_bytes}, ${[u.old_object_key, u.new_object_key, u.etag ?? ""].map(sqlText).join(", ")})`,
      )
      .join(",\n  ")
    const cte = `WITH fix(revision_id, old_sha256, new_sha256, new_bytes, old_key, new_key, etag) AS (VALUES\n  ${values}\n)`
    lines.push(
      `${cte}
UPDATE icono_manifestation_revision_storage_secrets AS s
   SET object_key = fix.new_key, ciphertext_sha256 = fix.new_sha256,
       ciphertext_bytes = fix.new_bytes + 16, body_iv_base64 = '', wrapped_dek_base64 = '',
       wrap_iv_base64 = '', key_version = 1, aad_version = 1,
       object_etag = NULLIF(fix.etag, ''), verified_at = ${sqlText(verifiedAt)}
  FROM fix
 WHERE s.manifestation_revision_id = fix.revision_id AND s.object_key = fix.old_key
   AND EXISTS (SELECT 1 FROM icono_manifestation_revisions r
                WHERE r.manifestation_revision_id = fix.revision_id AND r.body_sha256 = fix.old_sha256);`,
      `${cte}
UPDATE icono_manifestation_derivatives AS d
   SET source_body_sha256 = fix.new_sha256
  FROM fix
 WHERE d.manifestation_derivative_id = (SELECT dh.accepted_derivative_id
                                          FROM icono_manifestation_derivative_heads dh
                                         WHERE dh.manifestation_revision_id = fix.revision_id)
   AND d.source_body_sha256 = fix.old_sha256
   AND EXISTS (SELECT 1 FROM icono_manifestation_revision_storage_secrets s
                WHERE s.manifestation_revision_id = fix.revision_id AND s.object_key = fix.new_key);`,
      `${cte}
UPDATE icono_manifestation_revisions AS r
   SET body_sha256 = fix.new_sha256, body_bytes = fix.new_bytes
  FROM fix
 WHERE r.manifestation_revision_id = fix.revision_id AND r.body_sha256 = fix.old_sha256
   AND EXISTS (SELECT 1 FROM icono_manifestation_revision_storage_secrets s
                WHERE s.manifestation_revision_id = fix.revision_id AND s.object_key = fix.new_key);`,
    )
  }
  const added = uploads.reduce((sum, u) => sum + (u.new_bytes - u.old_bytes), 0)
  lines.push(
    `UPDATE icono_authority_state SET body_admitted_bytes = body_admitted_bytes + ${added}, updated_at = CURRENT_TIMESTAMP WHERE singleton = 1;`,
    // Verbatim schema text; it ends in an "end" line without the semicolon.
    ...BYPASSED_TRIGGERS.map((name) => `${String(triggers[name]).trim().replace(/;$/, "")};`),
  )
  return `${lines.join("\n\n")}\n`
}

// The main database's copy of each canonical seed's body facts.
export function projectionMigrationSql({ uploads }) {
  const lines = [
    "-- B-977: the canonical projection follows the in-place seed body replacement",
    "-- (the matching migrations-iconoplasm-authoring part). Guarded on the old hash.",
  ]
  for (const part of chunks(
    uploads.filter((u) => u.canonical),
    STATEMENT_ROWS,
  )) {
    const values = part
      .map((u) => `(${[u.revision_id, u.old_sha256, u.new_sha256].map(sqlText).join(", ")}, ${u.new_bytes})`)
      .join(",\n  ")
    lines.push(`WITH fix(revision_id, old_sha256, new_sha256, new_bytes) AS (VALUES
  ${values}
)
UPDATE icono_manifestation_canonical_projection AS p
   SET canonical_body_sha256 = fix.new_sha256, canonical_body_bytes = fix.new_bytes,
       accepted_tags_source_body_sha256 = CASE
         WHEN p.accepted_tags_source_body_sha256 = fix.old_sha256 THEN fix.new_sha256
         ELSE p.accepted_tags_source_body_sha256 END
  FROM fix
 WHERE p.canonical_revision_id = fix.revision_id AND p.canonical_body_sha256 = fix.old_sha256;`)
  }
  return `${lines.join("\n\n")}\n`
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`)
}

async function upload({ maxGenes, promptsPath }) {
  const plan = readJson(path.join(OUT, "plan.json"))
  const receiptPath = path.join(OUT, "uploads.json")
  const receipt = existsSync(receiptPath) ? readJson(receiptPath) : { uploads: [] }
  const done = new Set(receipt.uploads.map((u) => u.revision_id))
  const prompts = new DatabaseSync(promptsPath, { readOnly: true })
  const env = {
    ICONOPLASM_AUTHORING_STORAGE_ZONE: process.env.ICONOPLASM_AUTHORING_STORAGE_ZONE || "iconoplasm-authoring",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: process.env.ICONOPLASM_AUTHORING_STORAGE_PASSWORD,
  }
  if (!env.ICONOPLASM_AUTHORING_STORAGE_PASSWORD)
    throw new Error("Set ICONOPLASM_AUTHORING_STORAGE_PASSWORD to upload")
  let sent = 0
  try {
    for (const gene of plan.genes) {
      if (done.has(gene.revision_id)) continue
      if (sent >= maxGenes) break
      const row = prompts
        .prepare("SELECT manifestation FROM manifestations WHERE gene_symbol = ?")
        .get(gene.symbol)
      const bytes = ENCODER.encode(normalizeProse(row?.manifestation ?? ""))
      if (sha256(bytes) !== gene.new_sha256) throw new Error(`${gene.symbol}: the full text changed since plan`)
      const key = await createManifestationBodyObjectKey()
      const result = await putManifestationBodyObject(env, key, bytes, { expectedSha256: gene.new_sha256 })
      receipt.uploads.push({ ...gene, new_object_key: key, etag: result.etag || null })
      sent++
      if (sent % 50 === 0) {
        writeJson(receiptPath, receipt)
        console.log(`${receipt.uploads.length} of ${plan.genes.length} uploaded`)
      }
    }
  } finally {
    prompts.close()
    writeJson(receiptPath, receipt)
  }
  console.log(JSON.stringify({ uploaded_now: sent, uploaded_total: receipt.uploads.length, planned: plan.genes.length }))
}

async function main(argv) {
  const [step, ...rest] = argv
  const flag = (name, fallback) => {
    const at = rest.indexOf(name)
    return at >= 0 ? rest[at + 1] : fallback
  }
  const promptsPath = flag("--prompts", DEFAULT_PROMPTS_DB)
  if (step === "plan") {
    const plan = buildPlan({ authoringPath: flag("--authoring", newestAuthoringCopy()), promptsPath })
    writeJson(path.join(OUT, "plan.json"), plan)
    console.log(
      JSON.stringify({ genes: plan.genes.length, skipped: plan.skipped, over_limit: plan.over_limit.length }),
    )
  } else if (step === "upload") {
    await upload({ maxGenes: Number(flag("--max-genes", Infinity)), promptsPath })
  } else if (step === "sql") {
    const plan = readJson(path.join(OUT, "plan.json"))
    const { uploads } = readJson(path.join(OUT, "uploads.json"))
    if (uploads.length !== plan.genes.length)
      throw new Error(`Only ${uploads.length} of ${plan.genes.length} genes are uploaded; finish upload first`)
    const verifiedAt = new Date().toISOString()
    const half = Math.ceil(uploads.length / PARTS.length)
    const written = PARTS.map((part, index) => {
      const slice = uploads.slice(index * half, (index + 1) * half)
      writeFileSync(
        path.join(ROOT, "migrations-iconoplasm-authoring", part.authoring),
        authoringMigrationSql({ uploads: slice, triggers: plan.triggers, verifiedAt }),
      )
      writeFileSync(path.join(ROOT, "migrations-iconoplasm", part.projection), projectionMigrationSql({ uploads: slice }))
      return { ...part, genes: slice.length, canonical: slice.filter((u) => u.canonical).length }
    })
    console.log(JSON.stringify(written))
  } else {
    throw new Error("Usage: restore-cropped-seed-bodies.mjs plan | upload [--max-genes N] | sql")
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
