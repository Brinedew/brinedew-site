import { parseArgs } from "node:util"
import { pathToFileURL } from "node:url"
import WebSocket from "ws"

const API_ROOT = "https://api.cloudflare.com/client/v4"
const MAX_FRAME_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 16384

class CaptureError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const text = (value, limit) => (typeof value === "string" ? value.slice(0, limit) : null)
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)

export function summarizeTailEvent(event) {
  let route = null
  try {
    route = new URL(event.event?.request?.url).pathname.slice(0, 256)
  } catch {}
  return {
    kind: "request",
    route,
    outcome: text(event.outcome, 64),
    cpuMs: number(event.cpuTime),
    wallMs: number(event.wallTime),
    status: number(event.event?.response?.status),
    exceptions: Array.isArray(event.exceptions)
      ? event.exceptions.slice(0, 3).map((item) => text(item?.name, 64))
      : [],
  }
}

async function apiRequest(fetchImpl, path, token, method, body) {
  let response
  try {
    response = await fetchImpl(`${API_ROOT}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new CaptureError("CLOUDFLARE_REQUEST_FAILED")
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength
    if (bytes > 65536) throw new CaptureError("CLOUDFLARE_RESPONSE_TOO_LARGE")
    chunks.push(Buffer.from(chunk))
  }
  let payload = {}
  try {
    if (bytes) payload = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new CaptureError("CLOUDFLARE_RESPONSE_INVALID")
  }
  if (!response.ok || payload.success === false)
    throw new CaptureError(`CLOUDFLARE_HTTP_${response.status}`)
  return payload.result
}

async function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.terminate()
      resolve()
    }, 250)
    socket.once("close", () => {
      clearTimeout(timer)
      resolve()
    })
    if (socket.readyState === WebSocket.OPEN) socket.close()
    else socket.terminate()
  })
}

export async function captureWorkerTail({
  accountId,
  token,
  worker,
  seconds = 15,
  maxEvents = 20,
  samplingRate,
  signal,
  onRecord = () => {},
  fetchImpl = fetch,
  socketFactory = (url) =>
    new WebSocket(url, "trace-v1", { maxPayload: MAX_FRAME_BYTES, handshakeTimeout: 8000 }),
}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? "") || !token)
    throw new CaptureError("ACCOUNT_TOKEN_REQUIRED")
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(worker ?? ""))
    throw new CaptureError("INVALID_WORKER_NAME")
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
    throw new CaptureError("SECONDS_MUST_BE_1_TO_60")
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 50)
    throw new CaptureError("MAX_EVENTS_MUST_BE_1_TO_50")
  if (samplingRate !== undefined && !(samplingRate > 0 && samplingRate < 1))
    throw new CaptureError("INVALID_SAMPLING_RATE")
  if (signal?.aborted) throw new CaptureError("CAPTURE_CANCELED")
  const path = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(worker)}/tails`
  const filters = samplingRate === undefined ? [] : [{ sampling_rate: samplingRate }]
  const tail = await apiRequest(fetchImpl, path, token, "POST", { filters })
  if (!/^[a-f0-9]{32}$/i.test(tail?.id ?? "")) throw new CaptureError("INVALID_TAIL_ID")
  let socket
  let result
  let failure
  try {
    if (new URL(tail.url).protocol !== "wss:") throw new CaptureError("INVALID_TAIL_URL")
    if (signal?.aborted) throw new CaptureError("CAPTURE_CANCELED")
    socket = socketFactory(tail.url)
    result = await new Promise((resolve, reject) => {
      let settled = false
      let captureTimer
      let count = 0
      let outputBytes = 0
      const finish = (reason, error) => {
        if (settled) return
        settled = true
        clearTimeout(openTimer)
        clearTimeout(captureTimer)
        signal?.removeEventListener("abort", abort)
        if (error) reject(error)
        else
          resolve({
            kind: "capture",
            ok: true,
            reason,
            events: count,
            outputBytes,
            connected: true,
          })
      }
      const abort = () => finish(null, new CaptureError("CAPTURE_CANCELED"))
      const openTimer = setTimeout(
        () => finish(null, new CaptureError("TAIL_CONNECT_TIMEOUT")),
        10000,
      )
      signal?.addEventListener("abort", abort, { once: true })
      socket.on("open", () => {
        clearTimeout(openTimer)
        socket.send(JSON.stringify({ debug: false }), (error) => {
          if (error) finish(null, new CaptureError("TAIL_CONFIGURATION_FAILED"))
        })
        captureTimer = setTimeout(() => finish("deadline"), seconds * 1000)
      })
      socket.on("message", (data) => {
        if (settled) return
        try {
          if (data.byteLength > MAX_FRAME_BYTES) throw new CaptureError("TAIL_EVENT_TOO_LARGE")
          const event = JSON.parse(data.toString())
          if (
            !event ||
            typeof event !== "object" ||
            Array.isArray(event) ||
            typeof event.outcome !== "string"
          )
            throw new CaptureError("TAIL_EVENT_INVALID")
          const record = summarizeTailEvent(event)
          const bytes = Buffer.byteLength(JSON.stringify(record)) + 1
          if (outputBytes + bytes > MAX_OUTPUT_BYTES - 1024) return finish("output_limit")
          onRecord(record)
          count += 1
          outputBytes += bytes
          if (count >= maxEvents) finish("event_limit")
        } catch {
          finish(null, new CaptureError("TAIL_EVENT_INVALID"))
        }
      })
      socket.on("error", () => finish(null, new CaptureError("TAIL_CONNECTION_FAILED")))
      socket.on("close", () => finish(null, new CaptureError("TAIL_CLOSED_EARLY")))
    })
  } catch (error) {
    failure = error instanceof CaptureError ? error : new CaptureError("TAIL_CAPTURE_FAILED")
  } finally {
    try {
      await closeSocket(socket)
    } catch {
      failure = new CaptureError("TAIL_SOCKET_CLEANUP_FAILED")
    }
    try {
      await apiRequest(fetchImpl, `${path}/${tail.id}`, token, "DELETE")
    } catch {
      failure = new CaptureError("TAIL_DELETE_FAILED")
    }
  }
  if (failure) throw failure
  return { ...result, tailDeleted: true }
}

async function main() {
  const { values } = parseArgs({
    options: {
      worker: { type: "string" },
      seconds: { type: "string", default: "15" },
      "max-events": { type: "string", default: "20" },
      "sampling-rate": { type: "string" },
    },
  })
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  try {
    const result = await captureWorkerTail({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
      worker: values.worker,
      seconds: Number(values.seconds),
      maxEvents: Number(values["max-events"]),
      samplingRate:
        values["sampling-rate"] === undefined ? undefined : Number(values["sampling-rate"]),
      signal: controller.signal,
      onRecord: (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        code: error instanceof CaptureError ? error.code : "CAPTURE_FAILED",
      }),
    )
    process.exitCode = 1
  })
}
