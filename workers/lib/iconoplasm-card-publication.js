import {
  canonicalPublishedJson,
  publishedCardObjectKey,
} from "./iconoplasm-published-card-objects.js"

// ARCHITECTURE FENCE [IPD-011]: one durable publication job owns the head.
// D1 owns authoring; this job consumes its durable event IDs. Readers never
// enqueue, materialize, or repair cards. Bunny stores immutable bytes only.
// Do not replace the head with a mutable Bunny PUT: a timed-out old PUT can
// complete after a newer PUT. HTTP caching of the ordered head has no such race.
export const CARD_PUBLICATION_STORAGE = "bunny_card_catalog_v2"
export const CARD_PUBLICATION_BATCH = 6
const CARD_PUBLICATION_CONCURRENCY = 2
export const CARD_DELIVERY_INDEX_SIZE = 128
// This publisher's allocation, NOT an account entitlement. Leave 45k of the
// Free plan's 100k SQLite DO writes for votes, other coordinators and recovery.
// Bootstrap ~19k cards reserves ~44k; ordinary winner changes are much smaller.
export const CARD_PUBLICATION_DAILY_WRITE_ALLOCATION = 55000
export const CARD_PUBLICATION_CONTROL_WRITE_RESERVE = 1000

export class CardPublicationRepository {
  constructor(storage) {
    this.storage = storage
    this.sql = storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS publication_documents (
        name TEXT PRIMARY KEY, value TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS publication_prepared_cards (
        symbol TEXT PRIMARY KEY, value TEXT NOT NULL
      ) WITHOUT ROWID;
    `)
  }
  get(name) {
    const row = this.sql
      .exec("SELECT value FROM publication_documents WHERE name = ?", name)
      .toArray()[0]
    return row ? JSON.parse(row.value) : null
  }
  put(name, value) {
    this.sql.exec(
      "INSERT INTO publication_documents VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      name,
      JSON.stringify(value),
    )
  }
  remove(name) {
    this.sql.exec("DELETE FROM publication_documents WHERE name = ?", name)
  }
  prepared() {
    return this.sql
      .exec("SELECT value FROM publication_prepared_cards ORDER BY symbol")
      .toArray()
      .map((row) => JSON.parse(row.value))
  }
  prepare(symbol, value) {
    this.sql.exec(
      "INSERT INTO publication_prepared_cards VALUES (?, ?) ON CONFLICT(symbol) DO UPDATE SET value = excluded.value",
      symbol,
      JSON.stringify(value),
    )
  }
  clearPrepared() {
    this.sql.exec("DELETE FROM publication_prepared_cards")
  }
  transaction(callback) {
    return this.storage.transactionSync(callback)
  }
  reserveWrites(writes, { control = false } = {}) {
    const day = new Date().toISOString().slice(0, 10)
    this.transaction(() => {
      const previous = this.get("write_allocation")
      const used = previous?.day === day ? previous.reserved : 0
      const reserved = used + writes
      const limit =
        CARD_PUBLICATION_DAILY_WRITE_ALLOCATION -
        (control ? 0 : CARD_PUBLICATION_CONTROL_WRITE_RESERVE)
      if (reserved > limit) {
        const error = new Error(
          "Card publisher daily SQLite write allocation exhausted; durable work retained",
        )
        error.code = "CARD_PUBLICATION_DAILY_ALLOCATION_EXHAUSTED"
        error.retryAt = Date.parse(day + "T00:00:00Z") + 86400000
        throw error
      }
      // The reservation includes its own one-row write, and commits BEFORE
      // uploads/phase transactions. Failed attempts are not refunded.
      this.put("write_allocation", {
        day,
        reserved,
        limit: CARD_PUBLICATION_DAILY_WRITE_ALLOCATION,
        accounting_version: 2,
        // v1 did not reserve alarm/failure bookkeeping. Do not relabel that
        // historical partial counter as complete; the marker clears at UTC reset.
        legacy_control_writes_unmetered:
          previous?.day === day &&
          (previous.accounting_version !== 2 || Boolean(previous.legacy_control_writes_unmetered)),
      })
    })
  }
}

function groupChanges(refs, symbols) {
  const groups = new Map()
  for (const symbol of symbols) {
    // A new symbol belongs in the first range ending after it, or the last
    // range. Empty gaps and additions at either end must not be silently lost.
    let index = refs.findIndex((ref) => symbol <= ref.last_symbol)
    if (index < 0) index = refs.length - 1
    if (index < 0) throw new Error("Publication baseline has no shard ranges")
    if (!groups.has(index)) groups.set(index, [])
    groups.get(index).push(symbol)
  }
  return [...groups].map(([index, symbols]) => ({ index, symbols }))
}

async function settlePublicationWrites(promises) {
  const settled = await Promise.allSettled(promises)
  const failure = settled.find((result) => result.status === "rejected")
  if (failure) throw failure.reason
  return settled.map((result) => result.value)
}

// The algorithm is independent of DO transport and SQL. Its repository must
// provide synchronous transactions; tests exercise crash/retry boundaries.
// The host serializes step()/bootstrap(); it must not serialize public reads
// behind uploads. Each invocation performs one bounded phase (<50 fetches).
export function createCardPublication({
  repository: repo,
  objects,
  source,
  now = () => new Date().toISOString(),
}) {
  async function readValue(key) {
    const object = await objects.read(key)
    if (!object) throw new Error(`Missing committed publication object: ${key}`)
    return object.value
  }
  async function cardsFor(job, ref) {
    return job.bootstrap ? source.legacyCards(ref) : (await readValue(ref.key)).cards
  }
  function status() {
    return {
      head: repo.get("head"),
      job: repo.get("job"),
      requested: repo.get("requested"),
      effects: repo.get("effects"),
    }
  }
  function wake() {
    // Coalesce write-side wakeups, not reader traffic. D1's event log remains
    // the source of pending work even if this notification is lost.
    if (!repo.get("requested")) {
      repo.reserveWrites?.(2)
      repo.put("requested", true)
    }
  }
  async function bootstrap() {
    const head = repo.get("head")
    if (
      head &&
      source.buildRevision != null &&
      head.current.manifest.build_revision !== source.buildRevision
    )
      throw new Error(
        "Card mapping revision changed; storage bootstrap cannot perform a mapping migration",
      )
    if (head || repo.get("job")) return status()
    const baseline = await source.legacyBaseline()
    if (!baseline?.manifest?.shards?.length || !baseline.watermark) {
      throw new Error("Explicit migration requires a complete legacy baseline and event watermark")
    }
    const refs = baseline.manifest.shards
    repo.reserveWrites?.(3)
    repo.transaction(() => {
      repo.put("job", {
        bootstrap: true,
        baseline: baseline.manifest,
        watermark: baseline.watermark,
        groups: refs.map((_, index) => ({ index, symbols: null })),
        group: 0,
        offset: 0,
        refs: [],
        started_at: now(),
      })
      repo.put("requested", true)
    })
    return status()
  }
  async function start() {
    const head = repo.get("head")
    if (!head) throw new Error("Card publication storage migration has not been initialized")
    if (
      source.buildRevision != null &&
      head.current.manifest.build_revision !== source.buildRevision
    )
      throw new Error("Card mapping revision changed; explicit catalog migration required")
    repo.reserveWrites?.(2)
    const through = await source.highWater()
    if (through.id <= head.watermark.id) {
      repo.remove("requested")
      return null
    }
    const changed = await source.changed(head.watermark, through)
    if (changed.truncated)
      throw new Error("Publication dirty set exceeded its explicit safety limit")
    const job = {
      bootstrap: false,
      baseline: head.current.manifest,
      baseline_version: head.current.version,
      watermark: through,
      groups: groupChanges(head.current.manifest.shards, changed.symbols),
      group: 0,
      offset: 0,
      refs: head.current.manifest.shards.slice(),
      started_at: now(),
    }
    repo.put("job", job)
    return job
  }
  async function prepare(job, group, oldCards) {
    const symbols = group.symbols || oldCards.map((card) => card.symbol)
    const slice = symbols.slice(job.offset, job.offset + CARD_PUBLICATION_BATCH)
    repo.reserveWrites?.(slice.length + 2)
    const cards = job.bootstrap
      ? oldCards.filter((card) => slice.includes(card.symbol))
      : await source.materialize(slice)
    const bySymbol = new Map(cards.map((card) => [card.symbol, card]))
    // 6 cards * 3 independent objects * (PUT + verified GET) = 36 fetches.
    // Leave fourteen of Cloudflare Free's fifty subrequests for the old-shard
    // read, source materialization, redirects, and storage-provider variance.
    // Seven cards left only eight requests of headroom and failed live when a
    // later materialization page needed more than that. Index/packed-shard/root
    // publication is a separate invocation.
    // Cloudflare's April 2026 limit is six requests WAITING FOR HEADERS,
    // not six full response bodies. Starting 21 PUTs at once can consume the
    // 8-second request deadline while most waited in the platform queue.
    // Two cards x three independent PUT/GET pipelines stay within six.
    // Keep six cards per durable phase: reducing that batch further would
    // increase SQLite checkpoint writes. Settle even failed groups completely
    // before retrying so an earlier phase cannot retain invisible in-flight work.
    // https://developers.cloudflare.com/changelog/post/2026-04-09-relaxed-connection-limiting/
    const prepared = []
    for (let offset = 0; offset < slice.length; offset += CARD_PUBLICATION_CONCURRENCY) {
      const group = await settlePublicationWrites(
        slice.slice(offset, offset + CARD_PUBLICATION_CONCURRENCY).map(async (symbol) => {
          const card = bySymbol.get(symbol)
          if (!card) return { symbol, card: null, entry: null }
          if (!source.complete(card)) throw new Error(`Invalid canonical card: ${symbol}`)
          const stable = source.stable(card)
          const [full, gene, portrait] = await settlePublicationWrites([
            objects.write("cards", stable),
            objects.write("genes", source.project(stable.payload)),
            objects.write("portraits", source.stable(source.locator(stable))),
          ])
          return { symbol, card, entry: [symbol, full.hash, gene.hash, portrait.hash] }
        }),
      )
      prepared.push(...group)
    }
    repo.transaction(() => {
      for (const item of prepared) repo.prepare(item.symbol, item)
      repo.put("job", { ...job, offset: job.offset + slice.length })
    })
  }
  async function finishGroup(job, group, oldCards) {
    const ref = job.baseline.shards[group.index]
    const cards = new Map(oldCards.map((card) => [card.symbol, card]))
    const entries = new Map()
    if (!job.bootstrap) {
      for (const index of ref.delivery_indexes) {
        for (const entry of (await readValue(index.key)).entries) entries.set(entry[0], entry)
      }
    }
    const prepared = repo.prepared()
    repo.reserveWrites?.(prepared.length + 2)
    for (const item of prepared) {
      if (item.card) {
        cards.set(item.symbol, item.card)
        entries.set(item.symbol, item.entry)
      } else {
        cards.delete(item.symbol)
        entries.delete(item.symbol)
      }
    }
    const orderedCards = [...cards.values()].sort((a, b) =>
      a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0,
    )
    const orderedEntries = [...entries.values()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    if (orderedCards.length !== orderedEntries.length) throw new Error("Incomplete delivery index")
    // Split growing shards. The migration's existing 750-card ranges stay
    // packed for bulk/site reads; clients fetch only a 128-gene hash directory,
    // never these packed full-card bodies.
    const replacements = [...(job.sealed_refs || [])]
    const sealOffset = job.seal_offset || 0
    for (
      let offset = sealOffset;
      offset < Math.min(orderedCards.length, sealOffset + 750);
      offset += 750
    ) {
      const chunk = orderedCards.slice(offset, offset + 750)
      const entryChunk = orderedEntries.slice(offset, offset + 750)
      const deliveryIndexes = []
      for (let i = 0; i < entryChunk.length; i += CARD_DELIVERY_INDEX_SIZE) {
        const part = entryChunk.slice(i, i + CARD_DELIVERY_INDEX_SIZE)
        const value = { schema_version: 2, entries: part }
        // Content identity, not the enclosing publication epoch. Unchanged
        // directories and cards retain their URLs when a neighbor changes.
        const old = ref.delivery_indexes?.find(
          (index) => index.first_symbol === part[0][0] && index.last_symbol === part.at(-1)[0],
        )
        let object
        if (
          old &&
          canonicalPublishedJson(await readValue(old.key)) === canonicalPublishedJson(value)
        )
          object = old
        else object = await objects.write("indexes", value)
        deliveryIndexes.push({
          key: object.key,
          first_symbol: part[0][0],
          last_symbol: part.at(-1)[0],
        })
      }
      const stableCards = chunk.map((card) => source.stable(card))
      const packed = await objects.write("shards", { schema_version: 2, cards: stableCards })
      replacements.push({
        key: packed.key,
        content_hash: packed.hash,
        card_count: chunk.length,
        first_symbol: chunk[0].symbol,
        last_symbol: chunk.at(-1).symbol,
        delivery_indexes: deliveryIndexes,
      })
    }
    if (sealOffset + 750 < orderedCards.length) {
      repo.put("job", { ...job, sealed_refs: replacements, seal_offset: sealOffset + 750 })
      return
    }
    const refs = job.refs.slice()
    // Keep original positions until commit so a split cannot move later groups.
    refs[group.index] = replacements
    repo.transaction(() => {
      repo.put("job", {
        ...job,
        refs,
        group: job.group + 1,
        offset: 0,
        sealed_refs: [],
        seal_offset: 0,
      })
      repo.clearPrepared()
    })
  }
  async function commit(job) {
    repo.reserveWrites?.(6)
    const head = repo.get("head")
    if (!job.bootstrap && head?.current.version !== job.baseline_version)
      throw new Error("Publication baseline changed")
    const refs = job.refs.flat().map((ref, index) => ({ ...ref, index }))
    const count = refs.reduce((sum, ref) => sum + ref.card_count, 0)
    const manifest = {
      schema: job.baseline.schema,
      build_revision: job.baseline.build_revision,
      storage: CARD_PUBLICATION_STORAGE,
      source: "published_card_catalog",
      card_count: count,
      catalog_gene_count: count,
      shard_count: refs.length,
      shards: refs,
    }
    const object = await objects.write("manifests", manifest)
    const version = `ccv2-${object.hash}`
    const current = { version, key: object.key, manifest, published_at: now() }
    // All bytes were verified before this single transaction. Neither the
    // event watermark nor the head can advance alone on crash or retry.
    repo.transaction(() => {
      repo.put("head", {
        current,
        previous: head?.current.version === version ? head.previous : head?.current || null,
        watermark: job.watermark,
      })
      if (!job.bootstrap && source.afterCommit)
        repo.put("effects", {
          version,
          after: head.watermark,
          through: job.watermark,
          symbols: job.groups.flatMap((group) => group.symbols || []),
          offset: 0,
        })
      repo.remove("job")
      repo.clearPrepared()
      // One final event-log check catches votes received during preparation.
      repo.put("requested", true)
    })
    return current
  }
  return {
    status,
    wake,
    bootstrap,
    async step() {
      const effects = repo.get("effects")
      if (effects) {
        repo.reserveWrites?.(2)
        const symbols = effects.symbols.slice(
          effects.offset,
          effects.offset + CARD_PUBLICATION_BATCH,
        )
        await source.afterCommit({ ...effects, symbols })
        if (effects.offset + symbols.length >= effects.symbols.length) repo.remove("effects")
        else repo.put("effects", { ...effects, offset: effects.offset + symbols.length })
        return { more: true }
      }
      const job = repo.get("job") || (repo.get("requested") ? await start() : null)
      if (!job) return { more: false }
      if (job.group >= job.groups.length) return { more: true, committed: await commit(job) }
      const group = job.groups[job.group]
      const oldCards = await cardsFor(job, job.baseline.shards[group.index])
      const count = group.symbols?.length ?? oldCards.length
      if (job.offset < count) await prepare(job, group, oldCards)
      else await finishGroup(job, group, oldCards)
      return { more: true }
    },
  }
}

export function cardPublicationManifestKey(version) {
  const match = /^ccv2-([a-f0-9]{64})$/.exec(String(version || ""))
  return match ? publishedCardObjectKey("manifests", match[1]) : null
}
