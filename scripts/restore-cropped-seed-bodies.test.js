import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  BYPASSED_PROJECTION_TRIGGERS,
  BYPASSED_TRIGGERS,
  STATEMENT_ROWS,
  authoringMigrationSql,
  planGene,
  projectionMigrationSql,
} from "./restore-cropped-seed-bodies.mjs"
import { splitMigrationSql } from "./generate-operation-cost-migrations.mjs"
import {
  registerAuthorityAccount,
  registerGeneIdentity,
  seedSystemManifestation,
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "../workers/iconoplasm/caretaker/manifestation-authority.js"
import {
  TestD1,
  command,
  row,
  sha,
} from "../workers/iconoplasm/caretaker/manifestation-authority-test-support.js"
import {
  canonicalManifestationFieldsJson,
  prepareManifestationTagsPayload,
} from "../workers/iconoplasm/caretaker/manifestation-tags-payload.js"
import { plainStorageDescriptor } from "../workers/iconoplasm/caretaker/manifestation-storage-contract.js"

// Ways the in-place seed replacement (B-977) could fail, each checked below on the
// real authority migrations, copied into a real local D1 so rows_written is D1's:
// 1. A seed that changed after the nightly copy is half switched (storage moved,
//    revision not), so its body no longer verifies.
// 2. The accepted Tags derivative keeps the old source hash, so the projector
//    refuses the gene.
// 3. An immutability trigger is missing or altered after the migration.
// 4. A non-canonical seed's projection row (a caretaker's text) is rewritten.
// 5. A gene costs more D1 rows written than the plan claims (5 per gene).
// 6. A statement exceeds D1's 100 KB statement limit.
// 7. A gene that is not a crop (a different text) is planned.

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const NOW = "2026-10-04T00:00:00.000Z"
const ENCODER = new TextEncoder()
const hex = (bytes) => createHash("sha256").update(bytes).digest("hex")
const AFTER_BASE = [
  "0013_strict_upload_reservations.sql",
  "0014_bounded_lineage_upload_admission.sql",
  "0022_lineage_quota_window_and_unread_indexes.sql",
  "0023_saves_without_upload_reservations.sql",
].map((name) =>
  readFileSync(new URL(`../migrations-iconoplasm-authoring/${name}`, import.meta.url), "utf8"),
)

function fullText(label) {
  const sentence = `${label} rests at the nuclear periphery, café-bright and slow. `
  let text = ""
  while (Array.from(text).length < 6200) text += sentence
  return Array.from(text).slice(0, 6200).join("").trim()
}

const cropOf = (text) => Array.from(text).slice(0, 4000).join("")

async function seedGene(db, suffix) {
  const text = fullText(`Gene ${suffix}`)
  const seedBytes = ENCODER.encode(cropOf(text))
  const seedSha = hex(seedBytes)
  const geneId = `gene_seed_${suffix}`
  const revisionId = `revision_seed_${suffix}`
  const seedKey = `private/manifestations/v1/aa/mbody_${suffix.padStart(32, "0")}.bin`
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `S${suffix}`, now: NOW })
  await seedSystemManifestation(db, {
    geneId,
    storage: plainStorageDescriptor(
      { body_sha256: seedSha, body_bytes: seedBytes.byteLength },
      seedKey,
      {
        etag: '"seed"',
      },
    ),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: `manifestation_seed_${suffix}`,
    revisionId,
    selectionId: `selection_seed_${suffix}`,
    eventUuid: `event_seed_${suffix}`,
    now: NOW,
    ...command(`command_seed_${suffix}`, "1", null, "migration"),
  })
  const tagsText = "nuclear periphery\nslow protein"
  const fieldsJson = { organism: "human" }
  const payload = await prepareManifestationTagsPayload({
    tagsText,
    tagsSha256: hex(ENCODER.encode(tagsText)),
    fieldsJson,
    fieldsSha256: hex(ENCODER.encode(canonicalManifestationFieldsJson(fieldsJson))),
  })
  const derivativeId = `derivative_seed_${suffix}`
  const tagsKey = `private/manifestations/v1/bb/mbody_tags${suffix.padStart(26, "0")}.bin`
  const geneRevision = () =>
    row(db, "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?", geneId)
      .gene_revision
  await submitTagsDerivative(db, {
    revisionId,
    derivativeId,
    status: "complete",
    sourceBodySha256: seedSha,
    tagsSha256: payload.tags_sha256,
    tagsBytes: payload.tags_bytes,
    fieldsSha256: payload.fields_sha256,
    fieldsBytes: payload.fields_bytes,
    storage: plainStorageDescriptor(
      { body_sha256: payload.output_plain_sha256, body_bytes: payload.output_plain_bytes },
      tagsKey,
      { etag: '"tags"' },
    ),
    recipeId: "gene-tags",
    recipeVersion: "3",
    providerId: "local",
    modelId: "qwen",
    taggerConfigSha256: sha("9"),
    expectedGeneRevision: geneRevision(),
    now: NOW,
    ...command(`command_tags_${suffix}`, "4", null, "service"),
  })
  await selectTagsDerivativeHead(db, {
    derivativeId,
    expectedDerivativeHeadVersion: 0,
    expectedGeneRevision: geneRevision(),
    now: NOW,
    ...command(`command_tags_select_${suffix}`, "5", null, "service"),
  })
  const fullBytes = ENCODER.encode(text)
  return {
    symbol: `S${suffix}`,
    revision_id: revisionId,
    derivative_id: derivativeId,
    canonical: true,
    old_sha256: seedSha,
    old_bytes: seedBytes.byteLength,
    old_object_key: seedKey,
    new_sha256: hex(fullBytes),
    new_bytes: fullBytes.byteLength,
    new_object_key: `private/manifestations/v1/cc/mbody_f${suffix.padStart(31, "0")}.bin`,
    etag: `"new-${suffix}"`,
    text,
  }
}

