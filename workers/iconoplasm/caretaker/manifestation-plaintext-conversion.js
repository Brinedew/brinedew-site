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
// Bunny can acknowledge a PUT and keep serving the old object (see
// bunny-storage-consistency.js). The first night's single PUT per body left
// 1,499 of 1,500 bodies as envelopes, so a body is written the way every other
// body write is: the identical PUT is repeated until a read shows the plain
// text, up to BUNNY_IDEMPOTENT_PUT_ATTEMPTS times, with the shared
// read-after-write delays between the reads.
//
// One call converts ONE body, because of the free plan's 50 external fetches per
// invocation (D1 calls and the admin check are not fetches). Every storage call
// below passes maxAttempts: 1, so each one is exactly one fetch. One body costs,
// at worst:
//   1 read of the object as it stands
//   6 PUTs (BUNNY_IDEMPOTENT_PUT_ATTEMPTS)
//  30 read-backs (BUNNY_READ_AFTER_WRITE_DELAYS_MS has 5 delays, one read each,
//     after every PUT)
//   4 rollback fetches (one PUT and three reads), only when the last read shows
//     a missing or damaged object
//  41 in all, nine under the cap. A body that converts on the first PUT costs 3.
// Two bodies at the worst case would need 82, so the cap for a writing call is 1.
// A check call (no writes) makes one read per body, so it may scan up to
// PLAINTEXT_CHECK_MAX_BODIES; that stays small because the stateful Worker has
// almost no CPU headroom on the free plan (the Tags republish lost 19% of its
// calls to the 10 ms cap on 2026-10-03).
import {
  BUNNY_IDEMPOTENT_PUT_ATTEMPTS,
  BUNNY_READ_AFTER_WRITE_DELAYS_MS,
  putBunnyObjectUntilVerified,
} from "../../lib/bunny-storage-consistency.js"
import {
  classifyManifestationBody,
  openManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-reader.js"
import {
  readManifestationBodyObject,
  writeManifestationBodyObject,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { authorityError } from "./manifestation-authority-contract.js"

export const PLAINTEXT_CONVERSION_MAX_BODIES = 1
export const PLAINTEXT_CONVERSION_DEFAULT_BODIES = 1
export const PLAINTEXT_CHECK_MAX_BODIES = 10

// After the last PUT is still unreadable as plain text, an object that reads as
// missing or as neither version is put back as the old envelope: one PUT, then up
// to three reads.
const ROLLBACK_READ_PAUSES_MS = Object.freeze([0, 1500, 3000])

export const PLAINTEXT_CONVERSION_WORST_CASE_FETCHES =
  1 +
  BUNNY_IDEMPOTENT_PUT_ATTEMPTS * (1 + BUNNY_READ_AFTER_WRITE_DELAYS_MS.length) +
  (1 + ROLLBACK_READ_PAUSES_MS.length)

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

// Reads back after a rollback until the object shows the old envelope again, or
// the pauses run out. Returns the last observation.
async function readBackRollback(env, objectKey, storage, ids, sleep) {
  let seen = "error"
  for (const pause of ROLLBACK_READ_PAUSES_MS) {
    if (pause > 0) await sleep(pause)
    seen = await observe(env, objectKey, storage, ids)
    if (seen === "legacy") return seen
  }
  return seen
}

async function convertOne(env, kind, row, { execute, sleep }) {
  const { storage, ids } = describe(kind, row)
  let stored
  try {
    stored = await readManifestationBodyObject(env, row.object_key, { maxAttempts: 1 })
  } catch {
    return { status: "failed", code: "read", puts: 0 }
  }
  if (!stored) return { status: "failed", code: "object_missing", puts: 0 }
  const state = await classifyManifestationBody(stored.bytes, storage, ids)
  if (state === "plain") return { status: "plaintext", puts: 0 }
  if (state === "damaged") return { status: "failed", code: "integrity", puts: 0 }
  if (!execute) return { status: "legacy", puts: 0 }

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
    return { status: "failed", code: "decrypt", puts: 0 }
  }

  // Repeat the identical PUT until a read shows the plain text. A refused PUT
  // spends one of the attempts and leaves the object as it was; the read that
  // follows shows whether anything changed.
  let puts = 0
  let accepted = 0
  let seen = "error"
  const put = async () => {
    puts += 1
    try {
      await writeManifestationBodyObject(env, row.object_key, plain, { maxAttempts: 1 })
      accepted += 1
    } catch {
      // see above
    }
  }
  const verify = async () => {
    for (const pause of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
      if (pause > 0) await sleep(pause)
      seen = await observe(env, row.object_key, storage, ids)
      if (seen === "plain") return true
    }
    return null
  }
  if (await putBunnyObjectUntilVerified({ put, verify })) return { status: "converted", puts }

  // Both versions read correctly, so an object that still shows the old bytes
  // (Bunny's documented window), or whose reads failed, is safe: report it and
  // let a later pass look again. When Bunny never accepted a PUT, say so.
  if (seen === "legacy" || seen === "error") {
    return accepted === 0
      ? { status: "failed", code: "write", puts }
      : { status: "unverified", puts }
  }

  // The object is missing or is neither version. Put the old envelope back.
  try {
    await writeManifestationBodyObject(env, row.object_key, stored.bytes, { maxAttempts: 1 })
  } catch {
    return { status: "failed", code: "restore_failed", puts }
  }
  const restored = await readBackRollback(env, row.object_key, storage, ids, sleep)
  return {
    status: "failed",
    code: restored === "legacy" ? "rolled_back" : "restore_failed",
    puts,
  }
}

export async function convertManifestationBodies(
  db,
  env,
  { kind, after = "", limit = PLAINTEXT_CONVERSION_DEFAULT_BODIES, execute = false, sleep } = {},
) {
  if (kind !== "revision" && kind !== "derivative") {
    throw invalid("kind must be revision or derivative")
  }
  const maxLimit = execute === true ? PLAINTEXT_CONVERSION_MAX_BODIES : PLAINTEXT_CHECK_MAX_BODIES
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw invalid(
      `limit must be a whole number from 1 to ${maxLimit}${execute === true ? " when writing" : ""}`,
    )
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
    unverified_ids: outcomes.flatMap((outcome, index) =>
      outcome.status === "unverified" ? [rows[index].id] : [],
    ),
    puts: outcomes.reduce((sum, outcome) => sum + outcome.puts, 0),
    failed: outcomes.flatMap((outcome, index) =>
      outcome.status === "failed" ? [{ id: rows[index].id, code: outcome.code }] : [],
    ),
    next_after: rows.length ? rows[rows.length - 1].id : cursor,
    done: rows.length < limit,
    d1_rows_read: Number.isFinite(page?.meta?.rows_read) ? Number(page.meta.rows_read) : null,
  }
}
