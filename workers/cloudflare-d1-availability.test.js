import assert from "node:assert/strict"
import test from "node:test"

import {
  isD1DailyRowReadLimitError,
  secondsUntilCloudflareDailyReset,
} from "./lib/cloudflare-availability.js"
import { validateDailyBootstrapCacheWithAvailabilityFallback } from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("recognizes Cloudflare's daily D1 row-read exhaustion through wrapped errors", () => {
  const cause = new Error(
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit.",
  )
  assert.equal(isD1DailyRowReadLimitError(new Error("query failed", { cause })), true)
  assert.equal(isD1DailyRowReadLimitError(new Error("D1 database unavailable")), false)
})

test("retry-after targets five seconds after the next midnight UTC reset", () => {
  const now = Date.parse("2026-09-01T18:04:31.000Z")
  assert.equal(secondsUntilCloudflareDailyReset(now), 21_334)
})

test("daily gameplay retains its exact verified target during the D1 daily lockout", async () => {
  const cached = {
    targetProtein: { uniprot: "Q9QUOTA", gene: "QUOTA" },
    structureMeta: { r2Key: "structures/Q9QUOTA.bcif", format: "bcif" },
    structureToken: { format: "bcif", url: "https://example.test/Q9QUOTA.bcif" },
    structureVerifiedAt: 1,
  }
  const env = {
    DB: {
      prepare() {
        throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.")
      },
    },
  }

  const result = await validateDailyBootstrapCacheWithAvailabilityFallback(
    env,
    "2026-09-01",
    "https://geneguessr.brinedew.bio",
    cached,
  )

  assert.equal(result, cached)
})

test("daily gameplay does not hide unrelated target-validation defects", async () => {
  const cached = {
    targetProtein: { uniprot: "Q9DEFECT", gene: "DEFECT" },
    structureMeta: { r2Key: "structures/Q9DEFECT.bcif", format: "bcif" },
    structureVerifiedAt: 1,
  }
  const env = {
    DB: {
      prepare() {
        throw new Error("malformed protein query")
      },
    },
  }

  await assert.rejects(
    validateDailyBootstrapCacheWithAvailabilityFallback(
      env,
      "2026-09-01",
      "https://geneguessr.brinedew.bio",
      cached,
    ),
    /malformed protein query/,
  )
})
