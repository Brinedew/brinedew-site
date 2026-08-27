import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { Script } from "node:vm"
import test from "node:test"
import { parseHTML } from "linkedom"
import { FACTORY_BELT_OUTPUTS_SQL, readFactoryBelts } from "./iconoplasm-factory-belts.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { matchIconoplasmRouteContract } from "./iconoplasm-route-contract.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const migration = readFileSync(
  new URL("../migrations-iconoplasm/0080_factory_output_belts.sql", import.meta.url),
  "utf8",
)
const client = readFileSync(
  new URL("../quartz/static/iconoplasm/factory-belts.js", import.meta.url),
  "utf8",
)
const pipelines = [
  { code: "A", label: "Aesthetic", status: "accepted", recommended_vision: 9 },
  { code: "E", label: "Turbo 1.0", status: "retired", recommended_vision: 9 },
  { code: "O", label: "Turbo 1.1", status: "accepted", recommended_vision: 9 },
]

function database() {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE icono_portrait_assets (
    gene_symbol TEXT, asset_sha256 TEXT, emulsion_id TEXT, width INTEGER, height INTEGER,
    created_at TEXT, status TEXT, PRIMARY KEY (gene_symbol, asset_sha256));
    CREATE TABLE icono_generation_requests (
      factory_pipeline_code TEXT, factory_vision_revision INTEGER, status TEXT);
    CREATE INDEX requests_status ON icono_generation_requests(status);`)
  db.exec(migration)
  const insert = db.prepare("INSERT INTO icono_portrait_assets VALUES (?,?,?,?,?,?,?)")
  for (let i = 1; i <= 10; i++)
    insert.run(
      "GENE" + i,
      String(i).padStart(64, "0"),
      "A9-42",
      896,
      1152,
      `2026-08-${String(i).padStart(2, "0")} 12:00:00`,
      i === 10 ? "rejected" : "draft",
    )
  for (const [gene, emulsion] of [
    ["OLDER_VISION", "A1-42"],
    ["RETIRED", "E9-42"],
    ["UNQUALIFIED", "0-42"],
    ["EDIT", "A9-42-e"],
    ["BAD", "A9-42garbage"],
  ])
    insert.run(gene, gene.padStart(64, "0"), emulsion, 896, 1152, "2026-08-27 12:00:00", "draft")
  db.exec(
    "INSERT INTO icono_generation_requests VALUES ('A',9,'open'),('A',9,'open'),('A',9,'fulfilled')",
  )
  const d1 = {
    prepare: (sql) => ({
      bind: (...args) => ({ all: async () => ({ results: db.prepare(sql).all(...args) }) }),
      all: async () => ({ results: db.prepare(sql).all() }),
      first: async () => db.prepare(sql).get(),
    }),
  }
  return { db, d1 }
}

test("factory belts use exact qualified identity and indexed newest-six reads", async () => {
  const { db, d1 } = database()
  try {
    const result = await readFactoryBelts({
      db: d1,
      pipelines,
      visions: [{ revision: 1 }, { revision: 9 }],
      active: { pipeline: "A", vision: 9 },
      portraitUrl: (sha, size) => `/portraits/${sha}/${size}`,
    })
    const a9 = result.belts.find((belt) => belt.code === "A9")
    assert.equal(a9.outputs.length, 6)
    assert.deepEqual(
      a9.outputs.map((x) => x.gene_symbol),
      ["GENE10", "GENE9", "GENE8", "GENE7", "GENE6", "GENE5"],
    )
    assert.equal(a9.outputs[0].status, "rejected")
    assert.equal(a9.open_count, 2)
    assert.equal(a9.active, true)
    assert.equal(result.belts.find((b) => b.code === "A1").outputs[0].gene_symbol, "OLDER_VISION")
    assert.equal(result.belts.find((b) => b.code === "E9").status, "retired")
    assert.equal(result.belts.find((b) => b.code === "O9").outputs.length, 0)
    assert.equal(result.belts.find((b) => b.code === "O9").active, false)
    const plan = db.prepare("EXPLAIN QUERY PLAN " + FACTORY_BELT_OUTPUTS_SQL).all(6, '["A9","E9"]')
    assert.ok(
      plan.some((row) =>
        /SEARCH icono_portrait_assets USING INDEX idx_icono_portrait_assets_factory_recent/.test(
          row.detail,
        ),
      ),
    )
    assert.ok(!plan.some((row) => /SCAN icono_portrait_assets|TEMP B-TREE/.test(row.detail)))
  } finally {
    db.close()
  }
})

test("factory recipe capacity fails explicitly before reading", async () => {
  await assert.rejects(
    readFactoryBelts({
      db: {},
      pipelines,
      visions: Array.from({ length: 180 }, (_, i) => ({ revision: i + 1 })),
      active: {},
    }),
    /pagination/,
  )
})

test("DO NOT DELETE: factory belts are registered in the real gateway as private read-only", async () => {
  const path = "/api/iconoplasm/admin/factory-belts"
  const match = matchIconoplasmRouteContract(path, "GET")
  assert.ok(match, "A handler without route registration returns 404 in production")
  assert.equal(match.route.auth, "administrator")
  assert.equal(match.route.budgetFamily, "admin_factory_recipe")
  const dispatch = (method) =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio" + path, { method }),
      {},
      { waitUntil() {} },
    )
  assert.equal((await dispatch("GET")).status, 403)
  assert.equal((await dispatch("POST")).status, 405)
})

test("authorized factory belt requests execute through the gateway and real SQLite", async () => {
  const { db, d1 } = database()
  db.exec(`CREATE TABLE icono_factory_pipeline_vision_recommendations (pipeline_code TEXT, vision_revision INTEGER);
    CREATE TABLE icono_factory_active_recipe (singleton_id INTEGER, pipeline_code TEXT, vision_revision INTEGER, updated_by TEXT, updated_at TEXT);
    INSERT INTO icono_factory_active_recipe VALUES (1, 'A', 9, 'test', '2026-08-27');
    CREATE TABLE icono_factory_vision_definitions (revision INTEGER, source_id TEXT, label TEXT, source_sha256 TEXT,
      positive_prefix TEXT, negative_prompt TEXT, prompt_content_mode TEXT, prompt_order_mode TEXT,
      prompt_replace_underscores INTEGER, emulsion_base_id TEXT, status TEXT);
    INSERT INTO icono_factory_vision_definitions (revision, status) VALUES (9, 'accepted');`)
  try {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/factory-belts", {
          headers: {
            "x-iconoplasm-admin-token": "test-only-secret",
            "x-iconoplasm-only-allowed-stateful-worker-internal": "1",
          },
        }),
        { ICONOPLASM_ADMIN_TOKEN: "test-only-secret", ICONOPLASM_DB: d1 },
        { waitUntil() {} },
      )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    const result = await response.json()
    const a9 = result.belts.find((belt) => belt.code === "A9")
    assert.equal(a9.active, true)
    assert.equal(a9.outputs.length, 6)
    assert.match(a9.outputs[0].full_url, /\/full\.webp$/)
  } finally {
    db.close()
  }
})

function browserFixture() {
  const { window, document } = parseHTML(ICONOPLASM_ADMIN_HTML)
  Object.defineProperty(document, "hidden", { value: false, writable: true })
  const timers = new Map()
  const storage = new Map()
  window.setTimeout = (fn) => {
    const id = Symbol()
    timers.set(id, fn)
    return id
  }
  window.clearTimeout = (id) => timers.delete(id)
  window.localStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  }
  new Script(client).runInNewContext({ window })
  const asset = {
    gene_symbol: "GENE",
    emulsion_id: "A9-42",
    asset_sha256: "a",
    width: 896,
    height: 1152,
    created_at: "2026-08-27 12:00:00",
    full_url: "/full-a",
    thumb_url: "/thumb-a",
    status: "draft",
  }
  let next = {
    ok: true,
    belts: [
      {
        code: "A9",
        label: "Aesthetic",
        status: "accepted",
        active: true,
        open_count: 1,
        outputs: [asset],
      },
      { code: "E9", label: "Turbo 1.0", status: "retired", open_count: 0, outputs: [asset] },
      { code: "O9", label: "Turbo 1.1", status: "accepted", open_count: 0, outputs: [] },
    ],
  }
  let calls = 0
  const controller = window.IconoplasmFactoryBelts.create({
    document,
    escapeHtml: (value) =>
      String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    fetchPayload: async () => {
      calls++
      return structuredClone(next)
    },
    onViewChange: () => {},
  })
  return { window, document, controller, timers, storage, next, calls: () => calls }
}

const settle = () => new Promise(setImmediate)

test("belts reuse PhotoSwipe groups, preserve native dimensions and expose empty/retired filters", async () => {
  const { window, document, controller } = browserFixture()
  controller.mount()
  await settle()
  assert.equal(document.querySelectorAll(".factory-belt").length, 1)
  const trigger = document.querySelector("#factory-belts [data-icono-pswp]")
  assert.equal(trigger.dataset.iconoPswpSrc, "/full-a")
  assert.equal(trigger.dataset.pswpWidth, "896")
  assert.ok(trigger.closest("[data-icono-lightbox]"))
  const filter = document.getElementById("factory-belts-filter")
  function choose(value) {
    for (const option of filter.querySelectorAll("option")) option.selected = option.value === value
    filter.dispatchEvent(new window.Event("change"))
  }
  choose("all")
  assert.equal(document.querySelectorAll(".factory-belt").length, 2)
  assert.match(
    document.querySelector('[data-factory-code="O9"]').textContent,
    /No published outputs/,
  )
  choose("retired")
  assert.equal(document.querySelectorAll(".factory-belt").length, 1)
  assert.equal(document.querySelector(".factory-belt").dataset.factoryCode, "E9")
  controller.unmount()
})

test("background updates do not shuffle output images and hidden tabs stop polling", async () => {
  const { window, document, controller, timers, next, calls } = browserFixture()
  controller.mount()
  await settle()
  assert.equal(timers.size, 1)
  next.belts[0].outputs[0].thumb_url = "/thumb-b"
  const callback = [...timers.values()][0]
  timers.clear()
  callback()
  await settle()
  assert.equal(document.querySelector("#factory-belts img").getAttribute("src"), "/thumb-a")
  assert.equal(document.getElementById("factory-belts-updates").hidden, false)
  assert.equal(timers.size, 0)
  document.getElementById("factory-belts-updates").dispatchEvent(new window.Event("click"))
  assert.equal(document.querySelector("#factory-belts img").getAttribute("src"), "/thumb-b")
  document.hidden = true
  document.dispatchEvent(new window.Event("visibilitychange"))
  assert.equal(timers.size, 0)
  controller.unmount()
  assert.equal(document.querySelectorAll("#factory-belts img").length, 0)
  assert.equal(calls(), 2)
})

test("returning to an idle belt rechecks freshness and pins are local-only", async () => {
  const { window, document, controller, timers, next, calls, storage } = browserFixture()
  next.belts[0].open_count = 0
  controller.mount()
  await settle()
  assert.equal(timers.size, 0)
  document.querySelector('[data-factory-pin="A9"]').click()
  assert.deepEqual(JSON.parse(storage.get("iconoplasm.factory-pins")), ["A9"])
  assert.equal(calls(), 1)
  assert.equal(
    document.querySelector('[data-factory-pin="A9"]').getAttribute("aria-pressed"),
    "true",
  )
  document.hidden = true
  document.dispatchEvent(new window.Event("visibilitychange"))
  next.belts[0].outputs[0].thumb_url = "/new-idle-output"
  document.hidden = false
  document.dispatchEvent(new window.Event("visibilitychange"))
  await settle()
  assert.equal(calls(), 2)
  assert.equal(document.querySelector("#factory-belts img").getAttribute("src"), "/thumb-a")
  assert.equal(document.getElementById("factory-belts-updates").hidden, false)
  controller.unmount()
})

test("manual refresh defers replacement while the shared viewer is open", async () => {
  const { document, controller, next } = browserFixture()
  controller.mount()
  await settle()
  const lightbox = document.createElement("div")
  lightbox.className = "pswp"
  document.body.append(lightbox)
  next.belts[0].outputs[0].thumb_url = "/new-output"
  await controller.refresh()
  document.getElementById("factory-belts-updates").click()
  assert.equal(document.querySelector("#factory-belts img").getAttribute("src"), "/thumb-a")
  lightbox.remove()
  document.getElementById("factory-belts-updates").click()
  assert.equal(document.querySelector("#factory-belts img").getAttribute("src"), "/new-output")
  controller.unmount()
})

test("DO NOT DELETE: factory belts load before admin and reuse the shared viewer", () => {
  assert.ok(
    ICONOPLASM_ADMIN_HTML.indexOf("/factory-belts.js?") <
      ICONOPLASM_ADMIN_HTML.indexOf("/admin.js?"),
  )
  assert.match(ICONOPLASM_ADMIN_HTML, /lightbox-bootstrap\.js/)
  assert.doesNotMatch(client, /new PhotoSwipe|createElement\(["'](?:dialog|canvas)/)
})
