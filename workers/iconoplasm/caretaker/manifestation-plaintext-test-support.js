import assert from "node:assert/strict"

// Test-only. The real authority schema (every migration), the real command
// layer and a fake Bunny Storage zone, for the tests that prove body objects
// are written and read as plain text (B-859).
import {
  createCaretakerManifestationHttpHandler,
  createManifestationAuthorityServiceHandler,
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  seedSystemManifestation,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import { createManifestationBodyObjectKey } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { plainBodyObject } from "../../lib/iconoplasm-body-object-test-support.js"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"

export const NOW = "2026-10-03T00:00:00.000Z"
export const ADMIN = "account_admin_plain"
export const USER = "account_user_plain1"
export const TERMS = "terms_plain_0001"

const ZONE = "plaintext-test-zone"
const PASSWORD = "plaintext-test-password"

export function bodyEnvironment() {
  return {
    ICONOPLASM_AUTHORING_STORAGE_ZONE: ZONE,
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: PASSWORD,
    ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "1000",
  }
}

export function ids() {
  let sequence = 0
  return (prefix) => `${prefix}_${String(++sequence).padStart(12, "0")}`
}

// One counter for every handler in a test run: two handlers in one test must
// not mint the same revision or upload-intent id.
const sharedIds = ids()

// An in-memory Bunny Storage zone. `rules` run first and may answer a request
// themselves, which is how a test makes a write fail, store garbage or read
// back stale bytes. Every request is logged by method and object key.
export function installBunnyFake(t) {
  const originalFetch = globalThis.fetch
  const objects = new Map()
  const log = []
  const rules = []
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase()
    const prefix = `/${ZONE}/`
    const pathname = new URL(String(url)).pathname
    const objectKey = pathname.slice(pathname.indexOf(prefix) + prefix.length)
    log.push({ method, objectKey })
    for (const rule of rules) {
      const answer = await rule({ method, objectKey, init, objects })
      if (answer) return answer
    }
    if (method === "PUT") {
      objects.set(objectKey, Uint8Array.from(init.body))
      return new Response(null, { status: 201, headers: { etag: '"fake-etag"' } })
    }
    if (method === "DELETE") {
      objects.delete(objectKey)
      return new Response(null, { status: 200 })
    }
    const bytes = objects.get(objectKey)
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"fake-etag"' } })
      : new Response(null, { status: 404 })
  }
  return {
    objects,
    log,
    rules,
    count: (method) => log.filter((entry) => entry.method === method).length,
    clearLog: () => log.splice(0),
  }
}

// One gene with a system-seed revision and an active caretaker, as the server
// tests build it. The seed is a plain body object, so every body in the gene
// can be read.
export async function bootstrap(t, suffix, bunny) {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, {
    accountId: ADMIN,
    publicCreditLabel: "Plain admin",
    now: NOW,
  })
  await registerAuthorityAccount(db, {
    accountId: USER,
    publicCreditLabel: "Plain caretaker",
    now: NOW,
  })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Caretaker terms - test",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  const geneId = `gene_plain_${suffix}`
  const assignmentId = `assignment_plain_${suffix}`
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `P${suffix}`, now: NOW })
  const seedRevisionId = `revision_seed_${suffix}`
  const seed = await plainBodyObject(`The importer's seed manifestation for gene ${suffix}.`)
  const seedObjectKey = await createManifestationBodyObjectKey()
  bunny.objects.set(seedObjectKey, seed.bytes)
  await seedSystemManifestation(db, {
    geneId,
    storage: {
      body_sha256: seed.body_sha256,
      body_bytes: seed.body_bytes,
      object_key: seedObjectKey,
      ciphertext_sha256: seed.ciphertext_sha256,
      ciphertext_bytes: seed.ciphertext_bytes,
      body_iv_base64: seed.body_iv_base64,
      wrapped_dek_base64: seed.wrapped_dek_base64,
      wrap_iv_base64: seed.wrap_iv_base64,
      key_version: seed.key_version,
      aad_version: seed.aad_version,
      object_etag: '"fake-etag"',
      verified_at: NOW,
    },
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: `manifestation_seed_${suffix}`,
    revisionId: seedRevisionId,
    selectionId: `selection_seed_${suffix}`,
    eventUuid: `event_seed_${suffix}`,
    now: NOW,
    ...command(`command_seed_${suffix}`, "1", null, "migration"),
  })
  await offerCaretakerAssignment(db, {
    geneId,
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId,
    eventUuid: `event_offer_${suffix}`,
    now: NOW,
    ...command(`command_offer_${suffix}`, "2", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: `event_accept_${suffix}`,
    now: NOW,
    ...command(`command_accept_${suffix}`, "3", USER, "account"),
  })
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  return { db, geneId, assignmentId, suffix, seedRevisionId, seed, seedObjectKey }
}

export function headState(context) {
  const head = row(
    context.db,
    "SELECT head_version, canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
    context.geneId,
  )
  return {
    expectedHeadVersion: Number(head.head_version),
    expectedCanonicalRevisionId: head.canonical_revision_id,
  }
}

export function geneRevision(context) {
  return row(
    context.db,
    "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
    context.geneId,
  ).gene_revision
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Buffer.from(digest).toString("hex")
}

export function serviceRequest(path, body = null) {
  return new Request(`https://iconoplasm.test${path}`, {
    method: body == null ? "GET" : "POST",
    headers:
      body == null
        ? { authorization: "Bearer test-service" }
        : { authorization: "Bearer test-service", "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  })
}

export function browserRequest(path, body, { method = "POST" } = {}) {
  return new Request(`https://iconoplasm.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://iconoplasm.test",
      "sec-fetch-site": "same-origin",
    },
    body: body == null ? undefined : JSON.stringify(body),
  })
}

export function humanHandler(context, env, extra = {}) {
  return createCaretakerManifestationHttpHandler({
    db: context.db,
    env,
    cursorSecret: "c".repeat(32),
    resolveSession: async () => ({ account_id: USER }),
    idFactory: sharedIds,
    ...extra,
  })
}

export function workstationHandler(context, env, extra = {}) {
  return createManifestationAuthorityServiceHandler({
    db: context.db,
    env,
    authorizeReplicaBearer: async () => ({ authorized: true, actor_kind: "service" }),
    idFactory: sharedIds,
    ...extra,
  })
}

export async function readJson(response, expectedStatus = 200) {
  const value = await response.json()
  assert.equal(response.status, expectedStatus, JSON.stringify(value))
  return value
}

// A caretaker save answers 200, or 202 when the projection to the primary
// database is still pending; either way the version is committed.
export async function saveProse(handler, symbol, commandId, prose, manifestationVersion = 0) {
  const response = await handler(
    browserRequest(`/api/iconoplasm/caretaker/genes/${symbol}/revisions`, {
      command_id: commandId,
      prose,
      expected_assignment_version: 2,
      expected_manifestation_version: manifestationVersion,
    }),
  )
  const value = await response.json()
  assert.ok([200, 202].includes(response.status), `save answered ${response.status}`)
  return value
}

export function lineageVersion(context, manifestationId) {
  return Number(
    row(
      context.db,
      "SELECT row_version FROM icono_manifestations WHERE manifestation_id = ?",
      manifestationId,
    ).row_version,
  )
}

export { command, row, sha, storage, TestD1 }
