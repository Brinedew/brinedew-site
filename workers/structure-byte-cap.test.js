// The structure-bytes route caps the bytes it streams, whatever the upstream announces.
//
// `/api/structure-cached?key=` streams a provider's file to the browser. The old
// guard read the upstream's `Content-Length` and refused a file over 20 MiB
// (`MAX_STRUCTURE_FILE_BYTES`). The providers do not make that header reliable (live
// responses, 2026-10-03; curl asking for gzip and br, and a local workerd run):
//   RCSB (bcif)           no Content-Length either way (chunked), 148,689 bytes
//   AlphaFold (.pdb)      curl: the gzip size on the wire (62,578 for a 279,449 byte
//                         file); workerd: none, it drops the header when it decompresses
//   SWISS-MODEL (.pdb)    curl: chunked gzip, no Content-Length; workerd: a plain
//                         Content-Length. 5.55 MB for one TP53 model
// So the guard saw a size for at most one of the three providers, and for AlphaFold
// it was the wrong size. A SWISS-MODEL body was also read whole with `arrayBuffer()`
// and copied again to prepend the HEADER line Mol* needs, about twice the file in a
// 128 MB isolate that serves many requests.
//
// The cap now counts the bytes that actually stream, after decompression, and the
// SWISS-MODEL HEADER line is streamed ahead of the body, so nothing is buffered.
//
// Everything runs through the real Worker. The network is a stub whose bodies are
// lazy streams that count what was pulled from them and whether they were cancelled,
// and none sends a Content-Length.
//
// Failure modes this file proves, each written before the code that fixes it:
//   B1  a body past the cap is delivered whole because no Content-Length announces it
//   B2  a Content-Length that understates the body is believed
//   B3  the cap is off by one: a body of exactly the cap is cut, or one byte more passes
//   B4  a body is buffered whole in the Worker instead of streamed, so a burst of large
//       structures piles up in one isolate
//   B5  the SWISS-MODEL HEADER line is lost, or the cap counts it against the file
//   B6  past the cap the upstream is still read to its end (it must be cancelled)
import assert from "node:assert/strict"
import test, { mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

const MIB = 1024 * 1024
// The anonymous line Mol* needs at the top of a SWISS-MODEL PDB file.
const HEADER_LINE = "HEADER    MODEL                                   01-JAN-00   0000\n"
// MAX_STRUCTURE_FILE_BYTES: 20 MiB.
const CAP = 20 * MIB

const AF_URL = "https://alphafold.ebi.ac.uk/files/AF-Q9AF01-F1-model_v6.pdb"
const SM_URL =
  "https://swissmodel.expasy.org/repository/uniprot/Q9SM01.pdb?range=8-148&template=5ltu.1.A&provider=swissmodel"
const RCSB_URL = "https://models.rcsb.org/v1/1B64/full?encoding=bcif&copy_all_categories=false"

const KEYS = [
  { name: "RCSB bcif", key: "pdb/1B64.bcif", upstream: RCSB_URL, header: 0 },
  { name: "AlphaFold pdb", key: "alphafold/Q9AF01.pdb", upstream: AF_URL, header: 0 },
  { name: "SWISS-MODEL pdb", key: "swissmodel/Q9SM01_5ltu_1_A.pdb", upstream: SM_URL, header: 1 },
]

const STORED_ROWS = {
  Q9AF01: {
    uniprot: "Q9AF01",
    structure_source: "alphafold",
    pdb_id: null,
    alphafold_url: AF_URL,
    swissmodel_url: null,
    swissmodel_template: null,
  },
  Q9SM01: {
    uniprot: "Q9SM01",
    structure_source: "swissmodel",
    pdb_id: null,
    alphafold_url: null,
    swissmodel_url: SM_URL,
    swissmodel_template: "5ltu.1.A",
  },
}

function createDb() {
  return {
    prepare(sql) {
      assert.match(sql, /FROM proteins/i)
      return {
        bind(uniprot) {
          return {
            async first() {
              return STORED_ROWS[String(uniprot || "").toUpperCase()] || null
            },
          }
        },
      }
    },
  }
}

// A lazy body of `totalBytes` bytes in `chunk`-byte pieces. `stats.pulledBytes` is
// how much the consumer has asked for so far; `stats.cancelled` says the consumer
// stopped reading before the end.
function lazyBody(totalBytes, { chunk = MIB } = {}) {
  const stats = { pulledBytes: 0, cancelled: false }
  const body = new ReadableStream({
    pull(controller) {
      const remaining = totalBytes - stats.pulledBytes
      if (remaining <= 0) {
        controller.close()
        return
      }
      const size = Math.min(chunk, remaining)
      controller.enqueue(new Uint8Array(size).fill(0x41))
      stats.pulledBytes += size
    },
    cancel() {
      stats.cancelled = true
    },
  })
  return { body, stats }
}

// One request through the real Worker. The upstream answers 200 with a lazy body and
// the given headers, and never a Content-Length unless `headers` adds one.
async function getStructure({ key, upstream }, totalBytes, { headers = {} } = {}) {
  const { body, stats } = lazyBody(totalBytes)
  const original = globalThis.fetch
  const asked = []
  globalThis.fetch = async (input) => {
    asked.push(String(input))
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", ...headers },
    })
  }
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  try {
    const response = await worker.fetch(
      new Request(
        `https://geneguessr.brinedew.bio/api/structure-cached?key=${encodeURIComponent(key)}`,
      ),
      { DB: createDb() },
      { waitUntil() {} },
    )
    assert.deepEqual(asked, [upstream], `${key} fetches its own upstream`)
    return { response, stats }
  } finally {
    globalThis.fetch = original
    mock.restoreAll()
  }
}

