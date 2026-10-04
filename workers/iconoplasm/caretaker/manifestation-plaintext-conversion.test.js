import assert from "node:assert/strict"
import test from "node:test"

import {
  PLAINTEXT_CHECK_MAX_BODIES,
  PLAINTEXT_CONVERSION_MAX_BODIES,
  PLAINTEXT_CONVERSION_WORST_CASE_FETCHES,
  convertManifestationBodies,
} from "./manifestation-plaintext-conversion.js"
import {
  bodyEnvironment,
  bootstrap,
  humanHandler,
  installBunnyFake,
  lineageVersion,
  readJson,
  row,
  saveProse,
  seedLegacyRevision,
  seedLegacyTags,
  sha256,
  workstationHandler,
} from "./manifestation-plaintext-test-support.js"

// B-859: the one-shot rewrite of the 38,487 envelope objects (19,245 prose,
// 19,242 Tags) into plain text, run inside the Worker because only the Worker
// holds the key. It writes no D1 row: the cursor is the storage row's id, handed
// back to the caller. Failure modes, written before the code:
// 1. A body is rewritten wrongly: the new object is not the exact text, or the
//    reader sees something other than the old body.
// 2. A rerun is not idempotent: a second pass rewrites objects that are
//    already plain, or loses its place.
// 3. A failed write loses the old body: the PUT is refused, or "succeeds" but
//    stores garbage, and the object is neither readable as before nor restored.
// 4. A read-after-write that still shows the old envelope is taken as a
//    failure of the write (it is Bunny's documented stale window), or as proof
//    of success. Bunny can acknowledge a PUT and keep serving the old object,
//    so ONE PUT is not enough: the first night's single PUT left 1,499 of 1,500
//    bodies as envelopes. The identical PUT is repeated until a read shows the
//    plain text, and a store that never applies it leaves the old envelope
//    untouched and reports "unverified".
// 5. One call spends more subrequests than a free-plan Worker has (50), or the
//    response carries body text. A call that writes converts ONE body: six PUTs
//    and their read-backs need 41 fetches.
// 6. Check mode writes, or counts an envelope as plain.

const NO_WAIT = { sleep: async () => {} }
const PROSE = "A legacy manifestation with café and\nan interior line break."

async function sweep(
  context,
  env,
  kind,
  { execute = true, limit = execute ? 1 : 10, ...options } = {},
) {
  const calls = []
  let after = ""
  for (let guard = 0; guard < 50; guard += 1) {
    const result = await convertManifestationBodies(context.db, env, {
      kind,
      after,
      limit,
      execute,
      ...NO_WAIT,
      ...options,
    })
    calls.push(result)
    if (result.done) break
    after = result.next_after
  }
  const total = (field) => calls.reduce((sum, call) => sum + call[field], 0)
  return {
    calls,
    scanned: total("scanned"),
    plaintext: total("plaintext"),
    converted: total("converted"),
    legacy: total("legacy"),
    unverified: total("unverified"),
    puts: total("puts"),
    failed: calls.flatMap((call) => call.failed),
  }
}

// The seed plus two legacy caretaker revisions and two legacy Tags bodies, and
// one revision and one Tags body written as plain text by today's code.
async function mixedGene(t, suffix) {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, suffix, bunny)
  const keyed = bodyEnvironment()
  const first = await seedLegacyRevision(context, keyed, bunny, {
    name: `${suffix}a`,
    prose: PROSE,
  })
  const second = await seedLegacyRevision(context, keyed, bunny, {
    name: `${suffix}b`,
    prose: "A second legacy draft.",
    first: false,
  })
  const tagsA = await seedLegacyTags(context, keyed, bunny, {
    name: `${suffix}a`,
    revisionId: first.revisionId,
    sourceBodySha256: first.body_sha256,
    tagsText: "silver braid, ink-stained cuffs",
    fieldsJson: { hair: ["silver braid"], outfit: ["ink-stained cuffs"] },
  })
  const tagsB = await seedLegacyTags(context, keyed, bunny, {
    name: `${suffix}b`,
    revisionId: second.revisionId,
    sourceBodySha256: second.body_sha256,
    tagsText: "green eyes",
    fieldsJson: { face: ["green eyes"] },
  })
  const keyless = bodyEnvironment({ withKey: false })
  const human = humanHandler(context, keyless)
  const plain = await saveProse(
    human,
    `P${suffix}`,
    `browser_plain_${suffix}`,
    "A manifestation saved after the change.",
    lineageVersion(context, `manifestation_legacy_${suffix}a`),
  )
  return { bunny, context, keyed, keyless, first, second, tagsA, tagsB, plain, human }
}

