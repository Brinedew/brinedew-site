import assert from "node:assert/strict"
import test from "node:test"

import {
  selectManifestationRevision,
  selectTagsDerivativeHead,
} from "./caretaker/manifestation-authority.js"
import {
  NOW,
  USER,
  bodyEnvironment,
  bootstrap,
  command,
  geneRevision,
  headState,
  installBunnyFake,
  row,
  seedLegacyRevision,
  seedLegacyTags,
} from "./caretaker/manifestation-plaintext-test-support.js"
import { canonicalManifestationFieldsJson } from "./caretaker/manifestation-tags-payload.js"
import { createIconoplasmApp } from "./app.js"
import { writeFactoryGeneText } from "./gene-text-write.js"
import { copyGeneTextFromAuthority } from "./text-backfill.js"

// B-1065: every gene's text leaves the old authority (rows pointing at
// encrypted or plain Bunny objects) for the plain tables of migration 0024,
// through the real authority write path, the real schema, the real Hono route
// and a Bunny zone holding real legacy envelopes. Failure modes written before
// the code:
// 1. a text or its Tags arrive changed: other bytes, Tags fields re-serialised
//    differently, the wrong revision's text;
// 2. a gene whose chosen text is a caretaker's loses that choice, so the next
//    factory text would replace the caretaker's on the portrait;
// 3. a caretaker version is lost, or a withdrawn one comes back as live, or
//    readers are shown a text nobody chose to show them;
// 4. a rerun reads Bunny again or rewrites rows it already copied (it runs
//    about 1,000 pages over the free plan's write wall);
// 5. a missing object stops the page, or is copied as an empty text;
// 6. a caller without the factory's token runs it;
// 7. a copied text is dated the day it was copied, so it looks newer than the
//    workstation's own text and wins over it.
const TOKEN = "factory-token-0000000000000000000000001"

async function harness(t, suffix) {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, suffix, bunny)
  const env = {
    ...bodyEnvironment(),
    ICONOPLASM_AUTHORING_DB: context.db,
    ICONOPLASM_ADMIN_TOKEN: TOKEN,
  }
  const app = createIconoplasmApp({
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async () => ({}),
    refreshSummaries: async () => {},
    accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
    windowUsage: async () => null,
  })
  const backfill = async (body, { token = TOKEN } = {}) => {
    const response = await app.request(
      "/api/iconoplasm/admin/texts/backfill",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    )
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const rows = (sql, ...args) => context.db.raw.prepare(sql).all(...args)
  return { bunny, context, env, backfill, rows }
}

// Tags count for a text once accepted, as the factory's tagger does after a
// submit.
async function acceptTags(context, derivativeId, revisionId, name) {
  const head = row(
    context.db,
    "SELECT derivative_head_version FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?",
    revisionId,
  )
  await selectTagsDerivativeHead(context.db, {
    derivativeId,
    expectedDerivativeHeadVersion: Number(head?.derivative_head_version ?? 0),
    expectedGeneRevision: geneRevision(context),
    eventUuid: `event_accept_tags_${name}`,
    now: NOW,
    ...command(`command_accept_tags_${name}`, "6", null, "service"),
  })
}

const FIELDS = { protein_class: "kinase", locations: ["nucleus", "cytoplasm"], note: "café" }

test("a factory text and its Tags copy byte for byte, and a rerun reads nothing", async (t) => {
  const h = await harness(t, "9101")
  const { context } = h
  const tags = await seedLegacyTags(context, h.env, h.bunny, {
    name: "seed9101",
    revisionId: context.seedRevisionId,
    sourceBodySha256: context.seed.body_sha256,
    tagsText: "kinase, nucleus, small round body",
    fieldsJson: FIELDS,
  })
  await acceptTags(context, tags.derivativeId, context.seedRevisionId, "seed9101")

  const refused = await h.backfill({ kind: "factory" }, { token: "wrong" })
  assert.equal(refused.status, 401)
  assert.equal(h.rows("SELECT * FROM icono_gene_texts").length, 0)

  h.bunny.clearLog()
  const first = await h.backfill({ kind: "factory", after: null })
  assert.equal(first.status, 200)
  assert.deepEqual(first.body, {
    ok: true,
    kind: "factory",
    examined: 1,
    written: 1,
    skipped: 0,
    errors: [],
    next_after: null,
  })
  assert.equal(h.bunny.count("GET"), 2)
  const [copied] = h.rows("SELECT * FROM icono_gene_texts")
  assert.equal(copied.gene_id, context.geneId)
  assert.equal(copied.text_id, context.seedRevisionId)
  assert.equal(copied.version, 1)
  assert.equal(copied.text, "The importer's seed manifestation for gene 9101.")
  assert.equal(copied.text_sha256, context.seed.body_sha256)
  assert.equal(copied.tags, "kinase, nucleus, small round body")
  assert.equal(copied.fields_json, canonicalManifestationFieldsJson(FIELDS))
  assert.deepEqual(JSON.parse(copied.fields_json), FIELDS)
  assert.equal(copied.readers_see, 0)
  assert.equal(copied.chosen_caretaker_version_id, null)
  // The text keeps the date it was written; the workstation compares it with
  // its own texts' dates.
  const written = h.rows(
    "SELECT created_at FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
    context.seedRevisionId,
  )[0].created_at
  assert.equal(copied.updated_at, written)

  h.bunny.clearLog()
  const rerun = await h.backfill({ kind: "factory" })
  assert.equal(rerun.body.skipped, 1)
  assert.equal(rerun.body.written, 0)
  assert.equal(h.bunny.count("GET"), 0)

  // Even forced, a gene that has a plain row keeps its text: only the flags are
  // written again (failure mode 9 below).
  const forced = await h.backfill({ kind: "factory", force: true })
  assert.equal(forced.body.written, 1)
  assert.equal(h.bunny.count("GET"), 0)
  assert.equal(h.rows("SELECT text FROM icono_gene_texts")[0].text, copied.text)
})

