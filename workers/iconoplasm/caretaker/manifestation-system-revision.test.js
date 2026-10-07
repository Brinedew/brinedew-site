import assert from "node:assert/strict"
import test from "node:test"

import {
  bodyEnvironment,
  bootstrap,
  browserRequest,
  geneRevision,
  humanHandler,
  installBunnyFake,
  readJson,
  row,
  serviceRequest,
  sha256,
  workstationHandler,
} from "./manifestation-plaintext-test-support.js"
import { catalogueGeneId } from "./manifestation-authority-service-handlers.js"

// B-1011: the workstation's regenerated text reaches the site through one
// service command, the standing form of B-994's one-off migration. Ways it can
// fail, written before the route:
// 1. the new text does not become canonical while the system text is;
// 2. it overwrites a caretaker's canonical version;
// 3. its Tags are not the version's accepted Tags, or a body is not plain text;
// 4. a replay writes a second revision;
// 5. a stale request (the gene moved since the workstation read it) writes anything;
// 6. a browser session reaches the route.

const PROSE = "A regenerated archivist in a Barbiecore coat, careful and bright."
const TAGS = "pink coat, careful gaze"
const FIELDS = { outfit: ["pink coat"], face: ["careful gaze"] }

function head(context) {
  return row(
    context.db,
    `SELECT head_version, canonical_revision_id, canonical_manifestation_id, gene_revision
       FROM icono_manifestation_heads WHERE gene_id = ?`,
    context.geneId,
  )
}

function systemLineage(context) {
  return row(
    context.db,
    `SELECT manifestation_id, manifestation_head_revision_id, row_version
       FROM icono_manifestations WHERE gene_id = ? AND origin = 'system_seed'`,
    context.geneId,
  )
}

async function regeneration(context, commandId, overrides = {}) {
  const now = head(context)
  return {
    command_id: commandId,
    prose: PROSE,
    tags_text: TAGS,
    tags_sha256: await sha256(TAGS),
    fields_json: FIELDS,
    fields_sha256: await sha256('{"face":["careful gaze"],"outfit":["pink coat"]}'),
    recipe_id: "manifestation-tagger-json-categories",
    recipe_version: "1",
    provider_id: "opencode",
    model_id: "deepseek-v4.1-flash",
    tagger_config_sha256: "9".repeat(64),
    expected_head_version: now.head_version,
    expected_canonical_revision_id: now.canonical_revision_id,
    expected_system_revision_id: systemLineage(context).manifestation_head_revision_id,
    ...overrides,
  }
}

function counts(context) {
  return row(
    context.db,
    `SELECT (SELECT COUNT(*) FROM icono_manifestation_revisions) AS revisions,
            (SELECT COUNT(*) FROM icono_manifestation_events) AS events,
            (SELECT COUNT(*) FROM icono_authoring_command_receipts) AS receipts`,
  )
}

