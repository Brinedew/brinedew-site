import { planCandidateGalleryPages, writeCandidateGallery } from "./iconoplasm-candidate-gallery.js"
import {
  canonicalPublishedJson,
  PUBLISHED_CARD_OBJECT_LIMITS,
  publishedCardObjectKey,
} from "./iconoplasm-published-card-objects.js"

// ARCHITECTURE FENCE [IPD-011]: one durable publication job owns the head.
// D1 owns authoring; this job consumes its durable event IDs. Readers never
// enqueue, materialize, or repair cards. Bunny stores immutable bytes only.
// Do not replace the head with a mutable Bunny PUT: a timed-out old PUT can
// complete after a newer PUT. HTTP caching of the ordered head has no such race.
export const CARD_PUBLICATION_STORAGE = "bunny_card_catalog_v2"
// Four ordinary cards fit one phase. Larger galleries consume more than one
// object per card, so prepare() sizes its actual prefix before any upload.
export const CARD_PUBLICATION_BATCH = 4
export const CARD_BLOT_ALIAS_BACKFILL_BATCH = 12
const CARD_PUBLICATION_CONCURRENCY = 2
// Cloudflare Free allows 50 external subrequests per invocation. Each immutable
// object costs a PUT and verified GET; leave 18 for old-shard reads, redirects
// and provider variance. Gallery pages cannot consume this reserve.
const CARD_PUBLICATION_MAX_VERIFIED_OBJECTS_PER_PHASE = 16

function publicationObjectPlan(symbol, projected) {
  const candidates = Array.isArray(projected?.portrait_candidates)
    ? projected.portrait_candidates
    : []
  const pages = planCandidateGalleryPages(symbol, candidates)
  const count = 3 + pages.length
  if (count > CARD_PUBLICATION_MAX_VERIFIED_OBJECTS_PER_PHASE) {
    const error = new Error(
      `Candidate gallery for ${symbol} needs ${count} verified objects; one publication phase supports at most ${CARD_PUBLICATION_MAX_VERIFIED_OBJECTS_PER_PHASE}`,
    )
    error.code = "CARD_PUBLICATION_PHASE_TOO_LARGE"
    error.permanent = true
    error.gene = symbol
    error.details = {
      required_objects: count,
      max_objects: CARD_PUBLICATION_MAX_VERIFIED_OBJECTS_PER_PHASE,
    }
    throw error
  }
  return { projected, candidates, pages, count }
}
export const CARD_PUBLICATION_PACKED_SHARD_CARD_LIMIT = 750
const UTF8 = new TextEncoder()
export const CARD_DELIVERY_INDEX_SIZE = 128
// This publisher's allocation, NOT an account entitlement. The Free plan allows
// 100k SQLite DO writes per day. The former 55k cap was derived from a bootstrap
// estimate (~2.3 writes/card) that under-predicted a full-catalog
// rematerialization. The live pass then exhausted 70k at group 27 of 29
// (69,002 reserved, 855 cards left) and measured ~4.2 writes/card over groups
// 8-27, making the full pass cost ~73k. 85k covers that measured cost plus the
// candidate-completeness backfill pass with retry margin while keeping a 15k
// floor for votes, other coordinators and recovery; measured non-publisher use
// is ~1k on a normal day.
export const CARD_PUBLICATION_DAILY_WRITE_ALLOCATION = 85000
export const CARD_PUBLICATION_CONTROL_WRITE_RESERVE = 1000

export async function enrichPublishedGeneCandidates(records, loadCandidates) {
  const enriched = []
  for (const record of Array.isArray(records) ? records : []) {
    const candidates = await loadCandidates(record)
    // The published record carries the complete candidate pool. A silent slice
    // hid candidates whenever a pool grew past a fixed number (B-792); the
    // published object limits are the boundary instead, and exceeding one fails
    // the publication loudly rather than truncating what readers see.
    enriched.push({
      ...record,
      portrait_candidates: Array.isArray(candidates) ? candidates : [],
    })
  }
  return enriched
}

export function projectCardBlot(record, blot) {
  const projected = { ...record }
  if (blot) projected.blot = blot
  else delete projected.blot
  return projected
}

