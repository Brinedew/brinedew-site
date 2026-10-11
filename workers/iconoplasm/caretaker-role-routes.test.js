// B-1065 B2b: the gene page's caretaker role routes and the Make Tags helper,
// through the real Hono app into the real main schema (every migration). Only
// `env.AI.run` is faked: a live Workers AI call is the one thing a test must
// not spend allowance on. Failure modes written before the code:
//  1. two people end up caring for one gene, or one person for two;
//  2. a retried claim makes a second role;
//  3. a switch or a new claim lands inside the cooldown, or a switch leaves the
//     old role open;
//  4. a caretaker who leaves keeps their supervote in the election, or a retry
//     of the leave runs the election twice;
//  5. an offer is accepted by someone else, or without the current terms;
//  6. a new caretaker is told about every old comment as unread;
//  7. a cross-site page claims a gene for a signed-in person;
//  8. (B-995) Make Tags calls the AI for someone who is not the gene's active
//     caretaker, answers a reply the Tags save rejects, answers 500 on a bad
//     reply, lets one caretaker spend the shared allowance, ignores the kill
//     switch, or shows a raw code when Cloudflare's free allowance is spent.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"
import { createIconoplasmApp } from "./app.js"
import { caretakerTerms, CARETAKER_ENTITLEMENT_POLICY_VERSION } from "./caretaker-roles.js"
import { canonicalManifestationFieldsJson } from "./caretaker/manifestation-tags-payload.js"
import {
  TAGGERIZER_DAILY_LIMIT,
  TAGGERIZER_MESSAGES,
  TAGGERIZER_MODEL,
  applyProseEdits,
} from "./caretaker/taggerizer.js"
import { normalizeManifestationTags } from "../lib/iconoplasm-manifestation-tags.js"

const ORIGIN = "https://iconoplasm.test"
// Noon UTC: twelve hours before Cloudflare's daily reset.
const NOW = "2026-10-04T12:00:00.000Z"
const ALICE = "account_role_alice_01"
const BOB = "account_role_bob_0002"
const PROSE = "A tall archivist in a red coat with a careful gaze and ink-stained gloves."

function modelReply(value) {
  return { choices: [{ message: { content: JSON.stringify(value) } }] }
}