// The cursor that makes a one-body call land on this legacy revision.
function cursorBefore(context, revisionId) {
  return (
    row(
      context.db,
      `SELECT manifestation_revision_id AS id FROM icono_manifestation_revision_storage_secrets
        WHERE manifestation_revision_id < ? ORDER BY manifestation_revision_id DESC LIMIT 1`,
      revisionId,
    )?.id ?? ""
  )
}

function objectKeyOf(context, table, idColumn, id) {
  return row(context.db, `SELECT object_key FROM ${table} WHERE ${idColumn} = ?`, id).object_key
}

test("every legacy body of both kinds is rewritten as exact plain text and reads the same afterwards", async (t) => {
  const g = await mixedGene(t, "8201")
  const before = {
    seed: g.bunny.objects.get(g.context.seedObjectKey),
    first: g.bunny.objects.get(g.first.objectKey),
  }

  const revisions = await sweep(g.context, g.keyed, "revision")
  assert.deepEqual(
    [revisions.scanned, revisions.converted, revisions.plaintext, revisions.failed],
    [4, 3, 1, []],
  )
  const derivatives = await sweep(g.context, g.keyed, "derivative")
  assert.deepEqual(
    [derivatives.scanned, derivatives.converted, derivatives.plaintext, derivatives.failed],
    [2, 2, 0, []],
  )

  // The objects are now the exact text, and not the old envelope.
  assert.equal(new TextDecoder().decode(g.bunny.objects.get(g.first.objectKey)), g.first.prose)
  assert.equal(
    new TextDecoder().decode(g.bunny.objects.get(g.context.seedObjectKey)),
    g.context.seed.prose,
  )
  assert.notDeepEqual(g.bunny.objects.get(g.first.objectKey), before.first)
  assert.equal(new TextDecoder().decode(g.bunny.objects.get(g.tagsA.objectKey)), g.tagsA.tags)
  assert.equal(
    await sha256(new TextDecoder().decode(g.bunny.objects.get(g.tagsB.objectKey))),
    g.tagsB.body_sha256,
  )

  // Every reader still returns what it returned before, with the key gone.
  const workstation = workstationHandler(g.context, g.keyless, {
    onIntegrityFailure: (descriptor) => assert.fail(JSON.stringify(descriptor)),
  })
  for (const entry of [g.first, g.second]) {
    const body = await readJson(
      await workstation(
        new Request(
          `https://iconoplasm.test/api/iconoplasm/authority/revisions/${entry.revisionId}/body`,
          { headers: { authorization: "Bearer test-service" } },
        ),
      ),
    )
    assert.equal(body.body_plain, entry.prose)
  }
  const tags = await readJson(
    await workstation(
      new Request(
        `https://iconoplasm.test/api/iconoplasm/authority/derivatives/${g.tagsA.derivativeId}/body`,
        { headers: { authorization: "Bearer test-service" } },
      ),
    ),
  )
  assert.equal(tags.tags_text, "silver braid, ink-stained cuffs")
  assert.equal(
    (
      await readJson(
        await g.human(
          new Request(
            `https://iconoplasm.test/api/iconoplasm/caretaker/genes/P8201/revisions/${g.plain.manifestation_revision_id}/body`,
          ),
        ),
      )
    ).prose,
    "A manifestation saved after the change.",
  )
})

