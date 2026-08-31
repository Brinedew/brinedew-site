// ARCHITECTURE FENCE [IPD-012]: one bounded cutover item is materialized from
// a frozen primary row. Plaintext exists only in this invocation and is never
// written to D1, events, snapshots, logs, or command receipts.
import {
  decryptManifestationProse,
  encryptManifestationProse,
  normalizeManifestationProse,
  sha256Hex,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  decryptManifestationTags,
  encryptManifestationTags,
} from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { registerGeneIdentity } from "./caretaker-assignment-commands.js"
import {
  normalizeLegacyTagsDerivativeMaterial,
  verifyPlannedLegacySource,
} from "./manifestation-authority-cutover.js"
import { verifyManifestationBackupEntity } from "./manifestation-authority-backup.js"
import { seedGeneWithoutManifestation } from "./gene-authority-seed-command.js"
import { first, requireDatabase } from "./manifestation-authority-repository.js"
import { seedSystemManifestation } from "./manifestation-write-commands.js"
import {
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "./manifestation-derivative-commands.js"
import {
  createManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"

async function sourceRow(primaryDb, symbol) {
  return first(
    primaryDb,
    `SELECT gene_symbol, manifestation, manifestation_tags, manifestation_fields_json,
            sample_label, sample_number, sample_text_hash, updated_at
       FROM icono_gene_essence
      WHERE gene_symbol = ? COLLATE NOCASE LIMIT 1`,
    symbol,
  )
}

async function verifiedSourceMaterial(primaryDb, item) {
  await verifyPlannedLegacySource(primaryDb, item)
  const row = await sourceRow(primaryDb, item.canonical_symbol)
  if (!row) throw new Error("cutover_source_disappeared_after_verification")
  if (item.source_kind === "no_manifestation")
    return Object.freeze({ row, prose: null, tags: null })
  const prose = normalizeManifestationProse(row.manifestation)
  if (
    (await sha256Hex(prose.bytes)) !== item.source_body_sha256 ||
    prose.bytes.byteLength !== Number(item.source_body_bytes)
  ) {
    throw new Error("cutover_source_body_changed_after_verification")
  }
  const tags = await normalizeLegacyTagsDerivativeMaterial(
    row.manifestation_tags,
    row.manifestation_fields_json,
  )
  if (
    Boolean(tags) !== Boolean(item.source_tags_sha256) ||
    (tags &&
      (tags.tags_sha256 !== item.source_tags_sha256 ||
        tags.tags_bytes !== Number(item.source_tags_bytes) ||
        tags.fields_sha256 !== item.source_fields_sha256 ||
        tags.fields_bytes !== Number(item.source_fields_bytes)))
  ) {
    throw new Error("cutover_source_tags_changed_after_verification")
  }
  return Object.freeze({ row, prose, tags })
}

function descriptor(encrypted, objectKey, uploaded, now) {
  return {
    body_sha256: encrypted.body_sha256,
    body_bytes: encrypted.body_bytes,
    object_key: objectKey,
    ciphertext_sha256: encrypted.ciphertext_sha256,
    ciphertext_bytes: encrypted.ciphertext_bytes,
    body_iv_base64: encrypted.body_iv_base64,
    wrapped_dek_base64: encrypted.wrapped_dek_base64,
    wrap_iv_base64: encrypted.wrap_iv_base64,
    key_version: encrypted.key_version,
    aad_version: encrypted.aad_version,
    object_etag: uploaded.etag,
    verified_at: now,
  }
}

async function stableHash(label, item) {
  return sha256Hex(
    JSON.stringify([
      label,
      item.cutover_run_id,
      item.gene_id,
      item.source_body_sha256,
      item.source_tags_sha256,
      item.source_fields_sha256,
    ]),
  )
}

async function stableEventId(commandId) {
  return `event_${(await sha256Hex(`iconoplasm.cutover.event.v1\n${commandId}`)).slice(0, 48)}`
}

async function uploadEncryptedBody(
  authoringDb,
  env,
  item,
  kind,
  entityId,
  encrypted,
  now,
  verifyPlaintext,
) {
  const objectKey = await createManifestationBodyObjectKey()
  const intentDigest = await sha256Hex(`${kind}\n${entityId}\n${encrypted.ciphertext_sha256}`)
  await createManifestationUploadIntent(authoringDb, {
    entityKind: kind,
    entityId,
    objectKey,
    ciphertextSha256: encrypted.ciphertext_sha256,
    bodyBytes: encrypted.body_bytes,
    actorKind: "migration",
    uploadIntentId: `upload_intent_${intentDigest.slice(0, 48)}`,
    leaseToken: `upload_lease_${intentDigest.slice(16, 64)}`,
    // The shared Bunny verification contract can legitimately span several
    // delayed authenticated reads and identical PUTs. Keep the cutover lease
    // alive for that entire bounded window so the sweeper cannot delete an
    // object while this invocation is still proving it.
    leaseMs: 10 * 60 * 1000,
    now,
  })
  const uploaded = await putEncryptedManifestationBody(env, objectKey, encrypted.ciphertext, {
    expectedSha256: encrypted.ciphertext_sha256,
    verifyPlaintext,
  })
  return descriptor(encrypted, objectKey, uploaded, now)
}

async function verifySeedRevision(authoringDb, env, item) {
  const revision = await first(
    authoringDb,
    `SELECT revision.manifestation_revision_id, revision.manifestation_id,
            revision.body_sha256, revision.body_bytes,
            revision.sample_label, revision.sample_number, revision.sample_text_sha256,
            manifestation.gene_id
       FROM icono_manifestation_revisions revision
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
      WHERE revision.manifestation_revision_id = ?`,
    item.seed_revision_id,
  )
  if (!revision) return null
  if (
    revision.gene_id !== item.gene_id ||
    revision.manifestation_id !== item.seed_manifestation_id ||
    revision.body_sha256 !== item.source_body_sha256 ||
    Number(revision.body_bytes) !== Number(item.source_body_bytes) ||
    (revision.sample_label || null) !== (item.source_sample_label || null) ||
    (revision.sample_number == null ? null : Number(revision.sample_number)) !==
      (item.source_sample_number == null ? null : Number(item.source_sample_number)) ||
    (revision.sample_text_sha256 || null) !== (item.source_sample_text_sha256 || null)
  ) {
    throw new Error("cutover_seed_revision_conflicts_with_plan")
  }
  await verifyManifestationBackupEntity(authoringDb, env, {
    entityKind: "revision",
    entityId: item.seed_revision_id,
    actorKind: "service",
  })
  return revision
}

async function ensureSeedRevision(authoringDb, env, item, source, now) {
  if (await verifySeedRevision(authoringDb, env, item)) return
  const encrypted = await encryptManifestationProse(env, {
    revisionId: item.seed_revision_id,
    geneId: item.gene_id,
    prose: source.prose.prose,
  })
  const storage = await uploadEncryptedBody(
    authoringDb,
    env,
    item,
    "revision",
    item.seed_revision_id,
    encrypted,
    now,
    (stored) =>
      decryptManifestationProse(env, {
        revisionId: item.seed_revision_id,
        geneId: item.gene_id,
        ciphertext: stored,
        ciphertextSha256: encrypted.ciphertext_sha256,
        ciphertextBytes: encrypted.ciphertext_bytes,
        bodySha256: encrypted.body_sha256,
        bodyBytes: encrypted.body_bytes,
        bodyIvBase64: encrypted.body_iv_base64,
        wrappedDekBase64: encrypted.wrapped_dek_base64,
        wrapIvBase64: encrypted.wrap_iv_base64,
        keyVersion: encrypted.key_version,
        aadVersion: encrypted.aad_version,
      }),
  )
  await seedSystemManifestation(authoringDb, {
    geneId: item.gene_id,
    storage,
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    sampleLabel: item.source_sample_label,
    sampleNumber: item.source_sample_number,
    sampleTextSha256: item.source_sample_text_sha256,
    manifestationId: item.seed_manifestation_id,
    revisionId: item.seed_revision_id,
    selectionId: item.seed_selection_id,
    eventUuid: await stableEventId(item.seed_command_id),
    now,
    commandId: item.seed_command_id,
    requestSha256: await stableHash("seed_revision", item),
    actorKind: "migration",
  })
  await requireAdoptedManifestationUpload(authoringDb, "revision", item.seed_revision_id)
  await verifySeedRevision(authoringDb, env, item)
}

async function verifySeedDerivative(authoringDb, env, item) {
  const derivative = await first(
    authoringDb,
    `SELECT * FROM icono_manifestation_derivatives
      WHERE manifestation_derivative_id = ?`,
    item.seed_tags_derivative_id,
  )
  if (!derivative) return null
  if (
    derivative.manifestation_revision_id !== item.seed_revision_id ||
    derivative.status !== "complete" ||
    derivative.source_body_sha256 !== item.source_body_sha256 ||
    derivative.tags_sha256 !== item.source_tags_sha256 ||
    Number(derivative.tags_bytes) !== Number(item.source_tags_bytes) ||
    derivative.fields_sha256 !== item.source_fields_sha256 ||
    Number(derivative.fields_bytes) !== Number(item.source_fields_bytes) ||
    derivative.provenance_status !== "legacy_unknown"
  ) {
    throw new Error("cutover_seed_derivative_conflicts_with_plan")
  }
  await verifyManifestationBackupEntity(authoringDb, env, {
    entityKind: "derivative",
    entityId: item.seed_tags_derivative_id,
    actorKind: "service",
  })
  return derivative
}

async function ensureSeedDerivative(authoringDb, env, item, source, now) {
  if (!source.tags) return
  let derivative = await verifySeedDerivative(authoringDb, env, item)
  if (!derivative) {
    const encrypted = await encryptManifestationTags(env, {
      derivativeId: item.seed_tags_derivative_id,
      revisionId: item.seed_revision_id,
      sourceBodySha256: item.source_body_sha256,
      tags: source.tags.output_plain,
    })
    const storage = await uploadEncryptedBody(
      authoringDb,
      env,
      item,
      "derivative",
      item.seed_tags_derivative_id,
      encrypted,
      now,
      (stored) =>
        decryptManifestationTags(env, {
          derivativeId: item.seed_tags_derivative_id,
          revisionId: item.seed_revision_id,
          sourceBodySha256: item.source_body_sha256,
          ciphertext: stored,
          ciphertextSha256: encrypted.ciphertext_sha256,
          ciphertextBytes: encrypted.ciphertext_bytes,
          bodySha256: encrypted.body_sha256,
          bodyBytes: encrypted.body_bytes,
          bodyIvBase64: encrypted.body_iv_base64,
          wrappedDekBase64: encrypted.wrapped_dek_base64,
          wrapIvBase64: encrypted.wrap_iv_base64,
          keyVersion: encrypted.key_version,
          aadVersion: encrypted.aad_version,
        }),
    )
    const head = await first(
      authoringDb,
      "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
      item.gene_id,
    )
    await submitTagsDerivative(authoringDb, {
      revisionId: item.seed_revision_id,
      derivativeId: item.seed_tags_derivative_id,
      status: "complete",
      sourceBodySha256: item.source_body_sha256,
      tagsSha256: source.tags.tags_sha256,
      tagsBytes: source.tags.tags_bytes,
      fieldsSha256: source.tags.fields_sha256,
      fieldsBytes: source.tags.fields_bytes,
      storage,
      legacyUnknown: true,
      expectedGeneRevision: Number(head.gene_revision),
      eventUuid: await stableEventId(item.seed_tags_command_id),
      now,
      commandId: item.seed_tags_command_id,
      requestSha256: await stableHash("seed_tags", item),
      actorKind: "migration",
    })
    await requireAdoptedManifestationUpload(authoringDb, "derivative", item.seed_tags_derivative_id)
    derivative = await verifySeedDerivative(authoringDb, env, item)
  }
  const derivativeHead = await first(
    authoringDb,
    `SELECT accepted_derivative_id, derivative_head_version
       FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?`,
    item.seed_revision_id,
  )
  if (derivativeHead.accepted_derivative_id !== item.seed_tags_derivative_id) {
    const head = await first(
      authoringDb,
      "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
      item.gene_id,
    )
    await selectTagsDerivativeHead(authoringDb, {
      derivativeId: item.seed_tags_derivative_id,
      expectedDerivativeHeadVersion: Number(derivativeHead.derivative_head_version),
      expectedGeneRevision: Number(head.gene_revision),
      eventUuid: await stableEventId(item.seed_tags_selection_command_id),
      now,
      commandId: item.seed_tags_selection_command_id,
      requestSha256: await stableHash("select_seed_tags", item),
      actorKind: "migration",
    })
  }
}

export async function materializeManifestationCutoverItem({
  primaryDb,
  authoringDb,
  env,
  item,
  now = new Date().toISOString(),
} = {}) {
  requireDatabase(primaryDb)
  requireDatabase(authoringDb)
  const source = await verifiedSourceMaterial(primaryDb, item)
  await registerGeneIdentity(authoringDb, {
    geneId: item.gene_id,
    canonicalSymbol: item.canonical_symbol,
    now,
  })
  if (item.source_kind === "no_manifestation") {
    const seeded = await seedGeneWithoutManifestation(authoringDb, {
      geneId: item.gene_id,
      eventUuid: await stableEventId(item.seed_command_id),
      commandId: item.seed_command_id,
      requestSha256: await stableHash("seed_empty_gene", item),
    })
    return Object.freeze({
      gene_id: item.gene_id,
      source_kind: item.source_kind,
      event: {
        event_id: seeded.event_id,
        event_sequence: seeded.accepted_event_sequence,
        gene_id: item.gene_id,
      },
    })
  }
  await ensureSeedRevision(authoringDb, env, item, source, now)
  await ensureSeedDerivative(authoringDb, env, item, source, now)
  const latest = await first(
    authoringDb,
    `SELECT event_uuid, event_sequence, payload_json
       FROM icono_manifestation_events WHERE gene_id = ?
      ORDER BY event_sequence DESC LIMIT 1`,
    item.gene_id,
  )
  if (!latest) throw new Error("cutover_seed_event_missing")
  return Object.freeze({
    gene_id: item.gene_id,
    source_kind: item.source_kind,
    event: Object.freeze({
      event_id: latest.event_uuid,
      event_sequence: Number(latest.event_sequence),
      gene_id: item.gene_id,
      payload: JSON.parse(latest.payload_json),
    }),
  })
}

export async function verifyManifestationCutoverProjection(primaryDb, authoringDb, item) {
  const [projection, head] = await Promise.all([
    first(
      primaryDb,
      "SELECT * FROM icono_manifestation_canonical_projection WHERE gene_id = ?",
      item.gene_id,
    ),
    first(
      authoringDb,
      `SELECT head.canonical_manifestation_id, head.canonical_revision_id,
              head.canonical_selection_id, head.gene_revision, head.last_event_sequence,
              derivative_head.accepted_derivative_id
         FROM icono_manifestation_heads head
         LEFT JOIN icono_manifestation_derivative_heads derivative_head
           ON derivative_head.manifestation_revision_id = head.canonical_revision_id
        WHERE head.gene_id = ?`,
      item.gene_id,
    ),
  ])
  return Boolean(
    projection &&
    head &&
    projection.canonical_manifestation_id === head.canonical_manifestation_id &&
    projection.canonical_revision_id === head.canonical_revision_id &&
    projection.canonical_selection_id === head.canonical_selection_id &&
    Number(projection.gene_revision) === Number(head.gene_revision) &&
    Number(projection.authority_event_sequence) === Number(head.last_event_sequence) &&
    (projection.accepted_tags_derivative_id || null) === (head.accepted_derivative_id || null),
  )
}

// ARCHITECTURE FENCE [IPD-012]
