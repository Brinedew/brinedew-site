import assert from "node:assert/strict"
import test from "node:test"
import { createD1InvocationBudget } from "./d1-invocation-budget.js"

function database() {
  let calls = 0
  const statement = {
    bind() {
      return this
    },
    async first() {
      calls++
      return null
    },
    async all() {
      calls++
      return { results: [] }
    },
    async run() {
      calls++
      return { success: true }
    },
  }
  return {
    get calls() {
      return calls
    },
    prepare() {
      return statement
    },
    async batch(statements) {
      calls += statements.length
      return []
    },
  }
}

test("D1 invocation admission is shared across bindings and refuses a whole oversized batch before send", async () => {
  const first = database(),
    second = database(),
    budget = createD1InvocationBudget()
  const a = budget.binding(first),
    b = budget.binding(second)
  await a.prepare("read").first()
  await b.batch(Array.from({ length: 48 }, () => b.prepare("write").bind("value")))
  assert.equal(budget.used, 49)
  assert.equal(budget.canStart(2), false)
  await assert.rejects(b.batch([b.prepare("write"), b.prepare("write")]), {
    code: "D1_INVOCATION_STATEMENT_BUDGET_EXCEEDED",
  })
  assert.equal(second.calls, 48)
  await a.prepare("read").all()
  await assert.rejects(a.prepare("write").run(), {
    code: "D1_INVOCATION_STATEMENT_BUDGET_EXCEEDED",
  })
  assert.equal(first.calls + second.calls, 50)
  assert.equal(budget.binding(first), a)
})

test("failed D1 sends remain charged and foreign statements cannot bypass batch admission", async () => {
  const db = {
    prepare() {
      return {
        async run() {
          throw new Error("database failed")
        },
      }
    },
    async batch() {
      assert.fail("must not send")
    },
  }
  const budget = createD1InvocationBudget(),
    wrapped = budget.binding(db)
  await assert.rejects(wrapped.prepare("write").run(), /database failed/)
  assert.equal(budget.used, 1)
  await assert.rejects(wrapped.batch([db.prepare("raw")]), /unowned statement/)
  assert.equal(budget.used, 1)
})
