import { readSession } from "./lib/sealed-session.js"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test, { afterEach } from "node:test"
import { FakeDailyBudgetNamespace } from "./test-helpers/fake-daily-budget-namespace.js"

import {
  ADMIN_TOKEN,
  ASSET,
  ERASED_NAME,
  ERASED_USER,
  IMAGE,
  OTHER_NAME,
  OTHER_USER,
  dumpDatabase,
  findTraces,
  renditionKeys,
  seedDiscordMirror,
  seedSessionsAndKv,
  seedWorld,
} from "./test-helpers/account-erasure-fixture.js"
import { viaStatefulWorker } from "./test-helpers/via-stateful-worker.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  iconoplasmUserKvKeyScopes,
  postIconoplasmGeneCommentToDiscord,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  ERASURE_MAX_D1_CALLS,
  ERASURE_MAX_EXTERNAL_FETCHES,
  ERASURE_MIN_ROW_WRITES,
} from "./iconoplasm/account-erasure/erase-account-data.js"
import {
  ERASURE_STEPS,
  EXEMPT_COLUMNS,
  PERSON_COLUMN_PATTERN,
} from "./iconoplasm/account-erasure/erasure-steps.js"
import {
  TestD1,
  command,
  sha,
  storage,
} from "./iconoplasm/caretaker/manifestation-authority-test-support.js"
import {
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  offerCaretakerAssignment,
  saveManifestationRevision,
  seedSystemManifestation,
  transitionCaretakerAssignment,
} from "./iconoplasm/caretaker/manifestation-authority.js"
import {
  brinedewFormerAuthorLabel,
  brinedewProviderSubjectFingerprint,
  readBrinedewAccount,
  resolveBrinedewAccountIdentity,
} from "./lib/brinedew-account-identity.js"
import { drainBrinedewAuthorityAccountProjectionOutbox } from "./lib/brinedew-authority-account-projection.js"
import {
  commentMirrorContent,
  commentMirrorWithAuthor,
} from "./lib/iconoplasm-comment-discord-mirror.js"

// B-871, B-987: the privacy pages promise that a verified erasure request removes the person's
// account, discovery, generation and settings data, GeneGuessr stats and game history, and the
// provider identity, while retained authorship and published content stay under an anonymous label.
// This test seeds two people with a footprint in every table, key and object the code writes (the
// erased one heavier), runs the real route until it reports complete, and then looks for the
// person everywhere.
//
// Failure modes it is built to catch:
// 1. a table, KV key or Durable Object that holds the Discord id is left out (the trace scan and
//    the schema coverage check both fail);
// 2. content the pages say stays is deleted, or still points at the person;
// 3. the other person's rows, or the public vote counts, move;
// 4. the account completes while rows keyed by the Discord id remain;
// 5. a re-run, or a re-run after a partial failure, double-applies or errors;
// 6. one request is unbounded in D1 calls, rows written or external calls;
// 7. an unpublished job's result images stay in the public storage, or a published portrait's
//    objects go with a job (B-993);
// 8. the person's username stays in the public Discord copy of a comment, a post that is not hers
//    changes, or a comment she removed keeps its post (B-992).
//
// Bunny and Discord are a stateful fake at the fetch boundary (test-helpers/fake-discord-and-bunny.js);
// the real poster writes the Discord messages the erasure then has to find.

function route(env, body, token = ADMIN_TOKEN) {
  return viaStatefulWorker(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/accounts/erase", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    {},
  )
}

function routeEnv(worldEnv) {
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: new FakeDailyBudgetNamespace(),
    ...worldEnv,
  }
  return {
    ...gatewayEnv,
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      fetch: (request) =>
        handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          gatewayEnv,
          { waitUntil() {} },
        ),
    },
  }
}

function calls(world) {
  return world.accounts.calls + world.iconoplasm.calls + world.audit.calls
}

function rows(db, sql, ...args) {
  return db.database.prepare(sql).all(...args)
}

function row(db, sql, ...args) {
  return db.database.prepare(sql).get(...args) || null
}

function snapshot(world) {
  return {
    accounts: dumpDatabase(world.accounts),
    iconoplasm: dumpDatabase(world.iconoplasm),
    audit: dumpDatabase(world.audit),
    authoring: dumpDatabase(world.authoring),
  }
}

// Every row of a snapshot that does not mention the erased person or their account.
function rowsNotAbout(dump, needles) {
  const result = {}
  for (const [table, tableRows] of Object.entries(dump)) {
    result[table] = tableRows.filter(
      (tableRow) => !needles.some((needle) => tableRow.includes(needle)),
    )
  }
  return result
}

const installed = []
afterEach(() => {
  // Newest first: each network restores the fetch it replaced.
  for (const network of installed.splice(0).reverse()) network.restore()
})

async function erasedWorld() {
  const world = await seedWorld()
  await seedSessionsAndKv(world, iconoplasmUserKvKeyScopes)
  world.network.install()
  installed.push(world.network)
  await seedDiscordMirror(world, postIconoplasmGeneCommentToDiscord)
  return world
}

// Sends the same request until the erasure reports complete; every request's response and the
// external calls it made are returned.
async function eraseToCompletion(env, world, body = {}, limit = 16) {
  const requests = []
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const externalBefore = world.network.calls.length
    const response = await route(env, {
      account_id: world.erasedAccount,
      command_id: "req-1",
      ...body,
    })
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    const payload = await response.json()
    requests.push({ ...payload, external: world.network.calls.length - externalBefore })
    if (payload.erasure.complete) return requests
  }
  throw new Error(`not complete after ${limit} requests`)
}

