// ARCHITECTURE FENCE [IPD-008] + ARCHITECTURE FENCE [IPD-011]
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createCardPublicationCoordinatorClass } from "./lib/iconoplasm-card-publication-coordinator.js"
import {
  canonicalPublishedJson,
  publishedCardObjectKey,
  publishedObjectHash,
} from "./lib/iconoplasm-published-card-objects.js"
import {
  IconoplasmVoteCoordinator,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as handle,
  readIconoplasmPublishedCardCatalogArtifactForTest as readCards,
  resetIconoplasmRuntimeCachesForTest as reset,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import "../iconoplasm-extension/metadata-delivery.js"

function sqliteState(t) {
  const db = new DatabaseSync(":memory:")
  t.after(() => db.close())
  let alarm = null,
    tail = Promise.resolve()
  const storage = {
    sql: {
      exec(query, ...bindings) {
        if (!bindings.length && query.trim().split(";").filter(Boolean).length > 1) {
          db.exec(query)
          return { toArray: () => [] }
        }
        const rows = db.prepare(query).all(...bindings)
        return { toArray: () => rows }
      },
    },
    transactionSync(callback) {
      db.exec("BEGIN")
      try {
        const value = callback()
        db.exec("COMMIT")
        return value
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    transaction(callback) {
      const next = tail.then(async () => {
        const previous = alarm
        db.exec("BEGIN")
        try {
          const value = await callback(storage)
          db.exec("COMMIT")
          return value
        } catch (error) {
          db.exec("ROLLBACK")
          alarm = previous
          throw error
        }
      })
      tail = next.catch(() => {})
      return next
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value) {
      alarm = value
    },
  }
  const state = {
    storage,
    blockConcurrencyWhile(callback) {
      this.ready = Promise.resolve().then(callback)
      return this.ready
    },
  }
  return {
    db,
    state,
    consumeAlarm() {
      alarm = null
    },
    alarm: () => alarm,
  }
}
const sha = (char) => char.repeat(64)
function card(symbol, asset) {
  const portrait = asset
    ? {
        status: "published",
        asset_sha256: asset,
        medium_url: `https://example.test/${asset}.webp`,
        hero_url: `https://example.test/${asset}.webp`,
        thumb_url: `https://example.test/${asset}.webp`,
      }
    : { status: "missing" }
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    symbol,
    full_name: symbol,
    portrait,
    field_status: {},
    payload: { symbol, full_name: symbol, portrait },
  }
}
async function fixture(t) {
  reset()
  let now = Date.parse("2026-09-14T15:00:00Z")
  t.mock.method(Date, "now", () => now)
  const values = new Map(),
    kv = new Map(),
    calls = [],
    kvReads = [],
    kvWrites = []
  let failPut = false
  async function object(kind, value) {
    const bytes = new TextEncoder().encode(canonicalPublishedJson(value)),
      hash = await publishedObjectHash(bytes),
      key = publishedCardObjectKey(kind, hash)
    values.set(key, bytes)
    return { key, hash }
  }
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url),
      key = url.pathname.replace(/^\/fixture\//, "").replace(/^\//, "")
    const method = init.method || "GET"
    calls.push({ key, method })
    if (method === "PUT") {
      values.set(key, new Uint8Array(init.body))
      return new Response(null, { status: 201 })
    }
    return values.has(key) ? new Response(values.get(key)) : new Response(null, { status: 404 })
  }
  t.after(() => {
    globalThis.fetch = original
    reset()
  })
  const env = {
    PUBLIC_RATE_LIMIT_120: { limit: async () => ({ success: true }) },
    KV: {
      async get(key) {
        kvReads.push(key)
        return kv.get(key) || null
      },
      async put(key, value) {
        kvWrites.push(key)
        if (failPut) throw Error("KV unavailable")
        kv.set(key, value)
      },
    },
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "fixture",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
    ICONOPLASM_DB: {
      prepare() {
        throw Error("Reader D1 forbidden")
      },
    },
  }
  const old = card("TP53", sha("a")),
    other = card("BRCA1", sha("c"))
  const refs = {}
  for (const value of [old, other])
    refs[value.symbol] = {
      card: await object("cards", value),
      gene: await object("genes", value.payload),
      portrait: await object("portraits", {
        symbol: value.symbol,
        portrait: value.payload.portrait,
      }),
    }
  const index = await object("indexes", {
    schema_version: 2,
    entries: ["BRCA1", "TP53"].map((symbol) => [
      symbol,
      refs[symbol].card.hash,
      refs[symbol].gene.hash,
      refs[symbol].portrait.hash,
    ]),
  })
  const packed = await object("shards", { schema_version: 2, cards: [other, old] })
  const manifest = {
    schema: "iconoplasm.cardCatalog.v1",
    storage: "bunny_card_catalog_v2",
    card_count: 2,
    catalog_gene_count: 2,
    shards: [
      {
        key: packed.key,
        content_hash: packed.hash,
        card_count: 2,
        first_symbol: "BRCA1",
        last_symbol: "TP53",
        delivery_indexes: [{ key: index.key, first_symbol: "BRCA1", last_symbol: "TP53" }],
      },
    ],
  }
  const root = await object("manifests", manifest),
    base = `ccv2-${root.hash}`
  kv.set("iconoplasm:gallery-version", JSON.stringify({ current: base, previous: null }))
  const source = () => ({
    materialize: async (symbols, { portraitOverrides } = {}) =>
      symbols.map((symbol) =>
        card(
          symbol,
          portraitOverrides?.[symbol] === "none" ? null : portraitOverrides?.[symbol] || sha("a"),
        ),
      ),
    complete: (value) => value?.__complete === true,
    stable: (value) => value,
    project: (value) => value,
    locator: (value) => ({ symbol: value.symbol, portrait: value.payload.portrait }),
  })
  const Publisher = createCardPublicationCoordinatorClass(source)
  const pubState = sqliteState(t)
  let owner = new Publisher(pubState.state, env)
  await pubState.state.ready
  owner.repo.put("head", {
    current: { version: base, key: root.key, manifest, published_at: "2026-09-14T00:00:00Z" },
    previous: null,
    watermark: { event_id: 0, created_at: "" },
  })
  env.ICONOPLASM_CARD_PUBLICATION = {
    idFromName: (name) => name,
    get: () => ({
      fetch: (input, init) =>
        owner.fetch(input instanceof Request ? input : new Request(input, init)),
    }),
  }
  const voteState = sqliteState(t),
    vote = new IconoplasmVoteCoordinator(voteState.state, env)
  await voteState.state.ready
  vote.setMeta("symbol", "TP53")
  vote.setMeta("bootstrapped", "1")
  vote.setMeta("published_asset_sha256", sha("a"))
  vote.importGeneCandidateAuthority(
    ["a", "b"].map((char) => ({
      asset_sha256: sha(char),
      status: "approved",
      autopick_eligible: 1,
    })),
  )
  for (const char of ["a", "b"]) vote.ensureAssetSummaryRow(sha(char), { visionId: "anima-v1-9" })
  await vote.publication.seedPublished(vote.authoritativeSelectionIdentity(), {
    contentSha256: refs.TP53.card.hash,
    objectKey: refs.TP53.card.key,
    projections: { gene: refs.TP53.gene, portrait: refs.TP53.portrait },
  })
  vote.setMeta("authority_epoch", "v2")
  const read = (path) =>
    handle(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        headers: { "X-Iconoplasm-Extension-Version": "0.5.3" },
      }),
      env,
    )
  const choose = async (user) => {
    const response = await vote.fetch(
      new Request("https://internal/vote/set", {
        method: "POST",
        body: JSON.stringify({
          symbol: "TP53",
          user_id: user,
          asset_sha256: sha("b"),
          vote_value: 1,
        }),
      }),
    )
    assert.equal(response.status, 200)
    voteState.consumeAlarm()
    const published = await vote.alarm()
    assert.equal(published.publication.applied, true)
    assert.equal(published.handoff.delivered, 1)
    pubState.consumeAlarm()
    await owner.alarm()
    reset()
    return JSON.parse(kv.get("iconoplasm:gallery-version")).current
  }
  return {
    env,
    values,
    kv,
    calls,
    kvReads,
    kvWrites,
    base,
    refs,
    read,
    choose,
    vote,
    owner: () => owner,
    failPut: (value) => {
      failPut = value
    },
    advance: (ms) => {
      now += ms
    },
    async restartOwner() {
      owner = new Publisher(pubState.state, env)
      await pubState.state.ready
    },
    pubState,
  }
}

