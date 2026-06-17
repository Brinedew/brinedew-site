import { writeFile, mkdir } from "node:fs/promises"
import { performance } from "node:perf_hooks"

const DEFAULT_BASE_URL = "https://iconoplasm.brinedew.bio"
const DEFAULT_RUNS = 5

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b)
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

async function timedFetch({ name, url, options = {}, expectStatuses = [200] }) {
  const started = performance.now()
  let status = 0
  let ok = false
  let bytes = 0
  let error = ""
  try {
    const response = await fetch(url, options)
    status = response.status
    const text = await response.text()
    bytes = Buffer.byteLength(text)
    ok = expectStatuses.includes(status)
  } catch (fetchError) {
    error = String(fetchError?.message || fetchError)
  }
  return {
    name,
    url,
    status,
    ok,
    bytes,
    duration_ms: Math.round(performance.now() - started),
    ...(error ? { error } : {}),
  }
}

async function runBenchmark({
  baseUrl = DEFAULT_BASE_URL,
  runs = DEFAULT_RUNS,
  output = "",
  includeAdminWarm = false,
} = {}) {
  const adminToken = process.env.ICONOPLASM_ADMIN_TOKEN || ""
  const endpoints = [
    {
      name: "home_html",
      url: `${baseUrl}/`,
    },
    {
      name: "public_gallery_votes_24",
      url: `${baseUrl}/api/public/v1/gallery?order=votes&limit=24&offset=0`,
    },
    {
      name: "mobile_card_manifest_5",
      url: `${baseUrl}/api/iconoplasm/mobile-card-manifest`,
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: "mobile-dossier-v1",
          symbols: ["INS", "LEP", "GCG", "KLRC4", "DDOST"],
        }),
      },
    },
    {
      name: "account_window_guest_newest",
      url: `${baseUrl}/api/iconoplasm/account-gallery-window?order=newest&limit=12`,
    },
    {
      name: "account_window_unsupported_heaviest",
      url: `${baseUrl}/api/iconoplasm/account-gallery-window?order=heaviest&limit=12`,
      expectStatuses: [409],
    },
  ]
  if (adminToken) {
    endpoints.push({
      name: "admin_symbol_scoped_warm_rejected",
      url: `${baseUrl}/api/iconoplasm/admin/card-vms/warm`,
      expectStatuses: [409],
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ symbols: ["INS"] }),
      },
    })
  }
  if (includeAdminWarm) {
    if (!adminToken) throw new Error("ICONOPLASM_ADMIN_TOKEN is required for --include-admin-warm")
    endpoints.push({
      name: "admin_full_catalog_warm",
      url: `${baseUrl}/api/iconoplasm/admin/card-vms/warm`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({ scope: "catalog" }),
      },
    })
  }

  const samples = []
  for (let run = 0; run < runs; run += 1) {
    for (const endpoint of endpoints) {
      samples.push(await timedFetch(endpoint))
    }
  }

  const summary = endpoints.map((endpoint) => {
    const endpointSamples = samples.filter((sample) => sample.name === endpoint.name)
    const durations = endpointSamples.map((sample) => sample.duration_ms)
    return {
      name: endpoint.name,
      runs: endpointSamples.length,
      ok: endpointSamples.every((sample) => sample.ok),
      statuses: Array.from(new Set(endpointSamples.map((sample) => sample.status))).sort(),
      min_ms: Math.min(...durations),
      median_ms: percentile(durations, 0.5),
      p95_ms: percentile(durations, 0.95),
      max_ms: Math.max(...durations),
      bytes_median: percentile(
        endpointSamples.map((sample) => sample.bytes),
        0.5,
      ),
    }
  })

  const result = {
    schema: "iconoplasm.liveBenchmark.v1",
    measured_at: new Date().toISOString(),
    base_url: baseUrl,
    runs,
    include_admin_warm: includeAdminWarm,
    summary,
    samples,
  }

  if (output) {
    await mkdir(new URL(".", `file:///${output.replaceAll("\\", "/")}`), { recursive: true })
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  }
  console.log(JSON.stringify(result, null, 2))
}

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (!arg.startsWith("--")) continue
  const key = arg.slice(2)
  const next = process.argv[index + 1]
  if (next && !next.startsWith("--")) {
    args.set(key, next)
    index += 1
  } else {
    args.set(key, "true")
  }
}

await runBenchmark({
  baseUrl: args.get("base-url") || DEFAULT_BASE_URL,
  runs: Number.parseInt(args.get("runs") || String(DEFAULT_RUNS), 10) || DEFAULT_RUNS,
  output: args.get("output") || "",
  includeAdminWarm: args.get("include-admin-warm") === "true",
})
