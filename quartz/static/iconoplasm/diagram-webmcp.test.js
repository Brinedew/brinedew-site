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
  assert.match(studioSource, /isCanvasSelection && isSuppressedCanvasClick\(event\)/)
})

test("post-drag suppression applies only at the synthetic drop click", () => {
  const dropPoint = { x: 100, y: 200 }
  assert.equal(
    __testing.shouldSuppressCanvasClick({ clientX: 100, clientY: 200 }, dropPoint, 10, 20),
    true,
  )
  assert.equal(
    __testing.shouldSuppressCanvasClick({ clientX: 140, clientY: 200 }, dropPoint, 10, 20),
    false,
  )
  assert.equal(
    __testing.shouldSuppressCanvasClick({ clientX: 100, clientY: 200 }, dropPoint, 20, 20),
    false,
  )
})

test("hidden connector ports cannot intercept canvas clicks", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  assert.match(styles, /\[data-diagram-port\]\s*\{[^}]*pointer-events:\s*none;/s)
  assert.match(
    styles,
    /is-connecting-source \[data-diagram-port\]\s*\{[^}]*pointer-events:\s*all;/s,
  )
})
