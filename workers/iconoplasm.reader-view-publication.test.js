import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  IconoplasmVoteCoordinator,
  handlePublicGeneDetail,
  handlePublicPortraitLocator,
  hoverDeliveryHandlers,
  publishedCardDeliveryHandlers,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createCardPublicationCoordinatorClass } from "./lib/iconoplasm-card-publication-coordinator.js"
import {
  createPublishedCardObjectStore,
  publishedCardObjectKey,
} from "./lib/iconoplasm-published-card-objects.js"

// B-762 end-to-end reader view: a committed gene version travels through the
// real publication system (vote authority -> durable handoff -> card-publication
// owner), the owner advertises an exact immutable view id, and all three real
// reader handlers serve it. Later commits and compaction must leave the old
// advertised view id resolvable with exactly its old bytes.

const sha = (char) => char.repeat(64)
const SYMBOLS = ["BRCA1", "TP53"]

class DoSqlForTest {
  constructor() {
    this.db = new DatabaseSync(":memory:")
  }
  exec(sql, ...bindings) {
    const source = String(sql || "")
    let rows = []
    if (bindings.length) {
      rows = this.db.prepare(source).all(...bindings)
    } else if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(source) && !source.trim().includes(";")) {
      rows = this.db.prepare(source).all()
    } else {
      this.db.exec(source)
    }
    return { toArray: () => rows }
  }
}

function fakeState() {
  const sql = new DoSqlForTest()
  let alarm = null
  const storage = {
    sql,
    transactionSync(callback) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        sql.db.exec("COMMIT")
        return result
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
    async transaction(fn) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const result = await fn(storage)
        sql.db.exec("COMMIT")
        return result
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value) {
      alarm = value
    },
    async deleteAlarm() {
      alarm = null
    },
  }
  const state = {
    storage,
    blockConcurrencyWhile(callback) {
      this.ready = Promise.resolve().then(callback)
      return this.ready
    },
  }
  return { state, sql }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item))
  if (!value || typeof value !== "object") return value === undefined ? null : value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (["snapshot_version", "artifact_version", "data_source"].includes(key)) continue
    out[key] = stableValue(value[key])
  }
  return out
}

function cardVm(symbol, { portraitSha, prose }) {
  const portrait = {
    status: "published",
    asset_sha256: portraitSha,
    medium_url: `https://cdn.test/portraits/${symbol}-medium.webp`,
    hero_url: `https://cdn.test/portraits/${symbol}-hero.webp`,
    thumb_url: `https://cdn.test/portraits/${symbol}-thumb.webp`,
    width: 768,
    height: 1024,
  }
  const payload = {
    symbol,
    full_name: `${symbol} full name`,
    canonical_manifestation: { prose },
    portrait,
  }
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    symbol,
    full_name: `${symbol} full name`,
    portrait: { status: "published", asset_sha256: portraitSha },
    field_status: { symbol: "present" },
    payload,
  }
}

function geneRecord(symbol, prose) {
  return stableValue({
    symbol,
    full_name: `${symbol} full name`,
    canonical_manifestation: { prose },
  })
}

function portraitObject(symbol, portraitSha) {
  return stableValue({
    schema_version: 1,
    symbol,
    portrait: {
      status: "published",
      asset_sha256: portraitSha,
      medium_url: `https://cdn.test/portraits/${symbol}-medium.webp`,
      hero_url: `https://cdn.test/portraits/${symbol}-hero.webp`,
      thumb_url: `https://cdn.test/portraits/${symbol}-thumb.webp`,
      width: 768,
      height: 1024,
    },
  })
}

function installBunnyStorage() {
  const objects = new Map()
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url instanceof Request ? url.url : String(url))
    if (!parsed.hostname.endsWith("storage.test")) return original(url, init)
    const method = String(
      init.method || (url instanceof Request ? url.method : "GET") || "GET",
    ).toUpperCase()
    if (method === "PUT") {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer())
      objects.set(parsed.pathname, bytes)
      return new Response(null, { status: 201 })
    }
    const value = objects.get(parsed.pathname)
    if (!value) return new Response(null, { status: 404 })
    return new Response(value, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return {
    objects,
    restore() {
      globalThis.fetch = original
    },
  }
}