const botPosts = (world) => world.network.messages.filter((message) => message.author.bot)

// What the site's one session reader makes of a browser's sealed cookie (B-1069).
function sessionOf(world, cookie) {
  return readSession(
    new Request("https://iconoplasm.brinedew.bio/", { headers: { Cookie: cookie } }),
    world.env,
  )
}

test("the admin erasure route refuses non-admins and malformed requests", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const body = { account_id: world.erasedAccount, command_id: "req-1" }

  const denied = await route(env, body, "wrong")
  assert.equal([401, 403].includes(denied.status), true)
  assert.equal((await readBrinedewAccount(world.accounts, world.erasedAccount)).status, "active")

  const invalid = await route(env, { account_id: world.erasedAccount, command_id: " " })
  assert.equal(invalid.status, 400)
  const unknown = await route(env, { account_id: `acct_${"0".repeat(32)}`, command_id: "req-2" })
  assert.equal(unknown.status, 404)
  assert.equal((await readBrinedewAccount(world.accounts, world.erasedAccount)).status, "active")

  const missingStorage = await route(routeEnv({ ...world.env, ICONOPLASM_DB: undefined }), body)
  assert.equal(missingStorage.status, 503)
  assert.equal(
    (await readBrinedewAccount(world.accounts, world.erasedAccount)).status,
    "active",
    "a request that cannot reach every store must not even mark the account pending",
  )
})

