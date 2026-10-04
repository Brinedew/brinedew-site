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
  saveProse,
  serviceRequest,
  sha256,
  workstationHandler,
} from "./manifestation-plaintext-test-support.js"

// B-859: a caretaker's prose and Tags are published or fed to image generation,
// so the private object zone holds them as plain UTF-8. Failure modes, written
// before the code:
// 1. A save encrypts (the stored object is not the text, or the save needs a
//    key secret).
// 2. A damaged object is accepted: plain bytes that differ from the hash in
//    their row must be refused loudly.
// 3. The authority schema refuses a plain row: its size CHECK needs at least 17
//    bytes and its insert trigger needs the text length + 16, so the shortest
//    bodies are the ones that would fail.

const ENCODER = new TextEncoder()

function plainBytes(text) {
  return ENCODER.encode(text.normalize("NFC").replace(/\r\n?/g, "\n"))
}

function sameBytes(left, right) {
  return Buffer.from(left).equals(Buffer.from(right))
}

test("a new caretaker save stores the prose as plain text and needs no key", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8101", bunny)
  const env = bodyEnvironment()
  const handler = humanHandler(context, env)
  const prose = "A caretaker's manifestation.\r\nSecond line, with café."

  const { manifestation_revision_id: revisionId } = await saveProse(
    handler,
    "P8101",
    "browser_plain_save_8101",
    prose,
  )

  const stored = row(
    context.db,
    `SELECT storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
            revision.body_sha256, revision.body_bytes
       FROM icono_manifestation_revision_storage_secrets storage
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = storage.manifestation_revision_id
      WHERE revision.manifestation_revision_id = ?`,
    revisionId,
  )
  const expected = plainBytes(prose)
  assert.ok(
    sameBytes(bunny.objects.get(stored.object_key), expected),
    "the private object is exactly the normalized UTF-8 prose",
  )
  assert.equal(stored.body_sha256, await sha256(new TextDecoder().decode(expected)))
  assert.equal(stored.body_bytes, expected.byteLength)
  // The row names the object's hash. Its size column keeps the envelope shape
  // (text length + 16) that the schema's CHECK and insert trigger require.
  assert.equal(stored.ciphertext_sha256, stored.body_sha256)
  assert.equal(stored.ciphertext_bytes, stored.body_bytes + 16)

  const body = await readJson(
    await handler(
      new Request(
        `https://iconoplasm.test/api/iconoplasm/caretaker/genes/P8101/revisions/${revisionId}/body`,
      ),
    ),
  )
  assert.equal(body.prose, new TextDecoder().decode(expected))
})

test("new Tags saves, from the caretaker panel and from the workstation, store plain text", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8102", bunny)
  const env = bodyEnvironment()
  const human = humanHandler(context, env)
  const workstation = workstationHandler(context, env)
  const { manifestation_revision_id: revisionId } = await saveProse(
    human,
    "P8102",
    "browser_plain_tags_prose_8102",
    "A manifestation that Tags will describe.",
  )
  const revision = row(
    context.db,
    "SELECT body_sha256 FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
    revisionId,
  )

  // The caretaker panel.
  const submitted = await human(
    browserRequest(
      `/api/iconoplasm/caretaker/genes/P8102/revisions/${revisionId}/tags-derivatives`,
      {
        command_id: "browser_plain_tags_8102",
        tags_text: "red coat, careful gaze",
        fields_json: { outfit: ["red coat"], face: ["careful gaze"] },
        expected_gene_revision: geneRevision(context),
      },
    ),
  )
  assert.ok([200, 202].includes(submitted.status), `Tags save answered ${submitted.status}`)
  const derivative = await submitted.json()
  const humanRow = row(
    context.db,
    `SELECT storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
            derivative.body_sha256, derivative.body_bytes
       FROM icono_manifestation_derivative_storage_secrets storage
       JOIN icono_manifestation_derivatives derivative
         ON derivative.manifestation_derivative_id = storage.manifestation_derivative_id
      WHERE derivative.manifestation_derivative_id = ?`,
    derivative.manifestation_derivative_id,
  )
  const humanObject = new TextDecoder().decode(bunny.objects.get(humanRow.object_key))
  assert.equal(
    humanObject,
    'red coat, careful gaze\n{"face":["careful gaze"],"outfit":["red coat"]}',
  )
  assert.equal(humanRow.ciphertext_sha256, humanRow.body_sha256)
  assert.equal(humanRow.ciphertext_bytes, humanRow.body_bytes + 16)

  // The workstation's Tags enrichment goes through the service route.
  const tagsText = "green eyes"
  const fieldsJson = { traits: ["green eyes"] }
  const posted = await readJson(
    await workstation(
      serviceRequest(`/api/iconoplasm/authority/revisions/${revisionId}/tags-derivatives`, {
        command_id: "service_plain_tags_8102",
        status: "complete",
        source_body_sha256: revision.body_sha256,
        tags_text: tagsText,
        tags_sha256: await sha256(tagsText),
        fields_json: fieldsJson,
        fields_sha256: await sha256('{"traits":["green eyes"]}'),
        recipe_id: "tags_recipe",
        recipe_version: "v1",
        provider_id: "provider",
        model_id: "model",
        tagger_config_sha256: "9".repeat(64),
        expected_gene_revision: geneRevision(context),
      }),
    ),
  )
  const serviceRow = row(
    context.db,
    "SELECT object_key FROM icono_manifestation_derivative_storage_secrets WHERE manifestation_derivative_id = ?",
    posted.manifestation_derivative_id,
  )
  assert.equal(
    new TextDecoder().decode(bunny.objects.get(serviceRow.object_key)),
    'green eyes\n{"traits":["green eyes"]}',
  )
  const materialResponse = await workstation(
    serviceRequest(
      `/api/iconoplasm/authority/derivatives/${posted.manifestation_derivative_id}/body`,
    ),
  )
  assert.equal(materialResponse.headers.get("cache-control"), "private, no-store")
  const material = await readJson(materialResponse)
  assert.equal(material.tags_text, tagsText)
  assert.deepEqual(material.fields_json, fieldsJson)
  // The body carries no storage metadata: sizes and keys stay in the authority.
  assert.deepEqual(Object.keys(material).sort(), [
    "entity_kind",
    "fields_json",
    "fields_sha256",
    "manifestation_derivative_id",
    "manifestation_revision_id",
    "output_plain_bytes",
    "output_plain_sha256",
    "schema_version",
    "tags_sha256",
    "tags_text",
  ])

  // A damaged Tags object is refused and reported, never returned.
  const damaged = Uint8Array.from(bunny.objects.get(serviceRow.object_key))
  damaged[0] ^= 0xff
  bunny.objects.set(serviceRow.object_key, damaged)
  const failures = []
  const damagedRead = await workstationHandler(context, env, {
    onIntegrityFailure: async (descriptor) => {
      failures.push(descriptor)
    },
  })(
    serviceRequest(
      `/api/iconoplasm/authority/derivatives/${posted.manifestation_derivative_id}/body`,
    ),
  )
  assert.equal(damagedRead.status, 503)
  assert.equal((await damagedRead.json()).error.code, "DERIVATIVE_BODY_UNAVAILABLE")
  assert.equal(failures.at(-1).entity_id, posted.manifestation_derivative_id)
})