test("1, 3, 4: a regeneration of the canonical system text becomes canonical, with its Tags, once", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8301", bunny)
  const env = bodyEnvironment({ withKey: false })
  const workstation = workstationHandler(context, env)
  const before = head(context)
  const lineage = systemLineage(context)
  assert.equal(before.canonical_manifestation_id, lineage.manifestation_id)
  const path = `/api/iconoplasm/authority/genes/${context.geneId}/system-revisions`

  const body = await regeneration(context, "service_system_8301")
  const response = await workstation(serviceRequest(path, body))
  assert.ok([200, 202].includes(response.status), `answered ${response.status}`)
  const result = await readJson(response)
  assert.equal(result.canonical_changed, true)
  assert.equal(result.revision_number, 2)

  const after = head(context)
  assert.equal(after.canonical_revision_id, result.manifestation_revision_id)
  assert.equal(after.head_version, before.head_version + 1)
  assert.equal(after.gene_revision, before.gene_revision + 1)
  assert.equal(
    systemLineage(context).manifestation_head_revision_id,
    result.manifestation_revision_id,
  )
  assert.equal(systemLineage(context).row_version, lineage.row_version + 1)

  const tags = row(
    context.db,
    `SELECT head.accepted_derivative_id, storage.object_key
       FROM icono_manifestation_derivative_heads head
       JOIN icono_manifestation_derivative_storage_secrets storage
         ON storage.manifestation_derivative_id = head.accepted_derivative_id
      WHERE head.manifestation_revision_id = ?`,
    result.manifestation_revision_id,
  )
  assert.equal(tags.accepted_derivative_id, result.manifestation_derivative_id)
  assert.equal(
    new TextDecoder().decode(bunny.objects.get(tags.object_key)),
    'pink coat, careful gaze\n{"face":["careful gaze"],"outfit":["pink coat"]}',
  )
  const prose = row(
    context.db,
    "SELECT object_key FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
    result.manifestation_revision_id,
  )
  assert.equal(new TextDecoder().decode(bunny.objects.get(prose.object_key)), PROSE)

  // One event carries the whole change.
  const event = row(
    context.db,
    "SELECT payload_json FROM icono_manifestation_events ORDER BY event_sequence DESC LIMIT 1",
  )
  const payload = JSON.parse(event.payload_json)
  assert.equal(payload.cause, "manifestation.system_revision_appended")
  assert.equal(payload.changed_revision.manifestation_revision_id, result.manifestation_revision_id)
  assert.equal(payload.changed_derivative.manifestation_derivative_id, tags.accepted_derivative_id)
  assert.equal(payload.derivative_head.derivative_head_version, 1)
  assert.equal(payload.changed_selection.selected_revision_id, result.manifestation_revision_id)

  // 4. The same command again replays the first answer and writes nothing.
  const written = counts(context)
  const replay = await readJson(await workstation(serviceRequest(path, body)))
  assert.equal(replay.manifestation_revision_id, result.manifestation_revision_id)
  assert.deepEqual(counts(context), written)
})

test("2, 5: a caretaker's canonical version keeps winning, and a stale request writes nothing", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8302", bunny)
  const env = bodyEnvironment({ withKey: false })
  const human = humanHandler(context, env)
  const workstation = workstationHandler(context, env)
  const path = `/api/iconoplasm/authority/genes/${context.geneId}/system-revisions`

  // 5. The workstation read the gene, then something moved it.
  const stale = await regeneration(context, "service_system_stale_8302", {
    expected_head_version: head(context).head_version + 7,
  })
  const untouched = counts(context)
  const refused = await workstation(serviceRequest(path, stale))
  assert.equal(refused.status, 409)
  assert.deepEqual(counts(context), untouched)

  // 2. The caretaker's version is canonical; the regeneration only joins History.
  // Only a save with Tags makes the caretaker's version canonical.
  const caretakerSave = await human(
    browserRequest("/api/iconoplasm/caretaker/genes/P8302/saves", {
      command_id: "browser_caretaker_8302",
      prose: "The caretaker's own words.",
      tags_text: "linen coat",
      fields_json: { outfit: ["linen coat"] },
      expected_assignment_version: 2,
      expected_manifestation_version: 0,
      expected_head_version: head(context).head_version,
      expected_canonical_revision_id: head(context).canonical_revision_id,
    }),
  )
  assert.ok([200, 202].includes(caretakerSave.status), `caretaker save ${caretakerSave.status}`)
  assert.notEqual(head(context).canonical_manifestation_id, systemLineage(context).manifestation_id)
  const caretakerHead = row(
    context.db,
    `SELECT h.canonical_revision_id FROM icono_manifestation_heads h WHERE h.gene_id = ?`,
    context.geneId,
  )
  const canonicalBefore = head(context)
  const result = await readJson(
    await workstation(serviceRequest(path, await regeneration(context, "service_system_8302"))),
  )
  assert.equal(result.canonical_changed, false)
  const after = head(context)
  assert.equal(after.canonical_revision_id, canonicalBefore.canonical_revision_id)
  assert.equal(after.canonical_revision_id, caretakerHead.canonical_revision_id)
  assert.equal(after.head_version, canonicalBefore.head_version)
  assert.equal(after.gene_revision, geneRevision(context))
  assert.equal(
    systemLineage(context).manifestation_head_revision_id,
    result.manifestation_revision_id,
  )
})

