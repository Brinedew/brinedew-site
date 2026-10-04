// B-995: the caretaker taggerizer route, driven through the real caretaker HTTP
// handler and real SQLite (TestD1). Only `env.AI.run` is faked, because a live
// Workers AI call is the one thing a test must not spend allowance on.
//
// Ways this feature can fail, written before the tests:
//  1. A person who is not the gene's caretaker gets a suggestion and spends the
//     account's shared free AI allowance. Must be refused with no AI call.
//  2. The suggestion has a shape the existing Tags save rejects (wrong key names,
//     numbers, more than 6 tags, a retired category), so the caretaker's "Save"
//     fails after a long wait. Proved by saving the suggestion in the same test.
//  3. The model answers with text that is not JSON and the route answers 500
//     (or fills garbage in). Must be a plain 502 sentence and no change.
//  4. One caretaker spends the whole daily allowance. The 31st call in a UTC day
//     must be refused with a retry time, without calling the AI.
//  5. The kill switch is set but the route still calls the AI.
//  6. Cloudflare says the free daily allowance is used up and the caretaker sees a
//     raw error code instead of a sentence and a retry time.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  createCaretakerManifestationHttpHandler,
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  seedSystemManifestation,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"
import { TAGGERIZER_DAILY_LIMIT, TAGGERIZER_MESSAGES, TAGGERIZER_MODEL } from "./taggerizer.js"

const NOW = "2026-10-04T12:00:00.000Z"
const ADMIN = "account_admin_tagger"
const USER = "account_user_tagger1"
const OTHER = "account_other_tagger"
const TERMS = "terms_tagger_0001"
const GENE = "gene_tagger_0001"
const SYMBOL = "TAGGER1"
const BASE = `/api/iconoplasm/caretaker/genes/${SYMBOL}`

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
}

function environment(extra = {}) {
  return {
    ICONOPLASM_AUTHORING_BODY_KEK_V1: base64(new Uint8Array(32).fill(11)),
    ICONOPLASM_AUTHORING_STORAGE_ZONE: "tagger-test-zone",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "tagger-test-password",
    ICONOPLASM_TAGGERIZER_DISABLED: "0",
    ...extra,
  }
}

// Body storage is Bunny over fetch; keep the objects in memory.
function installMemoryBodyStorage(t) {
  const originalFetch = globalThis.fetch
  const objects = new Map()
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url)
    const method = String(init.method || "GET").toUpperCase()
    if (method === "PUT") {
      objects.set(key, Uint8Array.from(init.body))
      return new Response(null, { status: 201, headers: { etag: '"test-etag"' } })
    }
    if (method === "DELETE") {
      objects.delete(key)
      return new Response(null, { status: 200 })
    }
    const bytes = objects.get(key)
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"test-etag"' } })
      : new Response(null, { status: 404 })
  }
}

function ids() {
  let sequence = 0
  return (prefix) => `${prefix}_${String(++sequence).padStart(12, "0")}`
}

