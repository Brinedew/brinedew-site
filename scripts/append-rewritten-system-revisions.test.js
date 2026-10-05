import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  BYPASSED_PROJECTION_TRIGGERS,
  BYPASSED_TRIGGERS,
  authoringMigrationSql,
  planRewrite,
  projectionMigrationSql,
  readLineage,
} from "./append-rewritten-system-revisions.mjs"
import { splitMigrationSql } from "./generate-operation-cost-migrations.mjs"
import {
  createManifestationUploadIntent,
  registerAuthorityAccount,
  registerGeneIdentity,
  seedSystemManifestation,
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "../workers/iconoplasm/caretaker/manifestation-authority.js"
import { readCanonicalProjectionRecord } from "../workers/iconoplasm/caretaker/manifestation-authority-projection-read.js"
import {
  TestD1,
  command,
  row,
  sha,
} from "../workers/iconoplasm/caretaker/manifestation-authority-test-support.js"
import { readPublicCanonicalMaterial } from "../workers/iconoplasm/caretaker/manifestation-public-canonical-material.js"
import {
  canonicalManifestationFieldsJson,
  prepareManifestationTagsPayload,
} from "../workers/iconoplasm/caretaker/manifestation-tags-payload.js"
import { plainStorageDescriptor } from "../workers/iconoplasm/caretaker/manifestation-storage-contract.js"
import { prepareManifestationProse } from "../workers/lib/iconoplasm-manifestation-prose.js"

// Ways the B-994 append could fail, each checked below on the real authority
// migrations in a real local D1, and on the real main-database projection with
// its guards:
// 1. A trigger refuses an insert mid-file and the release aborts (or, worse, a
//    gene ends half-appended: a revision without storage, a head without Tags).
// 2. A gene that changed since the copy is appended anyway, or partly.
// 3. A gene whose canonical is not the seed head (a caretaker's text) is selected.
// 4. The projection disagrees with the authority, so the public reader refuses
//    the gene (PUBLIC_CANONICAL_PROJECTION_DRIFT), or serves the old prose.
// 5. A bypassed trigger is missing or altered afterwards.
// 6. It costs more rows than the plan claims.
// 7. The new Tags are not the rewrite's (the B-977 swap's failure mode).

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const NOW = "2026-10-04T00:00:00.000Z"
const LATER = "2026-10-07T20:30:00.000Z"
const FUTURE = "2099-10-04T00:00:00.000Z"
const ENCODER = new TextEncoder()
const hex = (bytes) => createHash("sha256").update(bytes).digest("hex")
const AFTER_BASE = [
  "0013_strict_upload_reservations.sql",
  "0014_bounded_lineage_upload_admission.sql",
].map((name) =>
  readFileSync(new URL(`../migrations-iconoplasm-authoring/${name}`, import.meta.url), "utf8"),
)
const PRIMARY = [
  "0084_manifestation_authority_cutover.sql",
  "0089_manifestation_page_visibility.sql",
].map((name) => readFileSync(new URL(`../migrations-iconoplasm/${name}`, import.meta.url), "utf8"))
const ENV = Object.freeze({
  ICONOPLASM_AUTHORING_BODY_KEK_V1: Buffer.from(new Uint8Array(32).fill(19)).toString("base64"),
  ICONOPLASM_AUTHORING_STORAGE_HOST: "storage.test.invalid",
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "append-test",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "test-password",
  ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "500",
})
const objects = new Map()
const key = (tag, n) =>
  `private/manifestations/v1/${tag}/mbody_${tag}${String(n).padStart(30, "0")}.bin`

async function seedGene(db, n) {
  const prose = await prepareManifestationProse(
    `Gene ${n} wears a neighbour's jade chestplate and frog closures.`,
  )
  const geneId = `gene_seed_${n}`
  const revisionId = `revision_seed_${n}`
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `S${n}`, now: NOW })
  await createManifestationUploadIntent(db, {
    entityKind: "revision",
    entityId: revisionId,
    objectKey: key("aa", n),
    ciphertextSha256: prose.body_sha256,
    bodyBytes: prose.body_bytes,
    actorKind: "migration",
    uploadIntentId: `intent_seed_${n}`,
    leaseToken: `lease_seed_${n}`,
    now: FUTURE,
  })
  objects.set(key("aa", n), prose.bytes)
  await seedSystemManifestation(db, {
    geneId,
    storage: plainStorageDescriptor(prose, key("aa", n), { etag: '"seed"' }),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: `manifestation_seed_${n}`,
    revisionId,
    selectionId: `selection_seed_${n}`,
    eventUuid: `event_seed_${n}`,
    now: NOW,
    ...command(`command_seed_${n}`, "1", null, "migration"),
  })
  const tagsText = "jade_chestplate, frog_closures"
  const fieldsJson = { outfit: ["jade_chestplate"] }
  const payload = await prepareManifestationTagsPayload({
    tagsText,
    tagsSha256: hex(ENCODER.encode(tagsText)),
    fieldsJson,
    fieldsSha256: hex(ENCODER.encode(canonicalManifestationFieldsJson(fieldsJson))),
  })
  await createManifestationUploadIntent(db, {
    entityKind: "derivative",
    entityId: `derivative_seed_${n}`,
    objectKey: key("bb", n),
    ciphertextSha256: payload.output_plain_sha256,
    bodyBytes: payload.output_plain_bytes,
    actorKind: "migration",
    uploadIntentId: `intent_tags_${n}`,
    leaseToken: `lease_tags_${n}`,
    now: FUTURE,
  })
  const geneRevision = () =>
    row(db, "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?", geneId)
      .gene_revision
  await submitTagsDerivative(db, {
    revisionId,
    derivativeId: `derivative_seed_${n}`,
    status: "complete",
    sourceBodySha256: prose.body_sha256,
    tagsSha256: payload.tags_sha256,
    tagsBytes: payload.tags_bytes,
    fieldsSha256: payload.fields_sha256,
    fieldsBytes: payload.fields_bytes,
    storage: plainStorageDescriptor(
      { body_sha256: payload.output_plain_sha256, body_bytes: payload.output_plain_bytes },
      key("bb", n),
      { etag: '"tags"' },
    ),
    recipeId: "gene-tags",
    recipeVersion: "3",
    providerId: "local",
    modelId: "qwen",
    taggerConfigSha256: sha("9"),
    expectedGeneRevision: geneRevision(),
    now: NOW,
    ...command(`command_tags_${n}`, "4", null, "service"),
  })
  await selectTagsDerivativeHead(db, {
    derivativeId: `derivative_seed_${n}`,
    expectedDerivativeHeadVersion: 0,
    expectedGeneRevision: geneRevision(),
    now: NOW,
    ...command(`command_tags_select_${n}`, "5", null, "service"),
  })
}

