// B-1137: asking a gene's caretaker for the gene, through the real Hono app into
// the real main schema (every migration), with a real sign-in database for names
// and Discord ids. Only Discord itself is faked. Failure modes written before
// the code:
//  1. a swap or handover leaves a moment, or a half-written state, in which a
//     gene has no caretaker or a person holds two;
//  2. a retried send or accept makes a second request or a second role;
//  3. accepting waits out the switch cooldown, or fails to start it again;
//  4. a request outlives a role it names (a leave, a switch, a claim, a
//     suspension, the other request being accepted), or a "freed" message goes
//     out for a gene somebody holds;
//  5. a person has two requests pending, or a new one silently drops the old;
//  6. the caretaker gets a Discord message for every request instead of one per
//     run of requests they haven't seen;
//  7. a rejected asker asks again at once; an expired request, or one sent
//     under older terms, is accepted;
//  8. a supervote stays in the election after its role is swapped away;
//  9. someone other than the caretaker accepts or rejects, someone other than
//     the asker withdraws, or a cross-site page does either;
// 10. a stale page sends a request against a caretaker who has changed;
// 11. a queued message goes out after it stopped being true;
// 12. the count of requests waiting on a caretaker, or the faces beside it
//     (caretaker/me, for the sidebar), includes an answered or expired one,
//     or another gene's.
import assert from "node:assert/strict"
import test from "node:test"

