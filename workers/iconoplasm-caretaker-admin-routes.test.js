import assert from "node:assert/strict"
import test from "node:test"

import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  createIconoplasmCaretakerAdminHandlers,
} from "./iconoplasm-caretaker-admin-routes.js"
import {
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  seedSystemManifestation,
  transitionCaretakerAssignment,
} from "./iconoplasm/caretaker/manifestation-authority.js"
import {
  TestD1,
  command,
  sha,
  storage,
} from "./iconoplasm/caretaker/manifestation-authority-test-support.js"
import {
  bodyEnvironment,
  bootstrap as bootstrapLegacyGene,
  installBunnyFake,
} from "./iconoplasm/caretaker/manifestation-plaintext-test-support.js"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const NOW = "2026-08-30T00:00:00.000Z"
const ADMIN = "account_admin_routes"
const USER = "account_user_routes1"
const TERMS = "terms_routes_0001"

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function mutationRequest(path, body) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  })
}

function handlers(db, wakeCalls = []) {
  return createIconoplasmCaretakerAdminHandlers({
    isAdmin: async () => true,
    json,
    resolveActiveAccount: async () => ({ account_id: ADMIN }),
    wakeAuthorityProjection: async (_env, event) => {
      wakeCalls.push(event.event_id)
      return { ok: true, results: [{ event_id: event.event_id, status: "published" }] }
    },
  })
}

async function call(handler, { request, routeId, params = {}, db }) {
  return handler({
    match: { route: { id: routeId }, params },
    request,
    env: { ICONOPLASM_AUTHORING_DB: db },
    done: (_name, response) => response,
  })
}

async function bootstrap(t, suffix, { accepted = false } = {}) {
  const db = new TestD1()
  t.after(() => db.close())
  const geneId = `gene_admin_${suffix}`
  const assignmentId = `assignment_admin_${suffix}`
  const seedRevisionId = `revision_seed_admin_${suffix}`
  await registerAuthorityAccount(db, {
    accountId: ADMIN,
    publicCreditLabel: "Brinedew administrator",
    now: NOW,
  })
  await registerAuthorityAccount(db, {
    accountId: USER,
    publicCreditLabel: "Caretaker specimen",
    now: NOW,
  })
  await registerGeneIdentity(db, {
    geneId,
    canonicalSymbol: `A${suffix}`,
    now: NOW,
  })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Caretaker terms - 30 August 2026",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  await seedSystemManifestation(db, {
    geneId,
    storage: storage(1),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: `manifestation_seed_admin_${suffix}`,
    revisionId: seedRevisionId,
    selectionId: `selection_seed_admin_${suffix}`,
    eventUuid: `event_seed_admin_${suffix}`,
    now: NOW,
    ...command(`command_seed_admin_${suffix}`, "1", null, "migration"),
  })
  if (accepted) {
    await offerCaretakerAssignment(db, {
      geneId,
      accountId: USER,
      invitedByAccountId: ADMIN,
      entitlementPolicyVersion: CARETAKER_ENTITLEMENT_POLICY_VERSION,
      expectedGeneRevision: 1,
      assignmentId,
      eventUuid: `event_offer_admin_${suffix}`,
      now: NOW,
      ...command(`command_offer_admin_${suffix}`, "2", ADMIN, "administrator"),
    })
    await transitionCaretakerAssignment(db, {
      assignmentId,
      action: "accept",
      expectedAssignmentVersion: 1,
      termsVersionId: TERMS,
      relinquishPolicy: "retain",
      eventUuid: `event_accept_admin_${suffix}`,
      now: NOW,
      ...command(`command_accept_admin_${suffix}`, "3", USER, "account"),
    })
  }
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  return { assignmentId, db, geneId, seedRevisionId }
}

test("admin discovery returns stable IDs, exact current head state, and server-owned policy", async (t) => {
  const context = await bootstrap(t, "8101", { accepted: true })
  const api = handlers(context.db)

  const termsResponse = await call(api["caretaker_admin.terms"], {
    request: new Request(`${ORIGIN}/api/iconoplasm/admin/caretakers/terms`),
    routeId: "caretaker_admin_terms",
    db: context.db,
  })
  const terms = await termsResponse.json()
  assert.equal(terms.entitlement_policy_version, CARETAKER_ENTITLEMENT_POLICY_VERSION)
  assert.deepEqual(terms.terms[0], {
    terms_version_id: TERMS,
    document_sha256: sha("f"),
    document_url: "https://iconoplasm.brinedew.bio/caretaker-terms",
    display_label: "Caretaker terms - 30 August 2026",
    effective_at: NOW,
    retired_at: null,
  })

  const accountsResponse = await call(api["caretaker_admin.accounts"], {
    request: new Request(`${ORIGIN}/api/iconoplasm/admin/caretakers/accounts?query=specimen`),
    routeId: "caretaker_admin_accounts",
    db: context.db,
  })
  assert.deepEqual((await accountsResponse.json()).accounts, [
    {
      account_id: USER,
      author_label: "Caretaker specimen",
      status: "active",
    },
  ])

  const genesResponse = await call(api["caretaker_admin.genes"], {
    request: new Request(`${ORIGIN}/api/iconoplasm/admin/caretakers/genes?query=A8101`),
    routeId: "caretaker_admin_genes",
    db: context.db,
  })
  const genes = (await genesResponse.json()).genes
  assert.equal(genes.length, 1)
  assert.equal(genes[0].gene_id, context.geneId)
  assert.equal(genes[0].canonical_revision_id, context.seedRevisionId)
  assert.equal(genes[0].open_assignment_status, "active")

  const registryResponse = await call(api["caretaker_admin.registry"], {
    request: new Request(
      `${ORIGIN}/api/iconoplasm/admin/caretakers/registry?status=active&limit=1`,
    ),
    routeId: "caretaker_admin_registry",
    db: context.db,
  })
  const registry = await registryResponse.json()
  assert.equal(registry.assignments[0].caretaker_assignment_id, context.assignmentId)
  assert.equal(registry.assignments[0].account_id, USER)
  assert.equal(registry.assignments[0].head_version, 1)
  assert.equal(registry.assignments[0].gene_revision, 3)
  assert.equal(registry.next_cursor, null)
})

