import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  bodyEnvironment,
  bootstrap,
  humanHandler,
  installBunnyFake,
  lineageVersion,
  readJson,
  saveProse,
} from "./manifestation-plaintext-test-support.js"

// B-724. Ways this could fail, written before the change:
// 1. a candidate made from version 1 is shown as made from the newest version after
//    version 2 is saved (the link follows "current" instead of the stored source);
// 2. a legacy_unbound image is given an invented source;
// 3. the stored source leaks to someone who is not a caretaker, or into the public
//    candidate pool;
// 4. an unreadable primary database breaks the whole caretaker dossier;
// 5. the lookup reads more than one gene's candidates.

const PRIMARY_MIGRATIONS = new URL("../../../migrations-iconoplasm/", import.meta.url)
const sha = (character) => character.repeat(64)

// The real primary schema: every checked-in migration, in order.
class PrimaryD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:")
    for (const name of readdirSync(PRIMARY_MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(readFileSync(new URL(name, PRIMARY_MIGRATIONS), "utf8"))
    }
    this.statements = []
    this.rowsRead = 0
  }
  prepare(sql) {
    const db = this
    return {
      args: [],
      bind(...args) {
        this.args = args
        return this
      },
      async all() {
        db.statements.push(sql)
        const results = db.sqlite.prepare(sql).all(...this.args)
        db.rowsRead += results.length
        return { results }
      },
    }
  }
  insertBoundAsset(symbol, assetSha, { revisionId, manifestationId, geneId }) {
    this.sqlite
      .prepare(
        `INSERT INTO icono_portrait_assets (
           gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, status,
           generation_provenance_status, generation_request_id, generation_attempt_id,
           generation_provider_id, generation_model_id, generation_prompt_sha256,
           generation_config_sha256, source_gene_id, source_manifestation_id,
           source_manifestation_revision_id, source_manifestation_body_sha256,
           source_canonical_selection_id, source_canonical_head_version,
           source_gene_revision, source_snapshot_sha256
         ) VALUES (?, ?, 'hero', 'thumb', 'draft', 'bound', ?, ?, 'provider', 'model', ?, ?,
                   ?, ?, ?, ?, 'selection_for_test', 1, 1, ?)`,
      )
      .run(
        symbol,
        assetSha,
        `request_${assetSha.slice(0, 12)}`,
        `attempt_${assetSha.slice(0, 12)}`,
        sha("1"),
        sha("2"),
        geneId,
        manifestationId,
        revisionId,
        sha("3"),
        sha("4"),
      )
  }
  insertLegacyAsset(symbol, assetSha) {
    this.sqlite
      .prepare(
        `INSERT INTO icono_portrait_assets
           (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, status)
         VALUES (?, ?, 'hero', 'thumb', 'draft')`,
      )
      .run(symbol, assetSha)
  }
  close() {
    this.sqlite.close()
  }
}

async function dossier(handler, symbol) {
  return readJson(
    await handler(new Request(`https://iconoplasm.test/api/iconoplasm/caretaker/genes/${symbol}`)),
  )
}

test("a candidate made from version 1 still points at version 1 after version 2 is saved", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8201", bunny)
  const primary = new PrimaryD1()
  t.after(() => primary.close())
  const handler = humanHandler(context, bodyEnvironment({ withKey: false }), {
    primaryDb: primary,
  })
  const first = await saveProse(handler, "P8201", "browser_sources_8201_a", "First words.")
  const firstRevisionId = first.manifestation_revision_id
  const madeFromFirst = sha("a")
  primary.insertBoundAsset("P8201", madeFromFirst, {
    revisionId: firstRevisionId,
    manifestationId: first.manifestation_id,
    geneId: context.geneId,
  })
  const legacy = sha("c")
  primary.insertLegacyAsset("P8201", legacy)

  const second = await saveProse(
    handler,
    "P8201",
    "browser_sources_8201_b",
    "Second words, after another edit.",
    lineageVersion(context, first.manifestation_id),
  )
  assert.notEqual(second.manifestation_revision_id, firstRevisionId)
  const madeFromSecond = sha("b")
  primary.insertBoundAsset("P8201", madeFromSecond, {
    revisionId: second.manifestation_revision_id,
    manifestationId: first.manifestation_id,
    geneId: context.geneId,
  })

  const value = await dossier(handler, "P8201")

  const sources = new Map(
    value.candidate_sources.map((entry) => [
      entry.asset_sha256,
      entry.source_manifestation_revision_id,
    ]),
  )
  assert.equal(sources.get(madeFromFirst), firstRevisionId, "still version 1 after version 2")
  assert.equal(sources.get(madeFromSecond), second.manifestation_revision_id)
  assert.equal(sources.has(legacy), false, "a legacy_unbound image gets no invented source")
  assert.equal(value.candidate_sources.length, 2)

  // The caretaker's History carries that exact saved version, with its words.
  const history = value.manifestations
    .flatMap((manifestation) => manifestation.revisions)
    .find((revision) => revision.manifestation_revision_id === firstRevisionId)
  assert.equal(history.body, "First words.")
})

test("the lookup reads one gene's candidates, by key, and never another gene's", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8202", bunny)
  const primary = new PrimaryD1()
  t.after(() => primary.close())
  const handler = humanHandler(context, bodyEnvironment({ withKey: false }), {
    primaryDb: primary,
  })
  const saved = await saveProse(handler, "P8202", "browser_sources_8202_a", "Words.")
  primary.insertBoundAsset("P8202", sha("a"), {
    revisionId: saved.manifestation_revision_id,
    manifestationId: saved.manifestation_id,
    geneId: context.geneId,
  })
  primary.insertBoundAsset("OTHER1", sha("d"), {
    revisionId: "revision_belongs_to_another_gene",
    manifestationId: "manifestation_other",
    geneId: "gene_other",
  })

  const value = await dossier(handler, "P8202")

  assert.deepEqual(
    value.candidate_sources.map((entry) => entry.asset_sha256),
    [sha("a")],
  )
  assert.equal(primary.statements.length, 1, "one primary read per dossier")
  assert.equal(primary.rowsRead, 1, "one row read: this gene's single bound candidate")
  assert.match(primary.statements[0], /WHERE gene_symbol = \?/)
  assert.doesNotMatch(primary.statements[0], /upper\(|lower\(/i)
})

test("an unreadable primary database leaves the caretaker dossier intact", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8203", bunny)
  const broken = {
    prepare() {
      throw new Error("primary D1 unavailable")
    },
  }
  const handler = humanHandler(context, bodyEnvironment({ withKey: false }), {
    primaryDb: broken,
  })
  await saveProse(handler, "P8203", "browser_sources_8203_a", "Words.")

  const value = await dossier(handler, "P8203")

  assert.equal(value.enabled, true)
  assert.equal("candidate_sources" in value, false)
})

test("someone with no caretaker relationship to the gene gets no dossier and no sources", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8204", bunny)
  const primary = new PrimaryD1()
  t.after(() => primary.close())
  primary.insertBoundAsset("P8204", sha("a"), {
    revisionId: "revision_for_stranger_test",
    manifestationId: "manifestation_for_stranger_test",
    geneId: context.geneId,
  })
  const stranger = humanHandler(context, bodyEnvironment({ withKey: false }), {
    primaryDb: primary,
    resolveSession: async () => ({ account_id: "account_admin_plain" }),
  })

  const value = await dossier(stranger, "P8204")

  assert.deepEqual(value, { enabled: false })
  assert.equal(primary.statements.length, 0, "the primary database is not even read")
})