for (const target of KEYS) {
  test(`B1: ${target.name}: a body past the cap with no Content-Length is cut off`, async () => {
    const { response, stats } = await getStructure(target, CAP + 64 * MIB)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-length"), null, "nothing announced a size")
    await assert.rejects(response.arrayBuffer(), "the client never gets a complete oversize file")
    assert.ok(
      stats.pulledBytes <= CAP + 2 * MIB,
      `${stats.pulledBytes} bytes were read from the upstream; the cap is ${CAP}`,
    )
    assert.equal(stats.cancelled, true, "B6: the upstream is cancelled, not drained")
  })

  test(`B2: ${target.name}: a Content-Length that understates the body is not believed`, async () => {
    const { response, stats } = await getStructure(target, CAP + 8 * MIB, {
      headers: { "Content-Length": "1000" },
    })
    await assert.rejects(response.arrayBuffer())
    assert.ok(stats.pulledBytes <= CAP + 2 * MIB, `${stats.pulledBytes} bytes read`)
  })

  test(`B3: ${target.name}: a body of exactly the cap is served whole, one byte more is cut`, async () => {
    const exact = await getStructure(target, CAP)
    assert.equal(exact.response.status, 200)
    const bytes = new Uint8Array(await exact.response.arrayBuffer())
    assert.equal(
      bytes.byteLength - (target.header ? HEADER_LINE.length : 0),
      CAP,
      "every upstream byte arrives",
    )

    const over = await getStructure(target, CAP + 1)
    await assert.rejects(over.response.arrayBuffer())
  })

  test(`B4: ${target.name}: the body streams, so one chunk read pulls a few chunks, not the file`, async () => {
    const { response, stats } = await getStructure(target, 15 * MIB)
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.equal(first.done, false)
    assert.ok(
      stats.pulledBytes <= 4 * MIB,
      `reading one chunk pulled ${stats.pulledBytes} bytes of a ${15 * MIB} byte file`,
    )
    await reader.cancel()
    assert.equal(stats.cancelled, true, "cancelling the response cancels the upstream")
  })
}

test("B5: a SWISS-MODEL body starts with the anonymous HEADER line and the cap counts only the file", async () => {
  const swissmodel = KEYS[2]
  const { response } = await getStructure(swissmodel, 3 * MIB)
  assert.equal(response.headers.get("content-type"), "chemical/x-pdb")
  const bytes = new Uint8Array(await response.arrayBuffer())
  const head = new TextDecoder().decode(bytes.subarray(0, 40))
  assert.match(head, /^HEADER    MODEL/)
  assert.equal(
    bytes.byteLength,
    3 * MIB + HEADER_LINE.length,
    "the header line is added to the file",
  )

  const exact = await getStructure(swissmodel, CAP)
  assert.equal(exact.response.status, 200)
  const exactBytes = new Uint8Array(await exact.response.arrayBuffer())
  assert.equal(exactBytes.byteLength, CAP + HEADER_LINE.length, "the cap does not count the header")
})

test("B5: RCSB and AlphaFold bodies are served as the provider sent them, with no header line added", async () => {
  for (const target of KEYS.slice(0, 2)) {
    const { response } = await getStructure(target, 2048)
    const bytes = new Uint8Array(await response.arrayBuffer())
    assert.equal(bytes.byteLength, 2048, target.name)
    assert.ok(
      bytes.every((byte) => byte === 0x41),
      target.name,
    )
  }
})