import { deliverPendingCaretakerGeneRequestNotifications } from "../iconoplasm-caretaker-comment-notifications.js"
import { readCaretakerCoordination } from "../iconoplasm-caretaker-notifications.js"
import { changeCaretakerRoleAsAdmin } from "../iconoplasm-caretaker-admin-routes.js"
import { blankDatabase, iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"
import { createIconoplasmApp } from "./app.js"
import { GENE_REQUEST_NOTE_MAX } from "./caretaker-gene-requests.js"
import { caretakerTerms, CARETAKER_ENTITLEMENT_POLICY_VERSION } from "./caretaker-roles.js"

const ORIGIN = "https://iconoplasm.test"
const NOW = "2026-10-04T12:00:00.000Z"
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const ALICE = "account_role_alice_01"
const BOB = "account_role_bob_0002"
const CAROL = "account_role_carol_01"
const DAVE = "account_role_dave_002"
const PEOPLE = [ALICE, BOB, CAROL, DAVE]
const discordIdOf = (account) => `30000000000000000${PEOPLE.indexOf(account)}`
const at = (ms) => new Date(Date.parse(NOW) + ms).toISOString()
const TERMS = () => ({
  terms_accepted: true,
  terms_version_id: caretakerTerms().terms_version_id,
})

function harness(t) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) })
  const db = iconoplasmDatabase()
  const accounts = blankDatabase()
  accounts.raw.exec(`
    CREATE TABLE users (discord_id TEXT PRIMARY KEY, username TEXT, avatar_url TEXT);
    CREATE TABLE brinedew_account_identities (
      provider TEXT, provider_subject TEXT, account_id TEXT,
      link_version INTEGER, unlinked_at INTEGER, last_seen_at INTEGER
    );
  `)
  for (const account of PEOPLE) {
    accounts.raw
      .prepare(`INSERT INTO users VALUES (?, ?, NULL)`)
      .run(discordIdOf(account), account.split("_")[2])
    accounts.raw
      .prepare(`INSERT INTO brinedew_account_identities VALUES ('discord', ?, ?, 1, NULL, 1)`)
      .run(discordIdOf(account), account)
  }
  t.after(() => {
    db.database.close()
    accounts.close()
  })
  const text = db.database.prepare(
    `INSERT INTO icono_gene_texts (gene_symbol, gene_id, text_id, version, text_sha256)
     VALUES (?, ?, ?, 1, ?)`,
  )
  for (const symbol of ["MFNG", "WEE1", "TP53", "SOX11"])
    text.run(symbol, `gene_${symbol.toLowerCase()}`, `text_${symbol.toLowerCase()}`, "0".repeat(64))
  const settled = []
  // No DISCORD_BOT_TOKEN: the inline send is a no-op, and the queue is checked
  // directly. Test 11 runs the delivery itself.
  const env = { ICONOPLASM_DB: db, DB: accounts }
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
  const call = async (method, path, body, { as, crossSite = false } = {}) => {
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
  let commands = 0
  const command = (who) => `cmd_${who.split("_")[2]}_${String(++commands).padStart(4, "0")}`
  const page = async (symbol, as) => {
    const response = await call("GET", `${symbol}/claim`, null, { as })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    return response.body
  }
  const roleOf = (account) =>
    db.database
      .prepare(
        `SELECT caretaker_assignment_id, gene_symbol, assignment_version
           FROM icono_caretaker_assignments
          WHERE account_id = ? AND status IN ('pending_acceptance', 'active', 'suspended')`,
      )
      .get(account)
  const claim = async (symbol, as) => {
    const previous = roleOf(as)?.caretaker_assignment_id || null
    const response = await call(
      "POST",
      `${symbol}/claim`,
      {
        command_id: command(as),
        ...TERMS(),
        entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
        previous_assignment_id: previous,
      },
      { as },
    )
    assert.equal(response.status, 200, JSON.stringify(response.body))
    return response.body
  }
  // What the request dialog sends: it echoes the roles the page showed.
  const ask = async (symbol, as, overrides = {}, { crossSite } = {}) => {
    const { request } = await page(symbol, as)
    return call(
      "POST",
      `${symbol}/requests`,
      {
        command_id: command(as),
        holder_assignment_id: request?.holder_assignment_id ?? "assignment_none",
        offered_assignment_id: request?.offered?.caretaker_assignment_id ?? null,
        replace_request_id: request?.replaces?.request_id ?? null,
        note: null,
        ...TERMS(),
        ...overrides,
      },
      { as, crossSite },
    )
  }
  const decide = (symbol, requestId, action, as, body = {}, options = {}) =>
    call("POST", `${symbol}/requests/${requestId}/${action}`, body, { as, ...options })
  // The caretaker's accept, as the dialog sends it.
  const accept = async (symbol, requestId, as = ALICE) => {
    const role = roleOf(as)
    return decide(symbol, requestId, "accept", as, {
      expected_assignment_version: Number(role.assignment_version),
      ...TERMS(),
    })
  }
  const requests = () =>
    db.database
      .prepare(
        `SELECT gene_symbol, requester_account_id AS requester, offered_gene_symbol AS offered,
                status, void_reason
           FROM icono_caretaker_gene_requests ORDER BY created_at, rowid`,
      )
      .all()
      .map((row) => ({ ...row }))
  const messages = () =>
    db.database
      .prepare(
        `SELECT kind, recipient_account_id AS recipient, gene_symbol, discord_status
           FROM icono_caretaker_gene_request_notifications ORDER BY rowid`,
      )
      .all()
      .map((row) => ({ ...row }))
  const roles = () =>
    db.database
      .prepare(
        `SELECT gene_symbol, account_id, status, end_reason, invited_by_account_id
           FROM icono_caretaker_assignments ORDER BY created_at, rowid`,
      )
      .all()
      .map((row) => ({ ...row }))
  return {
    db,
    accounts,
    env,
    call,
    page,
    claim,
    ask,
    decide,
    accept,
    roleOf,
    requests,
    messages,
    roles,
    settled,
  }
}