test("a verified erasure removes the person, keeps the content and leaves everyone else alone (B-987)", async (t) => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const accountId = world.erasedAccount
  const label = await brinedewFormerAuthorLabel(accountId)
  const fingerprint = await brinedewProviderSubjectFingerprint("discord", ERASED_USER)
  const needles = [ERASED_USER, ERASED_NAME, ERASED_NAME.toUpperCase(), fingerprint]
  const before = snapshot(world)

  // The seed really put the person into every table the erasure steps name; otherwise a step could
  // be deleted without this test noticing.
  const seeded = findTraces(world, needles)
  for (const step of ERASURE_STEPS) {
    if (step.action === "comments") continue
    const database = step.database === "accounts" ? "accounts" : step.database
    assert.ok(
      seeded.includes(`${database}.${step.table}`),
      `the seed has no row of the erased person in ${database}.${step.table}`,
    )
  }
  assert.equal((await sessionOf(world, world.cookies.erased)).status, "signed_in")
  assert.ok(seeded.includes("accounts.brinedew_account_identity_events"))
  assert.ok(seeded.includes("accounts.brinedew_account_lifecycle_events"))
  const tallies = () =>
    rows(
      world.iconoplasm,
      `SELECT gene_symbol, asset_sha256, SUM(vote_value) AS score, COUNT(*) AS votes
         FROM icono_image_votes GROUP BY gene_symbol, asset_sha256 ORDER BY 1, 2`,
    ).map((tally) => ({ ...tally }))
  const tallyBefore = tallies()
  assert.equal(tallyBefore.length, 4)

  // The erasure runs in slices. A small row budget makes this seed take several requests, the way a
  // heavy real account does.
  const requests = []
  for (let attempt = 1; attempt <= 16; attempt += 1) {
    const callsBefore = calls(world)
    const externalBefore = world.network.calls.length
    const response = await route(env, {
      account_id: accountId,
      command_id: "req-1",
      reason_code: "user_request",
      max_rows_written: 150,
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    requests.push({
      ...payload,
      d1Calls: calls(world) - callsBefore,
      external: world.network.calls.length - externalBefore,
    })
    if (attempt === 1) {
      // The person's own browser session is refused from its next request (the server stores none
      // to wipe): the account is already pending, so nothing is written under the Discord id.
      assert.equal(payload.account.status, "erasure_pending")
      const held = await sessionOf(world, world.cookies.erased)
      assert.equal(held.status, "invalid")
      assert.equal(held.accountStatus, "erasure_pending")
    }
    if (payload.erasure.complete) break
  }
  const last = requests.at(-1)
  assert.equal(last.erasure.complete, true, "the erasure finishes within sixteen requests")
  assert.equal(last.account.status, "erased")
  assert.ok(requests.length >= 2, "the small budget forced more than one request")
  assert.equal(requests[0].erasure.complete, false)
  for (const request of requests) {
    // Bounded: the row budget (reserved per pass before it is sent) and the data's D1 calls, plus
    // the thirteen or so of the account lifecycle that wrap them.
    assert.ok(request.erasure.rows_written <= 150, `wrote ${request.erasure.rows_written} rows`)
    assert.ok(
      request.d1Calls <= ERASURE_MAX_D1_CALLS + 15,
      `${request.d1Calls} D1 calls in one request`,
    )
    // The free plan allows 50 external fetches an invocation (Bunny deletes, Discord calls).
    assert.ok(
      request.external <= ERASURE_MAX_EXTERNAL_FETCHES,
      `${request.external} external calls in one request`,
    )
  }

  // 1. The person is gone from every database, key and object.
  assert.deepEqual(findTraces(world, needles), [])

  // 2. The account: erased under its anonymous label, no provider link, no users row, no
  // fingerprint, and the append-only guards are back.
  const account = await readBrinedewAccount(world.accounts, accountId)
  assert.equal(account.status, "erased")
  assert.equal(account.author_label, label)
  assert.equal(
    rows(
      world.accounts,
      "SELECT 1 FROM brinedew_account_identities WHERE account_id = ?",
      accountId,
    ).length,
    0,
  )
  assert.equal(
    rows(world.accounts, "SELECT 1 FROM users WHERE account_id = ?", accountId).length,
    0,
  )
  for (const event of rows(
    world.accounts,
    `SELECT provider_subject_fingerprint, command_id FROM brinedew_account_identity_events
      WHERE account_id = ?`,
    accountId,
  )) {
    assert.match(event.provider_subject_fingerprint, /^erased:identity_event_[0-9a-f]{32}$/)
  }
  assert.ok(
    rows(
      world.accounts,
      `SELECT command_id FROM brinedew_account_lifecycle_events WHERE account_id = ?`,
      accountId,
    ).every((event) => !event.command_id.includes("sha256:")),
  )
  for (const sql of [
    "UPDATE brinedew_account_identity_events SET occurred_at = 0",
    "UPDATE brinedew_account_lifecycle_events SET occurred_at = 0",
    "DELETE FROM brinedew_account_identity_events",
  ]) {
    assert.throws(() => world.accounts.database.exec(sql), /append-only/)
  }
  const outbox = row(
    world.accounts,
    `SELECT source_status, authority_status FROM brinedew_authority_account_projection_outbox
      WHERE account_id = ?`,
    accountId,
  )
  assert.deepEqual({ ...outbox }, { source_status: "erased", authority_status: "tombstoned" })

  // 3. The content stays, with no link to the person.
  const comments = rows(
    world.iconoplasm,
    "SELECT user_id, username, avatar_url, body FROM icono_gene_comments ORDER BY body",
  ).map((comment) => ({ ...comment }))
  assert.deepEqual(comments, [
    { user_id: accountId, username: label, avatar_url: "", body: "Alice before the mirror" },
    { user_id: accountId, username: label, avatar_url: "", body: "Alice on EZH2, edited" },
    { user_id: accountId, username: label, avatar_url: "", body: "Alice on SOX11" },
    { user_id: accountId, username: label, avatar_url: "", body: "Alice on TP53" },
    {
      user_id: OTHER_USER,
      username: OTHER_NAME,
      avatar_url: `https://cdn.discordapp.com/avatars/${OTHER_USER}/abcdef.png`,
      body: "Bob on TP53",
    },
  ])
  assert.equal(world.kv.map.has("iconoplasm:gene-comments:TP53"), false)
  const portraits = rows(
    world.iconoplasm,
    "SELECT asset_sha256, created_by, emulsion_id FROM icono_portrait_assets ORDER BY asset_sha256",
  ).map((portrait) => ({ ...portrait }))
  assert.deepEqual(portraits, [
    { asset_sha256: ASSET.alice, created_by: accountId, emulsion_id: `ERASED-${label.slice(-10)}` },
    { asset_sha256: ASSET.bob, created_by: OTHER_USER, emulsion_id: "0-255" },
    { asset_sha256: ASSET.alice2, created_by: accountId, emulsion_id: "0-255" },
    { asset_sha256: ASSET.workstation, created_by: "workstation", emulsion_id: "0-255" },
  ])
  assert.deepEqual(
    rows(
      world.iconoplasm,
      `SELECT status, requester_user_id, requester_username FROM icono_generation_requests
        WHERE requester_user_id = ? ORDER BY id`,
      accountId,
    ).map((request) => ({ ...request })),
    [
      { status: "fulfilled", requester_user_id: accountId, requester_username: "" },
      { status: "delivery_pending", requester_user_id: accountId, requester_username: "" },
      { status: "open", requester_user_id: accountId, requester_username: "" },
    ],
    "requests with output or in quarantine stay as provenance; the rest are deleted",
  )
  assert.deepEqual(
    rows(
      world.iconoplasm,
      "SELECT id FROM icono_candidate_generation_jobs WHERE user_id = ?",
      accountId,
    ).map((job) => job.id),
    ["cand-alice-published"],
  )
  assert.deepEqual(
    rows(world.iconoplasm, "SELECT id FROM icono_image_edit_jobs WHERE user_id = ?", accountId).map(
      (job) => job.id,
    ),
    ["edit-alice-published"],
  )
  assert.equal(
    row(
      world.iconoplasm,
      "SELECT count(*) AS n FROM icono_publish_events WHERE actor = ?",
      accountId,
    ).n,
    2,
  )
  assert.equal(
    row(world.audit, "SELECT count(*) AS n FROM icono_publish_events WHERE actor = ?", accountId).n,
    1,
  )

  // 4. Votes: dissociated, so every count and every winner is exactly what it was.
  assert.deepEqual(tallies(), tallyBefore)
  assert.equal(
    row(
      world.iconoplasm,
      "SELECT count(*) AS n FROM icono_image_votes WHERE user_id = ?",
      accountId,
    ).n,
    3,
  )
  for (const table of [
    "icono_vote_asset_summary",
    "icono_gene_vote_version",
    "icono_publish_state",
  ]) {
    assert.deepEqual(dumpDatabase(world.iconoplasm)[table], before.iconoplasm[table], table)
  }
  // The person's vote allowance counter (B-1065) goes; the other person's stays.
  assert.equal(
    row(
      world.iconoplasm,
      "SELECT count(*) AS n FROM icono_vote_person_day WHERE user_id = ?",
      ERASED_USER,
    ).n,
    0,
  )

  // 5. GeneGuessr and the settings: the person's rows are gone, the board follows the stats row.
  assert.equal(row(world.accounts, "SELECT 1 FROM stats WHERE user_id = ?", ERASED_USER), null)
  assert.equal(
    row(world.accounts, "SELECT 1 FROM leaderboard_streaks WHERE user_id = ?", ERASED_USER),
    null,
  )
  assert.ok(row(world.accounts, "SELECT 1 FROM leaderboard_streaks WHERE user_id = ?", OTHER_USER))
  assert.equal(
    rows(
      world.iconoplasm,
      "SELECT 1 FROM icono_user_emulsion_option_rollup WHERE emulsion_id LIKE 'ALICE%'",
    ).length,
    0,
  )
  assert.equal(
    rows(
      world.iconoplasm,
      "SELECT 1 FROM icono_user_emulsion_favorites WHERE emulsion_family_id LIKE 'ALICE%'",
    ).length,
    0,
    "other people's favourites of the erased person's emulsion go with it",
  )
  for (const name of [`user_${ERASED_USER}`, `practice_user_${ERASED_USER}`]) {
    assert.equal(world.sessions.objects.get(name).storage.map.size, 0, name)
  }

  // 6. The other person: every row that does not mention the erased person is identical, and their
  // own footprint is whole.
  const after = snapshot(world)
  const aboutErased = [...needles, accountId]
  for (const database of ["accounts", "iconoplasm", "audit"]) {
    const unchanged = rowsNotAbout(before[database], aboutErased)
    for (const [table, tableRows] of Object.entries(unchanged)) {
      for (const tableRow of tableRows) {
        assert.ok(
          after[database][table].includes(tableRow),
          `${database}.${table} lost ${tableRow}`,
        )
      }
    }
  }
  assert.ok(row(world.accounts, "SELECT 1 FROM users WHERE discord_id = ?", OTHER_USER))
  assert.ok(world.sessions.objects.get(`user_${OTHER_USER}`).storage.map.has("game_state"))
  assert.equal((await sessionOf(world, world.cookies.other)).status, "signed_in")
  const otherKeys = iconoplasmUserKvKeyScopes(OTHER_USER)
  for (const key of otherKeys.exact) assert.ok(world.kv.map.has(key), key)
  assert.ok(world.kv.map.has("iconoplasm:catalog:v1:abc"))
  assert.equal(
    [...world.kv.map.keys()].filter((key) => key.startsWith(otherKeys.prefixes[0])).length,
    3,
  )

  // 7. A re-run is a no-op, and a different command on an erased account refuses.
  const settled = snapshot(world)
  const changesBefore = world.accounts.changes + world.iconoplasm.changes + world.audit.changes
  const replay = await route(env, { account_id: accountId, command_id: "req-1" })
  assert.equal(replay.status, 200)
  const replayed = await replay.json()
  assert.equal(replayed.account.replay, true)
  assert.equal(replayed.erasure.complete, true)
  assert.deepEqual(snapshot(world), settled)
  assert.equal(
    world.accounts.changes + world.iconoplasm.changes + world.audit.changes,
    changesBefore,
  )
  const other = await route(env, { account_id: accountId, command_id: "req-other" })
  assert.equal(other.status, 409)
  assert.equal((await other.json()).code, "ACCOUNT_ERASED")

  // 8. The same person signing in again gets a brand-new account: the erased one stays erased under
  // its label, and nothing on the new one links back to it.
  const returning = await resolveBrinedewAccountIdentity(world.accounts, {
    provider: "discord",
    providerSubject: ERASED_USER,
    now: 9_000,
  })
  assert.notEqual(returning.account_id, accountId)
  assert.equal(returning.status, "active")
  assert.equal((await readBrinedewAccount(world.accounts, accountId)).status, "erased")
  world.accounts.database
    .prepare(
      `INSERT INTO users (discord_id, username, tier, leaderboard_opt_in, created_at, updated_at, account_id)
       VALUES (?, ?, 'registered', 0, 9000, 9000, ?)`,
    )
    .run(ERASED_USER, ERASED_NAME, returning.account_id)
  t.diagnostic(
    `${requests.length} requests, rows written per request ${requests
      .map((request) => request.erasure.rows_written)
      .join("/")}, D1 calls per request ${requests.map((request) => request.d1Calls).join("/")}`,
  )
})

test("a failure in the middle of an erasure resumes where it stopped and never completes the account early", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const body = { account_id: world.erasedAccount, command_id: "req-1", max_rows_written: 150 }

  // The Iconoplasm database refuses the second batch of the first request.
  const batch = world.iconoplasm.batch.bind(world.iconoplasm)
  let batches = 0
  world.iconoplasm.batch = async (statements) => {
    batches += 1
    if (batches === 3) throw new Error("D1 unavailable")
    return batch(statements)
  }
  const failed = await route(env, body)
  assert.equal(failed.status, 503)
  assert.equal(
    (await readBrinedewAccount(world.accounts, world.erasedAccount)).status,
    "erasure_pending",
  )
  assert.ok(row(world.accounts, "SELECT 1 FROM users WHERE discord_id = ?", ERASED_USER))
  world.iconoplasm.batch = batch

  let complete = false
  for (let attempt = 0; attempt < 16 && !complete; attempt += 1) {
    const response = await route(env, body)
    assert.equal(response.status, 200)
    complete = (await response.json()).erasure.complete
  }
  assert.equal(complete, true)
  assert.equal((await sessionOf(world, world.cookies.erased)).status, "invalid")
  assert.deepEqual(findTraces(world, [ERASED_USER, ERASED_NAME, ERASED_NAME.toUpperCase()]), [])
})

