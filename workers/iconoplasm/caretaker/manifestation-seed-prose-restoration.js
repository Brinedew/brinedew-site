// B-977: restores the full text of a seed manifestation that the cutover importer
// cut at 4,000 characters. It runs inside the Worker because only the Worker
// holds the private Bunny zone's password (and, until B-958 finishes, the key
// that opens an old Tags envelope). It is driven by
// scripts/restore-cropped-seed-prose.mjs, which holds the full texts. The route,
// this file, the script and the command in manifestation-write-commands.js go
// away together once a verify pass finds no cropped seed left (the same
// lifecycle as the B-859 plain-text conversion).
//
// WHAT THE SERVER PROVES. The caller is only a courier. Before anything is
// uploaded, the seed's current head revision must hash to exactly the first 4,000
// code points of the NORMALIZED new text (NFC, CRLF to LF), the new text must be
// longer than that, and it must pass the same normalization every save passes
// (10,000 code points, 16 KiB, no control characters). Text that is not the seed's
// own continuation is refused, so a wrong or tampered file cannot replace prose.
// A gene whose canonical revision is no longer the seed head (a caretaker saved
// or selected something) is skipped untouched.
//
// ONE GENE PER CALL, AND WHAT IT COSTS. A free-plan Worker may make 50 external
// fetches per invocation; D1 calls are not fetches (the plan allows 1,000 of
// them). Every storage call below passes maxAttempts: 1, so each is exactly one
// fetch. A gene costs, at worst:
//    1 read of the seed's accepted Tags object
//   18 for the new prose: 3 PUTs, each followed by up to 5 read-backs
//   18 for the new Tags object, the same way
//   37 in all, thirteen under the cap. A gene on which Bunny behaves costs 5
//      (read, PUT, read-back, PUT, read-back). Two genes would need 74, so the
//      cap for a call is 1.
// Three PUTs, not the six every other body write allows, is what makes the worst
// case fit. A body that Bunny will not serve within three tries is reported as
// failed with nothing committed; its upload intents and any stored object are
// released by the ordinary expired-upload sweep, and the next night's pass
// retries the gene.
//
// WHY THE TAGS ARE COPIED, NOT REGENERATED. The seed's accepted Tags were made
// from the full original text, so they are right for the restored text. The
// restore stores the same bytes under a new object key and accepts them as the
// new revision's Tags in the same batch. That is why a restored gene can still
// make images with no model call.
import { BUNNY_READ_AFTER_WRITE_DELAYS_MS } from "../../lib/bunny-storage-consistency.js"
import { openManifestationBody } from "../../lib/iconoplasm-manifestation-body-reader.js"
import {
  createManifestationBodyObjectKey,
  readManifestationBodyObject,
  writeManifestationBodyObject,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { normalizeManifestationProse } from "../../lib/iconoplasm-manifestation-prose.js"
import { sha256Hex } from "../../lib/iconoplasm-sha256.js"
import { authorityError, defaultIdFactory } from "./manifestation-authority-contract.js"
import { resolveGene } from "./manifestation-gene-resolver.js"
import {
  first,
  readHead,
  requireDatabase,
  resolveCommandReplay,
} from "./manifestation-authority-repository.js"
import { plainStorageDescriptor } from "./manifestation-storage-contract.js"
import {
  createManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"
import { readSeedForRestore, restoreCroppedSeedProse } from "./manifestation-write-commands.js"

// The importer's cut. The site's seeds are the first 4,000 code points of the
// original; the prose limit itself is larger now.
export const SEED_CROP_CODE_POINTS = 4000
export const SEED_RESTORE_PUT_ATTEMPTS = 3
export const SEED_RESTORE_WORST_CASE_FETCHES =
  1 + 2 * SEED_RESTORE_PUT_ATTEMPTS * (1 + BUNNY_READ_AFTER_WRITE_DELAYS_MS.length)

// Both reservations must outlive the slowest call: two bodies of three PUTs with
// 15 s of read-back pauses each is 90 s, and the adoption trigger refuses an
// intent whose lease has ended. The default lease is 2 minutes.
const UPLOAD_LEASE_MS = 5 * 60 * 1000

const ENCODER = new TextEncoder()
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function invalid(message) {
  return authorityError("INVALID_SEED_RESTORE_REQUEST", message, 400)
}

function unavailable(code, message) {
  return authorityError(code, message, 503)
}

// One PUT, then up to five read-backs; repeated up to SEED_RESTORE_PUT_ATTEMPTS
// times, each call exactly one fetch. A PUT Bunny refuses spends its attempt and
// the read-back that follows shows whether anything arrived.
async function putUntilVerified(env, objectKey, bytes, expectedSha256, { sleep, counter }) {
  for (let attempt = 1; attempt <= SEED_RESTORE_PUT_ATTEMPTS; attempt += 1) {
    counter.fetches += 1
    try {
      await writeManifestationBodyObject(env, objectKey, bytes, { maxAttempts: 1 })
    } catch {
      // The read-back below shows whether the object arrived anyway.
    }
    for (const delayMs of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
      if (delayMs > 0) await sleep(delayMs)
      counter.fetches += 1
      try {
        const stored = await readManifestationBodyObject(env, objectKey, { maxAttempts: 1 })
        if (
          stored &&
          stored.bytes.byteLength === bytes.byteLength &&
          (await sha256Hex(stored.bytes)) === expectedSha256
        ) {
          return { etag: stored.etag }
        }
      } catch {
        // Not readable yet.
      }
    }
  }
  return null
}

async function readCarriedTags(db, env, seedRevisionId, derivativeId, counter) {
  const row = await first(
    db,
    `SELECT derivative.source_body_sha256, derivative.body_sha256, derivative.body_bytes,
            storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
            storage.body_iv_base64, storage.wrapped_dek_base64, storage.wrap_iv_base64,
            storage.key_version, storage.aad_version
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_derivative_storage_secrets storage
         ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
      WHERE derivative.manifestation_derivative_id = ? AND derivative.status = 'complete'`,
    derivativeId,
  )
  if (!row) throw unavailable("SEED_TAGS_UNREADABLE", "The seed's accepted Tags have no body")
  counter.fetches += 1
  let stored
  try {
    stored = await readManifestationBodyObject(env, row.object_key, { maxAttempts: 1 })
  } catch {
    throw unavailable("SEED_TAGS_UNREADABLE", "The seed's Tags object could not be read")
  }
  if (!stored) throw unavailable("SEED_TAGS_UNREADABLE", "The seed's Tags object is missing")
  let opened
  try {
    opened = await openManifestationBody(env, "tags", stored.bytes, row, {
      derivativeId,
      revisionId: seedRevisionId,
      sourceBodySha256: row.source_body_sha256,
      bodySha256: row.body_sha256,
      bodyBytes: Number(row.body_bytes),
    })
  } catch {
    throw unavailable("SEED_TAGS_UNREADABLE", "The seed's Tags object failed its integrity check")
  }
  return { bytes: opened.bytes, body_sha256: row.body_sha256, body_bytes: Number(row.body_bytes) }
}

// Counts the rows the authority D1 reports it read and wrote through `run`, `all`
// and `batch` (D1's meta.rows_read and meta.rows_written, index entries included;
// `first` returns no meta). The operator script's canary night reads this to
// check its per-gene estimate against what the production D1 really billed.
function meterD1(db, meter) {
  const unwrap = new WeakMap()
  const add = (meta) => {
    meter.rows_written += Number(meta?.rows_written) || 0
    meter.rows_read += Number(meta?.rows_read) || 0
  }
  const wrap = (statement) => {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") return (...args) => wrap(target.bind(...args))
        if (property === "run" || property === "all") {
          return async (...args) => {
            const result = await target[property](...args)
            add(result?.meta)
            return result
          }
        }
        const value = target[property]
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    unwrap.set(proxy, statement)
    return proxy
  }
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (statements) => {
      const results = await db.batch(
        statements.map((statement) => unwrap.get(statement) ?? statement),
      )
      for (const result of results) add(result?.meta)
      return results
    },
  }
}

// Returns { status: "restored", ... } (the command's receipt plus the cost
// counters) or { status: "skipped_not_cropped", reason } or
// { status: "skipped_caretaker_canonical" }. Everything else throws an
// authorityError and has written no authority row.
export async function restoreSeedProseForGene(rawDb, env, options = {}) {
  requireDatabase(rawDb)
  const meter = { rows_written: 0, rows_read: 0 }
  const result = await restoreOne(meterD1(rawDb, meter), env, options)
  return { ...result, d1_rows_written: meter.rows_written, d1_rows_read: meter.rows_read }
}

async function restoreOne(
  db,
  env,
  { geneSymbol, prose: rawProse, command, sleep, idFactory = defaultIdFactory, now } = {},
) {
  const pause = typeof sleep === "function" ? sleep : defaultSleep
  const counter = { fetches: 0 }
  const actorKind = "migration"
  const replay = await resolveCommandReplay(db, command, { actorKind, actorAccountId: null })
  if (replay) return { ...replay, status: replay.status || "restored", bunny_fetches: 0 }

  let normalized
  try {
    normalized = normalizeManifestationProse(rawProse)
  } catch (error) {
    throw invalid(String(error?.message || "prose is invalid").slice(0, 200))
  }
  if (normalized.codePoints <= SEED_CROP_CODE_POINTS) {
    throw invalid(
      `prose must be longer than ${SEED_CROP_CODE_POINTS} characters to restore a cut seed`,
    )
  }
  const gene = await resolveGene(db, geneSymbol)
  if (gene.status !== "active") {
    throw authorityError("GENE_NOT_ACTIVE", "Gene is not active", 409)
  }
  const seed = await readSeedForRestore(db, gene.gene_id)
  if (!seed) throw authorityError("SEED_NOT_FOUND", "The gene has no active seed", 404)
  const head = await readHead(db, gene.gene_id)
  if (head.canonical_revision_id !== seed.manifestation_head_revision_id) {
    return { status: "skipped_caretaker_canonical", gene_id: gene.gene_id, bunny_fetches: 0 }
  }

  const cropText = Array.from(normalized.prose).slice(0, SEED_CROP_CODE_POINTS).join("")
  const cropSha256 = await sha256Hex(ENCODER.encode(cropText))
  if (seed.body_sha256 !== cropSha256) {
    const alreadyFull = seed.body_sha256 === (await sha256Hex(normalized.bytes))
    return {
      status: "skipped_not_cropped",
      reason: alreadyFull ? "already_full" : "different_text",
      gene_id: gene.gene_id,
      bunny_fetches: 0,
    }
  }
  const proseSha256 = await sha256Hex(normalized.bytes)

  const carried = seed.accepted_derivative_id
    ? await readCarriedTags(
        db,
        env,
        seed.manifestation_head_revision_id,
        seed.accepted_derivative_id,
        counter,
      )
    : null

  // Admission first, for both bodies, so a refused restore reserves and stores
  // nothing. The triggers enforce the same limit again at each insert.
  const state = await first(
    db,
    `SELECT body_admitted_bytes, body_reserved_bytes, body_admitted_limit_bytes
       FROM icono_authority_state WHERE singleton = 1`,
  )
  const planned = normalized.bytes.byteLength + (carried ? carried.body_bytes : 0)
  if (
    state &&
    Number(state.body_admitted_bytes) + Number(state.body_reserved_bytes) + planned >
      Number(state.body_admitted_limit_bytes)
  ) {
    throw authorityError(
      "AUTHORITY_BODY_QUOTA_EXCEEDED",
      "Authoring body capacity is temporarily exhausted",
      429,
    )
  }

  const revisionId = idFactory("revision")
  const derivativeId = carried ? idFactory("derivative") : null
  const proseKey = await createManifestationBodyObjectKey()
  const tagsKey = carried ? await createManifestationBodyObjectKey() : null
  await createManifestationUploadIntent(db, {
    entityKind: "revision",
    entityId: revisionId,
    objectKey: proseKey,
    ciphertextSha256: proseSha256,
    bodyBytes: normalized.bytes.byteLength,
    leaseMs: UPLOAD_LEASE_MS,
    actorKind,
    actorAccountId: null,
    idFactory,
    now,
  })
  if (carried) {
    await createManifestationUploadIntent(db, {
      entityKind: "derivative",
      entityId: derivativeId,
      objectKey: tagsKey,
      ciphertextSha256: carried.body_sha256,
      bodyBytes: carried.body_bytes,
      leaseMs: UPLOAD_LEASE_MS,
      actorKind,
      actorAccountId: null,
      idFactory,
      now,
    })
  }
  const proseUpload = await putUntilVerified(env, proseKey, normalized.bytes, proseSha256, {
    sleep: pause,
    counter,
  })
  if (!proseUpload) {
    throw unavailable("SEED_BODY_NOT_VERIFIED", "The restored text was not readable after 3 PUTs")
  }
  let tagsUpload = null
  if (carried) {
    tagsUpload = await putUntilVerified(env, tagsKey, carried.bytes, carried.body_sha256, {
      sleep: pause,
      counter,
    })
    if (!tagsUpload) {
      throw unavailable("SEED_BODY_NOT_VERIFIED", "The carried Tags were not readable after 3 PUTs")
    }
  }

  const result = await restoreCroppedSeedProse(db, {
    geneId: gene.gene_id,
    expectedSeedRevisionId: seed.manifestation_head_revision_id,
    expectedSeedBodySha256: seed.body_sha256,
    storage: plainStorageDescriptor(
      { body_sha256: proseSha256, body_bytes: normalized.bytes.byteLength },
      proseKey,
      proseUpload,
    ),
    tags: carried
      ? {
          storage: plainStorageDescriptor(
            { body_sha256: carried.body_sha256, body_bytes: carried.body_bytes },
            tagsKey,
            tagsUpload,
          ),
        }
      : null,
    revisionId,
    derivativeId,
    idFactory,
    now,
    ...command,
    actorKind,
    actorAccountId: null,
  })
  // A concurrent call with the same command id may have committed first; then
  // this call's uploads were never adopted and the sweep releases them.
  if (!result.replayed) {
    await requireAdoptedManifestationUpload(db, "revision", revisionId)
    if (carried) await requireAdoptedManifestationUpload(db, "derivative", derivativeId)
  }
  return { ...result, bunny_fetches: counter.fetches }
}