// Copies a node:sqlite database into a Miniflare D1: tables and indexes, then
// rows, then triggers, so no insert trigger fires on the copy.
async function copyToD1(source, db) {
  const objects = source
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all()
  const run = async (sqls) => {
    for (let i = 0; i < sqls.length; i += 50)
      await db.batch(sqls.slice(i, i + 50).map((sql) => db.prepare(sql)))
  }
  await run(objects.filter((o) => o.type === "table").map((o) => o.sql))
  await run(objects.filter((o) => o.type === "index").map((o) => o.sql))
  for (const { name } of objects.filter((o) => o.type === "table")) {
    const rows = source.prepare(`SELECT * FROM "${name}"`).all()
    const statements = rows.map((r) => {
      const columns = Object.keys(r)
      return db
        .prepare(
          `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .bind(...Object.values(r).map((v) => (typeof v === "bigint" ? Number(v) : v)))
    })
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50))
  }
  await run(objects.filter((o) => o.type === "trigger").map((o) => o.sql))
}

const triggerSql = async (db) =>
  Object.fromEntries(
    (
      await db
        .prepare(
          `SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name IN (${BYPASSED_TRIGGERS.map(() => "?").join(",")})`,
        )
        .bind(...BYPASSED_TRIGGERS)
        .all()
    ).results.map((r) => [r.name, r.sql]),
  )

test("a crop proof plans only seeds that are the full text's first 4,000 characters", () => {
  const text = fullText("Proof")
  const seed = {
    symbol: "P",
    revision_id: "r",
    body_sha256: hex(ENCODER.encode(cropOf(text))),
    body_bytes: 4000,
    object_key: "k",
  }
  assert.equal(planGene(seed, text).gene.new_sha256, hex(ENCODER.encode(text)))
  assert.equal(planGene(seed, `${text} changed`.replace("Proof", "Other")).skip, "not_a_crop")
  assert.equal(
    planGene({ ...seed, body_sha256: hex(ENCODER.encode(text)) }, text).skip,
    "already_full",
  )
  const long = Array.from({ length: 10_050 }, () => "a").join("")
  assert.equal(
    planGene({ ...seed, body_sha256: hex(ENCODER.encode(cropOf(long))) }, long).skip,
    "over_limit",
  )
})

test(
  "the authoring migration switches every planned seed whole, skips a changed one, restores the triggers, and costs at most 5 rows a gene",
  { timeout: 180_000 },
  async (t) => {
    const source = new TestD1()
    for (const migration of AFTER_BASE) source.raw.exec(migration)
    t.after(() => source.close())
    await registerAuthorityAccount(source, {
      accountId: "account_admin_seed",
      publicCreditLabel: "Admin",
      now: NOW,
    })
    const genes = []
    for (let i = 1; i <= 12; i++) genes.push(await seedGene(source, String(i)))
    // Gene 12 changed after the copy: the plan still holds its old hash.
    const changed = genes[11]
    const planned = genes.map((g) => (g === changed ? { ...g, old_sha256: "f".repeat(64) } : g))

    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('seed')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    t.after(() => runtime.dispose())
    const db = await runtime.getD1Database("DB")
    await copyToD1(source.raw, db)
    const before = await triggerSql(db)

    const sql = authoringMigrationSql({ uploads: planned, triggers: before, verifiedAt: NOW })
    const statements = splitMigrationSql(sql, "0020_restore_cropped_seed_bodies.sql")
    for (const statement of statements) assert.ok(ENCODER.encode(statement).byteLength < 100_000)
    const results = await db.batch(statements.map((s) => db.prepare(s)))
    const written = results.reduce((sum, r) => sum + r.meta.rows_written, 0)
    const switched = genes.length - 1
    // Per gene: storage row + its object_key index (delete, insert), the Tags
    // derivative row, the revision row; plus the index drop and the counter.
    assert.ok(written <= 5 * switched + 2, `rows written ${written} for ${switched} genes`)
    t.diagnostic(
      `rows_written ${written} for ${switched} genes (${(written / switched).toFixed(2)} a gene)`,
    )

    for (const g of genes) {
      const r = await db
        .prepare(
          "SELECT body_sha256, body_bytes FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
        )
        .bind(g.revision_id)
        .first()
      const s = await db
        .prepare(
          "SELECT object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64 FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
        )
        .bind(g.revision_id)
        .first()
      const d = await db
        .prepare(
          "SELECT source_body_sha256 FROM icono_manifestation_derivatives WHERE manifestation_derivative_id = ?",
        )
        .bind(g.derivative_id)
        .first()
      if (g === changed) {
        assert.deepEqual(
          [r.body_sha256, s.object_key, d.source_body_sha256],
          [g.old_sha256, g.old_object_key, g.old_sha256],
        )
      } else {
        assert.deepEqual(
          [
            r.body_sha256,
            r.body_bytes,
            s.object_key,
            s.ciphertext_sha256,
            s.ciphertext_bytes,
            s.body_iv_base64,
            d.source_body_sha256,
          ],
          [
            g.new_sha256,
            g.new_bytes,
            g.new_object_key,
            g.new_sha256,
            g.new_bytes + 16,
            "",
            g.new_sha256,
          ],
        )
      }
    }
    assert.deepEqual(await triggerSql(db), before)
    const index = await db
      .prepare("SELECT name FROM sqlite_schema WHERE name = 'idx_icono_revisions_body_hash'")
      .first()
    assert.equal(index, null)
    await assert.rejects(
      db
        .prepare(
          "UPDATE icono_manifestation_revisions SET body_bytes = 1 WHERE manifestation_revision_id = ?",
        )
        .bind(genes[0].revision_id)
        .run(),
      /manifestation_revisions_are_immutable/,
    )
  },
)

test(
  "the projection migration rewrites canonical seeds only, guarded on the old hash",
  { timeout: 60_000 },
  async () => {
    const main = new DatabaseSync(":memory:")
    const directory = new URL("../migrations-iconoplasm/", import.meta.url)
    const definition = readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(new URL(name, directory), "utf8"))
      .find((text) => text.includes("CREATE TABLE icono_manifestation_canonical_projection"))
    assert.ok(definition, "projection table definition")
    // The real table with its real guards: an earlier version of this test built
    // the table alone, and the event-replay guard would have refused 0116 in
    // production (found 2026-10-04 before the merge).
    main.exec(
      definition.match(/CREATE TABLE icono_manifestation_projection_authority \([\s\S]*?\n\);/)[0],
    )
    main.exec(
      "INSERT INTO icono_manifestation_projection_authority (singleton, authority_epoch) VALUES (1, 1)",
    )
    main.exec(
      definition.match(/CREATE TABLE icono_manifestation_canonical_projection \([\s\S]*?\n\);/)[0],
    )
    const guards = definition.match(
      /CREATE TRIGGER icono_projection_epoch_guard_\w+[\s\S]*?\nend;/g,
    )
    assert.equal(guards.length, 2)
    for (const guard of guards) main.exec(guard)
    const triggerSql = (name) =>
      main.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name)?.sql
    const triggers = Object.fromEntries(
      BYPASSED_PROJECTION_TRIGGERS.map((name) => [name, triggerSql(name)]),
    )
    const g = (n, canonical) => ({
      revision_id: `revision_${n}`,
      canonical,
      old_sha256: sha(String(n)),
      new_sha256: sha(String(n + 5)),
      new_bytes: 6200,
    })
    const genes = [g(1, true), g(2, true), g(3, false)]
    for (const [i, gene] of genes.entries())
      main
        .prepare(
          "INSERT INTO icono_manifestation_canonical_projection (gene_id, canonical_symbol, canonical_manifestation_id, canonical_selection_id, canonical_revision_lifecycle, canonical_revision_id, canonical_body_sha256, canonical_body_bytes, accepted_tags_source_body_sha256, head_version, gene_revision, authority_event_id, authority_event_sequence, authority_epoch, public_material_event_id, accepted_tags_derivative_id, accepted_tags_derivative_head_version, accepted_tags_status, accepted_tags_body_sha256, accepted_tags_body_bytes, accepted_tags_text_sha256, accepted_tags_text_bytes, accepted_tags_fields_sha256, accepted_tags_fields_bytes, accepted_tags_provenance_status) VALUES (?, ?, 'manifestation_x', 'selection_x', 'active', ?, ?, 4000, ?, 1, 1, ?, ?, 1, ?, 'derivative_x', 1, 'complete', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 10, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 5, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 4, 'legacy_unknown')",
        )
        .run(
          `gene_${i}`,
          `G${i}`,
          gene.canonical ? gene.revision_id : `revision_caretaker_${i}`,
          gene.canonical ? gene.old_sha256 : sha("c"),
          gene.canonical ? gene.old_sha256 : sha("c"),
          `event_${i}`,
          i + 1,
          `event_${i}`,
        )
    // Without the bypass, the guard refuses exactly this correction.
    assert.throws(
      () =>
        main.exec(
          `UPDATE icono_manifestation_canonical_projection SET canonical_body_sha256 = '${genes[0].new_sha256}' WHERE gene_id = 'gene_0'`,
        ),
      /manifestation_projection_event_replay_changed_payload/,
    )
    for (const statement of splitMigrationSql(
      projectionMigrationSql({ uploads: genes, triggers }),
      "0116.sql",
    ))
      main.exec(statement)
    const rows = main
      .prepare(
        "SELECT canonical_body_sha256 AS h, canonical_body_bytes AS b, accepted_tags_source_body_sha256 AS t FROM icono_manifestation_canonical_projection ORDER BY gene_id",
      )
      .all()
    assert.deepEqual(
      rows.map((r) => [r.h, r.b, r.t]),
      [
        [genes[0].new_sha256, 6200, genes[0].new_sha256],
        [genes[1].new_sha256, 6200, genes[1].new_sha256],
        [sha("c"), 4000, sha("c")],
      ],
    )
    // The guard is back, verbatim, and still refuses a replayed payload change.
    for (const name of BYPASSED_PROJECTION_TRIGGERS) assert.equal(triggerSql(name), triggers[name])
    assert.throws(
      () =>
        main.exec(
          `UPDATE icono_manifestation_canonical_projection SET canonical_body_bytes = 1 WHERE gene_id = 'gene_0'`,
        ),
      /manifestation_projection_event_replay_changed_payload/,
    )
  },
)