test("a person-shaped column in any migrated table is either erased or reviewed and exempt", () => {
  const read = (directory, name) =>
    readFileSync(new URL(`../${directory}/${name}`, import.meta.url), "utf8")
  const sorted = (directory) =>
    readdirSync(new URL(`../${directory}/`, import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))
  const iconoplasm = new DatabaseSync(":memory:")
  for (const name of sorted("migrations-iconoplasm"))
    iconoplasm.exec(read("migrations-iconoplasm", name))
  const accounts = new DatabaseSync(":memory:")
  for (const name of sorted("migrations")) {
    // The accounts history holds the proteins catalog and its FTS tables; only the account side is
    // needed, and `games` is dropped by 0022.
    if (/^(001_|0016_|0019_|0020_|0021_|0022_|0026_|0027_|0028_)/.test(name)) {
      accounts.exec(read("migrations", name))
    }
  }
  accounts.exec(
    `CREATE TABLE leaderboard_streaks (user_id TEXT PRIMARY KEY, last_played_date TEXT)`,
  )
  const audit = new DatabaseSync(":memory:")
  audit.exec(`CREATE TABLE icono_publish_events (id INTEGER PRIMARY KEY, actor TEXT)`)

  const covered = new Set(ERASURE_STEPS.flatMap((step) => step.covers))
  const exempt = new Set(Object.keys(EXEMPT_COLUMNS))
  const present = new Set()
  const unhandled = []
  for (const [prefix, database] of [
    ["", iconoplasm],
    ["", accounts],
    ["audit.", audit],
  ]) {
    const tables = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
    for (const { name: table } of tables) {
      for (const { name: column } of database
        .prepare(`SELECT name FROM pragma_table_info('${table}')`)
        .all()) {
        const key = `${prefix}${table}.${column}`
        present.add(key)
        if (PERSON_COLUMN_PATTERN.test(column) && !covered.has(key) && !exempt.has(key)) {
          unhandled.push(key)
        }
      }
    }
  }
  assert.deepEqual(
    unhandled,
    [],
    "a table holds something that looks like a person: add an erasure step or an exempt entry with the reason (workers/iconoplasm/account-erasure/erasure-steps.js)",
  )
  assert.deepEqual(
    [...covered, ...exempt].filter((key) => !present.has(key)),
    [],
    "an erasure step or exempt entry names a column that no longer exists",
  )

  // The caretaker authority keeps authorship and history by opaque account id only: its schema has
  // no column for a provider identity, a name, an avatar or an email.
  const authoring = new DatabaseSync(":memory:")
  for (const name of sorted("migrations-iconoplasm-authoring")) {
    authoring.exec(read("migrations-iconoplasm-authoring", name))
  }
  const identityShaped = []
  for (const { name: table } of authoring
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()) {
    for (const { name: column } of authoring
      .prepare(`SELECT name FROM pragma_table_info('${table}')`)
      .all()) {
      if (/discord|username|avatar|email|provider_subject|fingerprint/i.test(column)) {
        identityShaped.push(`${table}.${column}`)
      }
    }
  }
  assert.deepEqual(identityShaped, [])
})