export function publicCatalogEntry(card) {
  const record = card?.payload && typeof card.payload === "object" ? card.payload : {}
  const symbol = String(record.symbol || card?.symbol || "")
    .trim()
    .toUpperCase()
  const candidates = Array.isArray(record.portrait_candidates) ? record.portrait_candidates : []
  const candidateSummaries = candidates.map((candidate) => ({
    candidate_image_id: candidate.candidate_image_id ?? null,
    asset_sha256: candidate.asset_sha256 ?? null,
    image_upvotes: Number(candidate.image_upvotes || 0),
    image_downvotes: Number(candidate.image_downvotes || 0),
    image_score: Number(candidate.image_score || 0),
    is_current: Boolean(candidate.is_current),
  }))
  const current = candidateSummaries.find((candidate) => candidate.is_current) || null
  return {
    symbol,
    canonical_symbol: String(record.canonical_symbol || symbol),
    full_name: String(record.full_name || record.name || symbol),
    protein_name: String(record.protein_name || ""),
    color: String(record.color || "#888"),
    chromosome: record.chromosome ?? null,
    weight_kg: record.weight_kg ?? null,
    age_years: record.age_years ?? null,
    published_at: String(record.published_at || record.asset_created_at || ""),
    uniqueness_rank:
      record.uniqueness_rank != null && Number.isFinite(Number(record.uniqueness_rank))
        ? Number(record.uniqueness_rank)
        : null,
    popularity_score: Number(record.popularity_score || 0),
    portrait: record.portrait ?? null,
    blot: record.blot ?? null,
    image_upvotes: current?.image_upvotes || 0,
    image_downvotes: current?.image_downvotes || 0,
    image_score: current?.image_score || 0,
    candidate_summaries: candidateSummaries,
  }
}

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