// The service bearer check is the shared requireAuthorityBearer of every
// /authority/ route; the test handler authorizes any bearer by design.
test("6: a browser session cannot reach the system revision route", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8303", bunny)
  const env = bodyEnvironment({ withKey: false })
  const human = humanHandler(context, env)
  const path = `/api/iconoplasm/authority/genes/${context.geneId}/system-revisions`
  const body = await regeneration(context, "browser_system_8303")
  const viaHuman = await human(browserRequest(path, body))
  assert.ok(
    viaHuman == null || viaHuman.status >= 400,
    `browser handler answered ${viaHuman?.status}`,
  )
})

// B-1031: a gene new to the catalogue has no identity and no system text on the
// site. Ways it can fail, written before the change:
// 7. the first regeneration is refused (SYSTEM_LINEAGE_NOT_FOUND), so new genes
//    can never get a text;
// 8. it registers the gene but the text isn't canonical, or arrives without Tags;
// 9. a replay seeds a second lineage;
// 10. a caller registers an ID not derived from the symbol;
// 11. the next regeneration doesn't append to the seeded lineage.
test("7-11: a gene new to the catalogue gets its identity and first system text, with Tags", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8311", bunny)
  const env = bodyEnvironment({ withKey: false })
  const workstation = workstationHandler(context, env)
  const symbol = "EXOC1L"
  const geneId = await catalogueGeneId(symbol)
  const path = `/api/iconoplasm/authority/genes/${geneId}/system-revisions`
  const newGene = (commandId, overrides = {}) =>
    regeneration(context, commandId, {
      canonical_symbol: symbol,
      expected_head_version: 0,
      expected_canonical_revision_id: null,
      expected_system_revision_id: null,
      ...overrides,
    })

  // 10. An ID that isn't derived from the symbol is refused before anything is written.
  const untouched = counts(context)
  const forged = await workstation(
    serviceRequest(`/api/iconoplasm/authority/genes/gene_${"0".repeat(48)}/system-revisions`, {
      ...(await newGene("service_forged_8311")),
    }),
  )
  assert.equal(forged.status, 400)
  assert.deepEqual(counts(context), untouched)

  // 7, 8. One regeneration registers the gene and seeds its canonical text with Tags.
  const body = await newGene("service_new_gene_8311")
  const response = await workstation(serviceRequest(path, body))
  assert.ok([200, 202].includes(response.status), `answered ${response.status}`)
  const result = await readJson(response)
  assert.equal(result.revision_number, 1)
  assert.equal(result.canonical_changed, true)
  const identity = row(
    context.db,
    "SELECT canonical_symbol FROM icono_gene_identities WHERE gene_id = ?",
    geneId,
  )
  assert.equal(identity.canonical_symbol, symbol)
  const geneHead = row(
    context.db,
    "SELECT head_version, canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
    geneId,
  )
  assert.equal(geneHead.canonical_revision_id, result.manifestation_revision_id)
  assert.equal(geneHead.head_version, 1)
  const lineage = row(
    context.db,
    `SELECT manifestation_head_revision_id FROM icono_manifestations
      WHERE gene_id = ? AND origin = 'system_seed' AND status = 'active'`,
    geneId,
  )
  assert.equal(lineage.manifestation_head_revision_id, result.manifestation_revision_id)
  const tags = row(
    context.db,
    "SELECT accepted_derivative_id FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?",
    result.manifestation_revision_id,
  )
  assert.equal(tags.accepted_derivative_id, result.manifestation_derivative_id)
  const event = row(
    context.db,
    "SELECT payload_json FROM icono_manifestation_events ORDER BY event_sequence DESC LIMIT 1",
  )
  assert.equal(JSON.parse(event.payload_json).cause, "manifestation.system_seed_created")

  // 9. The same command again replays the first answer and writes nothing.
  const written = counts(context)
  const replay = await readJson(await workstation(serviceRequest(path, body)))
  assert.equal(replay.manifestation_revision_id, result.manifestation_revision_id)
  assert.deepEqual(counts(context), written)

  // 11. The next regeneration appends revision 2 to the seeded lineage.
  const next = await readJson(
    await workstation(
      serviceRequest(
        path,
        await newGene("service_new_gene_next_8311", {
          expected_head_version: 1,
          expected_canonical_revision_id: result.manifestation_revision_id,
          expected_system_revision_id: result.manifestation_revision_id,
        }),
      ),
    ),
  )
  assert.equal(next.revision_number, 2)
  assert.equal(next.canonical_changed, true)
})