function storageEnv(kv) {
  return {
    KV: kv,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "test-zone",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.test",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-password",
  }
}

async function writeBaseCatalog(store, cards) {
  const entries = []
  for (const card of cards) {
    const cardRef = await store.write("cards", stableValue(card))
    const geneRef = await store.write(
      "genes",
      geneRecord(card.symbol, card.payload.canonical_manifestation.prose),
    )
    const portraitRef = await store.write(
      "portraits",
      portraitObject(card.symbol, card.portrait.asset_sha256),
    )
    entries.push([card.symbol, cardRef.hash, geneRef.hash, portraitRef.hash])
  }
  entries.sort((left, right) => (left[0] < right[0] ? -1 : 1))
  const directory = await store.write("indexes", { schema_version: 2, entries })
  const packed = await store.write("shards", {
    schema_version: 2,
    cards: cards.map((card) => stableValue(card)),
  })
  const manifest = {
    schema: "iconoplasm.cardCatalog.v1",
    build_revision: 1,
    storage: "bunny_card_catalog_v2",
    source: "published_card_catalog",
    card_count: cards.length,
    catalog_gene_count: cards.length,
    shard_count: 1,
    shards: [
      {
        key: packed.key,
        index: 0,
        card_count: cards.length,
        content_hash: packed.hash,
        first_symbol: entries[0][0],
        last_symbol: entries.at(-1)[0],
        delivery_indexes: [
          { key: directory.key, first_symbol: entries[0][0], last_symbol: entries.at(-1)[0] },
        ],
      },
    ],
  }
  const written = await store.write("manifests", manifest)
  return { version: `ccv2-${written.hash}`, key: written.key, manifest, directory }
}

function ownerSource() {
  return {
    legacyBaseline: async () => {
      throw new Error("legacy migration is out of scope for this test")
    },
    legacyCards: async () => [],
    highWater: async () => ({ id: 0 }),
    changed: async () => ({ symbols: [], truncated: false }),
    materialize: async (symbols, { portraitOverrides = null } = {}) =>
      symbols
        .filter((symbol) => (portraitOverrides?.[symbol] || "") !== "none")
        .map((symbol) => {
          const portraitSha = portraitOverrides?.[symbol] || sha("a")
          return cardVm(symbol, {
            portraitSha,
            prose: `Winner-published ${symbol} via ${portraitSha.slice(0, 8)}.`,
          })
        }),
    complete: (card) => Boolean(card?.__complete),
    stable: (value) => stableValue(value),
    project: (payload) => stableValue(payload),
    locator: (card) =>
      stableValue({
        schema_version: 1,
        symbol: card.symbol,
        portrait: { ...card.payload.portrait },
      }),
  }
}

function ownerBinding(owner) {
  return {
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => owner.fetch(new Request(url, init)) }),
  }
}

async function seedVoteAuthority(t) {
  const { state, sql } = fakeState()
  t.after(() => sql.db.close())
  const coordinator = new IconoplasmVoteCoordinator(state, {})
  await state.ready
  coordinator.setMeta("symbol", "TP53")
  coordinator.setMeta("bootstrapped", "1")
  coordinator.importGeneCandidateAuthority([
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
  ])
  coordinator.setMeta("published_asset_sha256", sha("a"))
  coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  await coordinator.publication.seedPublished(coordinator.authoritativeSelectionIdentity(), {
    contentSha256: sha("e"),
    objectKey: `published-cards/v2/immutable/cards/${sha("e")}.json`,
  })
  coordinator.setMeta("authority_epoch", "v2")
  coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  coordinator.importGeneCandidateAuthority([
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
    { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
  ])
  return { coordinator, sql }
}

async function ownerCommit(
  owner,
  store,
  { symbol, version, prose, portraitSha, withdrawn = false },
) {
  const cardRef = await store.write(
    "cards",
    stableValue(cardVm(symbol, { portraitSha: portraitSha || sha("a"), prose })),
  )
  const geneRef = await store.write("genes", geneRecord(symbol, prose))
  const portraitRef = await store.write(
    "portraits",
    portraitObject(symbol, portraitSha || sha("a")),
  )
  const response = await owner.fetch(
    new Request("https://internal/commit-gene-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        version,
        selection_key: sha(String(version % 10)),
        withdrawn,
        card: { key: cardRef.key, hash: cardRef.hash },
        gene: { key: geneRef.key, hash: geneRef.hash },
        portrait: { key: portraitRef.key, hash: portraitRef.hash },
      }),
    }),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.accepted, true)
  // Production wakes run one bounded step; the test runs the same bounded
  // wakes deterministically instead of waiting on a timer.
  for (let wake = 0; wake < 3; wake += 1) await owner.alarm()
}

