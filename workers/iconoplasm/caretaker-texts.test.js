import assert from "node:assert/strict"
import test from "node:test"

import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"
import { createIconoplasmApp } from "./app.js"
import { withdrawCaretakerTextStatements } from "./caretaker-texts.js"
import { writeFactoryGeneText } from "./gene-text-write.js"
import { readGeneText } from "../lib/iconoplasm-gene-text.js"

// B-1065: the caretaker panel's text routes, through the real Hono app into the
// real main schema (every migration). Failure modes written before the code:
// 1. a save lands in the wrong line, numbers its version wrongly, or a save with
//    Tags does not become the text new images are drawn from;
// 2. an autosave retried with the same command ID saves twice;
// 3. a save without Tags replaces the chosen text (it has nothing to draw from);
// 4. someone who never cared for the gene reads its panel, or a past caretaker
//    writes to it;
// 5. a cross-site form or a non-JSON body writes;
// 6. withdrawing the chosen line leaves the gene on a withdrawn text, falls back
//    to a text without Tags, or restore brings back versions withdrawn earlier;
// 7. the card is rebuilt on every hidden autosave, or not rebuilt when what
//    readers see changes;
// 8. the panel loses the chosen text or the factory's text beyond History's
//    first page, or the Tags route hands out another gene's Tags;
// 9. ending a role with "withdraw" (admin) or erasing a "withdraw" account
//    leaves its plain versions in use;
// 10. (B-724) a candidate made from version 1 is shown as made from a later
//    version, a legacy image gets an invented source, the sources reach a
//    stranger, or the lookup reads another gene's pool;
// 11. History names a caretaker by their account, or two caretakers alike, or
//    a removed account by its old name;
// 12. (B-1106) a caretaker's "Show on the gene page" choice made before their
//    first save is lost, or a later save overrides the line's own flag.

const ORIGIN = "https://iconoplasm.test"
const CARETAKER = "account_caretaker_0001"
const OTHER = "account_caretaker_0002"
const STRANGER = "account_stranger_0003"
const NOW = "2026-10-11T08:00:00.000Z"

function assignment(db, { id, accountId, status = "active" }) {
  const ended = status === "ended"
  db.raw
    .prepare(
      `INSERT INTO icono_caretaker_assignments
         (caretaker_assignment_id, gene_symbol, account_id, status, terms_accepted_at,
          relinquish_policy, invited_by_account_id, started_at, ended_at, end_reason, created_at)
       VALUES (?, 'MFNG', ?, ?, ?, 'retain', ?, ?, ?, ?, ?)`,
    )
    .run(id, accountId, status, NOW, accountId, NOW, ended ? NOW : null, ended ? "test" : null, NOW)
}

