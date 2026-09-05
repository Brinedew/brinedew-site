import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const shell = process.platform === "win32" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : "pwsh"
const script = fileURLToPath(new URL("./Invoke-CloudflareCostOperation.ps1", import.meta.url))

test("operator refuses absent or malformed predictions before credential and network work", () => {
  const directory = mkdtempSync(join(tmpdir(), "cost-operation-"))
  try {
    const planPath = join(directory, "plan.json")
    for (const [plan, code] of [
      [{}, "COST_PREDICTION_REQUIRED"],
      [{ prediction: null }, "COST_PREDICTION_REQUIRED"],
      [{ prediction: { rows_read: -1, rows_written: 0, requests: 1 } }, "COST_PREDICTION_INVALID"],
      [{ prediction: { rows_read: 1, rows_written: 0, requests: 1 } }, "COST_PLAN_INVALID"],
    ]) {
      writeFileSync(planPath, JSON.stringify(plan))
      assert.throws(
        () =>
          execFileSync(
            shell,
            ["-NoProfile", "-File", script, "-Action", "Register", "-PlanPath", planPath],
            {
              timeout: 5000,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            },
          ),
        (error) => {
          assert.equal(error.status, 1)
          assert.match(error.stderr, new RegExp(code))
          assert.doesNotMatch(error.stderr, /telemetry|budget exhausted|TOKEN is unavailable/)
          return true
        },
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
