import { readFileSync } from "node:fs"

// A migration that a test applies to a Miniflare D1 has to be sent statement by
// statement: D1's exec() treats every line as a statement. A trigger body ends
// at its END; line, every other statement at its semicolon.
export function splitMigrationSql(source, name) {
  const statements = []
  let current = []
  let trigger = false
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("--")) continue
    if (!current.length) trigger = /^CREATE TRIGGER\b/i.test(line)
    current.push(line)
    if (trigger ? /^END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(current.join("\n"))
      current = []
    }
  }
  if (current.length) throw new Error(`Migration ${name} ends inside an unterminated statement`)
  return statements
}

export function migrationStatements(directory, name) {
  return splitMigrationSql(readFileSync(new URL(name, directory), "utf8"), name)
}

// Runs a migration file's own statements, in order, on a D1 binding. One batch
// keeps the file atomic, as `wrangler d1 migrations apply` does.
export async function applyMigrationFile(db, directory, name) {
  await db.batch(migrationStatements(directory, name).map((sql) => db.prepare(sql)))
}