function rewriteFor(n) {
  const tagsText = "pink_pinafore, heart_shaped_bib, jelly_platform_mules"
  const fieldsJson = { outfit: ["pink_pinafore", "heart_shaped_bib"] }
  return {
    symbol: `S${n}`,
    prose: `Gene ${n} is rewritten: a pink pinafore with a heart-shaped bib, jelly platform mules, claw clips.`,
    tags_text: tagsText,
    tags_sha256: hex(ENCODER.encode(tagsText)),
    fields_json: fieldsJson,
    fields_sha256: hex(ENCODER.encode(canonicalManifestationFieldsJson(fieldsJson))),
    recipe_id: "manifestation-tagger-json-categories",
    recipe_version: "1",
    provider_id: "opencode",
    model_id: "deepseek-v4.1-flash",
    tagger_config_sha256: sha("7"),
  }
}

// Tables and indexes, then rows, then triggers, so no insert trigger fires on the copy.
async function copyToD1(source, db) {
  const all = source
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all()
  const run = async (sqls) => {
    for (let i = 0; i < sqls.length; i += 50)
      await db.batch(sqls.slice(i, i + 50).map((sql) => db.prepare(sql)))
  }
  await run(all.filter((o) => o.type === "table").map((o) => o.sql))
  await run(all.filter((o) => o.type === "index").map((o) => o.sql))
  for (const { name } of all.filter((o) => o.type === "table")) {
    const rows = source.prepare(`SELECT * FROM "${name}"`).all()
    const statements = rows.map((r) =>
      db
        .prepare(
          `INSERT INTO "${name}" (${Object.keys(r)
            .map((c) => `"${c}"`)
            .join(",")}) VALUES (${Object.keys(r)
            .map(() => "?")
            .join(",")})`,
        )
        .bind(...Object.values(r).map((v) => (typeof v === "bigint" ? Number(v) : v))),
    )
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50))
  }
  await run(all.filter((o) => o.type === "trigger").map((o) => o.sql))
}