test("every step's declared weight covers the rows the real schema writes for one changed row", () => {
  const iconoplasm = new DatabaseSync(":memory:")
  const sorted = readdirSync(new URL("../migrations-iconoplasm/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))
  for (const name of sorted) {
    iconoplasm.exec(
      readFileSync(new URL(`../migrations-iconoplasm/${name}`, import.meta.url), "utf8"),
    )
  }
  const accounts = new DatabaseSync(":memory:")
  accounts.exec("PRAGMA foreign_keys = ON")
  for (const name of [
    "001_init.sql",
    "0016_add_leaderboard_opt_in.sql",
    "0019_add_iconoplasm_user_emulsion.sql",
    "0020_iconoplasm_user_emulsion_picker_index.sql",
    "0021_iconoplasm_user_emulsion_history.sql",
    "0026_iconoplasm_user_emulsion_public_slots.sql",
  ]) {
    accounts.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"))
  }
  const audit = new DatabaseSync(":memory:")
  audit.exec(`CREATE TABLE icono_publish_events (id INTEGER PRIMARY KEY, actor TEXT)`)
  const databases = { iconoplasm, accounts, audit }

  // A row costs one write, plus one per index; an UPDATE writes only the indexes that hold a column
  // it changes (the old entry and the new one: two). A WITHOUT ROWID table is its own primary key.
  for (const step of ERASURE_STEPS) {
    const database = databases[step.database]
    const { wr: withoutRowid } = database
      .prepare("SELECT wr FROM pragma_table_list(?) WHERE schema = 'main'")
      .get(step.table)
    const indexes = database
      .prepare("SELECT name FROM pragma_index_list(?)")
      .all(step.table)
      .map((index) => ({
        name: index.name,
        columns: database
          .prepare("SELECT name FROM pragma_index_info(?)")
          .all(index.name)
          .map((column) => column.name),
      }))
    let minimum
    if (step.action === "delete" || step.action === "job_images") {
      minimum = 1 + indexes.length - (withoutRowid ? 1 : 0)
    } else {
      const changed = [...step.set.matchAll(/(\w+)\s*=/g)].map((match) => match[1])
      const touched = indexes.filter((index) =>
        index.columns.some((column) => changed.includes(column)),
      )
      minimum = 1 + 2 * touched.length
    }
    assert.ok(
      step.weight >= minimum,
      `${step.id}: weight ${step.weight} is below the ${minimum} rows one changed row writes in ${step.table}`,
    )
    assert.ok(step.weight <= 12, `${step.id}: weight ${step.weight}`)
  }
  assert.ok(ERASURE_MIN_ROW_WRITES >= Math.max(...ERASURE_STEPS.map((step) => step.weight)))
})

test("a caretaker's manifestation survives the erasure under the anonymous label, with no Discord id in the authority", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const authoring = world.authoring
  const now = "2026-10-03T00:00:00.000Z"
  const terms = "terms_version_0001"
  const inviter = world.otherAccount
  await registerAuthorityAccount(authoring, { accountId: inviter, now })
  await registerAuthorityAccount(authoring, { accountId: world.erasedAccount, now })
  await registerGeneIdentity(authoring, { geneId: "gene_tp53_0001", canonicalSymbol: "TP53", now })
  await registerCaretakerTermsVersion(authoring, {
    termsVersionId: terms,
    termsSha256: sha("f"),
    documentUrl: "https://brinedew.com/iconoplasm/caretaker-terms/v1",
    displayLabel: "Caretaker terms v1",
    effectiveAt: now,
    createdByAccountId: inviter,
  })
  await seedSystemManifestation(authoring, {
    geneId: "gene_tp53_0001",
    storage: storage(1),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: "manifestation_seed_0001",
    revisionId: "revision_seed_0001",
    selectionId: "selection_seed_0001",
    eventUuid: "event_seed_0001",
    now,
    ...command("command_seed_0001", "1", null, "migration"),
  })
  await offerCaretakerAssignment(authoring, {
    geneId: "gene_tp53_0001",
    accountId: world.erasedAccount,
    invitedByAccountId: inviter,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: "assignment_0001",
    eventUuid: "event_offer_0001",
    now,
    ...command("command_offer_0001", "2", inviter, "administrator"),
  })
  await transitionCaretakerAssignment(authoring, {
    assignmentId: "assignment_0001",
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: terms,
    relinquishPolicy: "retain",
    eventUuid: "event_accept_0001",
    now,
    ...command("command_accept_0001", "3", world.erasedAccount, "account"),
  })
  const saved = await saveManifestationRevision(authoring, {
    assignmentId: "assignment_0001",
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    storage: storage(10),
    manifestationId: "manifestation_user_0001",
    revisionId: "revision_user_0001_01",
    eventUuid: "event_save_0001_01",
    now,
    ...command("command_save_0001_01", "4", world.erasedAccount, "account"),
  })

  let complete = false
  for (let attempt = 0; attempt < 12 && !complete; attempt += 1) {
    const response = await route(env, {
      account_id: world.erasedAccount,
      command_id: "req-caretaker",
      max_rows_written: 400,
    })
    assert.equal(response.status, 200)
    complete = (await response.json()).erasure.complete
  }
  assert.equal(complete, true)

  // The scheduled drain carries the erasure into the authority: the account is tombstoned and its
  // assignment ends. The manifestation it wrote stays, authored by the opaque account id.
  const drained = await drainBrinedewAuthorityAccountProjectionOutbox({
    primaryDb: world.accounts,
    authoringDb: authoring,
    limit: 10,
    now: Date.now(),
  })
  assert.ok(
    drained.results.every((result) => result.status === "delivered"),
    JSON.stringify(drained),
  )
  assert.equal(
    authoring.raw
      .prepare("SELECT status FROM icono_authority_accounts WHERE account_id = ?")
      .get(world.erasedAccount).status,
    "tombstoned",
  )
  const manifestation = authoring.raw
    .prepare(
      `SELECT manifestation_id, author_account_id, status FROM icono_manifestations
        WHERE manifestation_id = ?`,
    )
    .get(saved.manifestation_id)
  assert.equal(manifestation.author_account_id, world.erasedAccount)
  assert.notEqual(
    manifestation.status,
    "withdrawn",
    "retained, not withdrawn, by the retain policy",
  )
  assert.equal(
    authoring.raw
      .prepare(
        `SELECT count(*) AS count FROM icono_manifestation_revisions WHERE author_account_id = ?`,
      )
      .get(world.erasedAccount).count >= 1,
    true,
  )

  // Nothing in the authority, which never stored a provider identity, names the person.
  const traces = []
  for (const { name } of authoring.raw
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()) {
    for (const stored of authoring.raw.prepare(`SELECT * FROM ${name}`).all()) {
      const text = JSON.stringify(stored)
      if (text.includes(ERASED_USER) || text.includes(ERASED_NAME)) traces.push(name)
    }
  }
  assert.deepEqual(traces, [])
})

test("an unpublished job's result images leave the storage with the job; published and other people's objects stay (B-993)", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const before = new Set(world.network.objects.keys())

  const requests = await eraseToCompletion(env, world)

  // The two jobs' three renditions each, and the two canonical renditions of the job whose full key
  // pointed somewhere else: eight objects.
  const gone = new Set([
    ...renditionKeys(IMAGE.candidate),
    ...renditionKeys(IMAGE.edit),
    ...renditionKeys(IMAGE.oddKey).slice(1),
  ])
  for (const key of gone)
    assert.equal(world.network.objects.has(key), false, `${key} is still public`)
  // Everything else is exactly where it was: the portraits that were published (including the
  // hash a job shared with a published portrait, B-993's shared-key case), the other person's
  // image, the gene object a job row named, and the oddly keyed job's own full rendition.
  assert.deepEqual(
    [...world.network.objects.keys()].sort(),
    [...before].filter((key) => !gone.has(key)).sort(),
  )
  assert.equal(world.network.objects.has("genes/v3/TP53.json"), true)
  for (const key of renditionKeys(IMAGE.bob)) assert.equal(world.network.objects.has(key), true)
  for (const key of renditionKeys("c".repeat(64))) {
    assert.equal(world.network.objects.has(key), true, "a published portrait lost an object")
  }
  const changed = Object.assign({}, ...requests.map((request) => request.erasure.changed))
  assert.equal(
    requests.reduce((sum, request) => sum + (request.erasure.changed.job_image_objects || 0), 0),
    gone.size,
  )
  assert.ok(changed.candidate_job_images >= 1 || changed.edit_job_images >= 1)
  // None of the person's unpublished jobs is left, with or without an image.
  assert.deepEqual(
    rows(world.iconoplasm, "SELECT id FROM icono_candidate_generation_jobs ORDER BY id").map(
      (job) => job.id,
    ),
    ["cand-alice-published", "cand-bob-image", "cand-bob-queued"],
  )
  assert.deepEqual(
    rows(world.iconoplasm, "SELECT id FROM icono_image_edit_jobs ORDER BY id").map((job) => job.id),
    ["edit-alice-published", "edit-bob-queued"],
  )
})

