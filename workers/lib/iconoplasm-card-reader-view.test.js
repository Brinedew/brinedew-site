import assert from "node:assert/strict"
import test from "node:test"
import {
  canonicalPublishedJson,
  publishedCardObjectKey,
  publishedObjectHash,
  PUBLISHED_CARD_OBJECT_LIMITS,
} from "./iconoplasm-published-card-objects.js"
import {
  createGeneDirectory,
  writeCardReaderView,
  readCardReaderView,
  parseCardReaderView,
} from "./iconoplasm-card-reader-view.js"

function store() {
  const values = new Map()
  const meter = { reads: 0, writes: 0, bytes: 0 }
  return {
    values,
    meter,
    async write(kind, value) {
      const bytes = new TextEncoder().encode(canonicalPublishedJson(value))
      assert.ok(
        bytes.length <= PUBLISHED_CARD_OBJECT_LIMITS[kind],
        `oversized ${kind}: ${bytes.length}`,
      )
      const hash = await publishedObjectHash(bytes),
        key = publishedCardObjectKey(kind, hash)
      values.set(key, { key, hash, value: JSON.parse(new TextDecoder().decode(bytes)) })
      meter.writes++
      meter.bytes += bytes.length
      return { key, hash }
    },
    async read(key) {
      meter.reads++
      return values.get(key) || null
    },
  }
}
const hash = (n) => n.toString(16).padStart(64, "0")
const entry = (symbol, version = 1, withdrawn = false) => ({
  symbol,
  version,
  selection_key: hash(version),
  status: withdrawn ? "withdrawn" : "committed",
  card: { key: publishedCardObjectKey("cards", hash(version + 100)), hash: hash(version + 100) },
  gene: { key: publishedCardObjectKey("genes", hash(version + 200)), hash: hash(version + 200) },
  portrait: {
    key: publishedCardObjectKey("portraits", hash(version + 300)),
    hash: hash(version + 300),
  },
})

test("reader view IDs retrieve exact old roots after later changes and tombstones", async () => {
  const objects = store(),
    directory = createGeneDirectory(objects)
  const root1 = await directory.update(null, [entry("TP53"), entry("BRCA1")])
  const view1 = await writeCardReaderView(objects, `ccv2-${hash(1)}`, root1)
  const root2 = await directory.update(root1, [entry("TP53", 2, true)])
  const view2 = await writeCardReaderView(objects, `ccv2-${hash(1)}`, root2)
  assert.notEqual(view1.view, view2.view)
  assert.equal(parseCardReaderView(view1.view).base, `ccv2-${hash(1)}`)
  const old = await readCardReaderView(objects.read, view1.view)
  const current = await readCardReaderView(objects.read, view2.view)
  assert.equal((await directory.resolve(old.root, ["TP53"])).get("TP53").status, "committed")
  assert.equal((await directory.resolve(current.root, ["TP53"])).get("TP53").status, "withdrawn")
})

test("19,023 changed genes stay inside immutable page limits and one lookup follows only its path", async (t) => {
  const objects = store(),
    directory = createGeneDirectory(objects)
  let root = null
  for (let start = 0; start < 19023; start += 120) {
    root = await directory.update(
      root,
      Array.from({ length: Math.min(120, 19023 - start) }, (_, offset) =>
        entry(`G${String(start + offset).padStart(5, "0")}`),
      ),
    )
  }
  const before = { ...objects.meter }
  const exact = await directory.resolve(root, ["G01000", "G19022"])
  assert.equal(exact.size, 2)
  assert.ok(objects.meter.reads - before.reads <= 10)
  const updateBefore = { ...objects.meter }
  const next = await directory.update(root, [entry("G01000", 2)])
  assert.ok(objects.meter.reads - updateBefore.reads <= 6)
  assert.ok(objects.meter.writes - updateBefore.writes <= 6)
  const updateAfter = { ...objects.meter }
  assert.equal((await directory.resolve(root, ["G01000"])).get("G01000").version, 1)
  assert.equal((await directory.resolve(next, ["G01000"])).get("G01000").version, 2)
  t.diagnostic(
    JSON.stringify({
      genes: 19023,
      lookup_reads: updateBefore.reads - before.reads,
      single_change_reads: updateAfter.reads - updateBefore.reads,
      single_change_writes: updateAfter.writes - updateBefore.writes,
      max_page_bytes: Math.max(
        ...[...objects.values.values()].map(
          (o) => new TextEncoder().encode(canonicalPublishedJson(o.value)).length,
        ),
      ),
    }),
  )
})

test("repeated and stale directory updates preserve root and perform zero writes", async () => {
  const objects = store(),
    directory = createGeneDirectory(objects)
  const root = await directory.update(null, [entry("TP53", 2)])
  const before = objects.meter.writes
  assert.deepEqual(await directory.update(root, [entry("TP53", 2)]), root)
  assert.deepEqual(await directory.update(root, [entry("TP53", 1)]), root)
  assert.equal(objects.meter.writes, before)
  await assert.rejects(
    directory.update(root, [{ ...entry("TP53", 2), status: "withdrawn" }]),
    /Conflicting/,
  )
})

test("missing or wrong immutable pages fail without falling through to the base", async () => {
  const objects = store(),
    directory = createGeneDirectory(objects)
  const root = await directory.update(null, [entry("TP53")])
  const view = await writeCardReaderView(objects, `ccv2-${hash(9)}`, root)
  const changedBase = view.view.replace(`ccv2-${hash(9)}`, `ccv2-${hash(8)}`)
  await assert.rejects(readCardReaderView(objects.read, changedBase), /mismatched/)
  objects.values.delete(root.key)
  await assert.rejects(directory.resolve(root, ["TP53"]), /unavailable/)
})

export { store, entry }
