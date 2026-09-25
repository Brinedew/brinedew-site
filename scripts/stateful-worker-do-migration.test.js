import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