test("offer rejects browser-invented policy and replays without repeating completed projection", async (t) => {
  const context = await bootstrap(t, "8102")
  const wakeCalls = []
  const api = handlers(context.db, wakeCalls)
  const path = "/api/iconoplasm/admin/caretakers/offers"
  const baseBody = {
    command_id: "command_admin_offer_8102",
    gene_id: context.geneId,
    account_id: USER,
    expected_gene_revision: 1,
  }

  const mismatchResponse = await call(api["caretaker_admin.mutate"], {
    request: mutationRequest(path, {
      ...baseBody,
      entitlement_policy_version: "browser_invented_v9",
    }),
    routeId: "caretaker_admin_offer",
    db: context.db,
  })
  assert.equal(mismatchResponse.status, 409)
  assert.equal((await mismatchResponse.json()).error.code, "ENTITLEMENT_POLICY_VERSION_MISMATCH")

  const body = {
    ...baseBody,
    entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
  }
  const acceptedResponse = await call(api["caretaker_admin.mutate"], {
    request: mutationRequest(path, body),
    routeId: "caretaker_admin_offer",
    db: context.db,
  })
  const accepted = await acceptedResponse.json()
  assert.equal(acceptedResponse.status, 200)
  assert.equal(accepted.status, "pending_acceptance")
  assert.equal(accepted.replayed, false)

  const replayResponse = await call(api["caretaker_admin.mutate"], {
    request: mutationRequest(path, body),
    routeId: "caretaker_admin_offer",
    db: context.db,
  })
  const replay = await replayResponse.json()
  assert.equal(replayResponse.status, 200)
  assert.equal(replay.projection_pending, undefined)
  assert.equal(replay.replayed, true)
  assert.equal(replay.caretaker_assignment_id, accepted.caretaker_assignment_id)
  assert.equal(
    context.db.raw
      .prepare("SELECT count(*) AS total FROM icono_caretaker_assignments WHERE gene_id = ?")
      .get(context.geneId).total,
    1,
  )
  assert.equal(wakeCalls.length, 1)
})

test("administrator suspend, resume, and end preserve independent CAS tokens", async (t) => {
  const context = await bootstrap(t, "8103", { accepted: true })
  const api = handlers(context.db)
  const basePath = `/api/iconoplasm/admin/caretakers/assignments/${context.assignmentId}`

  const suspendResponse = await call(api["caretaker_admin.mutate"], {
    request: mutationRequest(`${basePath}/suspend`, {
      command_id: "command_admin_suspend_8103",
      expected_assignment_version: 2,
      suspension_reason: "Policy review",
    }),
    routeId: "caretaker_admin_assignment_action",
    params: { assignment_id: context.assignmentId, action: "suspend" },
    db: context.db,
  })
  const suspended = await suspendResponse.json()
  assert.equal(suspended.status, "suspended")
  assert.equal(suspended.assignment_version, 3)

  const resumeResponse = await call(api["caretaker_admin.mutate"], {
    request: mutationRequest(`${basePath}/resume`, {
      command_id: "command_admin_resume_8103",
      expected_assignment_version: 3,
    }),
    routeId: "caretaker_admin_assignment_action",
    params: { assignment_id: context.assignmentId, action: "resume" },
    db: context.db,
  })
  const resumed = await resumeResponse.json()
  assert.equal(resumed.status, "active")
  assert.equal(resumed.assignment_version, 4)

  const endResponse = await call(api["caretaker_admin.mutate"], {
    request: mutationRequest(`${basePath}/end`, {
      command_id: "command_admin_end_8103",
      expected_assignment_version: 4,
      expected_head_version: 1,
      expected_canonical_revision_id: context.seedRevisionId,
      relinquish_policy: "retain",
      reason: "Administrator ended tenure",
    }),
    routeId: "caretaker_admin_assignment_action",
    params: { assignment_id: context.assignmentId, action: "end" },
    db: context.db,
  })
  const ended = await endResponse.json()
  assert.equal(ended.status, "ended")
  assert.equal(ended.assignment_version, 5)
  assert.equal(ended.relinquish_policy, "retain")
})