test("caretaker versions copy with their flags, and the gene keeps the caretaker's choice", async (t) => {
  const h = await harness(t, "9102")
  const { context } = h
  await seedLegacyRevision(context, h.env, h.bunny, {
    name: "ct9102a",
    prose: "A caretaker's first take on gene 9102.",
  })
  await seedLegacyRevision(context, h.env, h.bunny, {
    name: "ct9102b",
    prose: "A caretaker's second take on gene 9102.",
    first: false,
  })
  const tags = await seedLegacyTags(context, h.env, h.bunny, {
    name: "ct9102b",
    revisionId: "revision_legacy_ct9102b",
    sourceBodySha256: row(
      context.db,
      "SELECT body_sha256 FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
      "revision_legacy_ct9102b",
    ).body_sha256,
    tagsText: "caretaker tags",
    fieldsJson: FIELDS,
  })
  await acceptTags(context, tags.derivativeId, "revision_legacy_ct9102b", "ct9102b")
  // The caretaker chooses the second version for the gene's portrait.
  await selectManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    revisionId: "revision_legacy_ct9102b",
    expectedAssignmentVersion: 2,
    ...headState(context),
    selectionId: "selection_ct9102b",
    eventUuid: "event_select_ct9102b",
    now: NOW,
    ...command("command_select_ct9102b", "5", USER, "account"),
  })
  const head = row(
    context.db,
    `SELECT h.canonical_revision_id, m.origin, m.manifestation_id
       FROM icono_manifestation_heads h
       JOIN icono_manifestations m ON m.manifestation_id = h.canonical_manifestation_id
      WHERE h.gene_id = ?`,
    context.geneId,
  )
  assert.equal(head.origin, "caretaker")
  assert.equal(head.canonical_revision_id, "revision_legacy_ct9102b")
  // The caretaker withdrew the first version; readers were shown the line.
  context.db.raw
    .prepare(
      `INSERT INTO icono_manifestation_revision_lifecycle
         (manifestation_revision_id, status, changed_at) VALUES (?, 'withdrawn', ?)
       ON CONFLICT (manifestation_revision_id) DO UPDATE SET status = 'withdrawn',
         changed_at = excluded.changed_at`,
    )
    .run("revision_legacy_ct9102a", "2026-10-05T00:00:00.000Z")
  context.db.raw
    .prepare("UPDATE icono_manifestations SET public_page_visible = 1 WHERE manifestation_id = ?")
    .run(head.manifestation_id)

  const factory = await h.backfill({ kind: "factory" })
  assert.equal(factory.body.written, 1)
  assert.equal(
    h.rows("SELECT chosen_caretaker_version_id FROM icono_gene_texts")[0]
      .chosen_caretaker_version_id,
    "revision_legacy_ct9102b",
  )

  const caretaker = await h.backfill({ kind: "caretaker" })
  assert.equal(caretaker.status, 200)
  assert.equal(caretaker.body.ok, true)
  assert.equal(caretaker.body.written, 2)
  const versions = h.rows(
    `SELECT version_id, gene_id, line_id, version, account_id, caretaker_assignment_id,
            text, tags, readers_see, withdrawn_at
       FROM icono_caretaker_text_versions ORDER BY version`,
  )
  assert.deepEqual(
    versions.map((version) => ({ ...version })),
    [
      {
        version_id: "revision_legacy_ct9102a",
        gene_id: context.geneId,
        line_id: head.manifestation_id,
        version: 1,
        account_id: "account_user_plain1",
        caretaker_assignment_id: context.assignmentId,
        text: "A caretaker's first take on gene 9102.",
        tags: null,
        readers_see: 0,
        withdrawn_at: "2026-10-05T00:00:00.000Z",
      },
      {
        version_id: "revision_legacy_ct9102b",
        gene_id: context.geneId,
        line_id: head.manifestation_id,
        version: 2,
        account_id: "account_user_plain1",
        caretaker_assignment_id: context.assignmentId,
        text: "A caretaker's second take on gene 9102.",
        tags: "caretaker tags",
        readers_see: 1,
        withdrawn_at: null,
      },
    ],
  )

  // The caretaker hides the line afterwards: the rerun moves the flag without
  // reading a single object.
  context.db.raw
    .prepare("UPDATE icono_manifestations SET public_page_visible = 0 WHERE manifestation_id = ?")
    .run(head.manifestation_id)
  h.bunny.clearLog()
  const rerun = await h.backfill({ kind: "caretaker" })
  assert.equal(rerun.body.written, 1)
  assert.equal(rerun.body.skipped, 1)
  assert.equal(h.bunny.count("GET"), 0)
  assert.equal(
    h.rows("SELECT readers_see FROM icono_caretaker_text_versions WHERE version = 2")[0]
      .readers_see,
    0,
  )
})