async function advertisedView(kv) {
  const projection = JSON.parse(kv.values.get("iconoplasm:gene-delta"))
  assert.match(projection.view, /\.c[a-f0-9]{64}$/)
  assert.equal(projection.view, `${projection.base}.c${projection.chain_hash}`)
  return projection
}

async function readGene(env, view, symbol) {
  const response = await handlePublicGeneDetail(
    new Request(
      `https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/${view}/genes/${symbol}`,
    ),
    env,
    { waitUntil() {} },
    view,
    symbol,
  )
  return { status: response.status, payload: await response.json() }
}

async function readLocator(env, view, symbol) {
  const response = await handlePublicPortraitLocator(
    new Request(
      `https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/${view}/portraits/${symbol}`,
    ),
    env,
    { waitUntil() {} },
    view,
    symbol,
  )
  return { status: response.status, payload: await response.json() }
}

async function readHover(env, view, lane, symbol) {
  const indexResponse = await hoverDeliveryHandlers.index({
    env,
    match: { params: { snapshot: view } },
  })
  assert.equal(indexResponse.status, 200)
  const index = await indexResponse.json()
  assert.equal(index.snapshot_version, view)
  const range = index.ranges.find(([first, last]) => symbol >= first && symbol <= last)
  assert.ok(range, `view ${view} must publish ranges covering ${symbol}`)
  const hash = range[2]
  const response = await hoverDeliveryHandlers.content({
    request: new Request(
      `https://iconoplasm.brinedew.bio/api/public/v1/card-content/v1/${hash}/${lane}/${symbol}`,
    ),
    env,
    ctx: { waitUntil() {} },
    match: { params: { hash, lane, symbol } },
  })
  return { status: response.status, hash, payload: await response.json().catch(() => null) }
}