test("irreversible and suspending transitions require a bounded administrator reason", async (t) => {
  const context = await bootstrap(t, "8105", { accepted: true })
  const api = handlers(context.db)
  const basePath = `/api/iconoplasm/admin/caretakers/assignments/${context.assignmentId}`
  const invalidReasons = [undefined, "   ", "x".repeat(501)]
  for (const [index, reason] of invalidReasons.entries()) {
    const response = await call(api["caretaker_admin.mutate"], {
      request: mutationRequest(`${basePath}/suspend`, {
        command_id: `command_admin_bad_suspend_8105_${index}`,
        expected_assignment_version: 2,
        ...(reason === undefined ? {} : { suspension_reason: reason }),
      }),
      routeId: "caretaker_admin_assignment_action",
      params: { assignment_id: context.assignmentId, action: "suspend" },
      db: context.db,
    })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: {
        code: "ADMINISTRATOR_REASON_REQUIRED",
        message: "suspension_reason must contain between 1 and 500 characters",
      },
    })
  }
  for (const [index, reason] of invalidReasons.entries()) {
    const response = await call(api["caretaker_admin.mutate"], {
      request: mutationRequest(`${basePath}/end`, {
        command_id: `command_admin_bad_end_8105_${index}`,
        expected_assignment_version: 2,
        expected_head_version: 1,
        expected_canonical_revision_id: context.seedRevisionId,
        relinquish_policy: "retain",
        ...(reason === undefined ? {} : { reason }),
      }),
      routeId: "caretaker_admin_assignment_action",
      params: { assignment_id: context.assignmentId, action: "end" },
      db: context.db,
    })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: {
        code: "ADMINISTRATOR_REASON_REQUIRED",
        message: "reason must contain between 1 and 500 characters",
      },
    })
  }
})

test("admin mutation requires strict same-origin browser metadata", async (t) => {
  const context = await bootstrap(t, "8104")
  const api = handlers(context.db)
  const request = new Request(`${ORIGIN}/api/iconoplasm/admin/caretakers/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command_id: "command_bad_origin_8104" }),
  })
  const response = await call(api["caretaker_admin.mutate"], {
    request,
    routeId: "caretaker_admin_offer",
    db: context.db,
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, "STRICT_SAME_ORIGIN_REQUIRED")
})

// B-859: the administrator's one slice of the rewrite of legacy envelope body
// objects as plain text. The conversion itself is tested in
// manifestation-plaintext-conversion.test.js; this is the door in front of it.
// A call that writes converts one body (the free plan's 50 fetches); a call that
// only reads scans up to ten.
test("the plaintext conversion route is administrator-only, bounded, and returns counts, never text", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrapLegacyGene(t, "8301", bunny)
  const env = { ICONOPLASM_AUTHORING_DB: context.db, ...bodyEnvironment() }
  const services = (isAdmin) => ({
    isAdmin: async () => isAdmin,
    json,
    resolveActiveAccount: async () => ({ account_id: ADMIN }),
    wakeAuthorityProjection: async () => ({ ok: true, results: [] }),
    sleep: async () => {},
  })
  const route = (isAdmin, body) =>
    createIconoplasmCaretakerAdminHandlers(services(isAdmin))["caretaker_admin.plaintext_bodies"]({
      request: new Request(`${ORIGIN}/api/iconoplasm/admin/caretakers/plaintext-bodies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
      done: (_name, response) => response,
    })
  const original = Uint8Array.from(bunny.objects.get(context.seedObjectKey))

  const denied = await route(false, { kind: "revision", execute: true })
  assert.equal(denied.status, 403)
  assert.equal(bunny.log.length, 0, "an unauthorised call touches no storage")

  for (const body of [
    {},
    { kind: "tags" },
    { kind: "revision", limit: 11 },
    { kind: "revision", limit: 2, execute: true },
    { kind: "revision", limit: 0 },
    { kind: "revision", after: "x; DROP TABLE y" },
  ]) {
    const refused = await route(true, body)
    assert.equal(refused.status, 400, JSON.stringify(body))
  }
  assert.equal(bunny.log.length, 0, "a refused call touches no storage")

  // Check mode finds the one envelope (the seed) and writes nothing.
  const checked = await route(true, { kind: "revision", limit: 5 })
  assert.equal(checked.status, 200)
  const check = await checked.json()
  assert.equal(check.ok, true)
  assert.deepEqual([check.scanned, check.legacy, check.converted, check.done], [1, 1, 0, true])
  assert.deepEqual(bunny.objects.get(context.seedObjectKey), original)

  // Execute mode rewrites it, and the answer carries no body text.
  const executed = await route(true, { kind: "revision", execute: true })
  assert.equal(executed.status, 200)
  const text = JSON.stringify(await executed.json())
  assert.equal(text.includes(context.seed.prose), false)
  assert.equal(
    new TextDecoder().decode(bunny.objects.get(context.seedObjectKey)),
    context.seed.prose,
  )
})