function harness(t, { aiReply = modelReply({ outfit: ["red_coat"] }), env: extra = {} } = {}) {
  // A second harness in the same test shares the first one's clock.
  try {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) })
  } catch {}
  const db = iconoplasmDatabase()
  t.after(() => db.database.close())
  const text = db.database.prepare(
    `INSERT INTO icono_gene_texts (gene_symbol, gene_id, text_id, version, text, text_sha256)
     VALUES (?, ?, ?, 1, 'Factory words.', ?)`,
  )
  for (const symbol of ["MFNG", "WEE1", "TP53"])
    text.run(symbol, `gene_${symbol.toLowerCase()}`, `text_${symbol.toLowerCase()}`, "0".repeat(64))
  const calls = []
  const settled = []
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_TAGGERIZER_DISABLED: "0",
    AI: {
      async run(model, input) {
        calls.push({ model, input })
        if (aiReply instanceof Error) throw aiReply
        return aiReply
      },
    },
    ...extra,
  }
  const app = createIconoplasmApp({
    isAdmin: async () => true,
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async () => ({}),
    refreshSummaries: async () => {},
    accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
    caretakerSession: async (request) => ({
      account_id: request.headers.get("x-test-account"),
      user_id: `discord_${request.headers.get("x-test-account")}`,
    }),
    settleGene: async (_env, _ctx, symbol) => settled.push(symbol),
  })
  const call = async (method, path, body, { as = ALICE, crossSite = false } = {}) => {
    const response = await app.request(
      `${ORIGIN}/api/iconoplasm/caretaker/genes/${path}`,
      {
        method,
        headers: {
          "x-test-account": as,
          ...(body
            ? {
                "content-type": "application/json",
                ...(crossSite
                  ? { origin: "https://elsewhere.test", "sec-fetch-site": "cross-site" }
                  : { origin: ORIGIN, "sec-fetch-site": "same-origin" }),
              }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      env,
    )
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json().catch(() => null),
    }
  }
  const claim = (symbol, commandId, { as = ALICE, previous = null, crossSite } = {}) =>
    call(
      "POST",
      `${symbol}/claim`,
      {
        command_id: commandId,
        terms_accepted: true,
        terms_version_id: caretakerTerms().terms_version_id,
        entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
        previous_assignment_id: previous,
      },
      { as, crossSite },
    )
  const roles = () =>
    db.database
      .prepare(
        `SELECT gene_symbol, account_id, status, end_reason, comments_read_through_id
           FROM icono_caretaker_assignments ORDER BY created_at, gene_symbol`,
      )
      .all()
      .map((row) => ({ ...row }))
  const taggerize = (body, { as } = {}) => call("POST", "MFNG/taggerize", body, { as })
  return { db, call, claim, roles, settled, calls, taggerize }
}

test("1, 2, 3, 6: one caretaker per gene and per person, a retry claims once, a switch waits out the cooldown", async (t) => {
  const h = harness(t)
  const comment = h.db.database.prepare(
    `INSERT INTO icono_gene_comments (gene_symbol, user_id, body) VALUES (?, 'reader', 'Hi.')`,
  )
  comment.run("MFNG")
  comment.run("MFNG")

  const offered = await h.call("GET", "MFNG/claim")
  assert.equal(offered.body.claim.available, true)
  assert.equal(offered.body.claim.mode, "claim")
  const first = await h.claim("MFNG", "claim_alice_mfng_0001")
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.status, "active")
  const retry = await h.claim("MFNG", "claim_alice_mfng_0001")
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.caretaker_assignment_id, first.body.caretaker_assignment_id)
  assert.equal(h.roles().length, 1, "a retry makes no second role")
  assert.equal(h.roles()[0].comments_read_through_id, 2, "old comments start out read")

  assert.equal(
    (await h.call("GET", "MFNG/claim", null, { as: BOB })).body.claim.reason,
    "gene_taken",
  )
  assert.equal((await h.claim("MFNG", "claim_bob_mfng_00001", { as: BOB })).status, 409)

  // Fifteen minutes (the default) from the last gene taken.
  const early = await h.call("GET", "WEE1/claim")
  assert.equal(early.body.claim.reason, "switch_cooldown")
  assert.equal(early.body.claim.available_at, "2026-10-04T12:15:00.000Z")
  const refused = await h.claim("WEE1", "claim_alice_wee1_0001", {
    previous: first.body.caretaker_assignment_id,
  })
  assert.equal(refused.status, 429)

  t.mock.timers.tick(16 * 60 * 1000)
  const later = await h.call("GET", "WEE1/claim")
  assert.equal(later.body.claim.mode, "switch")
  assert.equal(later.body.claim.switch_from.canonical_symbol, "MFNG")
  const stale = await h.claim("WEE1", "claim_alice_wee1_0002")
  assert.equal(stale.status, 409, "a page that does not name the role it leaves is refused")
  const switched = await h.claim("WEE1", "claim_alice_wee1_0003", {
    previous: first.body.caretaker_assignment_id,
  })
  assert.equal(switched.status, 200, JSON.stringify(switched.body))
  assert.deepEqual(
    h.roles().map((role) => [role.gene_symbol, role.status, role.end_reason]),
    [
      ["MFNG", "ended", "caretaker_switched_gene"],
      ["WEE1", "active", null],
    ],
  )
  assert.equal((await h.claim("MFNG", "claim_bob_mfng_00002", { as: BOB })).status, 200)
  assert.deepEqual(h.settled, [], "no supervote moved, so no election ran")
})

test("4: leaving with a supervote takes it out of the election once", async (t) => {
  const h = harness(t)
  const claimed = await h.claim("MFNG", "claim_alice_mfng_0001")
  h.db.database.exec(
    `UPDATE icono_caretaker_assignments
        SET supervote_asset_sha256 = '${"a".repeat(64)}', supervote_direction = 1,
            supervote_version = 1`,
  )
  const path = `MFNG/assignments/${claimed.body.caretaker_assignment_id}/end`
  const left = await h.call("POST", path, { expected_assignment_version: 1 })
  assert.equal(left.status, 200, JSON.stringify(left.body))
  assert.equal(left.body.status, "ended")
  assert.deepEqual(h.settled, ["MFNG"])
  const retry = await h.call("POST", path, { expected_assignment_version: 1 })
  assert.equal(retry.body.replayed, true)
  assert.deepEqual(h.settled, ["MFNG"], "a retry runs no second election")
  assert.equal(
    (await h.call("POST", path, { expected_assignment_version: 1 }, { as: BOB })).status,
    404,
  )
  const row = h.db.database
    .prepare(`SELECT end_reason, relinquish_policy FROM icono_caretaker_assignments`)
    .get()
  assert.deepEqual({ ...row }, { end_reason: "caretaker_resigned", relinquish_policy: "retain" })
})

