import assert from "node:assert/strict"
import test from "node:test"
import "./metadata-delivery.js"

const { createMetadataDelivery } = globalThis.IconoplasmMetadataDelivery
const base = `ccv2-${"a".repeat(64)}`
const readerView = `${base}.c${"b".repeat(64)}`
const json = (value) => new Response(JSON.stringify(value))

test("installed reader keeps legacy base-only card-current behavior", async () => {
  const delivery = createMetadataDelivery({
    fetchImpl: async () => json({ schema_version: 2, current: base }),
  })

  const head = await delivery.current(1)
  assert.equal(head.current, base)
  assert.equal(head.reader_view, undefined)
  assert.equal(head.base_current, undefined)
})

test("installed reader adopts an exact reader_view without changing the server base head", async () => {
  const delivery = createMetadataDelivery({
    fetchImpl: async () => json({ schema_version: 2, current: base, reader_view: readerView }),
  })

  const head = await delivery.current(1)
  assert.equal(head.current, readerView)
  assert.equal(head.reader_view, readerView)
  assert.equal(head.base_current, base)
  assert.ok(head.current.length > 100)
})

test("malformed reader_view fails closed instead of silently falling back to the base", async () => {
  let calls = 0
  const delivery = createMetadataDelivery({
    fetchImpl: async () => {
      calls++
      return json({ schema_version: 2, current: base, reader_view: `${base}.cnot-a-hash` })
    },
  })

  assert.equal(await delivery.current(1), null)
  assert.equal(calls, 2)
})
