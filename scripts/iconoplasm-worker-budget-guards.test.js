import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("the production drift guard passes in the protected CI suite", () => {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./assert-iconoplasm-worker-budget-guards.mjs", import.meta.url))],
    { timeout: 10000, stdio: "pipe" },
  )
})