test("5, 6: an offer is answered only by its person, and accepted only under the current terms", async (t) => {
  const h = harness(t)
  const offer = h.db.database.prepare(
    `INSERT INTO icono_caretaker_assignments
       (caretaker_assignment_id, gene_symbol, account_id, status, invited_by_account_id)
     VALUES (?, ?, ?, 'pending_acceptance', 'account_role_admin_1')`,
  )
  offer.run("assignment_offer_alice", "TP53", ALICE)
  offer.run("assignment_offer_bob01", "WEE1", BOB)
  h.db.database
    .prepare(
      `INSERT INTO icono_gene_comments (gene_symbol, user_id, body) VALUES ('TP53', 'r', 'Hi.')`,
    )
    .run()
  const accept = "TP53/assignments/assignment_offer_alice/accept"
  const terms = {
    expected_assignment_version: 1,
    terms_accepted: true,
    terms_version_id: caretakerTerms().terms_version_id,
  }
  assert.equal((await h.call("POST", accept, terms, { as: BOB })).status, 404)
  const unconfirmed = await h.call("POST", accept, { ...terms, terms_accepted: false })
  assert.equal(unconfirmed.body.error.code, "TERMS_ACCEPTANCE_REQUIRED")
  const oldTerms = await h.call("POST", accept, { ...terms, terms_version_id: "terms_old" })
  assert.equal(oldTerms.body.error.code, "TERMS_VERSION_MISMATCH")
  const accepted = await h.call("POST", accept, terms)
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal(accepted.body.status, "active")
  const declined = await h.call(
    "POST",
    "WEE1/assignments/assignment_offer_bob01/decline",
    { expected_assignment_version: 1 },
    { as: BOB },
  )
  assert.equal(declined.body.status, "ended")
  assert.deepEqual(
    h
      .roles()
      .map((role) => [
        role.gene_symbol,
        role.status,
        role.end_reason,
        role.comments_read_through_id,
      ]),
    [
      ["TP53", "active", null, 1],
      ["WEE1", "ended", "caretaker_declined", 0],
    ],
  )
})

test("7: a cross-site page claims nothing", async (t) => {
  const h = harness(t)
  const response = await h.claim("MFNG", "claim_alice_mfng_0001", { crossSite: true })
  assert.equal(response.status, 403)
  assert.equal(h.roles().length, 0)
})

test("8: Make Tags refuses anyone but the gene's active caretaker before any AI call", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", "claim_alice_mfng_0001")
  const stranger = await h.taggerize({ direction: "tags_from_prose", prose: PROSE }, { as: BOB })
  assert.equal(stranger.status, 404)
  h.db.database.exec(
    `UPDATE icono_caretaker_assignments SET status = 'suspended', suspended_at = '${NOW}'`,
  )
  const suspended = await h.taggerize({ direction: "tags_from_prose", prose: PROSE })
  assert.equal(suspended.status, 409)
  assert.equal(h.calls.length, 0)
  assert.equal(
    h.db.database.prepare("SELECT count(*) AS n FROM icono_taggerizer_daily_calls").get().n,
    0,
  )
})

test("8: Tags from prose returns exactly the shape the Tags save accepts, and Prose from Tags edits only what changed", async (t) => {
  const h = harness(t, {
    aiReply: modelReply({
      archetype: ["Archivist"],
      outfit: ["red coat", "ink-stained gloves", "a", "b", "c", "d", "e"],
      face: ["careful_gaze", "careful_gaze"],
      colors: ["red"],
    }),
  })
  await h.claim("MFNG", "claim_alice_mfng_0001")
  const response = await h.taggerize({ direction: "tags_from_prose", prose: PROSE })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  const { suggestion } = response.body
  assert.equal(h.calls[0].model, TAGGERIZER_MODEL)
  assert.deepEqual(suggestion.fields_json.archetype, ["archivist"])
  assert.equal(suggestion.fields_json.outfit.length, 6, "at most 6 tags per category")
  assert.deepEqual(suggestion.fields_json.face, ["careful_gaze"])
  assert.equal("colors" in suggestion.fields_json, false, "a retired category is dropped")
  // The suggestion passes the caretaker save's own Tags checks unchanged.
  assert.equal(normalizeManifestationTags(suggestion.tags_text).tags, suggestion.tags_text)
  assert.deepEqual(
    JSON.parse(canonicalManifestationFieldsJson(suggestion.fields_json)),
    suggestion.fields_json,
  )
  // Gemma 4 thinks first unless told not to, and the thinking spends the
  // completion budget (B-995, 2026-10-05).
  assert.equal(h.calls[0].input.chat_template_kwargs?.enable_thinking, false)

  const rewrite = harness(t, {
    aiReply: modelReply({ edits: [{ find: "a red coat", replace: "a blue coat" }] }),
  })
  await rewrite.claim("MFNG", "claim_alice_mfng_0001")
  const prose = await rewrite.taggerize({
    direction: "prose_from_tags",
    prose: PROSE,
    tags_fields: { outfit: ["blue_coat", "gloves"] },
    previous_tags_fields: { outfit: ["red_coat", "gloves"] },
  })
  assert.deepEqual(prose.body, {
    ok: true,
    suggestion: {
      prose: "A tall archivist in a blue coat with a careful gaze and ink-stained gloves.",
    },
  })
  const asked = rewrite.calls[0].input.messages[1].content
  assert.equal(asked.includes("Removed Tags:\noutfit: red_coat"), true)
  assert.equal(asked.includes("Added Tags:\noutfit: blue_coat"), true)
  assert.equal(asked.includes("outfit: gloves"), false)
  assert.equal(rewrite.calls[0].input.chat_template_kwargs?.enable_thinking, false)
})