test("a second pass writes nothing, and a pass can resume from any cursor", async (t) => {
  const g = await mixedGene(t, "8202")
  await sweep(g.context, g.keyed, "revision")
  await sweep(g.context, g.keyed, "derivative")
  g.bunny.clearLog()

  const again = await sweep(g.context, g.keyed, "revision")
  assert.deepEqual([again.converted, again.plaintext, again.failed], [0, 4, []])
  const againTags = await sweep(g.context, g.keyed, "derivative")
  assert.deepEqual([againTags.converted, againTags.plaintext, againTags.failed], [0, 2, []])
  assert.equal(g.bunny.count("PUT"), 0, "already-plain objects are never written again")
  assert.equal(g.bunny.count("DELETE"), 0)

  // Pages cover every row exactly once and the cursor is the last row's id.
  const first = await convertManifestationBodies(g.context.db, g.keyed, {
    kind: "revision",
    after: "",
    limit: 3,
    execute: false,
    ...NO_WAIT,
  })
  assert.equal(first.scanned, 3)
  assert.equal(first.done, false)
  const rest = await convertManifestationBodies(g.context.db, g.keyed, {
    kind: "revision",
    after: first.next_after,
    limit: 3,
    execute: false,
    ...NO_WAIT,
  })
  assert.equal(rest.scanned, 1)
  assert.equal(rest.done, true)
  assert.ok(first.next_after < rest.next_after)
})

test("check mode counts envelopes without writing, needs no key and trusts only the hash", async (t) => {
  const g = await mixedGene(t, "8203")
  g.bunny.clearLog()
  const revisions = await sweep(g.context, g.keyless, "revision", { execute: false })
  assert.deepEqual(
    [revisions.legacy, revisions.plaintext, revisions.converted, revisions.failed],
    [3, 1, 0, []],
  )
  const derivatives = await sweep(g.context, g.keyless, "derivative", { execute: false })
  assert.deepEqual([derivatives.legacy, derivatives.plaintext], [2, 0])
  assert.equal(g.bunny.count("PUT"), 0)

  // Damage one object: it is reported, not counted as legacy or as plain.
  const damaged = Uint8Array.from(g.bunny.objects.get(g.first.objectKey))
  damaged[3] ^= 0xff
  g.bunny.objects.set(g.first.objectKey, damaged)
  g.bunny.objects.delete(g.second.objectKey)
  const found = await sweep(g.context, g.keyless, "revision", { execute: false })
  assert.deepEqual(
    found.failed.map((entry) => [entry.id, entry.code]).sort(),
    [
      [g.first.revisionId, "integrity"],
      [g.second.revisionId, "object_missing"],
    ].sort(),
  )
  assert.equal(found.legacy, 1)
})

test("a refused write leaves the old envelope in place and readable", async (t) => {
  const g = await mixedGene(t, "8204")
  const original = Uint8Array.from(g.bunny.objects.get(g.first.objectKey))
  g.bunny.rules.push(({ method, objectKey }) =>
    method === "PUT" && objectKey === g.first.objectKey
      ? new Response(null, { status: 503 })
      : undefined,
  )
  const result = await sweep(g.context, g.keyed, "revision")
  assert.deepEqual(
    result.failed.map((entry) => [entry.id, entry.code]),
    [[g.first.revisionId, "write"]],
  )
  assert.equal(result.converted, 2, "the other legacy bodies were still converted")
  assert.deepEqual(g.bunny.objects.get(g.first.objectKey), original)
  assert.equal(
    g.bunny.log.filter((entry) => entry.method === "PUT" && entry.objectKey === g.first.objectKey)
      .length,
    6,
    "a refused PUT spends one of the six attempts, then the body is reported",
  )

  const workstation = workstationHandler(g.context, g.keyed)
  const body = await readJson(
    await workstation(
      new Request(
        `https://iconoplasm.test/api/iconoplasm/authority/revisions/${g.first.revisionId}/body`,
        { headers: { authorization: "Bearer test-service" } },
      ),
    ),
  )
  assert.equal(body.body_plain, g.first.prose)
})

test("a write that lands corrupted is repaired by the repeated PUT", async (t) => {
  const g = await mixedGene(t, "8205")
  let puts = 0
  g.bunny.rules.push(({ method, objectKey, init, objects }) => {
    if (method !== "PUT" || objectKey !== g.first.objectKey) return undefined
    puts += 1
    // The first PUT lands corrupted; the second is stored as sent.
    objects.set(objectKey, puts === 1 ? new Uint8Array([1, 2, 3, 4]) : Uint8Array.from(init.body))
    return new Response(null, { status: 201 })
  })
  const result = await sweep(g.context, g.keyed, "revision")
  assert.deepEqual(result.failed, [])
  assert.equal(result.converted, 3, "all three legacy bodies are plain text in the end")
  assert.equal(puts, 2)
  assert.equal(new TextDecoder().decode(g.bunny.objects.get(g.first.objectKey)), g.first.prose)
})

