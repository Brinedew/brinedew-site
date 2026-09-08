import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

// B-742: a CI failure named a test that the Contents API could not retrieve.
// Report only repository test source around that exact assertion. This has no
// credentials, network access, production effects or influence on test results.
test("B-742 deployment assertion source provenance", () => {
  const expected = "scripts/activate-operation-cost-release.test.js"
  console.log("B-742 reported test exists:", existsSync(expected))
  for (const name of readdirSync("scripts")) {
    if (!name.endsWith(".test.js")) continue
    const file = `scripts/${name}`
    const lines = readFileSync(file, "utf8").split("\n")
    const position = lines.findIndex((line) =>
      line.includes("production stages " + "admission before migrations"),
    )
    if (position < 0) continue
    console.log("B-742 assertion source:", file)
    console.log(
      lines
        .slice(Math.max(0, position - 5), position + 40)
        .map((line, index) => `${Math.max(0, position - 5) + index + 1}: ${line}`)
        .join("\n"),
    )
  }
})