test("1, 2, 3: a swap moves both roles in one step, once, and starts both cooldowns again", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  await h.claim("WEE1", BOB)
  assert.deepEqual(h.settled, ["MFNG", "WEE1"], "each gene page shows its new caretaker")
  h.settled.length = 0

  const offer = (await h.page("MFNG", BOB)).request
  assert.equal(offer.available, true)
  assert.equal(offer.mode, "swap")
  assert.equal(offer.offered.canonical_symbol, "WEE1")
  assert.equal(offer.note_max_length, GENE_REQUEST_NOTE_MAX)
  const sent = await h.ask("MFNG", BOB, {
    command_id: "cmd_bob_swap_0001",
    note: "  I study Notch glycosylation.  ",
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  assert.equal(sent.body.mode, "swap")
  const retry = await h.ask("MFNG", BOB, { command_id: "cmd_bob_swap_0001" })
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.request_id, sent.body.request_id)
  assert.equal(h.requests().length, 1, "a retry sends no second request")
  assert.equal((await h.page("MFNG", BOB)).request.pending.request_id, sent.body.request_id)

  const incoming = (await h.page("MFNG", ALICE)).incoming
  assert.equal(incoming.requests.length, 1)
  const [shown] = incoming.requests
  assert.equal(shown.requester.username, "bob")
  assert.match(shown.requester_label, /^Caretaker [0-9A-F]{8}$/)
  assert.deepEqual(shown.offered, { canonical_symbol: "WEE1" })
  assert.equal(shown.note, "I study Notch glycosylation.")

  // Ten minutes after both claims: well inside the 15-minute switch cooldown.
  t.mock.timers.tick(10 * MINUTE)
  const unconfirmed = await h.decide("MFNG", sent.body.request_id, "accept", ALICE, {
    expected_assignment_version: 1,
  })
  assert.equal(unconfirmed.body.error.code, "TERMS_ACCEPTANCE_REQUIRED")
  const stale = await h.decide("MFNG", sent.body.request_id, "accept", ALICE, {
    expected_assignment_version: 7,
    ...TERMS(),
  })
  assert.equal(stale.status, 409)
  assert.equal(h.requests()[0].status, "pending", "a refused accept changes nothing")

  const accepted = await h.accept("MFNG", sent.body.request_id)
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal(accepted.body.mode, "swap")
  assert.equal(accepted.body.offered_symbol, "WEE1")
  assert.deepEqual(
    h.roles().map((role) => [role.gene_symbol, role.account_id, role.status, role.end_reason]),
    [
      ["MFNG", ALICE, "ended", "caretaker_swapped_gene"],
      ["WEE1", BOB, "ended", "caretaker_swapped_gene"],
      ["MFNG", BOB, "active", null],
      ["WEE1", ALICE, "active", null],
    ],
  )
  const again = await h.decide("MFNG", sent.body.request_id, "accept", ALICE, {
    expected_assignment_version: 1,
    ...TERMS(),
  })
  assert.equal(again.body.replayed, true)
  assert.equal(h.roles().length, 4, "a retried accept makes no new role")

  // The old cooldowns ended at 12:15; the swap at 12:10 starts both again.
  t.mock.timers.tick(6 * MINUTE)
  for (const person of [ALICE, BOB]) {
    const next = (await h.page("TP53", person)).claim
    assert.equal(next.reason, "switch_cooldown")
    assert.equal(next.available_at, at(25 * MINUTE))
  }
  assert.deepEqual(
    h.messages().map((message) => [message.kind, message.recipient]),
    [
      ["requested", ALICE],
      ["accepted", BOB],
    ],
  )
  assert.deepEqual(
    h.settled.sort(),
    ["MFNG", "WEE1"],
    "both gene pages show the swapped caretakers",
  )
})