test("8: a reply that is not usable answers a plain 502 sentence, never a 500 (golden, SOX11)", async (t) => {
  // Workers AI, 2026-10-05, SOX11's 4,000-character prose with thinking on: the
  // whole 1,200-token budget went to reasoning, the answer was empty.
  for (const aiReply of [
    {
      choices: [
        {
          finish_reason: "length",
          message: { role: "assistant", content: "", reasoning_content: "The user wants tags…" },
        },
      ],
      usage: { prompt_tokens: 1188, completion_tokens: 1200 },
    },
    { choices: [{ message: { content: "Sure! Here are tags" } }] },
  ]) {
    const h = harness(t, { aiReply })
    await h.claim("MFNG", "claim_alice_mfng_0001")
    const response = await h.taggerize({ direction: "tags_from_prose", prose: PROSE })
    assert.equal(response.status, 502)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.error.code, "TAGGERIZER_BAD_REPLY")
    assert.equal(response.body.error.message, TAGGERIZER_MESSAGES.badReply)
  }
})

// Golden, SOX11, 2026-10-05. Before edits, "prose from Tags" retyped all 4,000
// characters and drifted. These are the edits Gemma 4 returned live for
// cream_silk_camisole -> emerald_silk_camisole; everything outside them comes
// back byte for byte, and an edit whose passage is missing is skipped.
test("8: prose edits change only their passages (golden, SOX11)", () => {
  const golden = JSON.parse(
    readFileSync(
      new URL("../fixtures/caretaker-history-diff-sox11-golden.json", import.meta.url),
      "utf8",
    ),
  )
  const result = applyProseEdits(golden.before, [
    {
      find: "beneath it sits a cream silk camisole with delicate lace trim at the neckline",
      replace: "beneath it sits an emerald silk camisole with delicate lace trim at the neckline",
    },
    {
      find: "the color story lives in black, cream, and faded teal with burgundy accents",
      replace: "the color story lives in black, emerald, and faded teal with burgundy accents",
    },
    { find: "cream", replace: "ivory" },
    { find: "no such passage", replace: "anything" },
  ])
  assert.equal(result.includes("cream"), false)
  assert.equal(result.includes("ivory"), false)
  assert.equal(
    result.replace("an emerald silk", "a cream silk").replace("black, emerald,", "black, cream,"),
    golden.before,
  )
  assert.equal(applyProseEdits("", [{ find: "", replace: " A red coat. " }]), "A red coat.")
})

test("8: the 31st call in a UTC day is refused with a retry time, and the AI is not called", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", "claim_alice_mfng_0001")
  for (let call = 1; call <= TAGGERIZER_DAILY_LIMIT; call += 1)
    assert.equal(
      (await h.taggerize({ direction: "tags_from_prose", prose: PROSE })).status,
      200,
      `call ${call}`,
    )
  const refused = await h.taggerize({ direction: "tags_from_prose", prose: PROSE })
  assert.equal(refused.status, 429)
  assert.equal(refused.body.error.message, TAGGERIZER_MESSAGES.caretakerLimit)
  assert.equal(refused.body.retry_after_seconds, 12 * 3600)
  assert.equal(refused.headers.get("retry-after"), String(12 * 3600))
  assert.equal(h.calls.length, TAGGERIZER_DAILY_LIMIT)
})

test("8: the kill switch and a spent Workers AI allowance answer sentences with no raw code", async (t) => {
  const off = harness(t, { env: { ICONOPLASM_TAGGERIZER_DISABLED: "1" } })
  await off.claim("MFNG", "claim_alice_mfng_0001")
  const disabled = await off.taggerize({ direction: "tags_from_prose", prose: PROSE })
  assert.equal(disabled.status, 503)
  assert.equal(disabled.body.error.message, TAGGERIZER_MESSAGES.disabled)
  assert.equal(off.calls.length, 0)

  const spent = harness(t, {
    aiReply: new Error(
      "3036: You have used up your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.",
    ),
  })
  await spent.claim("MFNG", "claim_alice_mfng_0001")
  const response = await spent.taggerize({ direction: "tags_from_prose", prose: PROSE })
  assert.equal(response.status, 503)
  assert.equal(
    response.body.error.message,
    "The free AI allowance for today is used up; try again after 00:00 UTC.",
  )
  assert.equal(response.body.retry_after_seconds, 12 * 3600 + 5)
  assert.equal(response.headers.get("retry-after"), String(12 * 3600 + 5))
})
