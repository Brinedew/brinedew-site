import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import path from "node:path"

// Compile, never execute, application statements against local migration-built
// schemas. An indexed plan is a review aid, not a cardinality/cost guarantee.
const root = fileURLToPath(new URL("../", import.meta.url))
const evidence = path.join(root, "artifacts/cloudflare-system-budget-audit")
const surface = JSON.parse(readFileSync(path.join(evidence, "resource-surface.json"), "utf8"))
const schemas = []
const schemaErrors = []
try {
  for (const directory of [
    "migrations",
    "migrations-iconoplasm",
    "migrations-iconoplasm-authoring",
  ]) {
    const db = new DatabaseSync(":memory:")
    schemas.push({ directory, db })
    const owners =
      directory === "migrations" ? [directory, "workers/benchmark/migrations"] : [directory]
    for (const owner of owners)
      for (const file of readdirSync(path.join(root, owner))
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))) {
        try {
          db.exec(readFileSync(path.join(root, owner, file), "utf8"))
        } catch (error) {
          schemaErrors.push({ directory, owner, file, error: error.message })
          break
        }
      }
  }
  const plans = surface.sqlExpressions.map((call) => {
    const result = {
      file: call.file,
      line: call.line,
      owner: call.owner,
      status: "requires-dynamic-query-review",
      plans: [],
    }
    if (!call.staticSql) return result
    const errors = []
    for (const { directory, db } of schemas) {
      if (schemaErrors.some((e) => e.directory === directory)) continue
      try {
        // sqlite EXPLAIN accepts unset positional parameters as NULL. No SQL
        // mutation occurs, including when the input is an INSERT/UPDATE/DELETE.
        const rows = db.prepare("EXPLAIN QUERY PLAN " + call.staticSql).all()
        result.plans.push({ schema: directory, details: rows.map((r) => r.detail) })
      } catch (error) {
        errors.push(error.message)
      }
    }
    result.status = result.plans.length ? "compiled-needs-bound-review" : "unresolved-schema-or-sql"
    result.scanOrSort = result.plans.some((p) =>
      p.details.some((d) => /\bSCAN\b|TEMP B-TREE/.test(d)),
    )
    if (!result.plans.length) result.errors = [...new Set(errors)]
    return result
  })
  writeFileSync(
    path.join(evidence, "query-plans.json"),
    JSON.stringify(
      {
        schemaErrors,
        limitations:
          "Empty-schema compile only; scans may be bounded and SEARCH may still be unbounded. Dynamic SQL, trigger fanout, actual cardinalities and all cost receipts require separate proof.",
        plans,
      },
      null,
      2,
    ) + "\n",
  )
  console.log(
    JSON.stringify({
      schemaErrors,
      sites: plans.length,
      compiled: plans.filter((p) => p.plans.length).length,
      scanOrSort: plans.filter((p) => p.scanOrSort).length,
      dynamic: plans.filter((p) => p.status === "requires-dynamic-query-review").length,
      unresolved: plans.filter((p) => p.status === "unresolved-schema-or-sql").length,
    }),
  )
  if (schemaErrors.length) process.exitCode = 1
} finally {
  for (const { db } of schemas) db.close()
}