function nextPackedShard(cards, start, stable) {
  const emptyBytes = UTF8.encode(
    canonicalPublishedJson({ schema_version: 2, cards: [] }),
  ).byteLength
  let byteSize = emptyBytes
  const stableCards = []
  const end = Math.min(cards.length, start + CARD_PUBLICATION_PACKED_SHARD_CARD_LIMIT)
  for (let index = start; index < end; index += 1) {
    const card = stable(cards[index])
    const cardBytes = UTF8.encode(canonicalPublishedJson(card)).byteLength
    const nextSize = byteSize + cardBytes + (stableCards.length ? 1 : 0)
    if (nextSize > PUBLISHED_CARD_OBJECT_LIMITS.shards) {
      if (!stableCards.length) {
        throw new Error(`Published card cannot fit in a packed shard: ${cards[index].symbol}`)
      }
      break
    }
    stableCards.push(card)
    byteSize = nextSize
  }
  return { stableCards, end: start + stableCards.length }
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
  // B-792: the coordinator records a failed publication durably. Attach the
  // exact gene and run identity here, where both are known, so a permanent
  // oversized document names its input rather than a bare object kind.
  //
  // B-793: the gene record stays small. Its complete candidate pool moves into
  // immutable gallery pages written and verified in this same phase, and the
  // record carries the count plus a reference to the first page. The card VM
  // keeps its embedded payload until B-794 retires the duplicate publication.
  async function writeCardObjects(symbol, stable, identity, precomputed = null) {
    try {
      const publication =
        precomputed || publicationObjectPlan(symbol, source.project(stable.payload))
      const gallery = await writeCandidateGallery(
        symbol,
        publication.candidates,
        (kind, body) => objects.write(kind, body),
        publication.pages,
      )
      const geneRecord = { ...publication.projected }
      delete geneRecord.portrait_candidates
      geneRecord.candidate_count = gallery.candidate_count
      geneRecord.candidate_gallery = gallery.candidate_gallery
      const [full, gene, portrait] = await settlePublicationWrites([
        objects.write("cards", stable),
        objects.write("genes", geneRecord),
        objects.write("portraits", source.stable(source.locator(stable))),
      ])
      return [full, gene, portrait]
    } catch (error) {
      if (error && typeof error === "object") {
        if (!error.gene) error.gene = symbol
        if (!error.run) error.run = identity
      }
      throw error
    }
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
  async function migrate() {
    const head = repo.get("head")
    if (!head) return bootstrap()
    if (repo.get("job")) return status()
    if (head.current.manifest.build_revision === source.buildRevision) return status()
    repo.reserveWrites?.(3)
    repo.transaction(() => {
      repo.put("job", {
        bootstrap: false,
        migration: true,
        baseline: head.current.manifest,
        baseline_version: head.current.version,
        watermark: head.watermark,
        groups: head.current.manifest.shards.map((_, index) => ({ index, symbols: null })),
        group: 0,
        offset: 0,
        refs: [],
        started_at: now(),
      })
      repo.put("requested", true)
    })
    return status()
  }
  /**
   * B-790: re-materialize every published card from the current source without
   * changing the mapping revision. Unlike `migrate()`, which deliberately
   * reuses compatible immutable objects, this walk calls `source.materialize`
   * for every symbol, so content that only exists in the source (for example
   * bounded candidate snapshots published after an earlier freeze) reaches the
   * public plane. The head is only replaced by one fully verified commit; the
   * previous catalog stays readable until then.
   *
   * A rematerialization does not republish per-symbol blot aliases: those are
   * the compatibility owner's job (the alias backfill). Coupling a full pass to
   * a mutable alias object stalled it for tens of minutes when Bunny Storage
   * kept serving a previous alias after repeated identical PUTs (CLNK,
   * 2026-09-21); ordinary dirty publication still republishes its touched
   * aliases strictly.
   */
  async function rematerialize() {
    const head = repo.get("head")
    if (!head) throw new Error("Card publication storage migration has not been initialized")
    if (repo.get("job")) return status()
    if (
      source.buildRevision != null &&
      head.current.manifest.build_revision !== source.buildRevision
    )
      throw new Error("Card mapping revision changed; explicit catalog migration required")
    // Claim the event window this pass will cover so the post-pass dirty set
    // only contains events received while the pass was preparing.
    const through = await source.highWater()
    repo.reserveWrites?.(3)
    repo.transaction(() => {
      repo.put("job", {
        bootstrap: false,
        rematerialize: true,
        baseline: head.current.manifest,
        baseline_version: head.current.version,
        watermark: through,
        groups: head.current.manifest.shards.map((_, index) => ({ index, symbols: null })),
        group: 0,
        offset: 0,
        refs: [],
        started_at: now(),
      })
      repo.put("requested", true)
    })
    return status()
  }
  async function backfillBlotAliases() {
    const head = repo.get("head")
    if (!head) throw new Error("Card publication storage migration has not been initialized")
    if (repo.get("job")) return status()
    repo.reserveWrites?.(3)
    repo.transaction(() => {
      repo.put("job", {
        bootstrap: false,
        alias_backfill: true,
        baseline: head.current.manifest,
        baseline_version: head.current.version,
        watermark: head.watermark,
        groups: head.current.manifest.shards.map((_, index) => ({ index, symbols: null })),
        group: 0,
        offset: 0,
        alias_offset: 0,
        started_at: now(),
      })
    })
    return status()
  }
  function cancelBlotAliasBackfill() {
    const job = repo.get("job")
    if (job?.alias_backfill !== true) return { accepted: false }
    const preparedRows = repo.prepared().length
    repo.reserveWrites?.(preparedRows + 3, { control: true })
    repo.transaction(() => {
      repo.remove("job")
      repo.remove("failure")
      repo.clearPrepared()
    })
    return { accepted: true, cleared_prepared_rows: preparedRows }
  }
  /**
   * B-795: an operator stop control for a running catalog rematerialization. A
   * full pass costs a platform day and previously had no way to halt it; this
   * removes the durable job, its prepared entries and any retained retry
   * receipt, so the coordinator performs no further phases for it. Already
   * written objects stay as unreferenced content-addressed bytes; the next
   * operator action starts a fresh pass.
   */
  function cancelRematerialization() {
    const job = repo.get("job")
    if (job?.rematerialize !== true) return { accepted: false }
    const preparedRows = repo.prepared().length
    repo.reserveWrites?.(preparedRows + 3, { control: true })
    repo.transaction(() => {
      repo.remove("job")
      repo.remove("failure")
      repo.clearPrepared()
    })
    return {
      accepted: true,
      cleared_prepared_rows: preparedRows,
      stopped_at: { group: job.group, offset: job.offset, started_at: job.started_at },
    }
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
    const candidateSymbols = symbols.slice(job.offset, job.offset + CARD_PUBLICATION_BATCH)
    // Admit the bounded write work before source materialization can spend D1.
    // A large gallery may use fewer cards; this existing reservation is an
    // upper bound, and publication still records only the selected prefix.
    repo.reserveWrites?.(candidateSymbols.length + 2)
    const cards =
      job.bootstrap || job.migration
        ? oldCards.filter((card) => candidateSymbols.includes(card.symbol))
        : await source.materialize(candidateSymbols)
    const bySymbol = new Map(cards.map((card) => [card.symbol, card]))
    const slice = []
    const projections = new Map()
    let objectsInPhase = 0
    for (const symbol of candidateSymbols) {
      const card = bySymbol.get(symbol)
      if (card) {
        if (!source.complete(card)) throw new Error(`Invalid canonical card: ${symbol}`)
        const stable = source.stable(card)
        const publication = publicationObjectPlan(symbol, source.project(stable.payload))
        if (
          slice.length &&
          objectsInPhase + publication.count > CARD_PUBLICATION_MAX_VERIFIED_OBJECTS_PER_PHASE
        )
          break
        objectsInPhase += publication.count
        projections.set(symbol, { stable, publication })
      }
      slice.push(symbol)
    }
    // Index, packed-shard and root publication use separate invocations.
    // Cloudflare's April 2026 limit is six requests WAITING FOR HEADERS,
    // not six full response bodies. Starting many PUTs at once can consume the
    // 8-second request deadline while most waited in the platform queue.
    // Two cards x four independent PUT/GET pipelines stay within six.
    // Settle even failed groups completely before retrying so an earlier phase
    // cannot retain invisible in-flight work.
    // https://developers.cloudflare.com/changelog/post/2026-04-09-relaxed-connection-limiting/
    const prepared = []
    // Captured before the loop: the per-phase settlement variable below is also
    // named `group`, and an identity read inside its own initializer would hit
    // the temporal dead zone.
    const runIdentity = {
      group: group.index,
      offset: job.offset,
      started_at: job.started_at,
      rematerialize: job.rematerialize === true,
    }
    for (let offset = 0; offset < slice.length; offset += CARD_PUBLICATION_CONCURRENCY) {
      const group = await settlePublicationWrites(
        slice.slice(offset, offset + CARD_PUBLICATION_CONCURRENCY).map(async (symbol) => {
          const card = bySymbol.get(symbol)
          if (!card) {
            // A full rematerialization never deletes a published page: a
            // missing source card fails the phase closed so the previous
            // complete catalog stays readable and the pass retries.
            if (job.rematerialize)
              throw new Error(`Rematerialization source returned no card for ${symbol}`)
            return { symbol, card: null, entry: null }
          }
          const { stable, publication } = projections.get(symbol)
          const [full, gene, portrait] = await writeCardObjects(
            symbol,
            stable,
            runIdentity,
            publication,
          )
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
    // Split growing shards by both cardinality and their actual canonical UTF-8
    // bytes. Authority materialization can make legacy prose larger without
    // changing the number of genes; a fixed 750-card chunk can therefore cross
    // the immutable-object read limit and wedge every later publication retry.
    // Clients fetch only a 128-gene hash directory, never these packed bodies.
    const replacements = [...(job.sealed_refs || [])]
    const sealOffset = job.seal_offset || 0
    let nextSealOffset = sealOffset
    if (sealOffset < orderedCards.length) {
      const packedChunk = nextPackedShard(orderedCards, sealOffset, source.stable)
      nextSealOffset = packedChunk.end
      const chunk = orderedCards.slice(sealOffset, packedChunk.end)
      const entryChunk = orderedEntries.slice(sealOffset, packedChunk.end)
      const deliveryIndexes = []
      const catalogPages = []
      const publicEntries = chunk.map(publicCatalogEntry)
      const priorCatalogIndex = ref.catalog_index ? await readValue(ref.catalog_index.key) : null
      const priorCatalogPages = Array.isArray(priorCatalogIndex?.pages)
        ? priorCatalogIndex.pages
        : ref.catalog_pages || []
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
        const catalogValue = {
          schema_version: 1,
          entries: publicEntries.slice(i, i + CARD_DELIVERY_INDEX_SIZE),
        }
        const oldCatalog = priorCatalogPages.find(
          (page) => page.first_symbol === part[0][0] && page.last_symbol === part.at(-1)[0],
        )
        let catalogObject
        if (
          oldCatalog &&
          canonicalPublishedJson(await readValue(oldCatalog.key)) ===
            canonicalPublishedJson(catalogValue)
        )
          catalogObject = oldCatalog
        else catalogObject = await objects.write("catalogs", catalogValue)
        catalogPages.push({
          key: catalogObject.key,
          first_symbol: part[0][0],
          last_symbol: part.at(-1)[0],
          entry_count: part.length,
        })
      }
      const catalogIndexValue = {
        schema_version: 2,
        pages: catalogPages,
        search_entries: publicEntries.map((entry, index) => [
          entry.symbol,
          entry.full_name,
          Math.floor(index / CARD_DELIVERY_INDEX_SIZE),
          index % CARD_DELIVERY_INDEX_SIZE,
        ]),
        gallery_entries: publicEntries.map((entry, index) => [
          entry.symbol,
          Math.floor(index / CARD_DELIVERY_INDEX_SIZE),
          index % CARD_DELIVERY_INDEX_SIZE,
          Number(entry.popularity_score || 0),
          Number(entry.image_score || 0),
          entry.published_at,
          entry.full_name.length,
          entry.uniqueness_rank,
          entry.weight_kg,
          entry.age_years,
          entry.portrait?.status === "published" ? 1 : 0,
        ]),
      }
      const oldCatalogIndex = ref.catalog_index
      let catalogIndexObject
      if (
        oldCatalogIndex &&
        canonicalPublishedJson(await readValue(oldCatalogIndex.key)) ===
          canonicalPublishedJson(catalogIndexValue)
      )
        catalogIndexObject = oldCatalogIndex
      else catalogIndexObject = await objects.write("catalogindexes", catalogIndexValue)
      const packed = await objects.write("shards", {
        schema_version: 2,
        cards: packedChunk.stableCards,
      })
      replacements.push({
        key: packed.key,
        content_hash: packed.hash,
        card_count: chunk.length,
        first_symbol: chunk[0].symbol,
        last_symbol: chunk.at(-1).symbol,
        delivery_indexes: deliveryIndexes,
        catalog_index: {
          key: catalogIndexObject.key,
          first_symbol: chunk[0].symbol,
          last_symbol: chunk.at(-1).symbol,
          page_count: catalogPages.length,
        },
      })
    }
    if (nextSealOffset < orderedCards.length) {
      repo.put("job", { ...job, sealed_refs: replacements, seal_offset: nextSealOffset })
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
        alias_offset: 0,
        sealed_refs: [],
        seal_offset: 0,
      })
      repo.clearPrepared()
    })
  }
  async function publishBlotAliases(job) {
    const prepared = repo.prepared()
    const offset = job.alias_offset || 0
    const batchSize = job.alias_backfill ? CARD_BLOT_ALIAS_BACKFILL_BATCH : CARD_PUBLICATION_BATCH
    const slice = prepared.slice(offset, offset + batchSize)
    repo.reserveWrites?.(2)
    for (let index = 0; index < slice.length; index += CARD_PUBLICATION_CONCURRENCY) {
      await settlePublicationWrites(
        slice.slice(index, index + CARD_PUBLICATION_CONCURRENCY).map((item) =>
          objects.publishBlotAlias(item.symbol, item.card?.payload?.blot || null, {
            // Backfill is a compatibility projection over an already committed
            // immutable head. A historical 404 gets the static placeholder;
            // ordinary publication remains strict and cannot commit a missing
            // immutable source. A full rematerialization walks every published
            // page, so one historical missing blot must not stall the catalog
            // refresh; it gets the same placeholder instead (#190, B-790).
            allowMissingImmutablePlaceholder:
              job.alias_backfill === true || job.rematerialize === true,
          }),
        ),
      )
    }
    repo.put("job", { ...job, alias_offset: offset + slice.length })
  }
  function prepareAliasBackfill(job, oldCards) {
    const slice = oldCards.slice(job.offset, job.offset + CARD_BLOT_ALIAS_BACKFILL_BATCH)
    repo.reserveWrites?.(slice.length + 1)
    repo.transaction(() => {
      for (const card of slice) repo.prepare(card.symbol, { symbol: card.symbol, card })
      repo.put("job", { ...job, offset: job.offset + slice.length })
    })
  }
  function advanceAliasBackfillGroup(job) {
    repo.reserveWrites?.(2)
    repo.transaction(() => {
      repo.put("job", {
        ...job,
        group: job.group + 1,
        offset: 0,
        alias_offset: 0,
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
      build_revision: source.buildRevision ?? job.baseline.build_revision,
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
      if (!job.bootstrap && !job.migration && !job.rematerialize && source.afterCommit)
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
  /**
   * B-762: materialize exactly one gene for an explicitly selected winner,
   * without touching the global head, job, watermark or requested flags.
   * Every written object is content-addressed and verified by the object
   * store before this returns; a failed or partial write throws and leaves no
   * visible publication state. `portraitAssetSha256 === null` with
   * `withdraw: true` publishes the gene's portrait-less (tombstone) version.
   */
  async function materializeSymbol(symbol, { portraitAssetSha256 = null, withdraw = false } = {}) {
    const cleanSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!cleanSymbol) throw new Error("A symbol is required for per-gene materialization")
    const cleanAssetSha = String(portraitAssetSha256 || "")
    const overrides =
      withdraw || !cleanAssetSha
        ? { [cleanSymbol]: withdraw ? "none" : "" }
        : { [cleanSymbol]: cleanAssetSha }
    const cards = await source.materialize([cleanSymbol], { portraitOverrides: overrides })
    const card = cards.find(
      (candidate) =>
        String(candidate?.symbol || candidate?.canonical_symbol || "")
          .trim()
          .toUpperCase() === cleanSymbol,
    )
    if (!card) return { symbol: cleanSymbol, withdrawn: true, receipts: null }
    if (!source.complete(card)) throw new Error(`Invalid canonical card: ${cleanSymbol}`)
    const stable = source.stable(card)
    const [full, gene, portrait] = await writeCardObjects(cleanSymbol, stable, {
      per_symbol: true,
      selected_asset_sha256: cleanAssetSha ? cleanAssetSha.toLowerCase() : null,
    })
    return {
      symbol: cleanSymbol,
      withdrawn: false,
      selected_asset_sha256: cleanAssetSha ? cleanAssetSha.toLowerCase() : null,
      receipts: { card: full, gene, portrait },
    }
  }

  return {
    status,
    wake,
    bootstrap,
    migrate,
    rematerialize,
    backfillBlotAliases,
    cancelBlotAliasBackfill,
    cancelRematerialization,
    materializeSymbol,
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
      if (job.alias_backfill && job.group >= job.groups.length) {
        repo.reserveWrites?.(2)
        repo.transaction(() => {
          repo.remove("job")
          repo.clearPrepared()
        })
        return { more: false, alias_backfill_completed: true }
      }
      if (job.group >= job.groups.length) return { more: true, committed: await commit(job) }
      const group = job.groups[job.group]
      const oldCards = await cardsFor(job, job.baseline.shards[group.index])
      if (job.alias_backfill) {
        if (job.offset < oldCards.length) prepareAliasBackfill(job, oldCards)
        else if ((job.alias_offset || 0) < repo.prepared().length) await publishBlotAliases(job)
        else advanceAliasBackfillGroup(job)
        return { more: true }
      }
      if (job.migration && source.reuseExistingCardObjectsForMigration) {
        await finishGroup(job, group, oldCards)
        return { more: true }
      }
      const count = group.symbols?.length ?? oldCards.length
      if (job.offset < count) await prepare(job, group, oldCards)
      else if (!job.rematerialize && (job.alias_offset || 0) < repo.prepared().length)
        await publishBlotAliases(job)
      else await finishGroup(job, group, oldCards)
      return { more: true }
    },
  }
}

export function cardPublicationManifestKey(version) {
  const match = /^ccv2-([a-f0-9]{64})$/.exec(String(version || ""))
  return match ? publishedCardObjectKey("manifests", match[1]) : null
}
