import assert from "node:assert/strict"
import test from "node:test"

const stored = new Map()
globalThis.window = {
  localStorage: {
    getItem(key) {
      return stored.get(key) || null
    },
    setItem(key, value) {
      stored.set(key, value)
    },
  },
}

const registered = []
globalThis.document = {
  modelContext: {
    async registerTool(tool) {
      registered.push(tool)
    },
  },
}

const { __testing, getCurrentDiagramDocument, registerDiagramWebMcp } =
  await import("./diagram-studio.js")

// ARCHITECTURE FENCE [IPD-003]
test("WebMCP keeps direct bitmap retrieval and visible diagram editing together", async () => {
  const result = await registerDiagramWebMcp()
  assert.equal(result.supported, true)
  assert.deepEqual(result.registered, [
    "resolve_gene_assets",
    "compose_gene_diagram",
    "edit_gene_diagram",
    "read_gene_diagram",
    "export_gene_diagram",
  ])

  const schemas = __testing.toolSchemas()
  assert.match(
    schemas.find((tool) => tool.name === "resolve_gene_assets").description,
    /reuse them outside the visible Iconoplasm diagram/,
  )
  assert.match(
    schemas.find((tool) => tool.name === "compose_gene_diagram").description,
    /visible, human-editable/,
  )
  assert.equal(getCurrentDiagramDocument().width / getCurrentDiagramDocument().height, 1.5)
})
