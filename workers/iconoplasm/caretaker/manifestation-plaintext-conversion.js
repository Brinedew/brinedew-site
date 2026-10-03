// B-859: the one-shot rewrite of the 38,487 envelope body objects (19,245 prose,
// 19,242 Tags) that production stored before bodies became plain text. It runs
// inside the Worker because only the Worker holds the key secret and the Bunny
// password. It is driven by scripts/convert-authoring-bodies-to-plaintext.mjs
// and goes away, with that script, the route and the legacy envelope reader,
// once `--verify` finds no envelope left (B-958).
//
// It writes no D1 row. The cursor is the storage row's id, which the caller
// hands back with the next call, so a crash loses nothing and a rerun is safe:
// an object that is already plain text is recognised by its hash and skipped.
//
// One call handles at most PLAINTEXT_CONVERSION_MAX_BODIES bodies at the same
// time. A free-plan Worker may make 50 subrequests, and a body can cost one read,
// one write, up to three read-backs, and (only when the write lands damaged) one
// rollback write and three more read-backs. Every storage call below makes one
// request, so 4 bodies * 9 + 1 D1 query stays inside 50 even in the worst case.
import {
  classifyManifestationBody,
  openManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-reader.js"
import {
  readManifestationBodyObject,
  writeManifestationBodyObject,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { authorityError } from "./manifestation-authority-contract.js"

export const PLAINTEXT_CONVERSION_MAX_BODIES = 4
export const PLAINTEXT_CONVERSION_DEFAULT_BODIES = 3

// Bunny can take seconds to serve an acknowledged write (see
// bunny-storage-consistency.js). Three reads, spaced, keep one body's wall time
// near five seconds; a body that still shows the old bytes is reported, and
// the next pass looks again.
const READ_BACK_PAUSES_MS = Object.freeze([0, 1500, 3000])

const ROW_SELECT = Object.freeze({
  revision: `SELECT storage.manifestation_revision_id AS id, storage.object_key,
            storage.ciphertext_sha256, storage.ciphertext_bytes, storage.body_iv_base64,
            storage.wrapped_dek_base64, storage.wrap_iv_base64, storage.key_version,
            storage.aad_version, revision.body_sha256, revision.body_bytes,
            manifestation.gene_id
       FROM icono_manifestation_revision_storage_secrets storage
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = storage.manifestation_revision_id
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
      WHERE storage.manifestation_revision_id > ?
      ORDER BY storage.manifestation_revision_id
      LIMIT ?`,
  derivative: `SELECT storage.manifestation_derivative_id AS id, storage.object_key,
            storage.ciphertext_sha256, storage.ciphertext_bytes, storage.body_iv_base64,
            storage.wrapped_dek_base64, storage.wrap_iv_base64, storage.key_version,
            storage.aad_version, derivative.body_sha256, derivative.body_bytes,
            derivative.manifestation_revision_id, derivative.source_body_sha256
       FROM icono_manifestation_derivative_storage_secrets storage
       JOIN icono_manifestation_derivatives derivative
         ON derivative.manifestation_derivative_id = storage.manifestation_derivative_id
      WHERE storage.manifestation_derivative_id > ?
      ORDER BY storage.manifestation_derivative_id
      LIMIT ?`,
})

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function invalid(message) {
  return authorityError("INVALID_PLAINTEXT_CONVERSION_REQUEST", message, 400)
}

function describe(kind, row) {
  const storage = {
    object_key: row.object_key,
    ciphertext_sha256: row.ciphertext_sha256,
    ciphertext_bytes: row.ciphertext_bytes,
    body_iv_base64: row.body_iv_base64,
    wrapped_dek_base64: row.wrapped_dek_base64,
    wrap_iv_base64: row.wrap_iv_base64,
    key_version: row.key_version,
    aad_version: row.aad_version,
  }
  const ids =
    kind === "revision"
      ? {
          revisionId: row.id,
          geneId: row.gene_id,
          bodySha256: row.body_sha256,
          bodyBytes: Number(row.body_bytes),
        }
      : {
          derivativeId: row.id,
          revisionId: row.manifestation_revision_id,
          sourceBodySha256: row.source_body_sha256,
          bodySha256: row.body_sha256,
          bodyBytes: Number(row.body_bytes),
        }
  return { storage, ids }
}

// What a read shows now: "plain", "legacy" (the old envelope), "damaged",
// "missing" or "error".
async function observe(env, objectKey, storage, ids) {
  let stored
  try {
    stored = await readManifestationBodyObject(env, objectKey, { maxAttempts: 1 })
  } catch {
    return "error"
  }
  if (!stored) return "missing"
  return classifyManifestationBody(stored.bytes, storage, ids)
}

// Reads back until the object shows `expected` ("plain" after a conversion,
// "legacy" after a rollback), or the pauses run out. Returns the last observation.
async function readBack(env, objectKey, storage, ids, sleep, expected) {
  let seen = "error"
  for (const pause of READ_BACK_PAUSES_MS) {
    if (pause > 0) await sleep(pause)
    seen = await observe(env, objectKey, storage, ids)
    if (seen === expected) return seen
  }
  return seen
}

async function convertOne(env, kind, row, { execute, sleep }) {
  const { storage, ids } = describe(kind, row)
  let stored
  try {
    stored = await readManifestationBodyObject(env, row.object_key, { maxAttempts: 1 })
  } catch {
    return { status: "failed", code: "read" }
  }
  if (!stored) return { status: "failed", code: "object_missing" }
  const state = await classifyManifestationBody(stored.bytes, storage, ids)
  if (state === "plain") return { status: "plaintext" }
  if (state === "damaged") return { status: "failed", code: "integrity" }
  if (!execute) return { status: "legacy" }

  let plain
  try {
    plain = (
      await openManifestationBody(
        env,
        kind === "derivative" ? "tags" : "prose",
        stored.bytes,
        storage,
        ids,
      )
    ).bytes
  } catch {
    return { status: "failed", code: "decrypt" }
  }
  try {
    // One request, no retry: a refused write leaves the old object as it was.
    await writeManifestationBodyObject(env, row.object_key, plain, { maxAttempts: 1 })
  } catch {
    return { status: "failed", code: "write" }
  }

  const after = await readBack(env, row.object_key, storage, ids, sleep, "plain")
  if (after === "plain") return { status: "converted" }
  // Acknowledged but still serving the old bytes (Bunny's documented window),
  // or the read itself failed: both versions read correctly, so leave it and
  // let the next pass look again.
  if (after === "legacy" || after === "error") return { status: "unverified" }

  // The object is missing or is neither version. Put the old envelope back.
  try {
    await writeManifestationBodyObject(env, row.object_key, stored.bytes, { maxAttempts: 1 })
  } catch {
    return { status: "failed", code: "restore_failed" }
  }
  const restored = await readBack(env, row.object_key, storage, ids, sleep, "legacy")
  return { status: "failed", code: restored === "legacy" ? "rolled_back" : "restore_failed" }
}

export async function convertManifestationBodies(
  db,
  env,
  { kind, after = "", limit = PLAINTEXT_CONVERSION_DEFAULT_BODIES, execute = false, sleep } = {},
) {
  if (kind !== "revision" && kind !== "derivative") {
    throw invalid("kind must be revision or derivative")
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > PLAINTEXT_CONVERSION_MAX_BODIES) {
    throw invalid(`limit must be a whole number from 1 to ${PLAINTEXT_CONVERSION_MAX_BODIES}`)
  }
  const cursor = String(after ?? "")
  if (!/^[A-Za-z0-9_-]{0,128}$/.test(cursor)) throw invalid("after is not a row id")
  const pause = typeof sleep === "function" ? sleep : defaultSleep

  const page = await db.prepare(ROW_SELECT[kind]).bind(cursor, limit).all()
  const rows = Array.isArray(page?.results) ? page.results : []
  const outcomes = await Promise.all(
    rows.map((row) => convertOne(env, kind, row, { execute: execute === true, sleep: pause })),
  )

  const count = (status) => outcomes.filter((outcome) => outcome.status === status).length
  return {
    kind,
    execute: execute === true,
    scanned: rows.length,
    plaintext: count("plaintext"),
    converted: count("converted"),
    legacy: count("legacy"),
    unverified: count("unverified"),
    failed: outcomes.flatMap((outcome, index) =>
      outcome.status === "failed" ? [{ id: rows[index].id, code: outcome.code }] : [],
    ),
    next_after: rows.length ? rows[rows.length - 1].id : cursor,
    done: rows.length < limit,
    d1_rows_read: Number.isFinite(page?.meta?.rows_read) ? Number(page.meta.rows_read) : null,
  }
}