test("when every write lands corrupted the old envelope is put back", async (t) => {
  const g = await mixedGene(t, "8210")
  const original = Uint8Array.from(g.bunny.objects.get(g.first.objectKey))
  let puts = 0
  g.bunny.rules.push(({ method, objectKey, init, objects }) => {
    if (method !== "PUT" || objectKey !== g.first.objectKey) return undefined
    puts += 1
    // Six conversion PUTs land corrupted; the seventh, the rollback, is stored
    // as sent.
    objects.set(objectKey, puts <= 6 ? new Uint8Array([1, 2, 3, 4]) : Uint8Array.from(init.body))
    return new Response(null, { status: 201 })
  })
  const result = await sweep(g.context, g.keyed, "revision")
  assert.deepEqual(
    result.failed.map((entry) => [entry.id, entry.code]),
    [[g.first.revisionId, "rolled_back"]],
  )
  assert.equal(puts, 7)
  assert.deepEqual(g.bunny.objects.get(g.first.objectKey), original)
})

test("a rollback that cannot be verified is reported as the one object to repair", async (t) => {
  const g = await mixedGene(t, "8206")
  g.bunny.rules.push(({ method, objectKey, objects }) => {
    if (method === "PUT" && objectKey === g.first.objectKey) {
      objects.set(objectKey, new Uint8Array([9, 9, 9]))
      return new Response(null, { status: 201 })
    }
    return undefined
  })
  const result = await sweep(g.context, g.keyed, "revision")
  assert.deepEqual(
    result.failed.map((entry) => [entry.id, entry.code]),
    [[g.first.revisionId, "restore_failed"]],
  )
})

test("a store that acknowledges PUTs without applying them is repeated until it does, and reported when it never does", async (t) => {
  // Bunny's documented failure (bunny-storage-consistency.js): the PUT is
  // acknowledged and the old object keeps being served. Replicate it for one
  // object: the first `ignored` PUTs are acknowledged and dropped.
  async function oneBody(suffix, ignored) {
    const g = await mixedGene(t, suffix)
    const original = Uint8Array.from(g.bunny.objects.get(g.first.objectKey))
    let puts = 0
    g.bunny.rules.push(({ method, objectKey, init, objects }) => {
      if (method !== "PUT" || objectKey !== g.first.objectKey) return undefined
      puts += 1
      if (puts > ignored) objects.set(objectKey, Uint8Array.from(init.body))
      return new Response(null, { status: 201 })
    })
    const result = await sweep(g.context, g.keyed, "revision")
    return { g, original, result, puts: () => puts }
  }

  // Every number of dropped PUTs below the attempt cap still converts.
  for (const [suffix, ignored] of [
    ["8207", 1],
    ["8211", 3],
    ["8212", 5],
  ]) {
    const { g, result, puts } = await oneBody(suffix, ignored)
    assert.deepEqual(result.failed, [], `${ignored} dropped PUTs`)
    assert.equal(result.unverified, 0, `${ignored} dropped PUTs`)
    assert.equal(result.converted, 3, `${ignored} dropped PUTs`)
    assert.equal(puts(), ignored + 1, "the body converts on the first PUT that is applied")
    assert.equal(new TextDecoder().decode(g.bunny.objects.get(g.first.objectKey)), g.first.prose)
  }

  // A store that never applies the PUT leaves the old envelope, reported as
  // unverified and not as damaged, after exactly six PUTs.
  const never = await oneBody("8213", Infinity)
  assert.equal(never.puts(), 6)
  assert.equal(never.result.unverified, 1)
  assert.deepEqual(never.result.failed, [])
  assert.equal(never.result.converted, 2, "the other legacy bodies were still converted")
  assert.deepEqual(never.g.bunny.objects.get(never.g.first.objectKey), never.original)
  assert.equal(
    never.result.calls.flatMap((call) => call.unverified_ids).join(),
    never.g.first.revisionId,
    "the call names the body that did not take",
  )

  // Both versions read correctly, so the unverified object is still safe.
  const workstation = workstationHandler(never.g.context, never.g.keyed)
  const body = await readJson(
    await workstation(
      new Request(
        `https://iconoplasm.test/api/iconoplasm/authority/revisions/${never.g.first.revisionId}/body`,
        { headers: { authorization: "Bearer test-service" } },
      ),
    ),
  )
  assert.equal(body.body_plain, never.g.first.prose)
})