async function harness(t, { accounts = null } = {}) {
  const db = iconoplasmDatabase()
  db.raw = db.database
  // Every statement the routes prepare, for the read-cost checks.
  db.statements = []
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    db.statements.push(sql)
    return prepare(sql)
  }
  t.after(() => db.database.close())
  const published = []
  const env = { ICONOPLASM_DB: db, ...(accounts ? { DB: accounts } : {}) }
  const app = createIconoplasmApp({
    isAdmin: async () => true,
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async (_env, symbol) => {
      published.push(symbol)
      return {}
    },
    refreshSummaries: async () => {},
    accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
    caretakerSession: async (request) => ({ account_id: request.headers.get("x-test-account") }),
  })
  await writeFactoryGeneText(env, {
    symbol: "MFNG",
    text: "The factory's MFNG.",
    tags: "factory, tag",
    fields: { mood: ["calm"] },
  })
  assignment(db, { id: "assignment_old_0002", accountId: OTHER, status: "ended" })
  assignment(db, { id: "assignment_now_0001", accountId: CARETAKER })

  let commands = 0
  const call = async (method, suffix, body, { as = CARETAKER, headers = {} } = {}) => {
    const response = await app.request(
      `${ORIGIN}/api/iconoplasm/caretaker/genes/MFNG${suffix}`,
      {
        method,
        headers: {
          "x-test-account": as,
          ...(body
            ? {
                "content-type": "application/json",
                origin: ORIGIN,
                "sec-fetch-site": "same-origin",
              }
            : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      env,
    )
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const save = (
    prose,
    { tags = "a tag", commandId = `cmd_${String(++commands).padStart(32, "0")}`, as, visible } = {},
  ) =>
    tags
      ? call(
          "POST",
          "/saves",
          {
            prose,
            tags_text: tags,
            fields_json: { mood: ["warm"] },
            command_id: commandId,
            ...(visible === undefined ? {} : { visible }),
          },
          { as },
        )
      : call(
          "POST",
          "/revisions",
          { prose, command_id: commandId, ...(visible === undefined ? {} : { visible }) },
          { as },
        )
  const versions = () =>
    db.raw
      .prepare(
        `SELECT version_id, line_id, version, text, tags, readers_see, withdrawn_at
           FROM icono_caretaker_text_versions ORDER BY created_at, version_id`,
      )
      .all()
  const chosen = async () => (await readGeneText(db, "MFNG")).text
  return { db, env, call, save, versions, chosen, published }
}

test("1, 2, 3: saves number within one line, a retry saves once, and only a save with Tags is drawn from", async (t) => {
  const h = await harness(t)
  const first = await h.save("Version one.", { commandId: "cmd_retry_000000000000000000000001" })
  assert.equal(first.status, 200)
  assert.equal(await h.chosen(), "Version one.")
  const retry = await h.save("Version one.", { commandId: "cmd_retry_000000000000000000000001" })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.manifestation_revision_id, first.body.manifestation_revision_id)
  await h.save("Version two, prose only.", { tags: null })
  const rows = h.versions()
  assert.deepEqual(
    rows.map((row) => [row.version, row.text, row.tags]),
    [
      [1, "Version one.", "a tag"],
      [2, "Version two, prose only.", null],
    ],
  )
  assert.equal(new Set(rows.map((row) => row.line_id)).size, 1)
  assert.equal(await h.chosen(), "Version one.")
})

test("4, 5: strangers see no panel, past caretakers cannot write, and cross-site writes are refused", async (t) => {
  const h = await harness(t)
  assert.deepEqual((await h.call("GET", "", null, { as: STRANGER })).body, { enabled: false })
  const past = await h.call("GET", "", null, { as: OTHER })
  assert.equal(past.body.enabled, true)
  assert.equal(past.body.viewer.can_edit, false)
  assert.equal((await h.save("Not mine.", { as: OTHER })).status, 404)
  assert.equal((await h.save("Not mine.", { as: STRANGER })).status, 404)
  const crossSite = await h.call(
    "POST",
    "/saves",
    { prose: "x", tags_text: "y", command_id: "cmd_cross_000000000000000000000001" },
    { headers: { "sec-fetch-site": "cross-site" } },
  )
  assert.equal(crossSite.status, 403)
  const notJson = await h.call(
    "POST",
    "/saves",
    { prose: "x", tags_text: "y", command_id: "cmd_plain_000000000000000000000001" },
    { headers: { "content-type": "text/plain" } },
  )
  assert.equal(notJson.status, 415)
  assert.equal(h.versions().length, 0)
})

test("6: withdrawing the chosen line falls back to a text with Tags; restore brings back only that withdrawal", async (t) => {
  const h = await harness(t)
  // An earlier caretaker's line, as the backfill left it.
  h.db.raw
    .prepare(
      `INSERT INTO icono_caretaker_text_versions
         (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
          text, text_sha256, tags, fields_json, created_at)
       VALUES ('revision_earlier_tagged', 'MFNG', 'manifestation_earlier', 1, ?,
               'assignment_old_0002', 'Earlier caretaker text.', ?, 'old tag', '{}',
               '2026-09-01T00:00:00.000Z')`,
    )
    .run(OTHER, "0".repeat(64))
  const one = await h.save("Mine, one.")
  await h.save("Mine, two.")
  const line = one.body.manifestation_id
  // Version 1 withdrawn on its own earlier; restore must not bring it back.
  h.db.raw
    .prepare(
      `UPDATE icono_caretaker_text_versions SET withdrawn_at = '2026-10-01T00:00:00.000Z' WHERE version_id = ?`,
    )
    .run(one.body.manifestation_revision_id)
  assert.equal(await h.chosen(), "Mine, two.")
  assert.equal(
    (
      await h.call("DELETE", `/manifestations/${line}`, {
        command_id: "cmd_withdraw_0000000000000000000001",
      })
    ).status,
    200,
  )
  assert.equal(await h.chosen(), "Earlier caretaker text.")
  assert.equal(
    (
      await h.call("DELETE", "/manifestations/factory", {
        command_id: "cmd_withdraw_0000000000000000000002",
      })
    ).status,
    409,
  )
  assert.equal(
    (
      await h.call("POST", `/manifestations/${line}/restore`, {
        command_id: "cmd_restore_00000000000000000000001",
      })
    ).status,
    200,
  )
  assert.equal(await h.chosen(), "Mine, two.")
  const mine = h.versions().filter((row) => row.line_id === line)
  assert.deepEqual(
    mine.map((row) => [row.version, Boolean(row.withdrawn_at)]),
    [
      [1, true],
      [2, false],
    ],
  )
  // With every caretaker text withdrawn, the gene goes back to the factory's.
  await h.call("DELETE", `/manifestations/${line}`, {
    command_id: "cmd_withdraw_0000000000000000000003",
  })
  await h.call("DELETE", "/manifestations/manifestation_earlier", {
    command_id: "cmd_withdraw_0000000000000000000004",
  })
  assert.equal(await h.chosen(), "The factory's MFNG.")
})

test("7: the card is rebuilt only when what readers see changes", async (t) => {
  const h = await harness(t)
  const first = await h.save("Hidden one.")
  await h.save("Hidden two.")
  assert.deepEqual(h.published, [])
  const line = first.body.manifestation_id
  await h.call("POST", `/manifestations/${line}/page-visibility`, {
    visible: true,
    command_id: "cmd_visible_00000000000000000000001",
  })
  assert.deepEqual(h.published, ["MFNG"])
  assert.equal((await readGeneText(h.db, "MFNG")).readers_see, true)
  await h.save("Shown three.")
  assert.deepEqual(h.published, ["MFNG", "MFNG"])
  // A prose-only save changes nothing readers see.
  await h.save("Draft four.", { tags: null })
  assert.deepEqual(h.published, ["MFNG", "MFNG"])
  assert.equal(
    (
      await h.call("POST", `/manifestations/${line}/page-visibility`, {
        visible: "yes",
        command_id: "cmd_visible_00000000000000000000002",
      })
    ).status,
    400,
  )
})

test("12: the first save carries the switch; later saves keep the line's flag", async (t) => {
  const h = await harness(t)
  await h.save("Shown from the start.", { visible: true })
  assert.deepEqual(h.published, ["MFNG"])
  assert.equal((await readGeneText(h.db, "MFNG")).readers_see, true)
  await h.save("Still shown.", { visible: false })
  assert.deepEqual(
    h.versions().map((row) => row.readers_see),
    [1, 1],
  )
})

test("8: the panel keeps the chosen and factory texts beyond History's first page, and Tags stay per gene", async (t) => {
  const h = await harness(t)
  const chosenSave = await h.save("The chosen one.")
  for (let index = 0; index < 22; index += 1) await h.save(`Draft ${index}.`, { tags: null })
  const page = await h.call("GET", "")
  assert.equal(page.status, 200)
  const dossier = page.body
  assert.equal(dossier.head.canonical_revision_id, chosenSave.body.manifestation_revision_id)
  assert.equal(dossier.history.total_count, 23)
  assert.ok(dossier.history.next_cursor)
  const lines = dossier.manifestations.map((line) => line.manifestation_id)
  assert.deepEqual(lines, ["factory", chosenSave.body.manifestation_id])
  assert.equal(dossier.manifestations[1].revisions.length, 20)
  const pinned = dossier.pinned_revisions.map((revision) => revision.body)
  assert.ok(pinned.includes("The chosen one."))
  assert.ok(pinned.includes("The factory's MFNG."))
  assert.equal(dossier.manifestations[1].author_label, "You")
  assert.equal(dossier.viewer.can_edit, true)
  // Saves in one test share milliseconds, so only the split is checked: every
  // version once, across the two pages.
  const older = await h.call(
    "GET",
    `?history_cursor=${encodeURIComponent(dossier.history.next_cursor)}`,
  )
  const pages = [dossier, older.body].flatMap((body) =>
    body.manifestations[1].revisions.map((revision) => revision.revision_number),
  )
  assert.equal(older.body.history.next_cursor, null)
  assert.deepEqual(
    pages.sort((a, b) => a - b),
    Array.from({ length: 23 }, (_, index) => index + 1),
  )
  const tags = await h.call("GET", `/derivatives/${chosenSave.body.manifestation_revision_id}/body`)
  assert.deepEqual(tags.body.tags.fields_json, { mood: ["warm"] })
  assert.equal(tags.body.tags.tags_text, "a tag")
  const factoryTags = await h.call(
    "GET",
    `/derivatives/${dossier.manifestations[0].manifestation_head_revision_id}/body`,
  )
  assert.equal(factoryTags.body.tags.tags_text, "factory, tag")
  assert.equal(
    (
      await h.call("GET", `/derivatives/${chosenSave.body.manifestation_revision_id}/body`, null, {
        as: STRANGER,
      })
    ).status,
    403,
  )
})

test("9: a role's withdrawal takes all its versions out of use and the gene falls back", async (t) => {
  const h = await harness(t)
  await h.save("Mine, chosen.")
  assert.equal(await h.chosen(), "Mine, chosen.")
  await h.db.batch(
    withdrawCaretakerTextStatements(h.db, {
      symbol: "MFNG",
      assignmentId: "assignment_now_0001",
      at: NOW,
    }),
  )
  assert.equal(await h.chosen(), "The factory's MFNG.")
  assert.ok(h.versions().every((row) => row.withdrawn_at === NOW))
})

const hex = (character) => character.repeat(64)

// Seeded the way production writes them: the factory's register route leaves
// every Drain portrait's asset row legacy_unbound, and the request fulfilment
// writes the source into a receipt (persistPortraitGenerationReceipt). An
// earlier seed bound the asset row itself, which production never does, so
// this test passed while every live candidate showed no link.
function candidate(db, symbol, assetSha, sourceVersionId) {
  db.raw
    .prepare(
      `INSERT INTO icono_portrait_assets
         (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, status)
       VALUES (?, ?, 'hero', 'thumb', 'draft')`,
    )
    .run(symbol, assetSha)
  if (sourceVersionId == null) return
  db.raw
    .prepare(
      `INSERT INTO icono_portrait_generation_provenance (
         generation_request_id, generation_attempt_id, gene_symbol, asset_sha256,
         source_gene_id, source_manifestation_id, source_manifestation_revision_id,
         source_manifestation_body_sha256, source_canonical_selection_id,
         source_canonical_head_version, source_gene_revision, source_snapshot_sha256,
         provider_id, model_id, prompt_sha256, generation_config_sha256
       ) VALUES (?, ?, ?, ?, 'gene_for_test', 'line_for_test', ?, ?, 'selection_for_test',
                 1, 1, ?, 'provider', 'model', ?, ?)`,
    )
    .run(
      `request_${assetSha.slice(0, 12)}`,
      `attempt_${assetSha.slice(0, 12)}`,
      symbol,
      assetSha,
      sourceVersionId,
      hex("3"),
      hex("4"),
      hex("1"),
      hex("2"),
    )
}

test("10: a candidate keeps pointing at the version that made it, for its caretaker only", async (t) => {
  const h = await harness(t)
  const first = await h.save("First words.")
  candidate(h.db, "MFNG", hex("a"), first.body.manifestation_revision_id)
  candidate(h.db, "MFNG", hex("c"), null)
  candidate(h.db, "OTHER1", hex("d"), "revision_belongs_to_another_gene")
  const second = await h.save("Second words, after another edit.")
  candidate(h.db, "MFNG", hex("b"), second.body.manifestation_revision_id)

  h.db.statements.length = 0
  const dossier = (await h.call("GET", "")).body
  const sources = new Map(
    dossier.candidate_sources.map((entry) => [
      entry.asset_sha256,
      entry.source_manifestation_revision_id,
    ]),
  )
  assert.equal(sources.get(hex("a")), first.body.manifestation_revision_id, "still version 1")
  assert.equal(sources.get(hex("b")), second.body.manifestation_revision_id)
  assert.equal(sources.size, 2, "no invented source for a legacy image, none from another gene")
  const history = dossier.manifestations
    .flatMap((line) => line.revisions)
    .find((revision) => revision.manifestation_revision_id === first.body.manifestation_revision_id)
  assert.equal(history.body, "First words.")
  const pool = h.db.statements.filter((sql) => /icono_portrait_generation_provenance/.test(sql))
  assert.equal(pool.length, 1, "one receipt read per panel")
  const plan = h.db.raw
    .prepare(`EXPLAIN QUERY PLAN ${pool[0]}`)
    .all("MFNG")
    .map((row) => row.detail)
    .join(" | ")
  assert.match(plan, /idx_icono_portrait_generation_provenance_gene/, `no table scan: ${plan}`)
  assert.match(pool[0], /WHERE gene_symbol = \?/)
  assert.doesNotMatch(pool[0], /upper\(|lower\(/i)

  h.db.statements.length = 0
  assert.deepEqual((await h.call("GET", "", null, { as: STRANGER })).body, { enabled: false })
  assert.equal(
    h.db.statements.filter((sql) => /icono_portrait_generation_provenance/.test(sql)).length,
    0,
    "a stranger's request never reads the receipts",
  )
})

test("11: History names each caretaker by a pseudonym of their own, and a removed account as removed", async (t) => {
  const accounts = iconoplasmDatabase()
  t.after(() => accounts.database.close())
  accounts.database.exec(
    `CREATE TABLE brinedew_accounts (account_id TEXT PRIMARY KEY, status TEXT NOT NULL)`,
  )
  accounts.database
    .prepare(`INSERT INTO brinedew_accounts VALUES (?, 'erased')`)
    .run("account_removed_0004")
  const h = await harness(t, { accounts })
  for (const [id, account] of [
    ["revision_other_0001", OTHER],
    ["revision_removed_0001", "account_removed_0004"],
  ])
    h.db.raw
      .prepare(
        `INSERT INTO icono_caretaker_text_versions
           (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
            text, text_sha256, created_at)
         VALUES (?, 'MFNG', ?, 1, ?, 'assignment_old_0002', 'Words.', ?, '2026-09-01T00:00:00.000Z')`,
      )
      .run(id, `line_${id}`, account, "0".repeat(64))
  await h.save("Mine.")
  const labels = Object.fromEntries(
    (await h.call("GET", "")).body.manifestations.map((line) => [
      line.manifestation_id,
      line.author_label,
    ]),
  )
  assert.match(labels.line_revision_other_0001, /^Caretaker [0-9A-F]{8}$/)
  assert.equal(labels.line_revision_removed_0001, "Removed account")
  assert.ok(Object.values(labels).includes("You"))
  // The same account keeps its pseudonym; another account gets another.
  const again = (await h.call("GET", "")).body.manifestations.find(
    (line) => line.manifestation_id === "line_revision_other_0001",
  )
  assert.equal(again.author_label, labels.line_revision_other_0001)
  assert.notEqual(labels.line_revision_other_0001, "Caretaker " + "0".repeat(8))
})
