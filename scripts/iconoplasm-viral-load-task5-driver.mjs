import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  assessHostedSchedule,
  buildHostedCommand,
  classifyHostedResponse,
  summarizeHostedCommandIdentity,
} from "./lib/iconoplasm-viral-load-task5-driver.mjs"

// ARCHITECTURE FENCE [IPD-004]: this driver produces observations for the
// existing release-evidence owner; it cannot mint a passing release verdict.

const STATIC_PATHS = [
  "/gene/TP53",
  "/gene/BRCA1",
  "/iconoplasm",
  "/iconoplasm/gallery",
  "/iconoplasm/search?q=TP53",
]

function option(name) {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
}

async function pooled(items, concurrency, operation) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await operation(items[index])
    }
  })
  await Promise.all(workers)
}

export async function runHostedTask5Load({
  baseUrl,
  authorization,
  day,
  assetSha256,
  fetchImpl = fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  durationSeconds = 600,
  commandsPerSecond = 100,
  anonymousArticleLoads = 500_000,
  concurrency = 200,
}) {
  if (!/^https:\/\//.test(baseUrl)) throw new Error("baseUrl must be an HTTPS hosted target")
  if (!authorization) throw new Error("ICONOPLASM_TASK5_AUTHORIZATION is required")
  const expectedCommands = durationSeconds * commandsPerSecond
  if (expectedCommands !== 60_000)
    throw new Error("certification profile must issue exactly 60,000 commands")
  if (anonymousArticleLoads !== 500_000)
    throw new Error("certification profile must issue 500,000 anonymous article loads")

  const receiptDigest = createHash("sha256")
  const scheduleDigest = createHash("sha256")
  const counts = { acceptedDurable: 0, capacityRefused: 0, invalidCommandReceipts: 0 }
  const commandLatenciesMs = []
  const windows = []
  let staticFailures = 0
  let physicalStaticRequests = 0
  let transferBytes = 0
  const startedAt = new Date().toISOString()
  const runStartedMs = Date.now()

  for (let second = 0; second < durationSeconds; second++) {
    const targetStart = runStartedMs + second * 1_000
    if (Date.now() < targetStart) await wait(targetStart - Date.now())
    const secondStarted = Date.now()
    const window = {
      second,
      scheduled: commandsPerSecond,
      started: 0,
      startedAtOffsetMs: secondStarted - runStartedMs,
    }
    windows.push(window)
    const firstCommand = second * commandsPerSecond
    const commands = Array.from({ length: commandsPerSecond }, (_, offset) =>
      buildHostedCommand({ day, index: firstCommand + offset, assetSha256 }),
    )
    const staticStart = Math.floor((second * anonymousArticleLoads) / durationSeconds)
    const staticEnd = Math.floor(((second + 1) * anonymousArticleLoads) / durationSeconds)
    const staticIndexes = Array.from(
      { length: staticEnd - staticStart },
      (_, offset) => staticStart + offset,
    )

    await Promise.all([
      pooled(commands, concurrency, async (command) => {
        window.started++
        const commandStarted = Date.now()
        const response = await fetchImpl(`${baseUrl}/api/iconoplasm/votes/set`, {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
            "x-iconoplasm-command-id": command.id,
          },
          body: JSON.stringify(command.body),
        })
        const body = await response.json().catch(() => null)
        transferBytes += Buffer.byteLength(JSON.stringify(body || null))
        commandLatenciesMs.push(Date.now() - commandStarted)
        const classification = classifyHostedResponse(command.id, { status: response.status, body })
        receiptDigest.update(`${command.id}\t${classification.verdict}\t${response.status}\n`)
        if (classification.verdict === "accepted_durable") counts.acceptedDurable++
        else if (classification.verdict === "bounded_capacity_refusal") counts.capacityRefused++
        else counts.invalidCommandReceipts++
      }),
      pooled(staticIndexes, concurrency, async (index) => {
        const route = STATIC_PATHS[index % STATIC_PATHS.length]
        const response = await fetchImpl(`${baseUrl}${route}`, {
          headers: { "x-iconoplasm-task5-static-request": String(index) },
        })
        physicalStaticRequests++
        transferBytes += (await response.arrayBuffer()).byteLength
        if (!response.ok) staticFailures++
      }),
    ])
    scheduleDigest.update(
      `${window.second}\t${window.scheduled}\t${window.started}\t${window.startedAtOffsetMs}\n`,
    )
  }

  const elapsedMs = Date.now() - runStartedMs
  const schedule = assessHostedSchedule(windows, elapsedMs)
  const sortedLatencies = commandLatenciesMs.toSorted((left, right) => left - right)
  const percentile = (fraction) =>
    sortedLatencies[
      Math.min(sortedLatencies.length - 1, Math.floor(fraction * sortedLatencies.length))
    ]

  return {
    schemaVersion: 1,
    kind: "iconoplasm_viral_load_task5_driver_receipt",
    target: { baseUrl, day },
    startedAt,
    endedAt: new Date().toISOString(),
    physicalStaticRequests,
    transferBytes,
    staticFailures,
    commandsAttempted: expectedCommands,
    commandIdentity: summarizeHostedCommandIdentity(day),
    commandOutcomes: counts,
    schedule: {
      ...schedule,
      windowCount: windows.length,
      windows,
      digestAlgorithm: "sha256-tab-newline-delimited",
      digest: scheduleDigest.digest("hex"),
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    },
    commandReceiptDigestAlgorithm: "sha256-tab-newline-delimited",
    commandReceiptDigest: receiptDigest.digest("hex"),
    certificationReady:
      physicalStaticRequests === anonymousArticleLoads &&
      staticFailures === 0 &&
      counts.invalidCommandReceipts === 0 &&
      counts.acceptedDurable + counts.capacityRefused === expectedCommands &&
      schedule.verified,
  }
}

async function main() {
  const output = path.resolve(
    option("--output") || "artifacts/iconoplasm-viral-load-gates/task5-driver-receipt.json",
  )
  const receipt = await runHostedTask5Load({
    baseUrl: option("--base-url"),
    authorization: process.env.ICONOPLASM_TASK5_AUTHORIZATION,
    day: option("--day"),
    assetSha256: option("--asset-sha256"),
  })
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  if (!receipt.certificationReady) process.exitCode = 1
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error) => {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, kind: "iconoplasm_viral_load_task5_driver_error", error: String(error?.message || error) })}\n`,
    )
    process.exitCode = 2
  })
}