test("one call stays inside the free plan's 50 subrequests in every case, and the worst case is the one counted in the module", async (t) => {
  assert.equal(PLAINTEXT_CONVERSION_WORST_CASE_FETCHES, 41)
  assert.ok(PLAINTEXT_CONVERSION_WORST_CASE_FETCHES <= 45, "a margin under 50 is kept")

  // The worst case: every PUT lands as garbage, so the body takes its read, six
  // PUTs with five read-backs each, then its rollback (one PUT, three reads).
  const worst = await mixedGene(t, "8208")
  worst.bunny.rules.push(({ method, objectKey, objects }) => {
    if (method !== "PUT") return undefined
    objects.set(objectKey, new Uint8Array([7, 7, 7]))
    return new Response(null, { status: 201 })
  })
  worst.bunny.clearLog()
  const result = await convertManifestationBodies(worst.context.db, worst.keyed, {
    kind: "revision",
    after: cursorBefore(worst.context, worst.first.revisionId),
    limit: PLAINTEXT_CONVERSION_MAX_BODIES,
    execute: true,
    ...NO_WAIT,
  })
  assert.equal(result.scanned, 1)
  assert.deepEqual(
    result.failed.map((entry) => entry.code),
    ["restore_failed"],
  )
  assert.equal(worst.bunny.log.length, PLAINTEXT_CONVERSION_WORST_CASE_FETCHES)

  // A store that refuses every PUT: no rollback, so fewer.
  const refused = await mixedGene(t, "8214")
  refused.bunny.rules.push(({ method }) =>
    method === "PUT" ? new Response(null, { status: 503 }) : undefined,
  )
  refused.bunny.clearLog()
  await convertManifestationBodies(refused.context.db, refused.keyed, {
    kind: "revision",
    after: cursorBefore(refused.context, refused.first.revisionId),
    limit: 1,
    execute: true,
    ...NO_WAIT,
  })
  assert.ok(refused.bunny.log.length <= PLAINTEXT_CONVERSION_WORST_CASE_FETCHES)

  // The usual case: read, one PUT, one read-back.
  const usual = await mixedGene(t, "8215")
  usual.bunny.clearLog()
  const converted = await convertManifestationBodies(usual.context.db, usual.keyed, {
    kind: "revision",
    after: cursorBefore(usual.context, usual.first.revisionId),
    limit: 1,
    execute: true,
    ...NO_WAIT,
  })
  assert.equal(converted.converted, 1)
  assert.equal(usual.bunny.log.length, 3)
  assert.equal(converted.puts, 1)
})

test("the call refuses bad input and never returns body text", async (t) => {
  const g = await mixedGene(t, "8209")
  const call = (options) =>
    convertManifestationBodies(g.context.db, g.keyed, {
      kind: "revision",
      after: "",
      limit: 2,
      execute: false,
      ...NO_WAIT,
      ...options,
    })
  await assert.rejects(call({ kind: "tags" }), /kind/)
  await assert.rejects(call({ limit: 0 }), /limit/)
  // A call that writes converts one body; a call that only reads may scan ten.
  await assert.rejects(call({ execute: true, limit: PLAINTEXT_CONVERSION_MAX_BODIES + 1 }), /limit/)
  await assert.rejects(call({ limit: PLAINTEXT_CHECK_MAX_BODIES + 1 }), /limit/)
  assert.equal(PLAINTEXT_CONVERSION_MAX_BODIES, 1)
  assert.equal((await call({ limit: PLAINTEXT_CHECK_MAX_BODIES })).scanned, 4)
  await assert.rejects(call({ after: "a b; DROP TABLE x" }), /after/)

  const result = await sweep(g.context, g.keyed, "revision")
  const text = JSON.stringify(result.calls)
  for (const secret of [
    PROSE,
    "A second legacy draft.",
    "A manifestation saved after the change.",
  ]) {
    assert.equal(text.includes(secret), false)
  }
})
