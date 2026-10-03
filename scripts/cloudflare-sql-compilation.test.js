import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import ts from "typescript"

const root = new URL("../", import.meta.url)

function staticStatements(directory = "workers/") {
  const statements = []
  for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
    const file = directory + entry.name
    if (entry.isDirectory()) {
      statements.push(...staticStatements(file + "/"))
      continue
    }
    if (!file.endsWith(".js") || /\.(test|spec)\.js$/.test(file)) continue
    const source = ts.createSourceFile(
      file,
      readFileSync(new URL(file, root), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    )
    function visit(node, owner = "<module>") {
      if (ts.isFunctionLike(node) && node.name) owner = node.name.getText(source)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["prepare", "exec"].includes(node.expression.name.text)
      ) {
        const argument = node.arguments[0]
        if (
          argument &&
          (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) &&
          /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i.test(argument.text)
        ) {
          statements.push({
            file,
            owner,
            line: source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1,
            sql: argument.text,
          })
        }
      }
      ts.forEachChild(node, (child) => visit(child, owner))
    }
    visit(source)
  }
  return statements
}

function migratedDatabase(directories) {
  const db = new DatabaseSync(":memory:")
  try {
    for (const directory of directories) {
      for (const name of readdirSync(new URL(directory + "/", root))
        .filter((name) => name.endsWith(".sql"))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b)))
        db.exec(readFileSync(new URL(directory + "/" + name, root), "utf8"))
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

test("static Worker SQL compiles against migrated D1 schemas before release", (t) => {
  const databases = []
  try {
    for (const directories of [
      ["migrations", "workers/benchmark/migrations"],
      ["migrations-iconoplasm"],
      ["migrations-iconoplasm-authoring"],
    ])
      databases.push(migratedDatabase(directories))
    const failures = []
    let compiled = 0,
      otherStorage = 0
    for (const statement of staticStatements()) {
      const errors = []
      let matched = false
      for (const db of databases) {
        try {
          // EXPLAIN compiles writes without running them. Unbound parameters
          // are NULL; fixture data and operator permissions are unnecessary.
          db.prepare("EXPLAIN QUERY PLAN " + statement.sql).all()
          matched = true
          break
        } catch (error) {
          errors.push(error.message)
        }
      }
      if (matched) compiled++
      else if (errors.every((message) => /^no such (table|index):/.test(message))) otherStorage++
      else failures.push({ ...statement, errors: [...new Set(errors)] })
    }
    t.diagnostic(
      JSON.stringify({
        compiled,
        otherStorage,
        limitations:
          "Static direct prepare/exec calls only. Missing tables may belong to Durable Objects or migration journals; dynamic SQL, trigger fanout and cost remain separately audited.",
      }),
    )
    assert.ok(compiled > 0)
    assert.deepEqual(failures, [])
  } finally {
    for (const db of databases) db.close()
  }
})