// A D1-shaped wrapper over node:sqlite for the main database.
function d1(raw) {
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    first: async () => raw.prepare(sql).get(...params) || null,
    all: async () => ({ results: raw.prepare(sql).all(...params) }),
    run: async () => ({
      success: true,
      meta: { changes: Number(raw.prepare(sql).run(...params).changes) },
    }),
  })
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => Promise.all(list.map((s) => s.run())),
  }
}

// The projector's row for an exact authority record (projectCanonicalManifestationAuthorityEvent).
function project(main, record) {
  const c = record.canonical
  const d = record.accepted_tags_derivative
  main
    .prepare(
      `INSERT INTO icono_manifestation_canonical_projection (
        gene_id, canonical_symbol, canonical_manifestation_id, canonical_revision_id, canonical_selection_id,
        canonical_body_sha256, canonical_body_bytes, canonical_revision_lifecycle, canonical_public_page_visible,
        accepted_tags_derivative_id, accepted_tags_derivative_head_version, accepted_tags_status,
        accepted_tags_source_body_sha256, accepted_tags_body_sha256, accepted_tags_body_bytes,
        accepted_tags_text_sha256, accepted_tags_text_bytes, accepted_tags_fields_sha256, accepted_tags_fields_bytes,
        accepted_tags_recipe_id, accepted_tags_recipe_version, accepted_tags_provider_id, accepted_tags_model_id,
        accepted_tags_config_sha256, accepted_tags_provenance_status, head_version, gene_revision,
        authority_event_id, authority_event_sequence, authority_epoch, public_material_event_id,
        public_material_version, projection_version, projected_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,2,?,1,1,CURRENT_TIMESTAMP)`,
    )
    .run(
      record.gene_id,
      record.canonical_symbol,
      c.manifestation_id,
      c.manifestation_revision_id,
      c.canonical_selection_id,
      c.body_sha256,
      c.body_bytes,
      c.lifecycle,
      c.public_page_visible ? 1 : 0,
      d.manifestation_derivative_id,
      d.derivative_head_version,
      d.status,
      d.source_body_sha256,
      d.body_sha256,
      d.body_bytes,
      d.tags_sha256,
      d.tags_bytes,
      d.fields_sha256,
      d.fields_bytes,
      d.recipe_id,
      d.recipe_version,
      d.provider_id,
      d.model_id,
      d.tagger_config_sha256,
      d.provenance_status,
      record.head_version,
      record.gene_revision,
      record.last_event_id,
      record.last_event_sequence,
      record.last_event_id,
    )
}

