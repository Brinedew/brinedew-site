import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import toml from "toml"

// The two Worker configs, parsed. Each check below is a production invariant
// that would cost money or open a bypass if a config edit broke it. They read
// configuration as data, so a reworded comment or a renamed step can't fail
// them. workers/iconoplasm-static-assets.workerd.test.js proves the asset-first
// routing behaviour itself in Miniflare.
const read = (path) => toml.parse(readFileSync(new URL(path, import.meta.url), "utf8"))
const publicEdge = read("../wrangler.toml")
const stateful = read("../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")

test("the public edge Worker holds no state and only proxies to the stateful Worker", () => {
  for (const [name, config] of [
    ["production", publicEdge],
    ...Object.entries(publicEdge.env || {}),
  ]) {
    for (const key of ["d1_databases", "kv_namespaces", "r2_buckets", "durable_objects"])
      assert.equal(config[key], undefined, `public edge ${name} must not bind ${key}`)
  }
  assert.deepEqual(
    publicEdge.services.map((service) => ({ ...service })),
    [{ binding: "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE", service: "geneguessr-api" }],
  )
})

test("production has no workers.dev or preview bypass; staging has its one rehearsal URL", () => {
  for (const config of [publicEdge, stateful]) {
    assert.equal(config.workers_dev, false)
    assert.equal(config.preview_urls, false)
  }
  assert.equal(stateful.env.staging.workers_dev, true)
  assert.equal(stateful.env.staging.preview_urls, false)
})

test("Iconoplasm routes straight to the stateful Worker, with no Durable Object in front of D1", () => {
  assert.deepEqual(
    stateful.routes.map((route) => route.pattern),
    ["iconoplasm.brinedew.bio/*"],
  )
  // B-1067 deleted the daily budget referee and the sync governor; batch work
  // is let in by its price (workers/iconoplasm/batch-admission.js).
  for (const config of [stateful, stateful.env.staging])
    assert.deepEqual(
      config.durable_objects.bindings.map((binding) => binding.name),
      ["GAME_SESSIONS"],
    )
})
