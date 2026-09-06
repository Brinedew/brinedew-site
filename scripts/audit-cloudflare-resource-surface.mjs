import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import toml from "toml"
import { ICONOPLASM_ROUTE_CONTRACTS } from "../workers/iconoplasm-route-contract.js"

// Discovery evidence, not a cost certificate. Follow the actual configured
// entrypoints so newly imported production modules cannot escape the inventory.
const root = fileURLToPath(new URL("../", import.meta.url))
const configs = [
  "wrangler.toml",
  "wrangler.the-only-allowed-public-edge-worker-upload-only.toml",
  "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
]
const visited = new Set()
const calls = []
const sqlExpressions = []
const unresolved = []
const resources = new Set([
  "prepare",
  "batch",
  "exec",
  "get",
  "put",
  "delete",
  "list",
  "send",
  "sendBatch",
  "fetch",
  "setAlarm",
])
function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/")
}
function visitFile(file) {
  if (visited.has(file)) return
  visited.add(file)
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  function visit(node, owner = "<module>", loops = 0) {
    if (ts.isFunctionLike(node))
      owner =
        node.name?.getText(source) ||
        (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : owner)
    if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    )
      loops++
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const head = ts.isTemplateExpression(node) ? node.head.text : node.text
      if (
        /^\s*(?:--[^\n]*\n\s*)*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|PRAGMA|EXPLAIN)\s/i.test(
          head,
        )
      ) {
        sqlExpressions.push({
          file: relative(file),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          owner,
          enclosingLoops: loops,
          sql: node.getText(source),
          staticSql: ts.isTemplateExpression(node) ? null : node.text,
        })
      }
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text
      if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(file), spec)
        const resolved = [base, base + ".js", base + ".ts", path.join(base, "index.js")].find(
          existsSync,
        )
        if (resolved && /\.[cm]?[jt]s$/.test(resolved)) visitFile(resolved)
        else if (!resolved) unresolved.push({ file: relative(file), import: spec })
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      resources.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text
      const first = node.arguments[0]
      const sql = method === "prepare" && first ? first.getText(source) : null
      const staticSql =
        sql && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
          ? first.text
          : null
      calls.push({
        file: relative(file),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        owner,
        method,
        receiver: node.expression.expression.getText(source).slice(0, 180),
        enclosingLoops: loops,
        sql,
        staticSql,
        reviewSignals: sql
          ? [
              /\bCOUNT\s*\(|\bSUM\s*\(/i.test(sql) && "aggregate",
              /\bORDER\s+BY\b/i.test(sql) && "sort",
              /\bJOIN\b/i.test(sql) && "join",
              /\$\{/.test(sql) && "dynamic-sql",
              /\b(?:UPDATE|DELETE)\b/i.test(sql) && !/\bWHERE\b/i.test(sql) && "unscoped-write",
            ].filter(Boolean)
          : [],
      })
    }
    ts.forEachChild(node, (child) => visit(child, owner, loops))
  }
  visit(source)
}
const deployments = configs.map((name) => {
  const config = toml.parse(readFileSync(path.join(root, name), "utf8"))
  if (config.main) visitFile(path.resolve(root, config.main))
  return {
    config: name,
    main: config.main,
    databases: (config.d1_databases || []).map((d) => ({
      binding: d.binding,
      name: d.database_name,
    })),
    crons: config.triggers?.crons || [],
    queues: config.queues || {},
    services: (config.services || []).map((s) => ({ binding: s.binding, service: s.service })),
  }
})
const report = {
  schema: "cloudflare-resource-surface.v1",
  certification:
    "UNREVIEWED: call candidates include ordinary JS collections; SQL expressions include fragments and migration definitions; reachability is module-level, not a proven execution bound",
  deployments,
  modules: [...visited].map(relative).sort(),
  unresolved,
  routes: ICONOPLASM_ROUTE_CONTRACTS.map((r) => ({
    id: r.id,
    methods: r.methods,
    auth: r.auth,
    budgetFamily: r.budgetFamily,
    handler: r.apiHandler || r.gatewayHandler,
  })),
  calls,
  sqlExpressions,
}
const output = path.join(root, "artifacts/cloudflare-system-budget-audit")
mkdirSync(output, { recursive: true })
writeFileSync(path.join(output, "resource-surface.json"), JSON.stringify(report, null, 2) + "\n")
console.log(
  JSON.stringify({
    modules: visited.size,
    routes: report.routes.length,
    sqlSites: calls.filter((c) => c.sql).length,
    sqlExpressions: sqlExpressions.length,
    resourceCallCandidates: calls.length,
    unresolvedImports: unresolved.length,
    sqlReviewSignals: calls.filter((c) => c.reviewSignals.length).length,
  }),
)
if (unresolved.length) process.exitCode = 1