test("accepted vote -> real alarms -> immutable view -> current, site card, detail, locator and released hover reads", async (t) => {
  const f = await fixture(t),
    view = await f.choose("reader")
  assert.match(view, /^ccv2-[a-f0-9]{64}\.c[a-f0-9]{64}$/)
  const current = await f.read("/api/public/v1/card-current")
  assert.equal((await current.json()).current, view)
  assert.ok(f.kvReads.every((key) => key === "iconoplasm:gallery-version"))
  const full = await readCards(f.env, view, ["TP53", "BRCA1"], { allowWholeArtifact: false })
  assert.equal(full.bySymbol.get("TP53").portrait.asset_sha256, sha("b"))
  assert.equal(full.bySymbol.get("BRCA1").portrait.asset_sha256, sha("c"))
  const pinned = await readCards(f.env, f.base, ["TP53"], { allowWholeArtifact: false })
  assert.equal(pinned.bySymbol.get("TP53").portrait.asset_sha256, sha("a"))
  const site = await f.read("/api/iconoplasm/cards/TP53")
  assert.equal(site.status, 200)
  assert.match(await site.text(), new RegExp(sha("b")))
  const gene = await f.read(`/api/public/v1/card-snapshots/${view}/genes/TP53`)
  assert.equal(gene.status, 200)
  assert.equal((await gene.json()).gene.portrait.asset_sha256, sha("b"))
  const locator = await f.read(`/api/public/v1/card-snapshots/${view}/portraits/TP53`)
  assert.equal((await locator.json()).portrait_locator.portrait.asset_sha256, sha("b"))
  const index = await f.read(`/api/public/v1/card-snapshots/${view}/delivery-index`)
  const range = (await index.json()).ranges[0]
  const legacy = await f.read(`/api/public/v1/card-content/v1/${range[2]}/portraits/TP53`)
  assert.equal((await legacy.json()).record.portrait.asset_sha256, sha("b"))
  t.diagnostic(
    JSON.stringify({
      view,
      kv_write_keys: f.kvWrites,
      reader_d1_calls: 0,
      legacy_vote_outbox: f.vote.pendingOutboxRows().length,
    }),
  )
})