test("a rewrite plans with the Worker's own preparers and refuses bad Tags", async () => {
  const lineage = {
    symbol: "S1",
    gene_id: "g",
    manifestation_id: "m",
    head_revision_id: "r1",
    revision_number: 1,
    head_body_sha256: sha("0"),
    canonical_manifestation_id: "m",
    canonical_revision_id: "r1",
    canonical_selection_id: "s1",
    head_version: 1,
    gene_revision: 3,
  }
  const planned = await planRewrite(lineage, rewriteFor(1))
  assert.equal(planned.gene.select, true)
  assert.equal(planned.gene.new_revision_number, 2)
  assert.equal(
    (await planRewrite({ ...lineage, canonical_revision_id: "caretaker" }, rewriteFor(1))).gene
      .select,
    false,
  )
  assert.equal(
    (await planRewrite(lineage, { ...rewriteFor(1), tags_sha256: sha("x") })).skip,
    "tags_invalid",
  )
  assert.equal((await planRewrite(undefined, rewriteFor(1))).skip, "no_system_seed_lineage")
})

test(
  "the append adds each rewrite whole with its own Tags, skips a changed gene, keeps a caretaker's canonical, and the public reader accepts the result",
  { timeout: 180_000 },
  async (t) => {
    const source = new TestD1()
    for (const migration of AFTER_BASE) source.raw.exec(migration)
    t.after(() => source.close())
    await registerAuthorityAccount(source, {
      accountId: "account_admin",
      publicCreditLabel: "Admin",
      now: NOW,
    })
    const N = 8
    for (let n = 1; n <= N; n++) await seedGene(source, n)

    // The plan, from the seeded state (what the nightly copy holds).
    let id = 0
    const ids = (prefix) => `${prefix}_${String(++id).padStart(32, "0")}`
    const uploads = []
    for (let n = 1; n <= N; n++) {
      const { gene } = await planRewrite(readLineage(source.raw, `S${n}`), rewriteFor(n), ids)
      const prose = await prepareManifestationProse(rewriteFor(n).prose)
      const tags = await prepareManifestationTagsPayload({
        tagsText: rewriteFor(n).tags_text,
        tagsSha256: rewriteFor(n).tags_sha256,
        fieldsJson: rewriteFor(n).fields_json,
        fieldsSha256: rewriteFor(n).fields_sha256,
      })
      objects.set(key("cc", n), prose.bytes)
      objects.set(key("dd", n), tags.output_bytes)
      uploads.push({
        ...gene,
        prose_key: key("cc", n),
        prose_etag: '"p"',
        tags_key: key("dd", n),
        tags_etag: '"t"',
      })
    }
    // Gene 7 changed after the copy (its lineage head moved on); gene 8's
    // canonical is not its seed head (a caretaker's text in production).
    uploads[6] = { ...uploads[6], old_revision_id: "revision_moved_on" }
    uploads[7] = { ...uploads[7], select: false, selection_id: null, command_id: null }

    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('x')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    t.after(() => runtime.dispose())
    const db = await runtime.getD1Database("DB")
    await copyToD1(source.raw, db)

    const main = new DatabaseSync(":memory:")
    main.exec(
      "CREATE TABLE icono_gene_essence (gene_symbol TEXT PRIMARY KEY, manifestation TEXT, manifestation_tags TEXT, manifestation_fields_json TEXT)",
    )
    for (const migration of PRIMARY) main.exec(migration)
    main.exec(
      "UPDATE icono_manifestation_projection_authority SET authority_epoch = 2, mode = 'authoritative' WHERE singleton = 1",
    )
    for (let n = 1; n <= N; n++)
      project(main, await readCanonicalProjectionRecord(db, `gene_seed_${n}`))

    const triggerText = async (names) =>
      Object.fromEntries(
        (
          await db
            .prepare(
              `SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name IN (${names.map(() => "?").join(",")})`,
            )
            .bind(...names)
            .all()
        ).results.map((r) => [r.name, r.sql]),
      )
    const before = await triggerText(BYPASSED_TRIGGERS)
    assert.equal(Object.keys(before).length, BYPASSED_TRIGGERS.length)
    const mainTriggers = Object.fromEntries(
      BYPASSED_PROJECTION_TRIGGERS.map((name) => [
        name,
        main.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name).sql,
      ]),
    )

    const statements = splitMigrationSql(
      authoringMigrationSql({ uploads, triggers: before, now: LATER }),
      "0022.sql",
    )
    for (const statement of statements) assert.ok(ENCODER.encode(statement).byteLength < 100_000)
    const results = await db.batch(statements.map((s) => db.prepare(s)))
    const written = results.reduce((sum, r) => sum + r.meta.rows_written, 0)
    const appended = N - 1
    t.diagnostic(
      `rows_written ${written} for ${appended} appended genes (${(written / appended).toFixed(1)} a gene)`,
    )
    assert.ok(written <= 40 * appended, `rows written ${written} for ${appended} genes`)
    for (const statement of splitMigrationSql(
      projectionMigrationSql({ uploads, triggers: mainTriggers }),
      "0118.sql",
    ))
      main.exec(statement)

    const restore = installStorageFetch()
    t.after(() => restore())
    const mainDb = d1(main)
    for (let n = 1; n <= N; n++) {
      const u = uploads[n - 1]
      const record = await readCanonicalProjectionRecord(db, `gene_seed_${n}`)
      const material = await readPublicCanonicalMaterial({
        primaryDb: mainDb,
        authoringDb: db,
        env: ENV,
        geneId: `gene_seed_${n}`,
      })
      const lineageHead = (
        await db
          .prepare(
            "SELECT manifestation_head_revision_id AS h FROM icono_manifestations WHERE manifestation_id = ?",
          )
          .bind(`manifestation_seed_${n}`)
          .first()
      ).h
      if (n === 7) {
        assert.equal(lineageHead, `revision_seed_${n}`, "a changed gene is not appended")
        assert.equal(
          await db
            .prepare(
              "SELECT 1 FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
            )
            .bind(u.new_revision_id)
            .first(),
          null,
        )
        assert.match(material.canonical.prose, /jade chestplate/)
      } else if (n === 8) {
        assert.equal(
          lineageHead,
          u.new_revision_id,
          "history-only append still moves the lineage head",
        )
        assert.equal(
          record.canonical.manifestation_revision_id,
          `revision_seed_${n}`,
          "the canonical stays put",
        )
        assert.match(material.canonical.prose, /jade chestplate/)
      } else {
        assert.equal(lineageHead, u.new_revision_id)
        assert.equal(record.canonical.manifestation_revision_id, u.new_revision_id)
        assert.equal(record.accepted_tags_derivative.manifestation_derivative_id, u.derivative_id)
        assert.equal(record.accepted_tags_derivative.source_body_sha256, u.body_sha256)
        assert.equal(
          record.accepted_tags_derivative.tags_sha256,
          rewriteFor(n).tags_sha256,
          "the rewrite's own Tags",
        )
        assert.equal(material.canonical.manifestation_revision_id, u.new_revision_id)
        assert.match(material.canonical.prose, /pink pinafore/)
      }
    }

    assert.deepEqual(await triggerText(BYPASSED_TRIGGERS), before)
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO icono_manifestation_revision_storage_secrets (manifestation_revision_id, object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version, aad_version, verified_at, created_at) VALUES ('revision_seed_7', ?, ?, 40, '', '', '', 1, 1, ?, ?)",
        )
        .bind(key("ee", 1), sha("e"), NOW, NOW)
        .run(),
      /revision_upload_intent_is_not_adoptable/,
    )
    for (const name of BYPASSED_PROJECTION_TRIGGERS)
      assert.equal(
        main.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name).sql,
        mainTriggers[name],
      )
  },
)

function installStorageFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const parts = new URL(String(url)).pathname.split("/").filter(Boolean)
    assert.equal(parts.shift(), ENV.ICONOPLASM_AUTHORING_STORAGE_ZONE)
    const bytes = objects.get(parts.join("/"))
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"x"' } })
      : new Response(null, { status: 404 })
  }
  return () => {
    globalThis.fetch = original
  }
}