test("a failed storage delete leaves the job row, and the next request finishes the job", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  world.network.storageFailures = 1

  const failed = await route(env, { account_id: world.erasedAccount, command_id: "req-1" })
  assert.equal(failed.status, 503)
  assert.equal((await failed.json()).code, "ERASURE_FAILED")
  assert.equal(
    (await readBrinedewAccount(world.accounts, world.erasedAccount)).status,
    "erasure_pending",
  )
  // The job rows that name the undeleted objects are still there: nothing remembers the keys
  // anywhere else.
  assert.ok(
    row(
      world.iconoplasm,
      "SELECT 1 FROM icono_candidate_generation_jobs WHERE id = 'cand-alice-image'",
    ),
  )
  assert.ok(
    row(world.iconoplasm, "SELECT 1 FROM icono_image_edit_jobs WHERE id = 'edit-alice-image'"),
  )

  await eraseToCompletion(env, world)
  for (const hash of [IMAGE.candidate, IMAGE.edit]) {
    for (const key of renditionKeys(hash)) assert.equal(world.network.objects.has(key), false, key)
  }
})

test("a person with many stored images takes several requests, each within the external-call bound", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const insertJob = world.iconoplasm.database.prepare(
    `INSERT INTO icono_image_edit_jobs
       (id, user_id, provider_id, source_gene_symbol, source_asset_sha256, status,
        result_asset_sha256, result_r2_key_full, result_r2_key_medium, result_r2_key_thumb)
     VALUES (?, ?, 'openai', 'TP53', ?, 'succeeded', ?, ?, ?, ?)`,
  )
  for (let index = 1; index <= 30; index += 1) {
    const hash = String(index).padStart(4, "0").repeat(16)
    const [full, medium, thumb] = renditionKeys(hash)
    insertJob.run(
      `edit-alice-bulk-${index}`,
      ERASED_USER,
      "b".repeat(64),
      hash,
      full,
      medium,
      thumb,
    )
    for (const key of [full, medium, thumb]) world.network.storeObject(key)
  }

  const requests = await eraseToCompletion(env, world, {}, 16)

  assert.ok(requests.length >= 3, "ninety more objects cannot fit in one request")
  for (const request of requests) {
    assert.ok(request.external <= ERASURE_MAX_EXTERNAL_FETCHES, `${request.external} calls`)
  }
  for (let index = 1; index <= 30; index += 1) {
    for (const key of renditionKeys(String(index).padStart(4, "0").repeat(16))) {
      assert.equal(world.network.objects.has(key), false, `${key} is still public`)
    }
  }
  assert.equal(
    row(
      world.iconoplasm,
      "SELECT count(*) AS n FROM icono_image_edit_jobs WHERE id LIKE 'edit-alice-bulk-%'",
    ).n,
    0,
  )
})

