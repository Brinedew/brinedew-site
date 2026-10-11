import assert from "node:assert/strict"
import test from "node:test"

import { TestD1 } from "./caretaker/manifestation-authority-test-support.js"
import { createIconoplasmApp } from "./app.js"
import { withdrawCaretakerTextStatements } from "./caretaker-texts.js"
import { writeFactoryGeneText } from "./gene-text-write.js"
import { readGeneText } from "../lib/iconoplasm-gene-text.js"

// B-1065 B2a: the caretaker panel's text routes, through the real Hono app into
// the real authoring schema (every migration). Failure modes written before the
// code:
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
//    leaves its plain versions in use.

const ORIGIN = "https://iconoplasm.test"
const CARETAKER = "account_caretaker_0001"
const OTHER = "account_caretaker_0002"
const STRANGER = "account_stranger_0003"
const NOW = "2026-10-11T08:00:00.000Z"

async function account(db, id, label) {
  db.raw
    .prepare(`INSERT INTO icono_authority_accounts (account_id, public_credit_label) VALUES (?, ?)`)
    .run(id, label)
}

function assignment(db, { id, geneId, accountId, status = "active" }) {
  const ended = status === "ended"
  db.raw
    .prepare(
      `INSERT INTO icono_caretaker_assignments
         (caretaker_assignment_id, gene_id, account_id, status, terms_accepted_at,
          entitlement_policy_version, relinquish_policy, invited_by_account_id, started_at,
          ended_at, end_reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'v1', 'retain', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      geneId,
      accountId,
      status,
      NOW,
      accountId,
      NOW,
      ended ? NOW : null,
      ended ? "test" : null,
      NOW,
    )
}

async function harness(t) {
  const db = new TestD1()
  t.after(() => db.close())
  const published = []
  const env = { ICONOPLASM_AUTHORING_DB: db }
  const app = createIconoplasmApp({
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async (_env, symbol) => {
      published.push(symbol)
      return {}
    },
    refreshSummaries: async () => {},
    accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
    windowUsage: async () => null,
    caretakerSession: async (request) => ({ account_id: request.headers.get("x-test-account") }),
  })
  await writeFactoryGeneText(env, {
    symbol: "MFNG",
    text: "The factory's MFNG.",
    tags: "factory, tag",
    fields: { mood: ["calm"] },
  })
  const geneId = (await readGeneText(db, "MFNG")).gene_id
  await account(db, CARETAKER, "Caretaker One")
  await account(db, OTHER, "Caretaker Two")
  await account(db, STRANGER, "Stranger Three")
  assignment(db, { id: "assignment_old_0002", geneId, accountId: OTHER, status: "ended" })
  assignment(db, { id: "assignment_now_0001", geneId, accountId: CARETAKER })

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
    { tags = "a tag", commandId = `cmd_${String(++commands).padStart(32, "0")}`, as } = {},
  ) =>
    tags
      ? call(
          "POST",
          "/saves",
          { prose, tags_text: tags, fields_json: { mood: ["warm"] }, command_id: commandId },
          { as },
        )
      : call("POST", "/revisions", { prose, command_id: commandId }, { as })
  const versions = () =>
    db.raw
      .prepare(
        `SELECT version_id, line_id, version, text, tags, readers_see, withdrawn_at
           FROM icono_caretaker_text_versions ORDER BY created_at, version_id`,
      )
      .all()
  const chosen = async () => (await readGeneText(db, "MFNG")).text
  return { db, env, geneId, call, save, versions, chosen, published }
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
         (version_id, gene_id, line_id, version, account_id, caretaker_assignment_id,
          text, text_sha256, tags, fields_json, created_at)
       VALUES ('revision_earlier_tagged', ?, 'manifestation_earlier', 1, ?, 'assignment_old_0002',
               'Earlier caretaker text.', ?, 'old tag', '{}', '2026-09-01T00:00:00.000Z')`,
    )
    .run(h.geneId, OTHER, "0".repeat(64))
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
      geneId: h.geneId,
      assignmentId: "assignment_now_0001",
      at: NOW,
    }),
  )
  assert.equal(await h.chosen(), "The factory's MFNG.")
  assert.ok(h.versions().every((row) => row.withdrawn_at === NOW))
})