test("1, 4: a handover gives the gene to someone with none; the other requests for it end quietly", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  const carol = await h.ask("MFNG", CAROL)
  const dave = await h.ask("MFNG", DAVE)
  assert.equal(carol.body.mode, "handover")
  assert.equal((await h.page("MFNG", DAVE)).request.offered, null)

  // A handover asks the caretaker for no terms: they take no gene.
  const accepted = await h.decide("MFNG", carol.body.request_id, "accept", ALICE, {
    expected_assignment_version: 1,
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.deepEqual(
    h
      .roles()
      .map((role) => [
        role.gene_symbol,
        role.account_id,
        role.status,
        role.end_reason,
        role.invited_by_account_id,
      ]),
    [
      ["MFNG", ALICE, "ended", "caretaker_handed_over_gene", ALICE],
      ["MFNG", CAROL, "active", null, ALICE],
    ],
  )
  const terms = h.db.database
    .prepare(
      `SELECT role.terms_version_id, role.terms_accepted_at, request.created_at
         FROM icono_caretaker_assignments role
         JOIN icono_caretaker_gene_requests request ON request.requester_account_id = role.account_id
        WHERE role.account_id = ?`,
    )
    .get(CAROL)
  assert.equal(terms.terms_version_id, caretakerTerms().terms_version_id)
  assert.equal(terms.terms_accepted_at, terms.created_at, "Carol accepted the terms when she asked")
  assert.deepEqual(
    h.requests().map((request) => [request.requester, request.status, request.void_reason]),
    [
      [CAROL, "accepted", null],
      [DAVE, "void", "caretaker_handed_over_gene"],
    ],
  )
  assert.ok(
    !h.messages().some((message) => message.kind === "freed"),
    "MFNG went straight to Carol, so nobody is told it is free",
  )
  assert.equal(dave.status, 200)
  assert.equal((await h.page("MFNG", DAVE)).request.pending, null)
  assert.equal((await h.page("MFNG", ALICE)).request.mode, "handover")
})

test("5, 9: one request at a time, and only its own people can answer it", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  await h.claim("WEE1", BOB)
  const first = await h.ask("MFNG", CAROL)
  assert.equal(first.status, 200)

  const replaces = (await h.page("WEE1", CAROL)).request.replaces
  assert.deepEqual(replaces, { request_id: first.body.request_id, canonical_symbol: "MFNG" })
  const silent = await h.ask("WEE1", CAROL, { replace_request_id: null })
  assert.equal(silent.body.error.code, "GENE_REQUEST_ALREADY_PENDING")
  const second = await h.ask("WEE1", CAROL)
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.withdrew_request_id, first.body.request_id)
  assert.deepEqual(
    h.requests().map((request) => [request.gene_symbol, request.status]),
    [
      ["MFNG", "withdrawn"],
      ["WEE1", "pending"],
    ],
  )
  assert.equal(
    (await h.ask("WEE1", CAROL)).body.error.code,
    "GENE_REQUEST_ALREADY_PENDING",
    "asking twice for one gene is one request",
  )

  const id = second.body.request_id
  for (const [who, action] of [
    [DAVE, "accept"],
    [ALICE, "accept"],
    [CAROL, "accept"],
    [DAVE, "reject"],
    [DAVE, "withdraw"],
    [BOB, "withdraw"],
  ])
    assert.equal(
      (await h.decide("WEE1", id, action, who, { expected_assignment_version: 1, ...TERMS() }))
        .status,
      404,
      `${who} cannot ${action}`,
    )
  assert.equal((await h.decide("MFNG", id, "reject", ALICE)).status, 404, "wrong gene")
  assert.equal((await h.decide("WEE1", "request_nope", "reject", BOB)).status, 400)

  assert.equal((await h.ask("WEE1", BOB)).status, 409, "nobody asks for their own gene")
  assert.equal((await h.ask("TP53", DAVE)).status, 409, "a free gene is claimed, not asked for")
  const long = await h.ask("MFNG", DAVE, { note: "x".repeat(GENE_REQUEST_NOTE_MAX + 1) })
  assert.equal(long.body.error.code, "INVALID_GENE_REQUEST_NOTE")
  assert.equal((await h.ask("MFNG", DAVE, { terms_accepted: false })).status, 400)

  const withdrawn = await h.decide("WEE1", id, "withdraw", CAROL)
  assert.equal(withdrawn.body.status, "withdrawn")
  assert.equal((await h.decide("WEE1", id, "withdraw", CAROL)).body.replayed, true)
  assert.equal((await h.accept("WEE1", id, BOB)).status, 409, "a withdrawn request stays withdrawn")
})

test("6: the caretaker gets one message for each run of requests they haven't seen", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  await h.ask("MFNG", BOB)
  await h.ask("MFNG", CAROL)
  assert.equal(h.messages().length, 1, "Carol's request joins the run Bob's message announced")
  await h.page("MFNG", ALICE)
  await h.ask("MFNG", DAVE)
  assert.deepEqual(
    h.messages().map((message) => [message.kind, message.recipient]),
    [
      ["requested", ALICE],
      ["requested", ALICE],
    ],
  )
})

