import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isIP } from "node:net"
import { mkdirSync, writeFileSync } from "node:fs"

// Public, bounded release probe. --cdn-ip is a diagnostic DNS contrast only;
// it never changes OS/browser DNS and must be disclosed in the evidence.
const origin = "https://iconoplasm.brinedew.bio"
const cdn = "https://iconoplasmportraits.b-cdn.net"
const version = JSON.parse(
  readFileSync(new URL("../iconoplasm-extension/publisher-release.json", import.meta.url)),
).version
const cdnIp = process.argv.find((arg) => arg.startsWith("--cdn-ip="))?.split("=")[1]
if (cdnIp && !isIP(cdnIp)) throw new Error("Invalid --cdn-ip")
const results = []
function withoutPublicationEpoch(value) {
  if (Array.isArray(value)) return value.map(withoutPublicationEpoch)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "snapshot_version",
            "artifact_version",
            "artifact_validated_at",
            "data_source",
          ].includes(key),
      )
      .map(([key, item]) => [key, withoutPublicationEpoch(item)]),
  )
}
function report(value) {
  const directory = new URL("../artifacts/b-711-metadata-delivery/", import.meta.url)
  mkdirSync(directory, { recursive: true })
  writeFileSync(new URL("live-probe.json", directory), JSON.stringify(value, null, 2))
  console.log(JSON.stringify(value, null, 2))
}
function get(url, extension = true) {
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    "12",
    "--connect-timeout",
    "5",
    "--include",
    url,
  ]
  if (extension) args.push("--header", `X-Iconoplasm-Extension-Version: ${version}`)
  if (cdnIp && url.startsWith(cdn))
    args.push("--resolve", `iconoplasmportraits.b-cdn.net:443:${cdnIp}`)
  const start = Date.now()
  const result = spawnSync("curl.exe", args, {
    encoding: "utf8",
    timeout: 14000,
    maxBuffer: 150000,
    windowsHide: true,
  })
  if (result.status !== 0)
    throw new Error(`Public probe failed: ${result.error?.message || result.stderr}`)
  const split = result.stdout.indexOf("\r\n\r\n")
  assert.ok(split > 0, "HTTP headers missing")
  const head = result.stdout.slice(0, split)
  const body = result.stdout.slice(split + 4)
  const headers = Object.fromEntries(
    head
      .split("\r\n")
      .slice(1)
      .map((line) => {
        const colon = line.indexOf(":")
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]
      }),
  )
  const status = Number(head.match(/^HTTP\/[^ ]+ (\d+)/)?.[1])
  results.push({
    url,
    status,
    ms: Date.now() - start,
    bytes: Buffer.byteLength(body),
    cache: headers["cdn-cache"],
    cacheControl: headers["cache-control"],
    cdnRequestId: headers["cdn-requestid"],
    cfRay: headers["cf-ray"],
  })
  return { status, headers, body, json: () => JSON.parse(body) }
}
try {
  const manifest = get(`${origin}/api/public/v1/catalog/manifest`).json()
  const snapshot = manifest.card_snapshot_version
  assert.ok(snapshot)
  const index = get(`${origin}/api/public/v1/card-snapshots/${snapshot}/delivery-index`)
  assert.equal(index.status, 200)
  assert.equal(index.json().snapshot_version, snapshot)
  for (const symbol of ["TP53", "RIPOR1"]) {
    const range = index.json().ranges.find(([first, last]) => symbol >= first && symbol <= last)
    assert.ok(range, `${symbol} range missing`)
    let portraitSha
    for (const lane of ["genes", "portraits"]) {
      const path = `/api/public/v1/card-content/v1/${range[2]}/${lane}/${symbol}`
      const canonical = get(origin + path)
      assert.equal(canonical.status, 200)
      const data = canonical.json()
      assert.equal(data.content_hash, range[2])
      assert.equal(data.record.symbol, symbol)
      const sha = data.record.portrait.asset_sha256
      if (portraitSha) assert.equal(sha, portraitSha)
      portraitSha = sha
      const first = get(cdn + path)
      assert.equal(first.status, 200)
      assert.deepEqual(first.json(), data)
      const warm = get(cdn + path)
      assert.equal(warm.status, 200)
      assert.deepEqual(warm.json(), data)
      assert.equal(warm.headers["cdn-cache"], "HIT", "CDN must avoid origin on repeat")
      const legacy = get(
        `${origin}/api/public/v1/card-snapshots/${snapshot}/${lane}/${symbol}`,
      ).json()
      assert.equal((legacy.gene || legacy.portrait_locator).portrait.asset_sha256, sha)
      assert.deepEqual(
        data.record,
        withoutPublicationEpoch(legacy.gene || legacy.portrait_locator),
        "All scientific properties must survive delivery unchanged",
      )
    }
  }
  const missing = `${cdn}/api/public/v1/card-content/v1/${"0".repeat(64)}/genes/TP53`
  for (let n = 0; n < 2; n++) {
    const response = get(missing)
    assert.equal(response.status, 410)
    assert.match(response.headers["cache-control"], /no-store/)
    assert.notEqual(response.headers["cdn-cache"], "HIT")
  }
  report({ ok: true, cdnDnsContrast: cdnIp || null, results })
} catch (error) {
  report({ ok: false, cdnDnsContrast: cdnIp || null, error: error.message, results })
  process.exitCode = 1
}