test(
  "an advertised gene-delta view survives compaction through all three reader handlers",
  { timeout: 120000 },
  async (t) => {
    const bunny = installBunnyStorage()
    t.after(() => bunny.restore())
    resetIconoplasmRuntimeCachesForTest()

    const values = new Map()
    const kv = {
      values,
      async get(key) {
        return values.has(key) ? values.get(key) : null
      },
      async put(key, value) {
        values.set(key, String(value))
      },
    }
    const env = storageEnv(kv)
    const store = createPublishedCardObjectStore(env)

    // Base card catalog epoch: both genes published with distinct portraits.
    const base = await writeBaseCatalog(store, [
      cardVm("TP53", { portraitSha: sha("1"), prose: "The exact base TP53 manifestation." }),
      cardVm("BRCA1", { portraitSha: sha("2"), prose: "The exact base BRCA1 manifestation." }),
    ])
    values.set(
      "iconoplasm:gallery-version",
      JSON.stringify({ current: base.version, previous: null }),
    )

    // Real publication system: vote authority -> durable handoff -> owner.
    const ownerState = fakeState()
    t.after(() => ownerState.sql.db.close())
    const Publisher = createCardPublicationCoordinatorClass(ownerSource)
    const owner = new Publisher(ownerState.state, env)
    await ownerState.state.ready
    // The owner's committed head is the same base epoch the public barrier
    // names; the per-gene delta layers on exactly that catalog artifact.
    owner.repo.put("head", {
      current: {
        version: base.version,
        key: base.key,
        manifest: base.manifest,
        published_at: new Date().toISOString(),
      },
      previous: null,
      watermark: { id: 0, created_at: null },
    })
    const { coordinator, sql: voteSql } = await seedVoteAuthority(t)
    await coordinator.applyAuthoritativeVoteMutation({
      assetSha256: sha("b"),
      userId: "reader-1",
      requestedVoteValue: 1,
      ensuredAsset: coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" }),
    })
    coordinator.env = { ICONOPLASM_CARD_PUBLICATION: ownerBinding(owner) }
    const published = await coordinator.alarm()
    assert.equal(published.publication.applied, true)
    assert.equal(published.handoff.delivered, 1)
    const handoff = voteSql.db
      .prepare(`SELECT symbol, version, delivered_at FROM publication_handoffs`)
      .get()
    assert.equal(handoff.symbol, "TP53")
    assert.equal(handoff.version, 2)
    assert.ok(handoff.delivered_at, "the durable handoff records delivery")

    for (let wake = 0; wake < 3; wake += 1) await owner.alarm()
    const first = await advertisedView(kv)
    const view1 = first.view
    assert.equal(first.base, base.version)
    assert.equal(first.segments.length, 1)

    // Advertisement: the tiny head names the exact delta view beside the base.
    const current = await (await publishedCardDeliveryHandlers.current({ env })).json()
    assert.equal(current.current, base.version)
    assert.equal(current.reader_view, view1)

    // All three real reader handlers serve the committed version pre-compaction.
    const geneBefore = await readGene(env, view1, "TP53")
    assert.equal(geneBefore.status, 200)
    assert.equal(
      geneBefore.payload.gene.canonical_manifestation.prose,
      "Winner-published TP53 via bbbbbbbb.",
    )
    const locatorBefore = await readLocator(env, view1, "TP53")
    assert.equal(locatorBefore.status, 200)
    assert.equal(locatorBefore.payload.portrait_locator.portrait.asset_sha256, sha("b"))
    const hoverGeneBefore = await readHover(env, view1, "genes", "TP53")
    assert.equal(hoverGeneBefore.status, 200)
    assert.equal(
      hoverGeneBefore.payload.record.canonical_manifestation.prose,
      "Winner-published TP53 via bbbbbbbb.",
    )
    assert.equal(hoverGeneBefore.hash, first.chain_hash)
    const hoverPortraitBefore = await readHover(env, view1, "portraits", "TP53")
    assert.equal(hoverPortraitBefore.payload.record.portrait.asset_sha256, sha("b"))
    // A symbol untouched by the delta still resolves from the view's own base.
    const untouched = await readGene(env, view1, "BRCA1")
    assert.equal(
      untouched.payload.gene.canonical_manifestation.prose,
      "The exact base BRCA1 manifestation.",
    )
    const untouchedHover = await readHover(env, view1, "genes", "BRCA1")
    assert.equal(
      untouchedHover.payload.record.canonical_manifestation.prose,
      "The exact base BRCA1 manifestation.",
    )

    // Later real commits add segments.
    await ownerCommit(owner, store, {
      symbol: "TP53",
      version: 3,
      prose: "The third TP53 manifestation.",
      portraitSha: sha("3"),
    })
    const second = await advertisedView(kv)
    assert.notEqual(second.view, view1)
    const midGene = await readGene(env, second.view, "TP53")
    assert.equal(
      midGene.payload.gene.canonical_manifestation.prose,
      "The third TP53 manifestation.",
    )
    // A tombstone is preserved: the withdrawn gene stays missing in the new view.
    await ownerCommit(owner, store, {
      symbol: "BRCA1",
      version: 2,
      prose: "withdrawn",
      withdrawn: true,
    })
    const withdrawn = await advertisedView(kv)
    const withdrawnGene = await readGene(env, withdrawn.view, "BRCA1")
    assert.equal(withdrawnGene.status, 404)
    assert.equal(withdrawnGene.payload.gene, null)
    const withdrawnLocator = await readLocator(env, withdrawn.view, "BRCA1")
    assert.equal(withdrawnLocator.status, 404)
    const withdrawnHover = await readHover(env, withdrawn.view, "genes", "BRCA1")
    assert.equal(withdrawnHover.status, 503)

    // Push past the bounded chain so compaction rewrites live references.
    for (let version = 4; version <= 10; version += 1) {
      await ownerCommit(owner, store, {
        symbol: "TP53",
        version,
        prose: `The manifestation at version ${version}.`,
        portraitSha: sha(String(version % 10)),
      })
    }
    for (let wake = 0; wake < 4; wake += 1) await owner.alarm()
    const status = await (
      await owner.fetch(new Request("https://internal/gene-delta-status"))
    ).json()
    assert.equal(status.segments, 6, "ten commits must compact to the six-segment bound")
    const final = await advertisedView(kv)
    assert.notEqual(final.view, view1)
    assert.notEqual(final.view, second.view)
    // Compaction replaced the oldest live reference with a merged object, and
    // the original segment object is still present for the old view.
    assert.notEqual(final.segments[0].key, first.segments[0].key)
    assert.ok(
      bunny.objects.has(`/test-zone/${first.segments[0].key}`),
      "the pre-compaction segment object must remain readable",
    )

    // The pre-compaction view id still returns exactly its old contents...
    const oldGene = await readGene(env, view1, "TP53")
    assert.equal(oldGene.status, 200)
    assert.equal(
      oldGene.payload.gene.canonical_manifestation.prose,
      "Winner-published TP53 via bbbbbbbb.",
    )
    const oldLocator = await readLocator(env, view1, "TP53")
    assert.equal(oldLocator.payload.portrait_locator.portrait.asset_sha256, sha("b"))
    const oldHover = await readHover(env, view1, "genes", "TP53")
    assert.equal(
      oldHover.payload.record.canonical_manifestation.prose,
      "Winner-published TP53 via bbbbbbbb.",
    )
    assert.equal(oldHover.hash, first.chain_hash)
    const oldUntouched = await readGene(env, view1, "BRCA1")
    assert.equal(
      oldUntouched.payload.gene.canonical_manifestation.prose,
      "The exact base BRCA1 manifestation.",
    )
    // ...and the old view's tombstone path is still the old committed version.
    assert.equal((await readHover(env, view1, "genes", "BRCA1")).status, 200)

    // The newly advertised view id returns the new contents.
    const newGene = await readGene(env, final.view, "TP53")
    assert.equal(
      newGene.payload.gene.canonical_manifestation.prose,
      "The manifestation at version 10.",
    )
    const newLocator = await readLocator(env, final.view, "TP53")
    assert.equal(newLocator.payload.portrait_locator.portrait.asset_sha256, sha("0"))
    const newHover = await readHover(env, final.view, "genes", "TP53")
    assert.equal(
      newHover.payload.record.canonical_manifestation.prose,
      "The manifestation at version 10.",
    )
    assert.equal(newHover.hash, final.chain_hash)
    // The withdrawn gene remains a tombstone in the new view.
    assert.equal((await readGene(env, final.view, "BRCA1")).status, 404)

    // A retired base epoch still fails closed; an exact old view is never
    // silently resolved against a newer epoch.
    values.set(
      "iconoplasm:gallery-version",
      JSON.stringify({ current: "ccv2-" + sha("9"), previous: null }),
    )
    resetIconoplasmRuntimeCachesForTest()
    const retired = await readGene(env, view1, "TP53")
    assert.equal(retired.status, 410)
    assert.equal(retired.payload.code, "card_snapshot_retired")
    const retiredIndex = await hoverDeliveryHandlers.index({
      env,
      match: { params: { snapshot: view1 } },
    })
    assert.equal(retiredIndex.status, 410)
  },
)