test("a missing object is reported and copies nothing, and the rerun picks it up", async (t) => {
  const h = await harness(t, "9103")
  const stored = h.bunny.objects.get(h.context.seedObjectKey)
  h.bunny.objects.delete(h.context.seedObjectKey)

  const first = await h.backfill({ kind: "factory" })
  assert.equal(first.status, 200)
  assert.equal(first.body.ok, false)
  assert.equal(first.body.written, 0)
  assert.deepEqual(first.body.errors, [{ id: h.context.geneId, error: "prose_body_missing" }])
  assert.equal(h.rows("SELECT * FROM icono_gene_texts").length, 0)

  h.bunny.objects.set(h.context.seedObjectKey, stored)
  const rerun = await h.backfill({ kind: "factory" })
  assert.equal(rerun.body.ok, true)
  assert.equal(rerun.body.written, 1)
  assert.equal(h.rows("SELECT tags FROM icono_gene_texts")[0].tags, null)
})

// The write-through the authority's projection runs for every accepted event,
// until the writers move onto the plain tables. Failure modes:
// 7. it copies nothing, so a card waits for the next backfill;
// 8. a newer text the factory saved through the new route is overwritten by the
//    old authority's older one, while the gene's flags must still follow.
test("one gene's text copies on its event, and a newer saved text keeps winning", async (t) => {
  const h = await harness(t, "9104")
  const { context } = h
  assert.deepEqual(await copyGeneTextFromAuthority(h.env, "gene_nobody"), { written: 0 })
  assert.deepEqual(await copyGeneTextFromAuthority(h.env, context.geneId), { written: 1 })
  const [copied] = h.rows("SELECT * FROM icono_gene_texts")
  assert.equal(copied.gene_id, context.geneId)
  assert.equal(copied.text, "The importer's seed manifestation for gene 9104.")

  h.bunny.clearLog()
  assert.deepEqual(await copyGeneTextFromAuthority(h.env, context.geneId), { written: 0 })
  assert.equal(h.bunny.count("GET"), 0)

  const saved = await writeFactoryGeneText(h.env, {
    symbol: "P9104",
    text: "A newer factory text.",
  })
  assert.equal(saved.version, 2)
  context.db.raw
    .prepare(
      "UPDATE icono_manifestations SET public_page_visible = 1 WHERE gene_id = ? AND origin = 'system_seed'",
    )
    .run(context.geneId)
  h.bunny.clearLog()
  assert.deepEqual(await copyGeneTextFromAuthority(h.env, context.geneId), { written: 1 })
  assert.equal(h.bunny.count("GET"), 0)
  const [after] = h.rows("SELECT * FROM icono_gene_texts")
  assert.equal(after.text, "A newer factory text.")
  assert.equal(after.text_id, saved.text_id)
  assert.equal(after.version, 2)
  assert.equal(after.readers_see, 1)
})

// 9. A gene whose first plain row came from the PUT (version 1, never backfilled)
//    gets the old authority's text back on its next event. Live on 2026-10-11:
//    about 5,600 genes were first written by the workstation's PUT.
test("a text the PUT wrote first is never replaced by the old authority's", async (t) => {
  const h = await harness(t, "9105")
  const { context } = h
  const saved = await writeFactoryGeneText(h.env, {
    symbol: "P9105",
    text: "The full factory text.",
  })
  assert.equal(saved.version, 1)
  h.bunny.clearLog()
  await copyGeneTextFromAuthority(h.env, context.geneId)
  assert.equal(h.bunny.count("GET"), 0)
  const [after] = h.rows("SELECT text, text_id, version FROM icono_gene_texts")
  assert.deepEqual(
    { ...after },
    { text: "The full factory text.", text_id: saved.text_id, version: 1 },
  )
})