function post(path, body) {
  return new Request(`https://iconoplasm.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://iconoplasm.test",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  })
}

function modelReply(value) {
  return { choices: [{ message: { content: JSON.stringify(value) } }] }
}

async function bootstrap(t, { aiReply, session = USER, env = {} } = {}) {
  installMemoryBodyStorage(t)
  const db = new TestD1()
  const primaryDb = new TestD1()
  t.after(() => {
    db.close()
    primaryDb.close()
  })
  primaryDb.raw.exec(
    readFileSync(
      new URL("../../../migrations-iconoplasm/0115_taggerizer_daily_calls.sql", import.meta.url),
      "utf8",
    ),
  )
  for (const accountId of [ADMIN, USER, OTHER]) {
    await registerAuthorityAccount(db, {
      accountId,
      publicCreditLabel: "Tagger test credit",
      now: NOW,
    })
  }
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Caretaker terms",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  await registerGeneIdentity(db, { geneId: GENE, canonicalSymbol: SYMBOL, now: NOW })
  await seedSystemManifestation(db, {
    geneId: GENE,
    storage: storage(1),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: "manifestation_seed_tagger",
    revisionId: "revision_seed_tagger",
    selectionId: "selection_seed_tagger",
    eventUuid: "event_seed_tagger",
    now: NOW,
    ...command("command_seed_tagger", "1", null, "migration"),
  })
  await offerCaretakerAssignment(db, {
    geneId: GENE,
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: "assignment_tagger_0001",
    eventUuid: "event_offer_tagger",
    now: NOW,
    ...command("command_offer_tagger", "2", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId: "assignment_tagger_0001",
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: "event_accept_tagger",
    now: NOW,
    ...command("command_accept_tagger", "3", USER, "account"),
  })
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  const calls = []
  const AI = {
    async run(model, input) {
      calls.push({ model, input })
      if (aiReply instanceof Error) throw aiReply
      return typeof aiReply === "function" ? aiReply(input) : aiReply
    },
  }
  const handler = createCaretakerManifestationHttpHandler({
    db,
    primaryDb,
    env: environment({ AI, ...env }),
    resolveSession: async () => ({ account_id: session }),
    idFactory: ids(),
    now: () => NOW,
  })
  return { db, primaryDb, handler, calls }
}

const PROSE = "A tall archivist in a red coat with a careful gaze and ink-stained gloves."

test("a person who is not the gene's caretaker is refused and the AI is never called", async (t) => {
  const { handler, calls, primaryDb } = await bootstrap(t, {
    session: OTHER,
    aiReply: modelReply({ outfit: ["red_coat"] }),
  })
  const response = await handler(
    post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
  )
  assert.equal(response.status, 404)
  assert.equal(calls.length, 0)
  assert.equal(row(primaryDb, "SELECT count(*) AS n FROM icono_taggerizer_daily_calls").n, 0)
})

test("Tags from prose returns exactly the shape the Tags save accepts, and Prose from Tags returns prose", async (t) => {
  const { handler, calls, db } = await bootstrap(t, {
    aiReply: modelReply({
      archetype: ["Archivist"],
      outfit: ["red coat", "ink-stained gloves", "a", "b", "c", "d", "e"],
      face: ["careful_gaze", "careful_gaze"],
      colors: ["red"],
    }),
  })
  const suggestionResponse = await handler(
    post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
  )
  assert.equal(suggestionResponse.status, 200)
  const { ok, suggestion } = await suggestionResponse.json()
  assert.equal(ok, true)
  assert.equal(calls[0].model, TAGGERIZER_MODEL)
  assert.deepEqual(suggestion.fields_json.archetype, ["archivist"])
  assert.equal(suggestion.fields_json.outfit.length, 6, "at most 6 tags per category")
  assert.deepEqual(suggestion.fields_json.face, ["careful_gaze"])
  assert.equal("colors" in suggestion.fields_json, false, "retired category is dropped")
  assert.ok(suggestion.tags_text.startsWith("archivist, careful_gaze, red_coat"))

  // The suggestion goes through the caretaker's real save path unchanged.
  const saved = await (
    await handler(
      post(`${BASE}/revisions`, {
        command_id: "tagger_revision_0001",
        prose: PROSE,
        expected_assignment_version: 2,
        expected_manifestation_version: 0,
      }),
    )
  ).json()
  const submitted = await handler(
    post(`${BASE}/revisions/${saved.manifestation_revision_id}/tags-derivatives`, {
      command_id: "tagger_tags_0001",
      tags_text: suggestion.tags_text,
      fields_json: suggestion.fields_json,
      expected_gene_revision: row(
        db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        GENE,
      ).gene_revision,
    }),
  )
  assert.ok(new Set([200, 202]).has(submitted.status), `Tags save answered ${submitted.status}`)
  const derivative = await submitted.json()
  const body = await (
    await handler(
      new Request(
        `https://iconoplasm.test${BASE}/derivatives/${derivative.manifestation_derivative_id}/body`,
      ),
    )
  ).json()
  assert.equal(body.tags.tags_text, suggestion.tags_text)
  assert.deepEqual(body.tags.fields_json, suggestion.fields_json)

  const rewrite = await bootstrap(t, { aiReply: modelReply({ prose: "A tall archivist." }) })
  const proseResponse = await rewrite.handler(
    post(`${BASE}/taggerize`, {
      direction: "prose_from_tags",
      prose: PROSE,
      tags_fields: { outfit: ["red_coat"] },
    }),
  )
  assert.deepEqual(await proseResponse.json(), {
    ok: true,
    suggestion: { prose: "A tall archivist." },
  })
})

test("a model answer that is not JSON gets a plain 502 sentence, not a 500", async (t) => {
  const { handler } = await bootstrap(t, {
    aiReply: { choices: [{ message: { content: "Sure! Here are tags" } }] },
  })
  const response = await handler(
    post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
  )
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.message, TAGGERIZER_MESSAGES.badReply)
})

test("the 31st call in a UTC day is refused with a retry time and the AI is not called", async (t) => {
  const { handler, calls } = await bootstrap(t, { aiReply: modelReply({ outfit: ["red_coat"] }) })
  for (let call = 1; call <= TAGGERIZER_DAILY_LIMIT; call += 1) {
    const ok = await handler(
      post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
    )
    assert.equal(ok.status, 200, `call ${call}`)
  }
  assert.equal(calls.length, TAGGERIZER_DAILY_LIMIT)
  const refused = await handler(
    post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
  )
  assert.equal(refused.status, 429)
  const body = await refused.json()
  assert.equal(body.error.message, TAGGERIZER_MESSAGES.caretakerLimit)
  assert.equal(body.retry_after_seconds, 12 * 3600, "noon UTC is twelve hours before the reset")
  assert.equal(refused.headers.get("retry-after"), String(12 * 3600))
  assert.equal(calls.length, TAGGERIZER_DAILY_LIMIT)
})

test("the kill switch refuses with a sentence and never calls the AI", async (t) => {
  const { handler, calls } = await bootstrap(t, {
    aiReply: modelReply({ outfit: ["red_coat"] }),
    env: { ICONOPLASM_TAGGERIZER_DISABLED: "1" },
  })
  const response = await handler(
    post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
  )
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.message, TAGGERIZER_MESSAGES.disabled)
  assert.equal(calls.length, 0)
})

test("an exhausted Workers AI free allowance becomes the plain 503 sentence with a retry time", async (t) => {
  const { handler } = await bootstrap(t, {
    aiReply: new Error(
      "3036: You have used up your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.",
    ),
  })
  const response = await handler(
    post(`${BASE}/taggerize`, { direction: "tags_from_prose", prose: PROSE }),
  )
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(
    body.error.message,
    "The free AI allowance for today is used up; try again after 00:00 UTC.",
  )
  assert.equal(body.retry_after_seconds, 12 * 3600 + 5)
  assert.equal(response.headers.get("retry-after"), String(12 * 3600 + 5))
})
