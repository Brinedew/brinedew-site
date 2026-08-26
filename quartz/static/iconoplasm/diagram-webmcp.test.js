import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("the app and Studio load the same versioned diagram module graph", () => {
  const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8")
  const studioSource = readFileSync(new URL("./diagram-studio.js", import.meta.url), "utf8")
  const appVersion = appSource.match(/diagram-studio\.js\?v=([^"']+)/)?.[1]
  const documentVersion = studioSource.match(/diagram-document\.js\?v=([^"']+)/)?.[1]

  assert.ok(appVersion)
  assert.equal(documentVersion, appVersion)
  assert.match(studioSource, /createDiagramEditor/)
  assert.match(studioSource, /addTextNode/)
})

test("Studio delegates canvas primitives and export to AntV X6", () => {
  const editorSource = readFileSync(new URL("./diagram-x6-editor.js", import.meta.url), "utf8")
  assert.match(editorSource, /new Selection/)
  assert.match(editorSource, /new Transform/)
  assert.match(editorSource, /new Snapline/)
  assert.match(editorSource, /new History/)
  assert.match(editorSource, /new Export/)
  assert.match(editorSource, /router: \{ name: "orth"/)
  assert.match(editorSource, /new DagreLayout/)
  assert.match(editorSource, /graph\.clearCells\(\{ silent: true \}\)/)
  assert.match(editorSource, /graph\.centerContent\(\)/)
  assert.doesNotMatch(editorSource, /Math\.max\((?:320|420), container\.client/)
  assert.doesNotMatch(editorSource, /pointermove|elementFromPoint|createSVGPoint/)
})
