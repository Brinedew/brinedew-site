import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("./pdf-gecko-redirect.js", import.meta.url), "utf8")

test("redirect bridge asks the background to open exactly the captured Firefox source", () => {
  const messages = []
  const document = {
    readyState: "complete",
    documentElement: { dataset: { iconoplasmGeckoPdfSource: "source-1" } },
  }
  const context = vm.createContext({
    browser: {
      runtime: {
        sendMessage(message) {
          messages.push(message)
          return Promise.resolve({ ok: true })
        },
      },
    },
    document,
  })
  context.globalThis = context
  vm.runInContext(source, context, { filename: "pdf-gecko-redirect.js" })
  assert.equal(
    JSON.stringify(messages),
    JSON.stringify([{ type: "PDF_OPEN_OWNED_READER", sourceId: "source-1" }]),
  )
})
