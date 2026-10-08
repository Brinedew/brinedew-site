import assert from "node:assert/strict"

// Test-only. The real authority schema (every migration), the real command
// layer and a fake Bunny Storage zone, for the tests that prove body objects
// are written as plaintext, that legacy ciphertext objects still read, and that
// the one-shot conversion turns the second kind into the first (B-859).
import {
  createCaretakerManifestationHttpHandler,
  createManifestationAuthorityServiceHandler,
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  saveManifestationRevision,
  seedSystemManifestation,
  submitTagsDerivative,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import {
  canonicalManifestationFieldsJson,
  prepareManifestationTagsPayload,
} from "./manifestation-tags-payload.js"
import { createManifestationBodyObjectKey } from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  encryptLegacyProse,
  encryptLegacyTags,
  legacyKeyEnvironment,
} from "../../lib/iconoplasm-body-object-test-support.js"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"

export const NOW = "2026-10-03T00:00:00.000Z"
export const ADMIN = "account_admin_plain"
export const USER = "account_user_plain1"
export const TERMS = "terms_plain_0001"

const ZONE = "plaintext-test-zone"
const PASSWORD = "plaintext-test-password"

// `withKey: false` is the production Worker after the key secret is deleted.
export function bodyEnvironment({ withKey = true } = {}) {
  return {
    ICONOPLASM_AUTHORING_STORAGE_ZONE: ZONE,
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: PASSWORD,
    ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "1000",
    ...(withKey ? legacyKeyEnvironment() : {}),
  }
}

export function ids() {
  let sequence = 0
  return (prefix) => `${prefix}_${String(++sequence).padStart(12, "0")}`
}

// One counter for every handler in a test run: two handlers in one test must
// not mint the same revision id.
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
// tests build it. The seed is a real legacy envelope object, like the 19,245 the
// importer wrote at the cutover, so every body in the gene can be read.
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
  const seed = await encryptLegacyProse(bodyEnvironment(), {
    revisionId: seedRevisionId,
    geneId,
    prose: `The importer's seed manifestation for gene ${suffix}.`,
  })
  const seedObjectKey = await createManifestationBodyObjectKey()
  bunny.objects.set(seedObjectKey, seed.ciphertext)
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

// A revision exactly as production stored it before B-859: an encrypted object
// whose key is wrapped in the row. `first` marks the gene's first caretaker
// revision (a new lineage); later ones continue it.
export async function seedLegacyRevision(context, env, bunny, { name, prose, first = true }) {
  const revisionId = `revision_legacy_${name}`
  const encrypted = await encryptLegacyProse(env, { revisionId, geneId: context.geneId, prose })
  const objectKey = await createManifestationBodyObjectKey()

  bunny.objects.set(objectKey, encrypted.ciphertext)
  const manifestation = row(
    context.db,
    "SELECT manifestation_id, row_version FROM icono_manifestations WHERE caretaker_assignment_id = ?",
    context.assignmentId,
  )
  await saveManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: first ? 0 : Number(manifestation.row_version),
    expectedHeadVersion: Number(
      row(
        context.db,
        "SELECT head_version FROM icono_manifestation_heads WHERE gene_id = ?",
        context.geneId,
      ).head_version,
    ),
    expectedCanonicalRevisionId: row(
      context.db,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      context.geneId,
    ).canonical_revision_id,
    storage: {
      body_sha256: encrypted.body_sha256,
      body_bytes: encrypted.body_bytes,
      object_key: objectKey,
      ciphertext_sha256: encrypted.ciphertext_sha256,
      ciphertext_bytes: encrypted.ciphertext_bytes,
      body_iv_base64: encrypted.body_iv_base64,
      wrapped_dek_base64: encrypted.wrapped_dek_base64,
      wrap_iv_base64: encrypted.wrap_iv_base64,
      key_version: encrypted.key_version,
      aad_version: encrypted.aad_version,
      object_etag: '"fake-etag"',
      verified_at: NOW,
    },
    manifestationId: first ? `manifestation_legacy_${name}` : undefined,
    revisionId,
    selectionId: `selection_legacy_${name}`,
    eventUuid: `event_legacy_${name}`,
    now: NOW,
    ...command(`command_legacy_${name}`, "7", USER, "account"),
  })
  return { revisionId, objectKey, ...encrypted }
}

// A Tags body exactly as production stored it before B-859.
export async function seedLegacyTags(
  context,
  env,
  bunny,
  { name, revisionId, sourceBodySha256, tagsText, fieldsJson },
) {
  const derivativeId = `derivative_legacy_${name}`
  const prepared = await prepareManifestationTagsPayload({
    tagsText,
    tagsSha256: await sha256(tagsText),
    fieldsJson,
    fieldsSha256: await sha256(canonicalManifestationFieldsJson(fieldsJson)),
  })
  const encrypted = await encryptLegacyTags(env, {
    derivativeId,
    revisionId,
    sourceBodySha256,
    tags: prepared.output_plain,
  })
  const objectKey = await createManifestationBodyObjectKey()

  bunny.objects.set(objectKey, encrypted.ciphertext)
  await submitTagsDerivative(context.db, {
    revisionId,
    derivativeId,
    status: "complete",
    sourceBodySha256,
    tagsSha256: prepared.tags_sha256,
    tagsBytes: prepared.tags_bytes,
    fieldsSha256: prepared.fields_sha256,
    fieldsBytes: prepared.fields_bytes,
    storage: {
      body_sha256: encrypted.body_sha256,
      body_bytes: encrypted.body_bytes,
      object_key: objectKey,
      ciphertext_sha256: encrypted.ciphertext_sha256,
      ciphertext_bytes: encrypted.ciphertext_bytes,
      body_iv_base64: encrypted.body_iv_base64,
      wrapped_dek_base64: encrypted.wrapped_dek_base64,
      wrap_iv_base64: encrypted.wrap_iv_base64,
      key_version: encrypted.key_version,
      aad_version: encrypted.aad_version,
      object_etag: '"fake-etag"',
      verified_at: NOW,
    },
    recipeId: "legacy-tags",
    recipeVersion: "1",
    providerId: "test",
    modelId: "test",
    taggerConfigSha256: sha("9"),
    expectedGeneRevision: geneRevision(context),
    now: NOW,
    ...command(`command_legacy_tags_${name}`, "8", null, "service"),
  })
  return { derivativeId, objectKey, tags: prepared, ...encrypted }
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
