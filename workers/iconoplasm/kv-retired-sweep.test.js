// B-1147: the retired-key sweep on a real local KV. It must delete only keys of
// retired features and retired versions, never one of the current version,
// and stop at its daily share.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

import { sweepRetiredIconoplasmKvKeys } from "./kv-retired-sweep.js"

const VERSIONS = { catalogArtifactVersionToken: "a5c1", portraitSnapshotSchemaVersion: "v3" }

test(
  "the sweep deletes retired keys a day's share at a time and keeps current ones",
  { timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        kvNamespaces: ["KV"],
      }),
    )
    try {
      const kv = await runtime.getKVNamespace("KV")
      const retired = [
        ...Array.from(
          { length: 30 },
          (_, i) => `iconoplasm:mobile-card-vm:moto3zwz-b3f3ce99:G${i}`,
        ),
        ...Array.from({ length: 20 }, (_, i) => `iconoplasm:card-catalog-shard:${i}`),
        "iconoplasm:card-catalog:ccv1-abc",
        "iconoplasm:hydrated-catalog-artifact:daba7daa0c66-v2-19160-ff",
        "iconoplasm:hydrated-catalog-artifact:a5:daba7daa0c66-ff",
        "iconoplasm:published-portrait-refs:v2-19160-ff",
      ]
      const kept = [
        "iconoplasm:hydrated-catalog-artifact:a5c1:daba7daa0c66-a5c1-v3-19160-ff",
        "iconoplasm:published-portrait-refs:v3-19160-ff",
        "iconoplasm:catalog:abc",
        "iconoplasm:catalog-dispatch-watermark",
        "puzzle_override:TP53",
        "feature_flags",
      ]
      for (const name of [...retired, ...kept]) await kv.put(name, "x")

      const first = await sweepRetiredIconoplasmKvKeys(kv, VERSIONS, { limit: 40 })
      assert.equal(first.deleted, 40)
      assert.equal(first.done, false, "a day's share leaves the rest for tomorrow")

      const second = await sweepRetiredIconoplasmKvKeys(kv, VERSIONS, { limit: 40 })
      assert.equal(second.deleted, retired.length - 40)
      assert.equal(second.done, true)

      const left = (await kv.list()).keys.map((key) => key.name).sort()
      assert.deepEqual(left, [...kept].sort())

      const third = await sweepRetiredIconoplasmKvKeys(kv, VERSIONS, { limit: 40 })
      assert.deepEqual(third, { deleted: 0, lists: 4, done: true }, "afterwards a run only lists")
    } finally {
      await runtime.dispose()
    }
  },
)
