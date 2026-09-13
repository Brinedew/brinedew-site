import { pathToFileURL } from "node:url"

const CONSUMERS = [
  { queue: "iconoplasm-sync-finalization", deadLetterQueue: "iconoplasm-sync-dlq", batchSize: 1 },
  {
    queue: "iconoplasm-vote-projection",
    deadLetterQueue: "iconoplasm-vote-projection-dlq",
    batchSize: 2,
  },
]
const QUEUE_NAMES = CONSUMERS.flatMap(({ queue, deadLetterQueue }) => [queue, deadLetterQueue])
const RETENTION_SECONDS = 86400

// ARCHITECTURE FENCE [IPD-004]: the provider transport must retain the delayed
// wakeup. Wrangler owns consumer configuration; this check must not overwrite
// its reviewed batch/concurrency settings with the CLI's defaults.
export async function reconcileFinalizationQueue({
  accountId,
  token,
  fetchImpl = fetch,
  apply = false,
}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token)
    throw new Error("Finalization Queue control-plane credentials are required")
  const deadline = AbortSignal.timeout(75000)
  async function api(path, method = "GET", body) {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]),
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    )
    if (!response.ok) throw new Error(`Finalization Queue control-plane HTTP ${response.status}`)
    const result = await response.json()
    if (result?.success !== true)
      throw new Error("Finalization Queue control-plane response failed")
    return result
  }
  const listing = await api("?per_page=100")
  if (
    !Array.isArray(listing.result) ||
    listing.result.length >= 100 ||
    Number(listing.result_info?.total_pages || 1) > 1
  )
    throw new Error("Finalization Queue inventory is invalid or truncated")
  const queues = QUEUE_NAMES.map((name) => {
    const matches = listing.result.filter((queue) => queue.queue_name === name)
    if (matches.length !== 1 || !/^[a-f0-9]{32}$/.test(matches[0]?.queue_id || ""))
      throw new Error(`Expected exactly one existing ${name} Queue`)
    return matches[0]
  })
  // Validate both complete transports before changing any retention setting.
  const consumers = CONSUMERS.map(({ queue, deadLetterQueue, batchSize }) => {
    const primary = queues.find((item) => item.queue_name === queue)
    const dlq = queues.find((item) => item.queue_name === deadLetterQueue)
    const consumer = primary.consumers?.[0]
    const expected = {
      batch_size: batchSize,
      max_concurrency: 1,
      max_retries: 5,
      max_wait_time_ms: 1000,
      retry_delay: 30,
    }
    if (
      primary.consumers?.length !== 1 ||
      consumer?.type !== "worker" ||
      consumer.script !== "geneguessr-api" ||
      consumer.dead_letter_queue !== deadLetterQueue ||
      Object.entries(expected).some(([key, value]) => consumer.settings?.[key] !== value)
    )
      throw new Error(`${queue} consumer does not match the deployed bounded configuration`)
    if (
      primary.settings?.delivery_paused !== false ||
      primary.settings?.delivery_delay !== 0 ||
      dlq.consumers?.length !== 0
    )
      throw new Error(`${queue} delivery or dead-letter configuration is invalid`)
    return { queue, ...expected }
  })
  const results = []
  for (const queue of queues) {
    let current = queue
    const changed = current.settings?.message_retention_period !== RETENTION_SECONDS
    if (changed) {
      if (!apply)
        throw new Error(`${queue.queue_name} does not retain reset-delayed work for 24 hours`)
      // PATCH only the owned retention setting; never unpause or purge a queue.
      await api(`/${queue.queue_id}`, "PATCH", {
        settings: { ...queue.settings, message_retention_period: RETENTION_SECONDS },
      })
      current = (await api(`/${queue.queue_id}`)).result
    }
    if (
      current?.queue_name !== queue.queue_name ||
      current?.settings?.message_retention_period !== RETENTION_SECONDS
    )
      throw new Error(`Finalization Queue retention did not persist for ${queue.queue_name}`)
    for (const key of ["delivery_delay", "delivery_paused"]) {
      if (Object.hasOwn(queue.settings, key) && current.settings[key] !== queue.settings[key])
        throw new Error(`Finalization Queue ${key} changed unexpectedly`)
    }
    results.push({ queue: queue.queue_name, retention_seconds: RETENTION_SECONDS, changed })
  }
  return { ok: true, consumers, queues: results }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      JSON.stringify(
        await reconcileFinalizationQueue({
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          token: process.env.CLOUDFLARE_API_TOKEN,
          apply: process.argv.includes("--apply"),
        }),
      ),
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