test("4: every role change ends the requests that name it, and a gene left free tells its askers", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  await h.ask("MFNG", BOB)
  const alice = h.roleOf(ALICE)
  const left = await h.call(
    "POST",
    `MFNG/assignments/${alice.caretaker_assignment_id}/end`,
    { expected_assignment_version: 1 },
    { as: ALICE },
  )
  assert.equal(left.status, 200, JSON.stringify(left.body))

  await h.claim("WEE1", CAROL)
  await h.ask("WEE1", DAVE)
  t.mock.timers.tick(16 * MINUTE)
  await h.claim("TP53", CAROL)

  await h.ask("TP53", BOB)
  await h.claim("MFNG", BOB)

  await h.ask("TP53", DAVE)
  const carol = h.roleOf(CAROL)
  await changeCaretakerRoleAsAdmin(h.env, {
    assignmentId: carol.caretaker_assignment_id,
    action: "suspend",
    actorAccountId: "account_role_admin_1",
    body: { expected_assignment_version: 1, suspension_reason: "Test suspension." },
  })

  assert.deepEqual(
    h.requests().map((request) => [request.gene_symbol, request.requester, request.void_reason]),
    [
      ["MFNG", BOB, "caretaker_role_end"],
      ["WEE1", DAVE, "caretaker_switched_gene"],
      ["TP53", BOB, "caretaker_claimed_gene"],
      ["TP53", DAVE, "caretaker_role_suspend"],
    ],
  )
  assert.deepEqual(
    h
      .messages()
      .filter((message) => message.kind === "freed")
      .map((message) => [message.gene_symbol, message.recipient]),
    [
      ["MFNG", BOB],
      ["WEE1", DAVE],
    ],
    "TP53 still has its suspended caretaker, so nobody is told it is free",
  )
  const offer = (await h.page("TP53", DAVE)).request
  assert.equal(offer.available, false)
  assert.equal(offer.reason, "caretaker_unavailable")
})

test("7, 11, 12: a rejection keeps its asker away from that gene for 14 days, and old requests expire", async (t) => {
  const h = harness(t)
  // 12: the count counts what still waits on the caretaker, and nothing once it
  // is answered or expired.
  const sidebar = async (account) =>
    (await readCaretakerCoordination(h.db, { accountId: account, accountDb: h.accounts })).caretaker
  const waiting = async (account) => (await sidebar(account)).pending_request_count
  // Bob has no picture of his own, so his face is Discord's default for his id,
  // at Discord's own address (the sidebar is signed-in only).
  const bobFace = {
    name: "bob",
    avatar_url: `https://cdn.discordapp.com/embed/avatars/${(BigInt(discordIdOf(BOB)) >> 22n) % 6n}.png`,
  }
  await h.claim("MFNG", ALICE)
  await h.claim("WEE1", CAROL)
  assert.equal(await waiting(ALICE), 0)
  assert.deepEqual((await sidebar(ALICE)).request_faces, [])
  const sent = await h.ask("MFNG", BOB)
  assert.equal(await waiting(ALICE), 1)
  assert.deepEqual((await sidebar(ALICE)).request_faces, [bobFace])
  assert.equal(await waiting(CAROL), 0, "only the gene asked for counts it")
  assert.deepEqual((await sidebar(CAROL)).request_faces, [])
  const rejected = await h.decide("MFNG", sent.body.request_id, "reject", ALICE)
  assert.equal(await waiting(ALICE), 0)
  assert.deepEqual((await sidebar(ALICE)).request_faces, [], "an answered request loses its face")
  assert.equal(rejected.body.status, "rejected")
  assert.equal((await h.decide("MFNG", sent.body.request_id, "reject", ALICE)).body.replayed, true)
  assert.equal((await h.accept("MFNG", sent.body.request_id)).status, 409)

  const offer = (await h.page("MFNG", BOB)).request
  assert.equal(offer.available, false)
  assert.equal(offer.reason, "rejected_recently")
  assert.equal(offer.available_at, at(14 * DAY))
  const again = await h.ask("MFNG", BOB)
  assert.equal(again.status, 429)
  assert.equal(again.headers.get("retry-after"), String(14 * 24 * 60 * 60))
  const elsewhere = await h.ask("WEE1", BOB)
  assert.equal(elsewhere.status, 200, "the block covers one gene, not the asker")
  assert.equal(await waiting(CAROL), 1)

  t.mock.timers.tick(14 * DAY + MINUTE)
  assert.equal(await waiting(CAROL), 0, "an expired request stops counting before anyone reads it")
  assert.deepEqual((await sidebar(CAROL)).request_faces, [])
  assert.deepEqual((await h.page("WEE1", CAROL)).incoming.requests, [], "Bob's request expired")
  assert.equal((await h.accept("WEE1", elsewhere.body.request_id, CAROL)).status, 409)
  const later = await h.ask("MFNG", BOB)
  assert.equal(later.status, 200, JSON.stringify(later.body))
  assert.deepEqual(
    h.requests().map((request) => [request.gene_symbol, request.status]),
    [
      ["MFNG", "rejected"],
      ["WEE1", "expired"],
      ["MFNG", "pending"],
    ],
  )
  assert.deepEqual(
    h.messages().map((message) => [message.kind, message.recipient]),
    [
      ["requested", ALICE],
      ["rejected", BOB],
      ["requested", CAROL],
      ["requested", ALICE],
    ],
  )
})

