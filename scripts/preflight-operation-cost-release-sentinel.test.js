import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("release checks shared capacity before the first application D1 inventory", () => {
  const source = readFileSync(
    new URL("./preflight-operation-cost-release.mjs", import.meta.url),
    "utf8",
  )
  const main = source.slice(source.indexOf("async function main()"))
  const sender = main.indexOf(
    "const preflightSend = createReleaseSender(process.env.ICONOPLASM_ADMIN_TOKEN)",
  )
  const sentinel = main.indexOf('const sentinelCapacity = await preflightSend("/capacity", "GET")')
  const guard = main.indexOf("requireReleaseSharedCapacity(", sentinel)
  const inventory = main.indexOf("const inventory = await runAdmittedMigrations", sentinel)
  assert.ok(sender >= 0 && sender < sentinel)
  assert.ok(sentinel < guard && guard < inventory)
  assert.match(main.slice(guard, inventory), /sentinel\.maximum/)
  assert.match(main.slice(guard, inventory), /sentinel\.observed/)
  assert.match(
    main.slice(inventory, main.indexOf("const result =", inventory)),
    /send: preflightSend/,
  )
})