test("the public Discord copy of a comment names the anonymous label; a removed comment's post is deleted (B-992)", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  const label = await brinedewFormerAuthorLabel(world.erasedAccount)
  const original = world.network.messages.map((message) => ({ ...message }))
  const seededCalls = world.network.callsTo("discord").length
  const header = (symbol) =>
    `New comment on **${symbol}** gene: <https://iconoplasm.brinedew.bio/gene/${symbol}>\n\n`

  const requests = await eraseToCompletion(env, world)

  // No post of the bot names her any more.
  assert.deepEqual(
    botPosts(world).filter((message) => message.content.includes(ERASED_NAME)),
    [],
  )
  const contents = botPosts(world).map((message) => message.content)
  // Her comments stay in the channel, under the label, with the text they were posted with
  // (including the one she edited on the site after it was posted).
  assert.ok(contents.includes(`${header("TP53")}**${label}**: Alice on TP53`))
  assert.ok(contents.includes(`${header("SOX11")}**${label}**: Alice on SOX11`))
  assert.ok(contents.includes(`${header("EZH2")}**${label}**: Alice on EZH2, first draft`))
  // The comment she removed is gone from the channel, and only that one.
  assert.equal(
    contents.some((content) => content.includes("Alice removed this")),
    false,
  )
  assert.equal(contents.filter((content) => content.includes("Alice on TP53")).length, 1)
  // Everything that is not her post is exactly as it was: Bob's comment, the recap, the chatter
  // and a person's own copy of her post (a person's message is not the bot's to edit).
  const after = new Map(world.network.messages.map((message) => [message.id, message]))
  for (const message of original) {
    const touchedPost = message.author.bot && message.content.includes(ERASED_NAME)
    if (!touchedPost) assert.deepEqual(after.get(message.id), message, message.content)
  }
  assert.ok(contents.includes(`${header("TP53")}**${OTHER_NAME}**: Bob on TP53`))
  const total = (name) =>
    requests.reduce((sum, request) => sum + (request.erasure.changed[name] || 0), 0)
  assert.equal(total("discord_posts_edited"), 3)
  assert.equal(total("discord_posts_deleted"), 1)
  assert.equal(
    total("discord_posts_not_found"),
    1,
    "the comment from before the mirror has no post",
  )
  assert.equal(requests.at(-1).erasure.discord_mirror, "processed")
  assert.equal(total("comments"), 5, "four comments rewritten, one deleted")
  // Two Discord calls a comment at most: a find, then an edit or a delete.
  assert.ok(world.network.callsTo("discord").length - seededCalls <= 2 * 5)
})

