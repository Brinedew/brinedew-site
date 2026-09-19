import { createHash } from "node:crypto"

export function mapExecutedOperationsToProviderMeters(actualOperations) {
  return {
    workerRequests: actualOperations.workerRequests,
    kvReads: 0,
    kvWrites: 0,
    kvLists: 0,
    d1RowsRead: actualOperations.d1RowsRead,
    d1RowsWritten: actualOperations.d1RowsWritten,
    durableObjectRequests: actualOperations.durableObjectRequests,
    durableObjectRowsRead: actualOperations.durableObjectRowsRead,
    durableObjectRowsWritten: actualOperations.durableObjectRowsWritten,
    queueOperations: actualOperations.queueOperations,
    externalRequests: 0,
    transferBytes: null,
  }
}

export function hostedCommandId({ day, index }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD")
  if (!Number.isSafeInteger(index) || index < 0 || index >= 60_000)
    throw new Error("index must identify one of the 60,000 staged commands")
  return `viral-load:tp53:${day}:${String(index).padStart(6, "0")}`
}

export function summarizeHostedCommandIdentity(day) {
  const first = hostedCommandId({ day, index: 0 })
  const last = hostedCommandId({ day, index: 59_999 })
  const prefix = first.slice(0, -6)
  const digest = createHash("sha256")
  for (let index = 0; index < 60_000; index++) digest.update(`${hostedCommandId({ day, index })}\n`)
  return {
    prefix,
    first,
    last,
    count: 60_000,
    digestAlgorithm: "sha256-newline-delimited",
    digest: digest.digest("hex"),
  }
}

export function buildHostedCommand({ day, index, assetSha256 }) {
  const id = hostedCommandId({ day, index })
  if (!/^[a-f0-9]{64}$/.test(assetSha256))
    throw new Error("assetSha256 must identify the staged TP53 candidate")
  return {
    id,
    body: {
      command_id: id,
      symbol: "TP53",
      asset_sha256: assetSha256,
      candidate_ref: `a:TP53:${assetSha256}`,
      vote_value: index % 2 === 0 ? 1 : -1,
    },
  }
}

export function classifyHostedResponse(commandId, response) {
  const body = response?.body
  if (!body || body.command_id !== commandId) {
    return { verdict: "invalid_missing_exact_receipt", commandId, status: response?.status ?? null }
  }
  if (response.status === 429 && body.accepted === false && body.code === "CAPACITY_REFUSED") {
    return { verdict: "bounded_capacity_refusal", commandId, status: response.status }
  }
  if (
    response.status >= 200 &&
    response.status < 300 &&
    body.accepted === true &&
    body.durable === true
  ) {
    return { verdict: "accepted_durable", commandId, status: response.status }
  }
  return { verdict: "invalid_response", commandId, status: response.status }
}

export function assessHostedSchedule(windows, elapsedMs, { toleranceMs = 10_000 } = {}) {
  const exactWindows =
    windows.length === 600 &&
    windows.every(
      (window, second) =>
        window.second === second &&
        window.scheduled === 100 &&
        window.started === 100 &&
        Number.isFinite(window.startedAtOffsetMs) &&
        Math.abs(window.startedAtOffsetMs - second * 1_000) <= 100,
    )
  const withinElapsedTolerance =
    Number.isFinite(elapsedMs) && elapsedMs >= 599_000 && elapsedMs <= 600_000 + toleranceMs
  return {
    verified: exactWindows && withinElapsedTolerance,
    exactWindows,
    withinElapsedTolerance,
    elapsedMs,
    achievedRps: elapsedMs > 0 ? 60_000 / (elapsedMs / 1_000) : 0,
  }
}
