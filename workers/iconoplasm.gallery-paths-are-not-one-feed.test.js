import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const appSource = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
const ordersSource = readFileSync(
  new URL("../quartz/static/iconoplasm/home-orders.js", import.meta.url),
  "utf8",
)
const workerSource = readFileSync(
  new URL("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js", import.meta.url),
  "utf8",
)
const onboardingSource = readFileSync(
  new URL("../docs/ICONOPLASM_ONBOARDING.md", import.meta.url),
  "utf8",
)
const operationsSource = readFileSync(
  new URL("../docs/ICONOPLASM_OPERATIONS.md", import.meta.url),
  "utf8",
)

test("Iconoplasm gallery onboarding says there is no single feed order", () => {
  assert.match(onboardingSource, /## there is no single gallery order/)
  assert.match(onboardingSource, /signed-in personal shelf/)
  assert.match(onboardingSource, /admin classic full gallery/)
  assert.match(onboardingSource, /account gallery window/)
  assert.match(onboardingSource, /client-side ordering/)
  assert.match(onboardingSource, /classic public gallery orders/)
  assert.match(onboardingSource, /A catalog gene must remain reachable/)
  assert.match(onboardingSource, /published card-catalog artifact/)

  assert.match(operationsSource, /## card\/gallery path warning/)
  assert.match(operationsSource, /\/api\/public\/v1\/gallery/)
  assert.match(operationsSource, /\/api\/iconoplasm\/discoveries\/me/)
  assert.match(operationsSource, /\/api\/iconoplasm\/account-gallery-window/)
  assert.match(operationsSource, /\/api\/iconoplasm\/mobile-card-manifest/)
  assert.match(operationsSource, /There is no universal "next genes the user will see"/)
})

test("home orders are shared across paths, not proof of one gallery feed", () => {
  for (const order of [
    "newest",
    "symbol",
    "shortest",
    "votes",
    "uniqueness",
    "popularity",
    "heaviest",
    "lightest",
    "oldest",
    "youngest",
    "random",
  ]) {
    assert.match(ordersSource, new RegExp(`value: "${order}"`), `missing home order ${order}`)
  }

  assert.match(appSource, /function accountGalleryWindowOrderSupported\(order\)/)
  assert.match(appSource, /return resolved === "newest" \|\| resolved === "symbol"/)
  assert.match(appSource, /fetchAccountGalleryWindow\(/)
  assert.match(appSource, /fetchDiscoveryState\(galleryState\.order, galleryState\.seed\)/)
  assert.match(appSource, /loadMobileCardPageVM\(pageEntries\)/)
  assert.match(appSource, /This is not a generic infinite-feed loader/)
})

test("worker comments pin public gallery, account windows, and published card artifacts as distinct paths", () => {
  assert.match(workerSource, /Account windows are one signed-in shelf path/)
  assert.match(workerSource, /Only these supported orders can use this cursor shape/)
  assert.match(workerSource, /Classic public gallery mode has its own order machinery/)
  assert.match(workerSource, /Card payloads have one runtime path/)
  assert.match(workerSource, /published card-catalog artifact/)
})
