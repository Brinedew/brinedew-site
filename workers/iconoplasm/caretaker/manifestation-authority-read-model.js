import { decryptManifestationProse } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { decryptManifestationTags } from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import { readEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { authorityError, normalizeId } from "./manifestation-authority-contract.js"
import {
  all,
  first,
  geneSnapshot,
  readHead,
  requireActiveAccount,
  requireDatabase,
} from "./manifestation-authority-repository.js"
import { decodeCursor, encodeCursor } from "./manifestation-authority-sync.js"
import { resolveGene } from "./manifestation-gene-resolver.js"
import { hydrateManifestationRevisionBodies } from "./manifestation-body-hydration.js"
import { readPinnedManifestationRevisions } from "./manifestation-dossier-pinned.js"

const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 50

async function requireGeneDossierAuthority(db, { geneId, actorAccountId, administrator = false }) {
  requireDatabase(db)
  const actor = await requireActiveAccount(db, actorAccountId)
  const gene = await resolveGene(db, geneId)
  if (administrator) return { actor, assignment: null, gene }
  const assignment = await first(
    db,
    `SELECT caretaker_assignment_id, gene_id, account_id, status,
            assignment_version, relinquish_policy, ended_at
       FROM icono_caretaker_assignments
      WHERE account_id = ? AND (gene_id = ? OR gene_id IS ?)
      ORDER BY CASE status
        WHEN 'active' THEN 0 WHEN 'suspended' THEN 1
        WHEN 'pending_acceptance' THEN 2 ELSE 3 END,
        created_at DESC, caretaker_assignment_id DESC
      LIMIT 1`,
    actor.account_id,
    gene.gene_id,
    gene.merged_into_gene_id,
  )
  if (!assignment) {
    throw authorityError(
      "GENE_DOSSIER_FORBIDDEN",
      "A caretaker relationship or administrator authority is required",
      403,
    )
  }
  return { actor, assignment, gene }
}

function authorCredit(row, viewerAccountId) {
  if (row.origin === "system_seed" || !row.author_account_id) return "Original manifestation"
  if (row.author_account_id === viewerAccountId) return "Your manifestation"
  const label = String(row.author_public_credit_label || "Anonymous caretaker")
  return row.author_account_status === "tombstoned"
    ? `${label} (account removed)`
    : `${label} (former caretaker)`
}

function browserManifestation(row, authority) {
  const own = row.author_account_id === authority.actor.account_id
  const currentAssignment =
    authority.gene.status === "active" &&
    authority.assignment?.status === "active" &&
    authority.assignment?.gene_id === authority.gene.gene_id &&
    row.caretaker_assignment_id === authority.assignment?.caretaker_assignment_id
  return {
    manifestation_id: row.manifestation_id,
    origin: row.origin,
    status: row.status,
    manifestation_head_revision_id: row.manifestation_head_revision_id || null,
    source_manifestation_id: row.source_manifestation_id || null,
    row_version: Number(row.row_version),
    non_withdrawable: Boolean(row.non_withdrawable),
    author_is_viewer: own,
    belongs_to_current_assignment: Boolean(currentAssignment),
    author_label: authorCredit(row, authority.actor.account_id),
    can_withdraw: Boolean(
      authority.gene.status === "active" && own && row.status === "active" && !row.non_withdrawable,
    ),
    can_restore: Boolean(
      currentAssignment &&
      own &&
      row.status === "withdrawn" &&
      !row.non_withdrawable &&
      row.restore_body_available,
    ),
    created_at: row.created_at,
  }
}

function browserDerivative(row) {
  if (!row) return null
  const accepted = row.accepted_derivative_id === row.manifestation_derivative_id
  return {
    manifestation_derivative_id: row.manifestation_derivative_id,
    status: accepted
      ? "accepted"
      : row.status === "failed"
        ? "failed"
        : row.status === "pending"
          ? "pending"
          : "stale",
    recipe_version: row.recipe_version || null,
    tags_sha256: row.tags_sha256 || null,
    fields_sha256: row.fields_sha256 || null,
    body_available: Boolean(row.body_available) && row.status !== "purged",
  }
}

function browserGenerationProvenance(row) {
  if (!row) return null
  return {
    origin: row.provenance_status,
    source_label:
      row.provider_id && row.model_id
        ? `${row.provider_id} · ${row.model_id}`
        : row.provenance_status === "legacy_unknown"
          ? "Legacy Tags provenance unavailable"
          : null,
    recipe_id: row.recipe_id || null,
    recipe_version: row.recipe_version || null,
    provider_id: row.provider_id || null,
    model_id: row.model_id || null,
    tagger_config_sha256: row.tagger_config_sha256 || null,
    source_body_sha256: row.source_body_sha256,
  }
}

async function readWithdrawalFallbackPreview(db, geneId, excludedManifestationId) {
  const fallback = await first(
    db,
    `SELECT selection.selected_revision_id, manifestation.origin,
            manifestation.author_account_id,
            author.public_credit_label AS author_public_credit_label,
            author.status AS author_account_status
       FROM icono_manifestation_canonical_selections selection
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = selection.selected_manifestation_id
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = selection.selected_revision_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_authority_accounts author
         ON author.account_id = manifestation.author_account_id
      WHERE selection.gene_id = ? AND selection.selected_manifestation_id <> ?
        AND manifestation.status = 'active' AND lifecycle.status = 'active'
      ORDER BY selection.head_version DESC, selection.canonical_selection_id DESC
      LIMIT 1`,
    geneId,
    excludedManifestationId,
  )
  if (!fallback) return null
  return {
    fallback_revision_id: fallback.selected_revision_id,
    fallback_label:
      fallback.origin === "system_seed"
        ? "Original manifestation"
        : String(
            fallback.author_public_credit_label || "a retained former caretaker manifestation",
          ),
  }
}

function internalRevision(row) {
  return {
    manifestation_revision_id: row.manifestation_revision_id,
    manifestation_id: row.manifestation_id,
    revision_number: Number(row.revision_number),
    parent_revision_id: row.parent_revision_id || null,
    source_revision_id: row.source_revision_id || null,
    body_sha256: row.body_sha256,
    body_bytes: Number(row.body_bytes),
    sample_label: row.sample_label || null,
    sample_number: row.sample_number == null ? null : Number(row.sample_number),
    sample_text_sha256: row.sample_text_sha256 || null,
    author_account_id: row.author_account_id || null,
    caretaker_assignment_id: row.caretaker_assignment_id || null,
    lifecycle_status: row.lifecycle_status,
    lifecycle_version: Number(row.lifecycle_version),
    body_available: Boolean(
      row.object_key && !new Set(["purged", "quarantined"]).has(row.lifecycle_status),
    ),
    created_at: row.created_at,
  }
}

async function readRevisionRows(db, geneId, decodedCursor, limit) {
  const cursorCreatedAt = decodedCursor?.created_at
  const cursorRevisionId = decodedCursor?.revision_id
  const cursorWhere = decodedCursor
    ? `AND (
         revision.created_at < ? OR
         (revision.created_at = ? AND revision.manifestation_revision_id < ?)
       )`
    : ""
  const params = decodedCursor
    ? [geneId, cursorCreatedAt, cursorCreatedAt, cursorRevisionId, limit + 1]
    : [geneId, limit + 1]
  return all(
    db,
    `SELECT * FROM (
       SELECT revision.manifestation_revision_id, revision.manifestation_id,
              manifestation.gene_id,
              revision.revision_number, revision.parent_revision_id,
              revision.source_revision_id, revision.body_sha256, revision.body_bytes,
              revision.sample_label, revision.sample_number, revision.sample_text_sha256,
              revision.author_account_id, revision.caretaker_assignment_id,
              revision.created_at, lifecycle.status AS lifecycle_status,
              lifecycle.lifecycle_version, manifestation.origin,
              author.public_credit_label AS author_public_credit_label,
              author.status AS author_account_status, storage.object_key,
              storage.ciphertext_sha256, storage.ciphertext_bytes,
              storage.body_iv_base64, storage.wrapped_dek_base64,
              storage.wrap_iv_base64, storage.key_version, storage.aad_version
         FROM icono_manifestation_revisions revision
         JOIN icono_manifestations manifestation
           ON manifestation.manifestation_id = revision.manifestation_id
         JOIN icono_manifestation_revision_lifecycle lifecycle
           ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
         LEFT JOIN icono_manifestation_revision_storage_secrets storage
           ON storage.manifestation_revision_id = revision.manifestation_revision_id
         LEFT JOIN icono_authority_accounts author
           ON author.account_id = revision.author_account_id
        WHERE manifestation.gene_id = ?
      ) revision
      WHERE 1 = 1 ${cursorWhere}
      ORDER BY revision.created_at DESC, revision.manifestation_revision_id DESC
      LIMIT ?`,
    ...params,
  )
}

async function pageRelations(db, geneId, revisionIds) {
  if (!revisionIds.length) return { selections: [], derivatives: [] }
  const slots = revisionIds.map(() => "?").join(", ")
  const selections = await all(
    db,
    `SELECT selection.canonical_selection_id, selection.previous_selection_id,
            selection.previous_revision_id, selection.selected_manifestation_id,
            selection.selected_revision_id, selection.actor_account_id,
            selection.caretaker_assignment_id, selection.reason,
            selection.head_version, selection.gene_revision, selection.created_at,
            actor.public_credit_label AS actor_public_credit_label,
            actor.status AS actor_account_status
       FROM icono_manifestation_canonical_selections selection
       LEFT JOIN icono_authority_accounts actor
         ON actor.account_id = selection.actor_account_id
      WHERE selection.gene_id = ? AND (selection.selected_revision_id IN (${slots})
         OR selection.previous_revision_id IN (${slots}))
      ORDER BY selection.gene_revision DESC, selection.created_at DESC,
               selection.canonical_selection_id DESC`,
    geneId,
    ...revisionIds,
    ...revisionIds,
  )
  const derivatives = await all(
    db,
    `SELECT derivative.manifestation_derivative_id,
            derivative.manifestation_revision_id, derivative.derivative_kind,
            derivative.status, derivative.source_body_sha256, derivative.body_sha256,
            derivative.body_bytes, derivative.tags_sha256, derivative.tags_bytes,
            derivative.fields_sha256, derivative.fields_bytes,
            derivative.recipe_id, derivative.recipe_version,
            derivative.provider_id, derivative.model_id, derivative.tagger_config_sha256,
            derivative.provenance_status, derivative.failure_code,
            derivative.created_at, derivative.completed_at,
            head.accepted_derivative_id, head.derivative_head_version,
            CASE WHEN storage.manifestation_derivative_id IS NULL THEN 0 ELSE 1 END AS body_available
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_derivative_heads head
         ON head.manifestation_revision_id = derivative.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivative_storage_secrets storage
         ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
      WHERE derivative.manifestation_revision_id IN (${slots})
      ORDER BY derivative.created_at DESC, derivative.manifestation_derivative_id DESC`,
    ...revisionIds,
  )
  return { selections, derivatives }
}

export async function readCaretakerGeneDossier(db, input = {}) {
  const authority = await requireGeneDossierAuthority(db, input)
  const audience = input.audience || "browser"
  if (!["browser", "administrator", "replica"].includes(audience)) {
    throw authorityError("INVALID_DOSSIER_AUDIENCE", "Dossier audience is invalid")
  }
  const requestedLimit = Math.trunc(Number(input.limit)) || DEFAULT_HISTORY_LIMIT
  const limit = Math.max(1, Math.min(input.includeBodies ? 20 : MAX_HISTORY_LIMIT, requestedLimit))
  const decoded = await decodeCursor(input.cursorSecret, input.cursor, "dossier_history")
  if (decoded && decoded.gene_id !== authority.gene.gene_id) {
    throw authorityError("INVALID_CURSOR", "Cursor belongs to another gene")
  }
  const head = await readHead(db, authority.gene.gene_id)
  const rows = await readRevisionRows(db, authority.gene.gene_id, decoded, limit)
  const rawPageRows = rows.slice(0, limit)
  const pageRows = input.includeBodies
    ? await hydrateManifestationRevisionBodies(
        input.storageEnv,
        rawPageRows,
        input.onIntegrityFailure,
      )
    : rawPageRows
  const revisionIds = pageRows.map((row) => row.manifestation_revision_id)
  const [{ total }, manifestations, relations] = await Promise.all([
    first(
      db,
      `SELECT COUNT(*) AS total FROM icono_manifestation_revisions revision
        JOIN icono_manifestations manifestation
          ON manifestation.manifestation_id = revision.manifestation_id
       WHERE manifestation.gene_id = ?`,
      authority.gene.gene_id,
    ),
    all(
      db,
      `SELECT manifestation.manifestation_id, manifestation.gene_id,
              manifestation.author_account_id, manifestation.caretaker_assignment_id,
              manifestation.origin, manifestation.status,
              manifestation.manifestation_head_revision_id,
              manifestation.source_manifestation_id, manifestation.row_version,
               manifestation.non_withdrawable, manifestation.created_at,
               author.public_credit_label AS author_public_credit_label,
               author.status AS author_account_status,
               EXISTS (
                 SELECT 1 FROM icono_manifestation_revisions restore_revision
                 JOIN icono_manifestation_revision_lifecycle restore_lifecycle
                   ON restore_lifecycle.manifestation_revision_id = restore_revision.manifestation_revision_id
                 JOIN icono_manifestation_revision_storage_secrets restore_storage
                   ON restore_storage.manifestation_revision_id = restore_revision.manifestation_revision_id
                WHERE restore_revision.manifestation_revision_id = manifestation.manifestation_head_revision_id
                  AND restore_lifecycle.status = 'withdrawn'
               ) AS restore_body_available
         FROM icono_manifestations manifestation
         LEFT JOIN icono_authority_accounts author
           ON author.account_id = manifestation.author_account_id
        WHERE manifestation.gene_id = ?
        ORDER BY manifestation.created_at, manifestation.manifestation_id`,
      authority.gene.gene_id,
    ),
    pageRelations(db, authority.gene.gene_id, revisionIds),
  ])
  const nextRow = rows.length > limit ? pageRows.at(-1) : null
  const browser = audience === "browser"
  if (browser) {
    const activeTerms =
      authority.assignment?.status === "pending_acceptance"
        ? await first(
            db,
            `SELECT terms_version_id, terms_sha256, document_url, display_label, effective_at
             FROM icono_caretaker_terms_versions
            WHERE retired_at IS NULL AND effective_at <= ?
            ORDER BY effective_at DESC, terms_version_id DESC LIMIT 1`,
            input.now ? new Date(input.now).toISOString() : new Date().toISOString(),
          )
        : null
    const ownManifestations = manifestations.filter(
      (row) => row.author_account_id === authority.actor.account_id,
    )
    const previewEntries = await Promise.all(
      ownManifestations.map(async (manifestation) => [
        manifestation.manifestation_id,
        head.canonical_manifestation_id === manifestation.manifestation_id
          ? await readWithdrawalFallbackPreview(
              db,
              authority.gene.gene_id,
              manifestation.manifestation_id,
            )
          : {
              fallback_revision_id: head.canonical_revision_id || null,
              fallback_label: "the current canonical manifestation",
            },
      ]),
    )
    const withdrawalPreviews = new Map(previewEntries)
    const currentManifestation = manifestations.find(
      (row) => row.caretaker_assignment_id === authority.assignment?.caretaker_assignment_id,
    )
    const browserRevisions = pageRows.map((row) => {
      const derivativeRows = relations.derivatives.filter(
        (candidate) => candidate.manifestation_revision_id === row.manifestation_revision_id,
      )
      const derivative =
        derivativeRows.find(
          (candidate) => candidate.accepted_derivative_id === candidate.manifestation_derivative_id,
        ) ||
        derivativeRows[0] ||
        null
      return {
        manifestation_revision_id: row.manifestation_revision_id,
        manifestation_id: row.manifestation_id,
        revision_number: Number(row.revision_number),
        parent_revision_id: row.parent_revision_id || null,
        source_revision_id: row.source_revision_id || null,
        body_sha256: row.body_sha256,
        body_bytes: Number(row.body_bytes),
        body: row.prose ?? "",
        body_available:
          row.body_state === "available" &&
          !new Set(["purged", "quarantined"]).has(row.lifecycle_status),
        lifecycle: row.lifecycle_status,
        lifecycle_version: Number(row.lifecycle_version),
        sample_label: row.sample_label || null,
        sample_number: row.sample_number == null ? null : Number(row.sample_number),
        sample_text_sha256: row.sample_text_sha256 || null,
        author_is_viewer: row.author_account_id === authority.actor.account_id,
        derivative: browserDerivative(derivative),
        generation_provenance: browserGenerationProvenance(derivative),
        created_at: row.created_at,
      }
    })
    const pinnedIds = [
      ...new Set(
        [head.canonical_revision_id, currentManifestation?.manifestation_head_revision_id].filter(
          Boolean,
        ),
      ),
    ]
    const pageById = new Map(
      browserRevisions.map((revision) => [revision.manifestation_revision_id, revision]),
    )
    const fetchedPins = await readPinnedManifestationRevisions(db, input.storageEnv, {
      geneId: authority.gene.gene_id,
      revisionIds: pinnedIds.filter((id) => !pageById.has(id)),
      onIntegrityFailure: input.onIntegrityFailure,
    })
    const fetchedById = new Map(
      fetchedPins.map((revision) => [revision.manifestation_revision_id, revision]),
    )
    const pinnedRevisions = pinnedIds
      .map((id) => pageById.get(id) || fetchedById.get(id))
      .filter(Boolean)
    const nestedManifestations = manifestations.map((row) => {
      const manifestation = browserManifestation(row, authority)
      const manifestationRevisions = browserRevisions.filter(
        (revision) => revision.manifestation_id === row.manifestation_id,
      )
      const headRevision = manifestationRevisions.find(
        (revision) => revision.manifestation_revision_id === row.manifestation_head_revision_id,
      )
      return {
        ...manifestation,
        author_label:
          row.author_account_id === authority.actor.account_id
            ? "Your manifestation"
            : row.origin === "system_seed"
              ? "Original manifestation"
              : manifestation.author_label,
        head_body: headRevision?.body || "",
        withdrawal_preview: withdrawalPreviews.get(row.manifestation_id) || null,
        revisions: manifestationRevisions,
      }
    })
    const canEdit = authority.gene.status === "active" && authority.assignment?.status === "active"
    return Object.freeze({
      schema_version: 1,
      enabled: true,
      last_event_sequence: Number(head.last_event_sequence),
      gene: {
        gene_id: authority.gene.gene_id,
        symbol: authority.gene.canonical_symbol,
        status: authority.gene.status,
        merged_into_symbol: authority.gene.merged_into_symbol || null,
        aliases: authority.gene.aliases,
      },
      assignment: authority.assignment
        ? {
            caretaker_assignment_id: authority.assignment.caretaker_assignment_id,
            status: authority.assignment.status,
            assignment_version: Number(authority.assignment.assignment_version),
            leave_policy: authority.assignment.relinquish_policy || null,
            terms: activeTerms
              ? {
                  terms_version_id: activeTerms.terms_version_id,
                  document_url: activeTerms.document_url,
                  display_label: activeTerms.display_label,
                  content_sha256: activeTerms.terms_sha256,
                  effective_at: activeTerms.effective_at,
                }
              : null,
            withdrawal_preview:
              withdrawalPreviews.get(currentManifestation?.manifestation_id) || null,
          }
        : null,
      viewer: {
        is_caretaker: new Set(["pending_acceptance", "active", "suspended"]).has(
          authority.assignment?.status,
        ),
        can_accept: authority.assignment?.status === "pending_acceptance",
        can_decline: authority.assignment?.status === "pending_acceptance",
        can_edit: canEdit,
        suspended: authority.assignment?.status === "suspended",
      },
      head: {
        head_version: Number(head.head_version),
        canonical_selection_id: head.canonical_selection_id || null,
        canonical_revision_id: head.canonical_revision_id || null,
        gene_revision: Number(head.gene_revision),
      },
      pinned_revisions: pinnedRevisions,
      manifestations: nestedManifestations,
      history: {
        total_count: Number(total || 0),
        next_cursor: nextRow
          ? await encodeCursor(input.cursorSecret, {
              version: 1,
              kind: "dossier_history",
              gene_id: authority.gene.gene_id,
              created_at: nextRow.created_at,
              revision_id: nextRow.manifestation_revision_id,
            })
          : null,
      },
    })
  }
  return Object.freeze({
    schema_version: 1,
    last_event_sequence: Number(head.last_event_sequence),
    gene: geneSnapshot(authority.gene),
    read_only: authority.gene.status !== "active",
    merged_into_gene_id: authority.gene.merged_into_gene_id || null,
    authority: {
      administrator: Boolean(input.administrator),
      caretaker_assignment_id: authority.assignment?.caretaker_assignment_id || null,
      assignment_status: authority.assignment?.status || null,
      assignment_version:
        authority.assignment == null ? null : Number(authority.assignment.assignment_version),
      can_decline: authority.assignment?.status === "pending_acceptance",
      can_mutate: authority.gene.status === "active" && authority.assignment?.status === "active",
    },
    canonical: {
      manifestation_id: head.canonical_manifestation_id || null,
      manifestation_revision_id: head.canonical_revision_id || null,
      canonical_selection_id: head.canonical_selection_id || null,
      head_version: Number(head.head_version),
      gene_revision: Number(head.gene_revision),
    },
    manifestations,
    revisions: pageRows.map(internalRevision),
    selections: relations.selections,
    derivatives: relations.derivatives.map((row) => ({
      ...row,
      body_bytes: row.body_bytes == null ? null : Number(row.body_bytes),
      body_available: Boolean(row.body_available) && row.status !== "purged",
      derivative_head_version: Number(row.derivative_head_version),
    })),
    history: {
      total: Number(total || 0),
      next_cursor: nextRow
        ? await encodeCursor(input.cursorSecret, {
            version: 1,
            kind: "dossier_history",
            gene_id: authority.gene.gene_id,
            created_at: nextRow.created_at,
            revision_id: nextRow.manifestation_revision_id,
          })
        : null,
    },
  })
}

async function revisionBodySecret(db, geneId, revisionId) {
  return first(
    db,
    `SELECT revision.manifestation_revision_id, manifestation.gene_id,
            revision.body_sha256, revision.body_bytes, lifecycle.status AS lifecycle_status,
            storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
            storage.body_iv_base64, storage.wrapped_dek_base64,
            storage.wrap_iv_base64, storage.key_version, storage.aad_version
       FROM icono_manifestation_revisions revision
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
      WHERE revision.manifestation_revision_id = ? AND manifestation.gene_id = ?`,
    revisionId,
    geneId,
  )
}

export async function readAuthorizedManifestationRevisionBody(db, env, input = {}) {
  const authority = await requireGeneDossierAuthority(db, input)
  const revisionId = normalizeId(input.revisionId, "manifestation_revision_id")
  const secret = await revisionBodySecret(db, authority.gene.gene_id, revisionId)
  if (!secret) throw authorityError("REVISION_NOT_FOUND", "Revision was not found", 404)
  if (new Set(["purged", "quarantined"]).has(secret.lifecycle_status) || !secret.object_key) {
    throw authorityError("REVISION_BODY_UNAVAILABLE", "Revision body is unavailable", 410)
  }
  const encrypted = await readEncryptedManifestationBody(env, secret.object_key)
  if (!encrypted)
    throw authorityError("REVISION_BODY_UNAVAILABLE", "Revision body is unavailable", 503)
  const prose = await decryptManifestationProse(env, {
    revisionId,
    geneId: secret.gene_id,
    ciphertext: encrypted.bytes,
    ciphertextSha256: secret.ciphertext_sha256,
    ciphertextBytes: Number(secret.ciphertext_bytes),
    bodySha256: secret.body_sha256,
    bodyBytes: Number(secret.body_bytes),
    bodyIvBase64: secret.body_iv_base64,
    wrappedDekBase64: secret.wrapped_dek_base64,
    wrapIvBase64: secret.wrap_iv_base64,
    keyVersion: Number(secret.key_version),
    aadVersion: Number(secret.aad_version),
  })
  return Object.freeze({
    manifestation_revision_id: revisionId,
    body_sha256: secret.body_sha256,
    body_bytes: Number(secret.body_bytes),
    prose,
  })
}

export async function readAuthorizedManifestationDerivativeBody(db, env, input = {}) {
  const authority = await requireGeneDossierAuthority(db, input)
  const derivativeId = normalizeId(input.derivativeId, "manifestation_derivative_id")
  const secret = await first(
    db,
    `SELECT derivative.manifestation_derivative_id,
            derivative.manifestation_revision_id, derivative.source_body_sha256,
            derivative.body_sha256, derivative.body_bytes, derivative.status,
            storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
            storage.body_iv_base64, storage.wrapped_dek_base64,
            storage.wrap_iv_base64, storage.key_version, storage.aad_version
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = derivative.manifestation_revision_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       LEFT JOIN icono_manifestation_derivative_storage_secrets storage
         ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
      WHERE derivative.manifestation_derivative_id = ? AND manifestation.gene_id = ?
        AND lifecycle.status NOT IN ('purged', 'quarantined')`,
    derivativeId,
    authority.gene.gene_id,
  )
  if (!secret) throw authorityError("DERIVATIVE_NOT_FOUND", "Derivative was not found", 404)
  if (secret.status !== "complete" || !secret.object_key) {
    throw authorityError("DERIVATIVE_BODY_UNAVAILABLE", "Derivative body is unavailable", 410)
  }
  const encrypted = await readEncryptedManifestationBody(env, secret.object_key)
  if (!encrypted)
    throw authorityError("DERIVATIVE_BODY_UNAVAILABLE", "Derivative body is unavailable", 503)
  const tags = await decryptManifestationTags(env, {
    derivativeId,
    revisionId: secret.manifestation_revision_id,
    sourceBodySha256: secret.source_body_sha256,
    ciphertext: encrypted.bytes,
    ciphertextSha256: secret.ciphertext_sha256,
    ciphertextBytes: Number(secret.ciphertext_bytes),
    bodySha256: secret.body_sha256,
    bodyBytes: Number(secret.body_bytes),
    bodyIvBase64: secret.body_iv_base64,
    wrappedDekBase64: secret.wrapped_dek_base64,
    wrapIvBase64: secret.wrap_iv_base64,
    keyVersion: Number(secret.key_version),
    aadVersion: Number(secret.aad_version),
  })
  return Object.freeze({
    manifestation_derivative_id: derivativeId,
    manifestation_revision_id: secret.manifestation_revision_id,
    body_sha256: secret.body_sha256,
    body_bytes: Number(secret.body_bytes),
    tags,
  })
}

export { requireGeneDossierAuthority }
export { resolveGene } from "./manifestation-gene-resolver.js"