test("a plain body whose bytes miss the hash in its row is refused", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8105", bunny)
  const failures = []
  const record = async (descriptor) => {
    failures.push(descriptor)
  }

  // Plain bytes of the right length whose content is not what the row hashed.
  const human = humanHandler(context, bodyEnvironment())
  const saved = await saveProse(human, "P8105", "browser_damaged_save_8105", "Exact words.")
  const plainKey = row(
    context.db,
    "SELECT object_key FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
    saved.manifestation_revision_id,
  ).object_key
  bunny.objects.set(plainKey, ENCODER.encode("Wrong words."))
  const tampered = await workstationHandler(context, bodyEnvironment(), {
    onIntegrityFailure: record,
  })(serviceRequest(`/api/iconoplasm/authority/revisions/${saved.manifestation_revision_id}/body`))
  assert.equal(tampered.status, 503)
  assert.equal(failures.at(-1).entity_id, saved.manifestation_revision_id)
})

// The storage tables require ciphertext_bytes of at least 17 and an insert
// trigger requires plaintext length + 16, a rule written for envelopes. A plain
// row has to satisfy both, so the shortest bodies are the ones that would break.
test("a one-byte manifestation and a four-byte Tags body save and read back", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8106", bunny)
  const env = bodyEnvironment()
  const human = humanHandler(context, env)
  const workstation = workstationHandler(context, env)

  const { manifestation_revision_id: revisionId } = await saveProse(
    human,
    "P8106",
    "browser_tiny_prose_8106",
    "A",
  )
  const storedProse = row(
    context.db,
    "SELECT object_key FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
    revisionId,
  )
  assert.equal(new TextDecoder().decode(bunny.objects.get(storedProse.object_key)), "A")
  assert.equal(
    (
      await readJson(
        await workstation(serviceRequest(`/api/iconoplasm/authority/revisions/${revisionId}/body`)),
      )
    ).body_plain,
    "A",
  )

  const revision = row(
    context.db,
    "SELECT body_sha256 FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
    revisionId,
  )
  const submitted = await readJson(
    await workstation(
      serviceRequest(`/api/iconoplasm/authority/revisions/${revisionId}/tags-derivatives`, {
        command_id: "service_tiny_tags_8106",
        status: "complete",
        source_body_sha256: revision.body_sha256,
        tags_text: "a",
        tags_sha256: await sha256("a"),
        fields_json: {},
        fields_sha256: await sha256("{}"),
        recipe_id: "tags_recipe",
        recipe_version: "v1",
        provider_id: "provider",
        model_id: "model",
        tagger_config_sha256: "9".repeat(64),
        expected_gene_revision: geneRevision(context),
      }),
    ),
  )
  const storedTags = row(
    context.db,
    "SELECT object_key FROM icono_manifestation_derivative_storage_secrets WHERE manifestation_derivative_id = ?",
    submitted.manifestation_derivative_id,
  )
  assert.equal(new TextDecoder().decode(bunny.objects.get(storedTags.object_key)), "a\n{}")
  const material = await readJson(
    await workstation(
      serviceRequest(
        `/api/iconoplasm/authority/derivatives/${submitted.manifestation_derivative_id}/body`,
      ),
    ),
  )
  assert.equal(material.tags_text, "a")
  assert.deepEqual(material.fields_json, {})
})
