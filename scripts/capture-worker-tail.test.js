import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { captureWorkerTail, summarizeTailEvent } from "./capture-worker-tail.mjs"

const event = {
  outcome: "ok",
  cpuTime: 2,
  wallTime: 12,
  event: {
    request: {
      url: "https://example.org/gene/TP53?token=PRIVATE",
      headers: { authorization: "PRIVATE" },
    },
    response: { status: 200 },
  },
  exceptions: [{ name: "Error", message: "PRIVATE", stack: "PRIVATE" }],
  logs: ["PRIVATE"],
}

function fixture({ events = [], earlyClose = false, deleteFails = false, onOpen } = {}) {
  const calls = []
  let socket
  class Socket extends EventEmitter {
    readyState = 1
    send(_data, callback) {
      callback()
    }
    close() {
      this.readyState = 3
      queueMicrotask(() => this.emit("close"))
    }
    terminate() {
      this.close()
    }
  }
  return {
    calls,
    options: {
      accountId: "a".repeat(32),
      token: "PRIVATE",
      worker: "test-worker",
      seconds: 1,
      fetchImpl: async (_url, request) => {
        calls.push(request.method)
        const result =
          request.method === "POST"
            ? { id: "b".repeat(32), url: "wss://example.org/tail?token=PRIVATE" }
            : {}
        return Response.json({ success: !(deleteFails && request.method === "DELETE"), result })
      },
      socketFactory: () => {
        socket = new Socket()
        queueMicrotask(() => {
          socket.emit("open")
          onOpen?.()
          for (const item of events)
            socket.emit(
              "message",
              Buffer.from(typeof item === "string" ? item : JSON.stringify(item)),
            )
          if (earlyClose) socket.emit("close")
        })
        return socket
      },
    },
  }
}

test("tail summary selects operational fields and excludes secrets and free-form logs", () => {
  assert.deepEqual(summarizeTailEvent(event), {
    kind: "request",
    route: "/gene/TP53",
    outcome: "ok",
    cpuMs: 2,
    wallMs: 12,
    status: 200,
    exceptions: ["Error"],
  })
  assert.ok(!JSON.stringify(summarizeTailEvent(event)).includes("PRIVATE"))
  assert.equal(summarizeTailEvent({ outcome: "ok" }).cpuMs, null)
})

test("event limit is successful only after deleting the exact created tail", async () => {
  const f = fixture({ events: [event, event] })
  const rows = []
  const result = await captureWorkerTail({
    ...f.options,
    maxEvents: 1,
    onRecord: (row) => rows.push(row),
  })
  assert.equal(result.reason, "event_limit")
  assert.equal(result.events, 1)
  assert.equal(result.tailDeleted, true)
  assert.equal(rows.length, 1)
  assert.deepEqual(f.calls, ["POST", "DELETE"])
})

test("planned duration succeeds with zero events but a verified connection", async () => {
  const f = fixture()
  const result = await captureWorkerTail(f.options)
  assert.equal(result.reason, "deadline")
  assert.equal(result.connected, true)
  assert.equal(result.events, 0)
  assert.deepEqual(f.calls, ["POST", "DELETE"])
})

test("malformed, oversized, or non-event frames fail and still delete the tail", async () => {
  for (const frame of ["{PRIVATE", "x".repeat(1024 * 1024 + 1), { error: "PRIVATE" }]) {
    const f = fixture({ events: [frame] })
    await assert.rejects(captureWorkerTail(f.options), /TAIL_EVENT_INVALID/)
    assert.deepEqual(f.calls, ["POST", "DELETE"])
  }
})

test("early disconnect is not misreported as a successful planned capture", async () => {
  const f = fixture({ earlyClose: true })
  await assert.rejects(captureWorkerTail(f.options), /TAIL_CLOSED_EARLY/)
  assert.deepEqual(f.calls, ["POST", "DELETE"])
})

test("cancellation and socket creation failures both clean up the created tail", async () => {
  const controller = new AbortController()
  const f = fixture({ onOpen: () => controller.abort() })
  await assert.rejects(
    captureWorkerTail({ ...f.options, signal: controller.signal }),
    /CAPTURE_CANCELED/,
  )
  assert.deepEqual(f.calls, ["POST", "DELETE"])
  const broken = fixture()
  await assert.rejects(
    captureWorkerTail({
      ...broken.options,
      socketFactory: () => {
        throw new Error("PRIVATE")
      },
    }),
    /TAIL_CAPTURE_FAILED/,
  )
  assert.deepEqual(broken.calls, ["POST", "DELETE"])
})

test("cleanup failure is visible, and output has an independent byte bound", async () => {
  const f = fixture({ events: [event], deleteFails: true })
  await assert.rejects(captureWorkerTail({ ...f.options, maxEvents: 1 }), /TAIL_DELETE_FAILED/)
  const big = {
    ...event,
    outcome: "x".repeat(64),
    event: { request: { url: `https://example.org/${"x".repeat(256)}` } },
    exceptions: Array.from({ length: 3 }, () => ({ name: "x".repeat(64) })),
  }
  const many = fixture({ events: Array(50).fill(big) })
  let bytes = 0
  const result = await captureWorkerTail({
    ...many.options,
    maxEvents: 50,
    onRecord: (row) => {
      bytes += Buffer.byteLength(JSON.stringify(row)) + 1
    },
  })
  assert.equal(result.reason, "output_limit")
  assert.ok(bytes + Buffer.byteLength(JSON.stringify(result)) < 16384)
})

test("invalid capture options cannot start a remote tail", async () => {
  const f = fixture()
  for (const overrides of [
    { seconds: 0 },
    { seconds: 61 },
    { maxEvents: 51 },
    { worker: "../wrong" },
    { token: "" },
    { samplingRate: 1 },
  ]) {
    await assert.rejects(captureWorkerTail({ ...f.options, ...overrides }))
  }
  assert.deepEqual(f.calls, [])
})
