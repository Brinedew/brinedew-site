import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

// ARCHITECTURE FENCE [IPD-004]: tests guard durable due-time Queue behavior.
// ARCHITECTURE FENCE [IPD-005]: tests guard the bounded ledger and browser budget.

import {
  ICONOPLASM_GENE_CARD_HEIGHT,
  ICONOPLASM_GENE_CARD_WIDTH,
  iconoplasmGeneCardDownloadFilename,
  iconoplasmGeneCardFingerprint,
  iconoplasmGeneCardObjectKey,
  iconoplasmGeneCardPngDimensions,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

const runtimeSource = readFileSync(
  new URL(
    "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const ledgerSource = readFileSync(
  new URL(
    "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const portraitStorageSource = readFileSync(
  new URL("./lib/iconoplasm-portrait-storage.js", import.meta.url),
  "utf8",
)
const migrationSource = readFileSync(
  new URL("../migrations-iconoplasm/0063_gene_card_materializations.sql", import.meta.url),
  "utf8",
)
const wranglerSource = readFileSync(
  new URL(
    "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    import.meta.url,
  ),
  "utf8",
)

function card(overrides = {}) {
  return {
    symbol: "SOX12",
    full_name: "SRY-box transcription factor 12",
    color: "#445566",
    portrait: { asset_sha256: "ab".repeat(32) },
    essence: { sex: "Female", age_years: 31, aesthetics: ["archival"] },
    ...overrides,
  }
}

test("gene-card identity ignores publication wrappers but changes with visible card material", () => {
  const baseline = iconoplasmGeneCardFingerprint(card())
  assert.match(baseline, /^[a-f0-9]{32}$/)
  assert.equal(
    iconoplasmGeneCardFingerprint({
      ...card(),
      snapshot_version: "another-global-publication",
      data_source: "test",
      print_copy: { status: "ready", image_url: "https://example.test/old.png" },
    }),
    baseline,
  )
  assert.notEqual(iconoplasmGeneCardFingerprint(card({ full_name: "changed name" })), baseline)
  assert.notEqual(
    iconoplasmGeneCardFingerprint(card({ portrait: { asset_sha256: "cd".repeat(32) } })),
    baseline,
  )
})

test("materialized objects and downloads carry the canonical gene symbol", () => {
  const fingerprint = iconoplasmGeneCardFingerprint(card())
  const key = iconoplasmGeneCardObjectKey("sox12", fingerprint)
  assert.equal(key, `gene-cards/v1/S/SOX12/${fingerprint}/SOX12-iconoplasm-gene-card.png`)
  assert.equal(iconoplasmGeneCardDownloadFilename("sox12"), "SOX12-iconoplasm-gene-card.png")
  assert.equal(ICONOPLASM_GENE_CARD_WIDTH, 1536)
  assert.equal(ICONOPLASM_GENE_CARD_HEIGHT, 2048)
})

test("materialized print dimensions are verified from the PNG header", () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47], 0)
  png.set([0x49, 0x48, 0x44, 0x52], 12)
  png.set([0x00, 0x00, 0x06, 0x00], 16)
  png.set([0x00, 0x00, 0x08, 0x00], 20)

  assert.deepEqual(iconoplasmGeneCardPngDimensions(png), { width: 1536, height: 2048 })
  assert.equal(iconoplasmGeneCardPngDimensions(new Uint8Array([1, 2, 3])), null)
  assert.match(runtimeSource, /Browser screenshot dimensions were/)
})

test("GET and HEAD cannot enroll, enqueue, cache in KV, or launch Browser Rendering", () => {
  const handler = runtimeSource.slice(
    runtimeSource.indexOf("async function handleIconoplasmPrintCopyPng"),
    runtimeSource.indexOf("async function handlePublicResolve"),
  )
  assert.match(handler, /readIconoplasmGeneCardMaterialization/)
  assert.match(handler, /readPortraitStorageObject/)
  assert.doesNotMatch(handler, /renderIconoplasmPrintCopyPngWithBrowser/)
  assert.doesNotMatch(handler, /enrollIconoplasmGeneCardMaterialization/)
  assert.doesNotMatch(handler, /\.KV\.put|env\.KV/)
})

test("the durable ledger is bounded and queue delivery is serialized", () => {
  assert.match(migrationSource, /gene_symbol TEXT PRIMARY KEY/)
  assert.match(migrationSource, /WITHOUT ROWID/)
  assert.doesNotMatch(migrationSource, /BLOB/)
  assert.match(ledgerSource, /LIMIT \?/)
  assert.match(ledgerSource, /lease_expires_at/)
  assert.match(ledgerSource, /next_attempt_at/)
  assert.match(
    ledgerSource,
    /state <> 'failed'[\s\S]*ELSE 'queued'/,
    "an explicit request must revive a terminal failure without disturbing an active duplicate",
  )
  assert.match(
    ledgerSource,
    /D1 batch is transactional[\s\S]*INSERT INTO icono_publish_events[\s\S]*UPDATE icono_gene_card_materializations/,
    "ready state and its dirty-publication event must commit atomically",
  )
  assert.match(
    runtimeSource,
    /enqueue: budgetReservation\.reason !== "daily_budget"/,
    "a daily-cap backlog must remain in D1 instead of minting one next-day Queue message per gene",
  )
  assert.match(
    runtimeSource,
    /turnstile\.action !== "gene_card_request"/,
    "guest enrollment must reject a Turnstile token minted for another action",
  )
  assert.match(
    portraitStorageSource,
    /verifyPortraitStorageObjectAfterPut[\s\S]*BUNNY_READ_AFTER_WRITE_DELAYS_MS[\s\S]*headPortraitStorageObject/,
    "Bunny read-after-write verification must use the shared measured replication window",
  )
  assert.match(
    portraitStorageSource,
    /putBunnyObjectUntilVerified[\s\S]*putPortraitStorageObject[\s\S]*verifyPortraitStorageObjectAfterPut/,
    "an acknowledged but lost gene-card PUT must retry the same rendered bytes",
  )
  assert.match(
    wranglerSource,
    /queue = "iconoplasm-gene-card-materialization"[\s\S]*max_batch_size = 1/,
  )
  assert.match(
    wranglerSource,
    /queue = "iconoplasm-gene-card-materialization"[\s\S]*max_concurrency = 1/,
  )
})

test("the Browser Rendering envelope is below the free daily and launch limits", () => {
  assert.match(ledgerSource, /MAX_DAILY_BROWSER_SECONDS = 480/)
  assert.match(ledgerSource, /MAX_DAILY_BROWSER_LAUNCHES = 8/)
  assert.match(ledgerSource, /MIN_LAUNCH_INTERVAL_SECONDS = 25/)
  assert.match(ledgerSource, /RESERVED_SECONDS_PER_LAUNCH = 60/)
})
