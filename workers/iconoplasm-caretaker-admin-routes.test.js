import assert from "node:assert/strict"
import test from "node:test"

import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  createIconoplasmCaretakerAdminHandlers,
} from "./iconoplasm-caretaker-admin-routes.js"
import { caretakerPseudonym, caretakerTerms } from "./iconoplasm/caretaker-roles.js"
import { blankDatabase, iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

// B-1065 B2b: the admin's caretaker page, through its declared handlers, on the
// roles table of the real main schema (every migration). Failure modes:
// 1. the registry or a picker shows a person by more than their pseudonym, or
//    loses their account status;
// 2. an admin change applies from a stale version, or a retry applies twice;
// 3. a suspension or an end lands without a bounded reason;
// 4. ending with "withdraw" leaves the person's texts in use, or a lost answer
//    between the end and the withdrawal leaves it half done;
// 5. ending a role whose supervote decides the gene leaves the old winner
//    published;
// 6. a cross-site request changes a role;
// 7. a role that ended keeping its texts cannot withdraw them later, so a cut
//    text stays the readers' text with nobody to fix it (B-1097), or the late
//    withdrawal runs from a stale version or on a role still open.
const ORIGIN = "https://iconoplasm.brinedew.bio"
const ADMIN = "account_admin_routes"
const USER = "account_user_routes1"
const ROLE = "assignment_admin_8101"

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function mutationRequest(
  path,
  body,
  headers = { origin: ORIGIN, "sec-fetch-site": "same-origin" },
) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function setup(t, { supervote = false } = {}) {
  const db = iconoplasmDatabase()
  const accounts = blankDatabase()
  t.after(() => {
    db.database.close()
    accounts.close()
  })
  accounts.raw.exec(`
    CREATE TABLE brinedew_accounts (account_id TEXT PRIMARY KEY, status TEXT NOT NULL);
    INSERT INTO brinedew_accounts VALUES ('${USER}', 'active'), ('${ADMIN}', 'active');
  `)
  db.database
    .prepare(
      `INSERT INTO icono_gene_texts (gene_symbol, gene_id, text_id, version, text, text_sha256)
       VALUES ('A8101', 'gene_admin_8101', 'text_admin_8101', 1, 'Factory words.', ?)`,
    )
    .run("0".repeat(64))
  db.database
    .prepare(
      `INSERT INTO icono_caretaker_assignments
         (caretaker_assignment_id, gene_symbol, account_id, status, terms_version_id,
          terms_accepted_at, relinquish_policy, invited_by_account_id, started_at,
          supervote_asset_sha256, supervote_direction, supervote_version)
       VALUES (?, 'A8101', ?, 'active', ?, '2026-10-01', 'retain', ?, '2026-10-01', ?, ?, ?)`,
    )
    .run(
      ROLE,
      USER,
      caretakerTerms().terms_version_id,
      USER,
      supervote ? "a".repeat(64) : null,
      supervote ? 1 : null,
      supervote ? 1 : 0,
    )
  const settled = []
  const api = createIconoplasmCaretakerAdminHandlers({
    isAdmin: async () => true,
    json,
    resolveActiveAccount: async () => ({ account_id: ADMIN }),
    settleGene: async (_env, _ctx, symbol) => settled.push(symbol),
  })
  const env = { ICONOPLASM_DB: db, DB: accounts }
  const read = async (name, path) =>
    (
      await api[name]({
        request: new Request(`${ORIGIN}${path}`),
        env,
        done: (_name, response) => response,
      })
    ).json()
  const act = async (action, body, headers) => {
    const response = await api["caretaker_admin.mutate"]({
      match: { params: { assignment_id: ROLE, action } },
      request: mutationRequest(
        `/api/iconoplasm/admin/caretakers/assignments/${ROLE}/${action}`,
        body,
        headers,
      ),
      env,
      ctx: {},
      done: (_name, response) => response,
    })
    return { status: response.status, body: await response.json() }
  }
  return { db, api, read, act, settled }
}

test("1: the registry and the pickers name people by pseudonym and keep their account status", async (t) => {
  const h = setup(t)
  const label = await caretakerPseudonym(USER)
  assert.match(label, /^Caretaker [0-9A-F]{8}$/)

  const terms = await h.read("caretaker_admin.terms", "/api/iconoplasm/admin/caretakers/terms")
  assert.equal(terms.entitlement_policy_version, CARETAKER_ENTITLEMENT_POLICY_VERSION)
  assert.equal(terms.terms[0].terms_version_id, caretakerTerms().terms_version_id)

  const { accounts } = await h.read(
    "caretaker_admin.accounts",
    `/api/iconoplasm/admin/caretakers/accounts?query=user_routes`,
  )
  assert.deepEqual(accounts, [{ account_id: USER, author_label: label, status: "active" }])

  const { genes } = await h.read(
    "caretaker_admin.genes",
    "/api/iconoplasm/admin/caretakers/genes?query=a81",
  )
  assert.equal(genes.length, 1)
  assert.equal(genes[0].canonical_symbol, "A8101")
  assert.equal(genes[0].gene_id, "gene_admin_8101")
  assert.equal(genes[0].open_assignment_status, "active")

  const registry = await h.read(
    "caretaker_admin.registry",
    "/api/iconoplasm/admin/caretakers/registry?status=active&limit=1",
  )
  assert.equal(registry.assignments.length, 1)
  assert.equal(registry.assignments[0].caretaker_assignment_id, ROLE)
  assert.equal(registry.assignments[0].author_label, label)
  assert.equal(registry.assignments[0].account_status, "active")
  assert.equal(registry.assignments[0].canonical_revision_id, "text_admin_8101")
  assert.equal(registry.next_cursor, null)
})

test("2, 3: suspend, resume and end each apply once from the version the page saw, with a reason", async (t) => {
  const h = setup(t)
  for (const reason of [undefined, "   ", "x".repeat(501)]) {
    const suspend = await h.act("suspend", {
      expected_assignment_version: 1,
      ...(reason === undefined ? {} : { suspension_reason: reason }),
    })
    assert.equal(suspend.status, 400)
    assert.equal(suspend.body.error.code, "ADMINISTRATOR_REASON_REQUIRED")
    const end = await h.act("end", {
      expected_assignment_version: 1,
      relinquish_policy: "retain",
      ...(reason === undefined ? {} : { reason }),
    })
    assert.equal(end.status, 400)
    assert.equal(end.body.error.code, "ADMINISTRATOR_REASON_REQUIRED")
  }

  const suspended = await h.act("suspend", {
    expected_assignment_version: 1,
    suspension_reason: "Policy review",
  })
  assert.deepEqual(
    [suspended.status, suspended.body.status, suspended.body.assignment_version],
    [200, "suspended", 2],
  )
  const retry = await h.act("suspend", {
    expected_assignment_version: 1,
    suspension_reason: "Policy review",
  })
  assert.equal(retry.body.replayed, true, "a retry of a landed change replays")
  assert.equal(retry.body.assignment_version, 2)

  const stale = await h.act("end", {
    expected_assignment_version: 1,
    relinquish_policy: "retain",
    reason: "Too late",
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, "ASSIGNMENT_VERSION_CONFLICT")

  const resumed = await h.act("resume", { expected_assignment_version: 2 })
  assert.deepEqual([resumed.body.status, resumed.body.assignment_version], ["active", 3])
  const ended = await h.act("end", {
    expected_assignment_version: 3,
    relinquish_policy: "retain",
    reason: "Administrator ended tenure",
  })
  assert.deepEqual([ended.body.status, ended.body.assignment_version], ["ended", 4])
  const row = h.db.database
    .prepare(
      `SELECT end_reason, relinquish_policy, ended_by_account_id FROM icono_caretaker_assignments`,
    )
    .get()
  assert.deepEqual(
    { ...row },
    {
      end_reason: "Administrator ended tenure",
      relinquish_policy: "retain",
      ended_by_account_id: ADMIN,
    },
  )
  assert.deepEqual(h.settled, [], "nothing readers see changed")
})

test("4, 5: an end with withdraw takes the texts out of use, and an end with a supervote re-elects", async (t) => {
  const h = setup(t, { supervote: true })
  h.db.database
    .prepare(
      `INSERT INTO icono_caretaker_text_versions
         (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
          text, text_sha256, readers_see)
       VALUES ('version_admin_8101', 'A8101', 'line_admin_8101', 1, ?, ?, 'Caretaker words.', ?, 1)`,
    )
    .run(USER, ROLE, "1".repeat(64))
  h.db.database.exec(
    `UPDATE icono_gene_texts SET chosen_caretaker_version_id = 'version_admin_8101', readers_see = 1`,
  )
  const body = {
    expected_assignment_version: 1,
    relinquish_policy: "withdraw",
    reason: "Asked to leave",
  }
  const ended = await h.act("end", body)
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  assert.equal(ended.body.status, "ended")
  assert.deepEqual(h.settled, ["A8101"], "the gene is settled once, for both reasons")
  const version = h.db.database
    .prepare(`SELECT withdrawn_at FROM icono_caretaker_text_versions`)
    .get()
  assert.ok(version.withdrawn_at, "the caretaker's version is withdrawn")
  assert.equal(
    h.db.database.prepare(`SELECT chosen_caretaker_version_id AS id FROM icono_gene_texts`).get()
      .id,
    null,
    "the gene falls back to the factory text",
  )

  // A retry after a lost answer finds the work done and settles nothing again.
  h.settled.length = 0
  const retry = await h.act("end", body)
  assert.equal(retry.body.replayed, true)
  assert.deepEqual(h.settled, [])
})

test("7: a role that ended keeping its texts withdraws them later, once", async (t) => {
  const h = setup(t)
  h.db.database
    .prepare(
      `INSERT INTO icono_caretaker_text_versions
         (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
          text, text_sha256, readers_see)
       VALUES ('version_admin_8101', 'A8101', 'line_admin_8101', 1, ?, ?, 'Cut caretaker wor', ?, 1)`,
    )
    .run(USER, ROLE, "1".repeat(64))
  h.db.database.exec(
    `UPDATE icono_gene_texts SET chosen_caretaker_version_id = 'version_admin_8101', readers_see = 1`,
  )
  const open = await h.act("withdraw", { expected_assignment_version: 1 })
  assert.equal(open.status, 409, "an open role ends first; withdraw is for ended roles")

  const ended = await h.act("end", {
    expected_assignment_version: 1,
    relinquish_policy: "retain",
    reason: "Test account",
  })
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  const chosen = () =>
    h.db.database.prepare(`SELECT chosen_caretaker_version_id AS id FROM icono_gene_texts`).get().id
  assert.equal(chosen(), "version_admin_8101", "kept texts stay the readers' text")

  const stale = await h.act("withdraw", { expected_assignment_version: 1 })
  assert.equal(stale.status, 409, "the page's version must be the role's current one")
  assert.equal(chosen(), "version_admin_8101")

  h.settled.length = 0
  const withdrawn = await h.act("withdraw", { expected_assignment_version: 2 })
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body))
  assert.equal(withdrawn.body.status, "ended")
  assert.equal(chosen(), null, "the gene falls back to the factory text")
  assert.ok(
    h.db.database.prepare(`SELECT withdrawn_at FROM icono_caretaker_text_versions`).get()
      .withdrawn_at,
    "the version is kept, marked withdrawn",
  )
  assert.equal(
    h.db.database
      .prepare(
        `SELECT relinquish_policy FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
      )
      .get(ROLE).relinquish_policy,
    "withdraw",
    "the role records what happened to its texts",
  )
  assert.deepEqual(h.settled, ["A8101"], "the gene republishes with its factory text")

  h.settled.length = 0
  const retry = await h.act("withdraw", { expected_assignment_version: 2 })
  assert.equal(retry.body.replayed, true)
  assert.deepEqual(h.settled, [])
})

test("6: a cross-site request changes nothing", async (t) => {
  const h = setup(t)
  const response = await h.act(
    "suspend",
    { expected_assignment_version: 1, suspension_reason: "Policy review" },
    {},
  )
  assert.equal(response.status, 403)
  assert.equal(response.body.error.code, "STRICT_SAME_ORIGIN_REQUIRED")
  assert.equal(
    h.db.database.prepare(`SELECT status FROM icono_caretaker_assignments`).get().status,
    "active",
  )
})
