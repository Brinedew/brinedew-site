import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  ADMIN_TOKEN,
  ASSET,
  ERASED_NAME,
  ERASED_USER,
  OTHER_NAME,
  OTHER_USER,
  dumpDatabase,
  findTraces,
  seedSessionsAndKv,
  seedWorld,
} from "./test-helpers/account-erasure-fixture.js"
import { viaStatefulWorker } from "./test-helpers/via-stateful-worker.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  iconoplasmUserKvKeyScopes,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  ERASURE_MAX_D1_CALLS,
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
// 6. one request is unbounded in D1 calls or rows written.

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
  const gatewayEnv = { ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN, ...worldEnv }
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

async function erasedWorld() {
  const world = await seedWorld()
  await seedSessionsAndKv(world, iconoplasmUserKvKeyScopes)
  return world
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
  assert.ok(seeded.some((entry) => entry.startsWith("do:session:alice-session")))
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
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const callsBefore = calls(world)
    const response = await route(env, {
      account_id: accountId,
      command_id: "req-1",
      reason_code: "user_request",
      max_rows_written: 150,
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    requests.push({ ...payload, d1Calls: calls(world) - callsBefore })
    if (attempt === 1) {
      // The person's own browser session is refused and wiped by its next request: the account is
      // already pending, so nothing is written under the Discord id from here on.
      assert.equal(payload.account.status, "erasure_pending")
      const held = await world.sessions.get("session:alice-session").fetch("http://internal/get")
      assert.equal(held.status, 401)
      assert.equal(world.sessions.objects.get("session:alice-session").storage.map.size, 0)
    }
    if (payload.erasure.complete) break
  }
  const last = requests.at(-1)
  assert.equal(last.erasure.complete, true, "the erasure finishes within a dozen requests")
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
    "icono_vote_daily_budget",
  ]) {
    assert.deepEqual(dumpDatabase(world.iconoplasm)[table], before.iconoplasm[table], table)
  }

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
  assert.ok(world.sessions.objects.get("session:bob-session").storage.map.has("data"))
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
  for (let attempt = 0; attempt < 12 && !complete; attempt += 1) {
    const response = await route(env, body)
    assert.equal(response.status, 200)
    complete = (await response.json()).erasure.complete
  }
  assert.equal(complete, true)
  // The person's own session is refused and wiped by its next request.
  await world.sessions.get("session:alice-session").fetch("http://internal/get")
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
    if (step.action === "delete") {
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
