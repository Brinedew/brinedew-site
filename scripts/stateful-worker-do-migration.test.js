import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import {
  durableObjectMigrationPending,
  lastTopLevelMigrationTag,
} from "./stateful-worker-do-migration.mjs"

const CONFIG = readFileSync(
  new URL(
    "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    import.meta.url,
  ),
  "utf8",
)
const api =
  (result, ok = true) =>
  async () => ({
    ok,
    status: ok ? 200 : 403,
    json: async () => ({ success: ok, result }),
  })

test("the production migration list is read, not staging's", () => {
  const toml = `name = "w"\n[[migrations]]\ntag = "v1"\n[[env.staging.migrations]]\ntag = "v9"\n`
  assert.equal(lastTopLevelMigrationTag(toml), "v1")
  assert.match(lastTopLevelMigrationTag(CONFIG), /^v\d+$/)
})

test("a config tag ahead of the deployed script is pending", async () => {
  const toml = `name = "w"\n[[migrations]]\ntag = "v6"\n[[migrations]]\ntag = "v7"\n`
  const pending = await durableObjectMigrationPending({
    toml,
    accountId: "a",
    apiToken: "t",
    fetchImpl: api([{ id: "w", migration_tag: "v6" }]),
  })
  assert.equal(pending.pending, true)
  const current = await durableObjectMigrationPending({
    toml,
    accountId: "a",
    apiToken: "t",
    fetchImpl: api([{ id: "w", migration_tag: "v7" }]),
  })
  assert.equal(current.pending, false)
})

test("API errors and a missing script fail closed", async () => {
  const toml = `name = "w"\n[[migrations]]\ntag = "v1"\n`
  await assert.rejects(
    durableObjectMigrationPending({
      toml,
      accountId: "a",
      apiToken: "t",
      fetchImpl: api(null, false),
    }),
    /HTTP 403/,
  )
  await assert.rejects(
    durableObjectMigrationPending({
      toml,
      accountId: "a",
      apiToken: "t",
      fetchImpl: api([{ id: "x" }]),
    }),
    /not deployed/,
  )
})

// B-898 Stage 3 failure modes for a release that deletes a Durable Object class.
// 1. The toml deletes a class that a binding still names, or that the Worker
//    module still exports: Cloudflare refuses the deploy and the whole release
//    stops after the build.
// 2. The deletion is in the toml's staging list but not production's (or the
//    reverse), so one environment keeps a class the other has dropped.
// 3. The deletion is not the last top-level tag, so the release detector reads
//    an older tag and ships the code with `versions upload`, which Cloudflare
//    refuses for an unapplied migration.
function tomlBlocks(toml, header) {
  const blocks = []
  let current = null
  for (const line of toml.split(/\r?\n/)) {
    const match = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/)
    if (match) {
      current = match[1].trim() === header ? [] : null
      if (current) blocks.push(current)
    } else if (current) current.push(line)
  }
  return blocks.map((lines) => lines.join("\n"))
}

const deletedClasses = (toml, header) =>
  tomlBlocks(toml, header).flatMap((block) => {
    const match = block.match(/deleted_classes\s*=\s*\[([^\]]*)\]/)
    return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : []
  })

function workerSourceFiles() {
  const root = new URL("../workers/", import.meta.url)
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
    .map((name) => [name, readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8")])
}

test("every deleted Durable Object class is unbound and unexported, in production and in staging", () => {
  const production = deletedClasses(CONFIG, "migrations")
  const staging = deletedClasses(CONFIG, "env.staging.migrations")
  assert.deepEqual(staging, production, "staging deletes exactly what production deletes")
  assert.ok(production.includes("IconoplasmVoteCoordinator"), "the vote coordinator is deleted")
  const bound = [
    ...tomlBlocks(CONFIG, "durable_objects.bindings"),
    ...tomlBlocks(CONFIG, "env.staging.durable_objects.bindings"),
  ].map((block) => block.match(/class_name\s*=\s*"([^"]+)"/)?.[1])
  const sources = workerSourceFiles()
  for (const name of production) {
    assert.ok(!bound.includes(name), `${name} is still bound`)
    const exportPattern = new RegExp(
      `export\s+class\s+${name}\b|export\s*\{[^}]*\b${name}\b[^}]*\}`,
    )
    for (const [file, source] of sources)
      assert.doesNotMatch(source, exportPattern, `${file} still exports ${name}`)
  }
})

test("the last top-level migration deletes the vote coordinator, so the release runs wrangler deploy", () => {
  assert.equal(lastTopLevelMigrationTag(CONFIG), "v9")
  const last = tomlBlocks(CONFIG, "migrations").at(-1)
  assert.match(last, /tag\s*=\s*"v9"/)
  assert.match(last, /deleted_classes\s*=\s*\["IconoplasmVoteCoordinator"\]/)
  const stagingLast = tomlBlocks(CONFIG, "env.staging.migrations").at(-1)
  assert.match(stagingLast, /deleted_classes\s*=\s*\["IconoplasmVoteCoordinator"\]/)
})
