// This is the provider's per-invocation statement ceiling, not a second daily
// spending authority. Daily row/storage admission remains owned by the existing
// operation-cost ledger. Statements are charged before any binding call, even
// when that call fails or its transaction rolls back.
export const D1_INVOCATION_STATEMENT_LIMIT = 50

export function createD1InvocationBudget() {
  let used = 0
  const bindings = new WeakMap()
  function charge(count) {
    if (used + count > D1_INVOCATION_STATEMENT_LIMIT) {
      const error = new Error("D1 invocation statement budget exceeded before sending")
      error.code = "D1_INVOCATION_STATEMENT_BUDGET_EXCEEDED"
      throw error
    }
    used += count
  }
  return Object.freeze({
    get used() {
      return used
    },
    canStart(maximumStatements) {
      if (!Number.isSafeInteger(maximumStatements) || maximumStatements < 1)
        throw new TypeError("Invalid D1 statement reservation")
      return used + maximumStatements <= D1_INVOCATION_STATEMENT_LIMIT
    },
    binding(db) {
      if (bindings.has(db)) return bindings.get(db)
      if (!db?.prepare) throw new TypeError("D1 binding missing")
      const statements = new WeakMap()
      function statement(raw) {
        const wrapped = Object.freeze({
          bind(...args) {
            return statement(raw.bind(...args))
          },
          async first(...args) {
            charge(1)
            return raw.first(...args)
          },
          async all(...args) {
            charge(1)
            return raw.all(...args)
          },
          async run(...args) {
            charge(1)
            return raw.run(...args)
          },
        })
        statements.set(wrapped, raw)
        return wrapped
      }
      const binding = Object.freeze({
        prepare(sql) {
          return statement(db.prepare(sql))
        },
        async batch(batch) {
          if (!Array.isArray(batch) || batch.some((item) => !statements.has(item)))
            throw new TypeError("D1 batch contains an unowned statement")
          charge(batch.length)
          return db.batch(batch.map((item) => statements.get(item)))
        },
      })
      bindings.set(db, binding)
      return binding
    },
  })
}