test("7: a request sent under older terms ends instead of being accepted", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  const sent = await h.ask("MFNG", BOB)
  h.db.database.exec(`UPDATE icono_caretaker_gene_requests SET terms_version_id = 'terms_old'`)
  const refused = await h.accept("MFNG", sent.body.request_id)
  assert.equal(refused.status, 409)
  assert.deepEqual(
    h.requests().map((request) => [request.status, request.void_reason]),
    [["void", "terms_changed"]],
  )
  assert.equal(h.roleOf(ALICE).gene_symbol, "MFNG")
  assert.equal(h.roleOf(BOB), undefined)
})

test("8: accepting a swap takes both supervotes out of their elections", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  await h.claim("WEE1", BOB)
  h.settled.length = 0
  h.db.database.exec(
    `UPDATE icono_caretaker_assignments
        SET supervote_asset_sha256 = '${"a".repeat(64)}', supervote_direction = 1,
            supervote_version = 1`,
  )
  assert.equal((await h.page("MFNG", BOB)).request.offered.has_supervote, true)
  const sent = await h.ask("MFNG", BOB)
  assert.equal((await h.page("MFNG", ALICE)).incoming.holder.has_supervote, true)
  const accepted = await h.accept("MFNG", sent.body.request_id)
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.deepEqual(h.settled.sort(), ["MFNG", "WEE1"])
  const fresh = h.db.database
    .prepare(
      `SELECT COUNT(*) AS n FROM icono_caretaker_assignments
        WHERE status = 'active' AND supervote_asset_sha256 IS NOT NULL`,
    )
    .get()
  assert.equal(fresh.n, 0, "the new roles start without a supervote")
})

test("9, 10: a cross-site page or a stale page changes nothing, and a race rolls the whole accept back", async (t) => {
  const h = harness(t)
  await h.claim("MFNG", ALICE)
  await h.claim("WEE1", BOB)
  assert.equal((await h.ask("MFNG", BOB, {}, { crossSite: true })).status, 403)
  assert.deepEqual(h.requests(), [])

  const changed = await h.ask("MFNG", BOB, { holder_assignment_id: "assignment_somebody_else" })
  assert.equal(changed.status, 409)
  const moved = await h.ask("MFNG", BOB, { offered_assignment_id: null })
  assert.equal(moved.status, 409, "Bob's page must name the gene he gives up")

  const sent = await h.ask("MFNG", BOB)
  const crossAccept = await h.decide(
    "MFNG",
    sent.body.request_id,
    "accept",
    ALICE,
    { expected_assignment_version: 1, ...TERMS() },
    { crossSite: true },
  )
  assert.equal(crossAccept.status, 403)

  // Bob's role changes between the accept's reads and its batch: the batch's
  // own guards and the one-role-per-person index refuse it whole.
  const batch = h.db.batch.bind(h.db)
  h.db.batch = async (statements) => {
    h.db.batch = batch
    h.db.database.exec(
      `UPDATE icono_caretaker_assignments SET assignment_version = assignment_version + 1
        WHERE account_id = '${BOB}'`,
    )
    return batch(statements)
  }
  const raced = await h.accept("MFNG", sent.body.request_id)
  assert.equal(raced.status, 409, JSON.stringify(raced.body))
  assert.deepEqual(
    h.roles().map((role) => [role.gene_symbol, role.account_id, role.status]),
    [
      ["MFNG", ALICE, "active"],
      ["WEE1", BOB, "active"],
    ],
  )
  assert.equal(h.requests()[0].status, "pending")
  const settledLater = await h.accept("MFNG", sent.body.request_id)
  assert.equal(settledLater.status, 200, "the same request accepts once the race is over")
})