test("new extension resolves the composite view directly from Bunny with independent projection lanes", async (t) => {
  const f = await fixture(t),
    view = await f.choose("reader")
  const calls = []
  const delivery = globalThis.IconoplasmMetadataDelivery.createMetadataDelivery({
    fetchImpl: async (input, init) => {
      calls.push(String(input))
      const key = new URL(input).pathname.slice(1)
      assert.ok(String(input).startsWith("https://iconoplasmportraits.b-cdn.net/"))
      return f.values.has(key)
        ? new Response(f.values.get(key))
        : new Response(null, { status: 404 })
    },
  })
  const [gene, portrait] = await Promise.all(
    ["genes", "portraits"].map((lane) =>
      delivery.fetch(
        `https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/${view}/${lane}/TP53`,
        { method: "GET", credentials: "same-origin" },
        10,
      ),
    ),
  )
  assert.equal(gene.status, 200)
  assert.equal(portrait.status, 200)
  assert.equal((await gene.json()).gene.portrait.asset_sha256, sha("b"))
  assert.equal((await portrait.json()).portrait_locator.portrait.asset_sha256, sha("b"))
  assert.equal(calls.length, 4, "one immutable view, one shared leaf, two independent records")
})

test("KV failure retains the previous view; restart retries only advertisement; idle alarms do no puts", async (t) => {
  const f = await fixture(t)
  f.failPut(true)
  await f.choose("reader")
  assert.equal(JSON.parse(f.kv.get("iconoplasm:gallery-version")).current, f.base)
  const puts = f.calls.filter((c) => c.method === "PUT").length
  f.failPut(false)
  f.advance(2000)
  await f.restartOwner()
  f.pubState.consumeAlarm()
  await f.owner().alarm()
  const view = JSON.parse(f.kv.get("iconoplasm:gallery-version")).current
  assert.notEqual(view, f.base)
  assert.equal(
    f.calls.filter((c) => c.method === "PUT").length,
    puts,
    "retry must not rewrite immutable tree or view",
  )
  const kvPuts = f.kvWrites.length
  f.pubState.consumeAlarm()
  await f.owner().alarm()
  assert.equal(f.kvWrites.length, kvPuts)
})

test("a portrait withdrawal becomes a fresh portrait-less profile while older named views remain readable", async (t) => {
  const f = await fixture(t),
    view = await f.choose("reader")
  const response = await f.vote.fetch(
    new Request("https://internal/authority/candidates", {
      method: "POST",
      body: JSON.stringify({ symbol: "TP53", items: [] }),
    }),
  )
  assert.equal(response.status, 200)
  await f.vote.alarm()
  f.pubState.consumeAlarm()
  await f.owner().alarm()
  reset()
  const newest = JSON.parse(f.kv.get("iconoplasm:gallery-version")).current
  assert.notEqual(newest, view)
  const old = await readCards(f.env, view, ["TP53"], { allowWholeArtifact: false })
  assert.equal(old.bySymbol.get("TP53").portrait.asset_sha256, sha("b"))
  const current = await f.read(`/api/public/v1/card-snapshots/${newest}/genes/TP53`)
  assert.equal(current.status, 200)
  assert.equal((await current.json()).gene.portrait.status, "missing")
  const locator = await f.read(`/api/public/v1/card-snapshots/${newest}/portraits/TP53`)
  assert.equal(locator.status, 404)
})

test("a stalled legacy publisher cannot prevent a completed gene reaching fresh readers", async (t) => {
  const f = await fixture(t)
  f.owner().publisher.step = async () => {
    throw Error("legacy finalization unavailable")
  }
  const view = await f.choose("reader")
  assert.notEqual(view, f.base)
  assert.equal(
    (await (await f.read(`/api/public/v1/card-snapshots/${view}/genes/TP53`)).json()).gene.portrait
      .asset_sha256,
    sha("b"),
  )
})
