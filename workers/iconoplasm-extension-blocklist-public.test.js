import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

// ARCHITECTURE FENCE [IPD-008]: public manifest traffic must stay entirely on
// published artifacts even when an ICONOPLASM_DB binding exists.

import {
  iconoplasmExtensionBlocklistKvKey,
  resetIconoplasmExtensionBlocklistPublicCacheForTests,
} from "./iconoplasm-extension-blocklist-policy.js"
import { resetIconoplasmRecognitionPolicyPublicCacheForTests } from "./iconoplasm-recognition-policy-reconciliation.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeKv {
  constructor(entries) {
    this.entries = new Map(Object.entries(entries))
  }

  async get(key) {
    return this.entries.get(key) ?? null
  }

  async put(key, value) {
    this.entries.set(key, value)
  }

  async list({ prefix = "", limit = 1_000 } = {}) {
    const names = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort()
    return {
      keys: names.slice(0, limit).map((name) => ({ name })),
      list_complete: names.length <= limit,
    }
  }
}

class ThrowingDb {
  prepare() {
    throw new Error("public catalog manifest must not touch D1")
  }

  batch() {
    throw new Error("public catalog manifest must not touch D1")
  }
}

class ThrowingDurableObjectNamespace {
  idFromName() {
    throw new Error("public catalog manifest must not touch Durable Objects")
  }

  get() {
    throw new Error("public catalog manifest must not touch Durable Objects")
  }
}

function projection(revision, version, terms) {
  return JSON.stringify({
    schema_version: 1,
    revision,
    version,
    term_count: terms.length,
    terms,
  })
}

function blocklistVersion(terms) {
  return `ebl1-${createHash("sha256").update(JSON.stringify(terms)).digest("hex").slice(0, 16)}`
}

const AMID_VERSION = blocklistVersion(["AMID"])
const ARCH_VERSION = blocklistVersion(["ARCH"])

function publicManifestKv() {
  const hash = "blocklistfixture01"
  return new FakeKv({
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      filename: `catalog.${hash}.json`,
      generated_at: "2026-08-09T00:00:00.000Z",
      schema_version: 4,
      contract_revision: 1,
      canonical_key: "symbol",
      gene_count: 1,
      scanner_artifact: {
        schema_version: 1,
        contract_revision: 1,
        build_version: hash,
        filename: `scanner.${hash}.json`,
        byte_size: 100,
      },
    }),
    "iconoplasm:published-portrait-fingerprint:v3": JSON.stringify({
      schema: "iconoplasm.publishedPortraitFingerprint.v1",
      published_at: "2026-08-09T00:00:00.000Z",
      fingerprint: { published_count: 0, latest: null },
    }),
    "iconoplasm:gallery-version": JSON.stringify({
      current: "cards-fixture-1",
      previous: null,
      schema: 1,
      status: "active",
    }),
    [iconoplasmExtensionBlocklistKvKey(1)]: projection(1, AMID_VERSION, ["AMID"]),
    [iconoplasmExtensionBlocklistKvKey(999)]: "{corrupt projection",
  })
}

async function getManifest(env, headers = {}) {
  return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest", { headers }),
    env,
    { waitUntil() {} },
  )
}

test("public manifest skips a corrupt higher key, stays KV-only, and includes revision in ETag", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const kv = publicManifestKv()
  const env = {
    KV: kv,
    ICONOPLASM_DB: new ThrowingDb(),
    ICONOPLASM_CARD_PUBLICATION: new ThrowingDurableObjectNamespace(),
  }
  const first = await getManifest(env)
  const firstPayload = await first.json()
  const firstEtag = first.headers.get("ETag")

  assert.equal(first.status, 200)
  assert.deepEqual(firstPayload.extension_blocklist, {
    schema_version: 1,
    revision: 1,
    version: AMID_VERSION,
    term_count: 1,
    terms: ["AMID"],
  })
  assert.match(firstEtag, new RegExp(`blocklist-${AMID_VERSION}-r1`))

  const unchanged = await getManifest(env, { "If-None-Match": firstEtag })
  assert.equal(unchanged.status, 304)

  kv.entries.set(iconoplasmExtensionBlocklistKvKey(2), projection(2, ARCH_VERSION, ["ARCH"]))
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const changed = await getManifest(env, { "If-None-Match": firstEtag })
  const changedPayload = await changed.json()
  assert.equal(changed.status, 200)
  assert.equal(changedPayload.extension_blocklist.revision, 2)
  assert.equal(changedPayload.build_version, firstPayload.build_version)
  assert.equal(changedPayload.catalog_hash, firstPayload.catalog_hash)
  assert.equal(
    changedPayload.scanner_artifact.build_version,
    firstPayload.scanner_artifact.build_version,
  )
  assert.notEqual(changed.headers.get("ETag"), firstEtag)
})