test("11: each message goes out once, and one that stopped being true is dropped", async (t) => {
  const h = harness(t)
  const sends = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    if (String(url).endsWith("/users/@me/channels")) {
      return Response.json({ id: `dm-${body.recipient_id}` })
    }
    sends.push({
      channel: String(url).split("/channels/")[1].split("/")[0],
      content: body.content,
      embeds: body.embeds ?? null,
      components: body.components ?? null,
    })
    return Response.json({ id: `message-${sends.length}` })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const deliver = () =>
    deliverPendingCaretakerGeneRequestNotifications({ ...h.env, DISCORD_BOT_TOKEN: "test-token" })
  const button = (label, url) => [{ type: 1, components: [{ type: 2, style: 5, label, url }] }]
  const wee1Portrait = "ab".repeat(32)
  h.db.database
    .prepare(
      `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256) VALUES ('WEE1', ?)`,
    )
    .run(wee1Portrait)

  await h.claim("MFNG", ALICE)
  await h.claim("WEE1", BOB)
  const bob = await h.ask("MFNG", BOB, { note: "I *study* [Notch](https://x.test) glycosylation." })
  await deliver()
  await h.decide("MFNG", bob.body.request_id, "reject", ALICE)
  await deliver()
  await h.ask("MFNG", DAVE)
  await h.page("MFNG", ALICE) // Alice sees Dave's request before its message is sent.
  await deliver()
  const alice = h.roleOf(ALICE)
  await h.call(
    "POST",
    `MFNG/assignments/${alice.caretaker_assignment_id}/end`,
    { expected_assignment_version: 1 },
    { as: ALICE },
  )
  await h.claim("MFNG", CAROL) // MFNG is taken again before Dave hears it was free.
  await deliver()
  await h.ask("MFNG", DAVE) // A handover with no note: the sentence and the button only.
  await deliver()
  await deliver()

  assert.deepEqual(sends, [
    {
      channel: `dm-${discordIdOf(ALICE)}`,
      content: "**bob** asked to swap **WEE1** for **MFNG**",
      embeds: [
        {
          description: String.raw`I \*study\* \[Notch\](https://x.test) glycosylation.`,
          thumbnail: {
            url: `https://iconoplasm.brinedew.bio/portraits/v1/ab/${wee1Portrait}/small.webp`,
          },
        },
      ],
      components: button("Review", "https://iconoplasm.brinedew.bio/gene/MFNG#gene-requests"),
    },
    {
      channel: `dm-${discordIdOf(BOB)}`,
      content: "Your request for **MFNG** was rejected.",
      embeds: null,
      components: button("Open", "https://iconoplasm.brinedew.bio/gene/MFNG"),
    },
    {
      channel: `dm-${discordIdOf(CAROL)}`,
      content: "**dave** asked to become a **MFNG** caretaker",
      embeds: null,
      components: button("Review", "https://iconoplasm.brinedew.bio/gene/MFNG#gene-requests"),
    },
  ])
  assert.deepEqual(
    h.messages().map((message) => [message.kind, message.recipient, message.discord_status]),
    [
      ["requested", ALICE, "sent"],
      ["rejected", BOB, "sent"],
      ["requested", ALICE, "suppressed"],
      ["freed", DAVE, "suppressed"],
      ["requested", CAROL, "sent"],
    ],
  )
})
