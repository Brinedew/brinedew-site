import { readFileSync } from "node:fs"

import {
  SEED_CROP_CODE_POINTS,
  restoreSeedProseForGene,
} from "./manifestation-seed-prose-restoration.js"
import {
  createManifestationUploadIntent,
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  saveManifestationRevision,
  seedSystemManifestation,
  selectManifestationRevision,
  selectTagsDerivativeHead,
  submitTagsDerivative,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import { TestD1, command, row, rows, sha } from "./manifestation-authority-test-support.js"
import {
  ADMIN,
  USER,
  TERMS,
  bodyEnvironment,
  installBunnyFake,
} from "./manifestation-plaintext-test-support.js"
import {
  canonicalManifestationFieldsJson,
  prepareManifestationTagsPayload,
} from "./manifestation-tags-payload.js"
import { plainStorageDescriptor } from "./manifestation-storage-contract.js"
import { createManifestationBodyObjectKey } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { sha256Hex } from "../../lib/iconoplasm-sha256.js"

// Test-only. A gene as the cutover left it (a seed cut at 4,000 characters, canonical, with
// accepted Tags), on the real authority schema and a fake Bunny zone, and the helpers the
// restore tests share (B-977).

export const NOW = "2026-10-04T00:00:00.000Z"
export const FUTURE = "2099-10-04T00:00:00.000Z"
export const ENCODER = new TextEncoder()
export const sleep = async () => {}

const MIGRATIONS_AFTER_BASE = [
  "../../../migrations-iconoplasm-authoring/0013_strict_upload_reservations.sql",
  "../../../migrations-iconoplasm-authoring/0014_bounded_lineage_upload_admission.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))

export function longText(codePoints = 6200, label = "Alpha") {
  const sentence = `${label} protein rests at the nuclear periphery, café-bright and slow. `
  let text = ""
  while (Array.from(text).length < codePoints) text += sentence
  return Array.from(text).slice(0, codePoints).join("").trim()
}

export function normalize(text) {
  return text.normalize("NFC").replace(/\r\n?/g, "\n")
}

export function crop(text) {
  return Array.from(normalize(text)).slice(0, SEED_CROP_CODE_POINTS).join("")
}

export async function putSeedObject(bunny, bytes) {
  const objectKey = await createManifestationBodyObjectKey()
  bunny.objects.set(objectKey, bytes)
  return objectKey
}

// A gene exactly as the cutover left it: an active seed whose only revision holds
// the first 4,000 characters, canonical, with accepted Tags made from the full
// text. `tags` is false (no Tags), true, or "legacy_unknown" (migration provenance).
export async function world(t, suffix, { full, tags = true, caretaker = false } = {}) {
  const bunny = installBunnyFake(t)
  const db = new TestD1()
  for (const migration of MIGRATIONS_AFTER_BASE) db.raw.exec(migration)
  t.after(() => db.close())
  const env = bodyEnvironment({ withKey: false })
  const fullText = full ?? longText(6200, suffix)
  const geneId = `gene_restore_${suffix}`
  const seedRevisionId = `revision_seed_${suffix}`
  const manifestationId = `manifestation_seed_${suffix}`
  const symbol = `R${suffix}`
  await registerAuthorityAccount(db, { accountId: ADMIN, publicCreditLabel: "Admin", now: NOW })
  await registerAuthorityAccount(db, { accountId: USER, publicCreditLabel: "Caretaker", now: NOW })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Caretaker terms - test",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  await registerGeneIdentity(db, { geneId, canonicalSymbol: symbol, now: NOW })

  const seedBytes = ENCODER.encode(crop(fullText))
  const seedSha = await sha256Hex(seedBytes)
  const seedKey = await putSeedObject(bunny, seedBytes)
  await createManifestationUploadIntent(db, {
    entityKind: "revision",
    entityId: seedRevisionId,
    objectKey: seedKey,
    ciphertextSha256: seedSha,
    bodyBytes: seedBytes.byteLength,
    actorKind: "migration",
    uploadIntentId: `upload_intent_seed_${suffix}`,
    leaseToken: `upload_lease_seed_${suffix}`,
    now: FUTURE,
  })
  await seedSystemManifestation(db, {
    geneId,
    storage: plainStorageDescriptor(
      { body_sha256: seedSha, body_bytes: seedBytes.byteLength },
      seedKey,
      { etag: '"fake-etag"' },
    ),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId,
    revisionId: seedRevisionId,
    selectionId: `selection_seed_${suffix}`,
    eventUuid: `event_seed_${suffix}`,
    now: NOW,
    ...command(`command_seed_${suffix}`, "1", null, "migration"),
  })

  let seedTags = null
  if (tags) {
    const tagsText = "nuclear periphery\nslow protein\ncafé-bright"
    const fieldsJson = { organism: "human", rank: "alpha" }
    const payload = await prepareManifestationTagsPayload({
      tagsText,
      tagsSha256: await sha256Hex(ENCODER.encode(tagsText)),
      fieldsJson,
      fieldsSha256: await sha256Hex(ENCODER.encode(canonicalManifestationFieldsJson(fieldsJson))),
    })
    const derivativeId = `derivative_seed_${suffix}`
    const tagsKey = await putSeedObject(bunny, payload.output_bytes)
    await createManifestationUploadIntent(db, {
      entityKind: "derivative",
      entityId: derivativeId,
      objectKey: tagsKey,
      ciphertextSha256: payload.output_plain_sha256,
      bodyBytes: payload.output_plain_bytes,
      actorKind: "migration",
      uploadIntentId: `upload_intent_tags_${suffix}`,
      leaseToken: `upload_lease_tags_${suffix}`,
      now: FUTURE,
    })
    const legacy = tags === "legacy_unknown"
    await submitTagsDerivative(db, {
      revisionId: seedRevisionId,
      derivativeId,
      status: "complete",
      sourceBodySha256: seedSha,
      tagsSha256: payload.tags_sha256,
      tagsBytes: payload.tags_bytes,
      fieldsSha256: payload.fields_sha256,
      fieldsBytes: payload.fields_bytes,
      storage: plainStorageDescriptor(
        { body_sha256: payload.output_plain_sha256, body_bytes: payload.output_plain_bytes },
        tagsKey,
        { etag: '"fake-etag"' },
      ),
      ...(legacy
        ? { legacyUnknown: true }
        : {
            recipeId: "gene-tags",
            recipeVersion: "3",
            providerId: "local",
            modelId: "qwen",
            taggerConfigSha256: sha("9"),
          }),
      expectedGeneRevision: row(
        db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        geneId,
      ).gene_revision,
      now: NOW,
      ...command(`command_tags_${suffix}`, "4", null, legacy ? "migration" : "service"),
    })
    await selectTagsDerivativeHead(db, {
      derivativeId,
      expectedDerivativeHeadVersion: 0,
      expectedGeneRevision: row(
        db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        geneId,
      ).gene_revision,
      now: NOW,
      ...command(`command_tags_select_${suffix}`, "5", null, legacy ? "migration" : "service"),
    })
    seedTags = { derivativeId, tagsKey, payload }
  }

  const assignmentId = `assignment_restore_${suffix}`
  let caretakerRevisionId = null
  if (caretaker) {
    await offerCaretakerAssignment(db, {
      geneId,
      accountId: USER,
      invitedByAccountId: ADMIN,
      entitlementPolicyVersion: "entitlement-v1",
      expectedGeneRevision: row(
        db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        geneId,
      ).gene_revision,
      assignmentId,
      eventUuid: `event_offer_${suffix}`,
      now: NOW,
      ...command(`command_offer_${suffix}`, "2", ADMIN, "administrator"),
    })
    await transitionCaretakerAssignment(db, {
      assignmentId,
      action: "accept",
      expectedAssignmentVersion: 1,
      termsVersionId: TERMS,
      relinquishPolicy: "retain",
      eventUuid: `event_accept_${suffix}`,
      now: NOW,
      ...command(`command_accept_${suffix}`, "3", USER, "account"),
    })
    caretakerRevisionId = `revision_caretaker_${suffix}`
    const bytes = ENCODER.encode("A caretaker's own words about this gene.")
    const key = await putSeedObject(bunny, bytes)
    const bodySha = await sha256Hex(bytes)
    await createManifestationUploadIntent(db, {
      entityKind: "revision",
      entityId: caretakerRevisionId,
      assignmentId,
      objectKey: key,
      ciphertextSha256: bodySha,
      bodyBytes: bytes.byteLength,
      actorKind: "account",
      actorAccountId: USER,
      uploadIntentId: `upload_intent_care_${suffix}`,
      leaseToken: `upload_lease_care_${suffix}`,
      now: FUTURE,
    })
    await saveManifestationRevision(db, {
      assignmentId,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: 0,
      storage: plainStorageDescriptor({ body_sha256: bodySha, body_bytes: bytes.byteLength }, key, {
        etag: '"fake-etag"',
      }),
      manifestationId: `manifestation_caretaker_${suffix}`,
      revisionId: caretakerRevisionId,
      eventUuid: `event_care_save_${suffix}`,
      now: NOW,
      ...command(`command_care_save_${suffix}`, "6", USER, "account"),
    })
  }
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  return {
    bunny,
    db,
    env,
    fullText,
    geneId,
    symbol,
    seedRevisionId,
    seedSha,
    seedKey,
    seedTags,
    assignmentId,
    caretakerRevisionId,
  }
}

export async function selectCaretaker(w, commandSuffix) {
  const head = row(
    w.db,
    "SELECT head_version, canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
    w.geneId,
  )
  return selectManifestationRevision(w.db, {
    assignmentId: w.assignmentId,
    revisionId: w.caretakerRevisionId,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: head.head_version,
    expectedCanonicalRevisionId: head.canonical_revision_id,
    eventUuid: `event_care_select_${commandSuffix}`,
    now: NOW,
    ...command(`command_care_select_${commandSuffix}`, "7", USER, "account"),
  })
}

let commandCounter = 0
export function restoreCommand(label = "restore") {
  commandCounter += 1
  return command(
    `command_${label}_${String(commandCounter).padStart(6, "0")}`,
    "a",
    null,
    "migration",
  )
}

export function restore(
  w,
  { prose = w.fullText, symbol = w.symbol, cmd = restoreCommand(), db } = {},
) {
  return restoreSeedProseForGene(db ?? w.db, w.env, {
    geneSymbol: symbol,
    prose,
    command: cmd,
    sleep,
  })
}

// Every table's row count, to prove a refusal wrote nothing anywhere.
export function tableCounts(db) {
  const names = rows(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).map((entry) => entry.name)
  return Object.fromEntries(
    names.map((name) => [name, row(db, `SELECT count(*) AS n FROM "${name}"`).n]),
  )
}

export const totalChanges = (db) => row(db, "SELECT total_changes() AS n").n

export function stateOf(w) {
  return {
    head: row(w.db, "SELECT * FROM icono_manifestation_heads WHERE gene_id = ?", w.geneId),
    revisions: rows(
      w.db,
      `SELECT revision.manifestation_revision_id AS id, revision.revision_number, revision.parent_revision_id,
              revision.body_sha256, revision.body_bytes
         FROM icono_manifestation_revisions revision
         JOIN icono_manifestations manifestation USING (manifestation_id)
        WHERE manifestation.gene_id = ? ORDER BY manifestation.created_at, revision.revision_number`,
      w.geneId,
    ),
  }
}