test("a rate-limited Discord ends the request without losing work, and the next request finishes", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  world.network.rateLimits = 1

  const requests = await eraseToCompletion(env, world)

  assert.equal(requests[0].erasure.complete, false)
  assert.equal(requests[0].erasure.retry_after_seconds, 3)
  assert.equal(requests[0].account.status, "erasure_pending")
  assert.equal(requests.at(-1).erasure.complete, true)
  assert.deepEqual(
    botPosts(world).filter((message) => message.content.includes(ERASED_NAME)),
    [],
  )
})

test("a Discord the bot cannot read refuses the erasure with its cause; the operator can skip the mirror explicitly", async () => {
  const world = await erasedWorld()
  const env = routeEnv(world.env)
  world.network.discordStatus = 403

  const refused = await route(env, { account_id: world.erasedAccount, command_id: "req-1" })
  assert.equal(refused.status, 503)
  const failure = await refused.json()
  assert.equal(failure.code, "DISCORD_MIRROR_FORBIDDEN")
  assert.match(failure.error, /Read Message History/)
  // Nothing was lost: her comments still carry her Discord id, and the account is still pending.
  assert.equal(
    row(
      world.iconoplasm,
      "SELECT count(*) AS n FROM icono_gene_comments WHERE user_id = ?",
      ERASED_USER,
    ).n,
    5,
  )
  assert.equal(
    (await readBrinedewAccount(world.accounts, world.erasedAccount)).status,
    "erasure_pending",
  )

  // A deployment without the bot never mirrored a comment; the operator may also skip it by name.
  const discordCalls = world.network.callsTo("discord").length
  assert.ok(discordCalls > 0)
  const skipped = await eraseToCompletion(env, world, { skip_discord_mirror: true })
  assert.equal(skipped.at(-1).erasure.discord_mirror, "skipped")
  assert.equal(world.network.callsTo("discord").length, discordCalls, "no Discord call was made")
  assert.equal(
    row(
      world.iconoplasm,
      "SELECT count(*) AS n FROM icono_gene_comments WHERE user_id = ?",
      ERASED_USER,
    ).n,
    0,
  )

  const unconfigured = await erasedWorld()
  const seeded = unconfigured.network.callsTo("discord").length
  const unconfiguredEnv = routeEnv({ ...unconfigured.env, DISCORD_BOT_TOKEN: "" })
  const finished = await eraseToCompletion(unconfiguredEnv, unconfigured)
  assert.equal(finished.at(-1).erasure.discord_mirror, "not_configured")
  assert.equal(unconfigured.network.callsTo("discord").length, seeded)
})

test("the comment mirror's shape is found and rewritten for any username, however it is spelled", () => {
  const link = "https://iconoplasm.brinedew.bio/gene/TP53"
  for (const username of [
    "Dr. Who? (the *real* one)",
    "a**b",
    "x|y[1]^$\\",
    "ünïcødé 蛋白",
    "  padded  ",
  ]) {
    const posted = commentMirrorContent({ symbol: "TP53", link, username, body: "p53 is **bold**" })
    const rewritten = commentMirrorWithAuthor(posted, {
      symbol: "TP53",
      username,
      author: "Former caretaker · 0123456789",
    })
    assert.equal(
      rewritten,
      `New comment on **TP53** gene: <${link}>\n\n**Former caretaker · 0123456789**: p53 is **bold**`,
      username,
    )
  }
  // Another gene or another author is not this post.
  const posted = commentMirrorContent({ symbol: "TP53", link, username: "ada", body: "hi" })
  assert.equal(
    commentMirrorWithAuthor(posted, { symbol: "SOX11", username: "ada", author: "x" }),
    null,
  )
  assert.equal(
    commentMirrorWithAuthor(posted, { symbol: "TP53", username: "adam", author: "x" }),
    null,
  )
})
