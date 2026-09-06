import { readCanonicalProjectionRecord } from "../iconoplasm/caretaker/manifestation-authority.js"

const ACTIVE_AUTHORITY_MODE = "authoritative"
const CUTOVER_AUTHORITY_MODE = "shadow_frozen"
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const GENERATED_DERIVATIVE_FIELDS = Object.freeze([
  "recipe_id",
  "recipe_version",
  "provider_id",
  "model_id",
  "tagger_config_sha256",
])
const PUBLIC_MATERIAL_CHANGED_SQL = Object.freeze([
  "canonical_symbol",
  "canonical_manifestation_id",
  "canonical_revision_id",
  "canonical_selection_id",
  "canonical_body_sha256",
  "canonical_body_bytes",
  "canonical_revision_lifecycle",
  "canonical_public_page_visible",
  "accepted_tags_derivative_id",
  "accepted_tags_derivative_head_version",
  "accepted_tags_status",
  "accepted_tags_source_body_sha256",
  "accepted_tags_body_sha256",
  "accepted_tags_body_bytes",
  "accepted_tags_text_sha256",
  "accepted_tags_text_bytes",
  "accepted_tags_fields_sha256",
  "accepted_tags_fields_bytes",
  "accepted_tags_recipe_id",
  "accepted_tags_recipe_version",
  "accepted_tags_provider_id",
  "accepted_tags_model_id",
  "accepted_tags_config_sha256",
  "accepted_tags_provenance_status",
  "head_version",
])
  .map((field) => `icono_manifestation_canonical_projection.${field} IS NOT excluded.${field}`)
  .join(" OR ")

export class ManifestationProjectionError extends Error {
  constructor(code, message, status = 503) {
    super(message)
    this.name = "ManifestationProjectionError"
    this.code = code
    this.status = status
  }
}

function projectionError(code, message, status = 503) {
  throw new ManifestationProjectionError(code, message, status)
}

function requiredText(value, field) {
  const normalized = String(value || "").trim()
  if (!normalized) projectionError("INVALID_AUTHORITY_PROJECTION", `${field} is required`)
  return normalized
}

function positiveVersion(value, field) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    projectionError("INVALID_AUTHORITY_PROJECTION", `${field} must be a positive integer`)
  }
  return normalized
}

function sha256(value, field) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    projectionError("INVALID_AUTHORITY_PROJECTION", `${field} must be a lowercase SHA-256`)
  }
  return normalized
}

function optionalSha256(value, field) {
  if (value === null || value === undefined || String(value).trim() === "") return null
  return sha256(value, field)
}

function nonNegativeInteger(value, field) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    projectionError("INVALID_AUTHORITY_PROJECTION", `${field} must be a non-negative integer`)
  }
  return normalized
}

function boundedBytes(value, field, minimum, maximum) {
  const normalized = positiveVersion(value, field)
  if (normalized < minimum || normalized > maximum) {
    projectionError(
      "INVALID_AUTHORITY_PROJECTION",
      `${field} must be between ${minimum} and ${maximum} bytes`,
    )
  }
  return normalized
}

function optionalCanonical(rawCanonical) {
  if (!rawCanonical) return null
  const canonical = {
    manifestation_id: requiredText(rawCanonical.manifestation_id, "canonical.manifestation_id"),
    manifestation_revision_id: requiredText(
      rawCanonical.manifestation_revision_id,
      "canonical.manifestation_revision_id",
    ),
    canonical_selection_id: requiredText(
      rawCanonical.canonical_selection_id,
      "canonical.canonical_selection_id",
    ),
    body_sha256: sha256(rawCanonical.body_sha256, "canonical.body_sha256"),
    body_bytes: positiveVersion(rawCanonical.body_bytes, "canonical.body_bytes"),
    lifecycle: requiredText(rawCanonical.lifecycle, "canonical.lifecycle"),
    public_page_visible: rawCanonical.public_page_visible === true,
  }
  if (canonical.body_bytes > 16_384) {
    projectionError("INVALID_AUTHORITY_PROJECTION", "canonical.body_bytes exceeds 16 KiB")
  }
  if (canonical.lifecycle !== "active") {
    projectionError(
      "INELIGIBLE_CANONICAL_REVISION",
      "The authority head points at a non-active manifestation revision",
    )
  }
  return canonical
}

function optionalDerivative(rawDerivative, canonical) {
  if (!rawDerivative) return null
  if (!canonical) {
    projectionError(
      "ORPHANED_ACCEPTED_DERIVATIVE",
      "An accepted Tags derivative cannot exist without a canonical revision",
    )
  }
  const provenanceStatus = requiredText(
    rawDerivative.provenance_status,
    "accepted_tags_derivative.provenance_status",
  )
  if (!new Set(["generated", "legacy_unknown"]).has(provenanceStatus)) {
    projectionError(
      "INVALID_AUTHORITY_PROJECTION",
      "accepted_tags_derivative.provenance_status is invalid",
    )
  }
  const generated = Object.fromEntries(
    GENERATED_DERIVATIVE_FIELDS.map((field) => [
      field,
      field === "tagger_config_sha256"
        ? rawDerivative[field]
          ? sha256(rawDerivative[field], `accepted_tags_derivative.${field}`)
          : null
        : String(rawDerivative[field] || "").trim() || null,
    ]),
  )
  const suppliedGeneratedFields = GENERATED_DERIVATIVE_FIELDS.filter((field) => generated[field])
  if (
    (provenanceStatus === "generated" &&
      suppliedGeneratedFields.length !== GENERATED_DERIVATIVE_FIELDS.length) ||
    (provenanceStatus === "legacy_unknown" && suppliedGeneratedFields.length !== 0)
  ) {
    projectionError(
      "INVALID_DERIVATIVE_PROVENANCE",
      "Accepted Tags derivative provenance is incomplete or internally inconsistent",
    )
  }
  const derivative = {
    manifestation_derivative_id: requiredText(
      rawDerivative.manifestation_derivative_id,
      "accepted_tags_derivative.manifestation_derivative_id",
    ),
    derivative_head_version: positiveVersion(
      rawDerivative.derivative_head_version,
      "accepted_tags_derivative.derivative_head_version",
    ),
    status: requiredText(rawDerivative.status, "accepted_tags_derivative.status"),
    source_body_sha256: sha256(
      rawDerivative.source_body_sha256,
      "accepted_tags_derivative.source_body_sha256",
    ),
    body_sha256: sha256(rawDerivative.body_sha256, "accepted_tags_derivative.body_sha256"),
    body_bytes: boundedBytes(
      rawDerivative.body_bytes,
      "accepted_tags_derivative.body_bytes",
      4,
      32_768,
    ),
    tags_sha256: sha256(rawDerivative.tags_sha256, "accepted_tags_derivative.tags_sha256"),
    tags_bytes: boundedBytes(
      rawDerivative.tags_bytes,
      "accepted_tags_derivative.tags_bytes",
      1,
      32_767,
    ),
    fields_sha256: sha256(rawDerivative.fields_sha256, "accepted_tags_derivative.fields_sha256"),
    fields_bytes: boundedBytes(
      rawDerivative.fields_bytes,
      "accepted_tags_derivative.fields_bytes",
      2,
      32_766,
    ),
    provenance_status: provenanceStatus,
    ...generated,
  }
  if (derivative.status !== "complete") {
    projectionError(
      "INELIGIBLE_ACCEPTED_DERIVATIVE",
      "The accepted Tags derivative is not complete",
    )
  }
  if (derivative.source_body_sha256 !== canonical.body_sha256) {
    projectionError(
      "STALE_ACCEPTED_DERIVATIVE",
      "The accepted Tags derivative was generated from a different manifestation revision body",
    )
  }
  if (derivative.body_bytes !== derivative.tags_bytes + 1 + derivative.fields_bytes) {
    projectionError(
      "INVALID_AUTHORITY_PROJECTION",
      "accepted Tags compound body byte count does not match its exact text and fields components",
    )
  }
  return derivative
}

function normalizeExactRecord(rawRecord) {
  const record = rawRecord && typeof rawRecord === "object" ? rawRecord : {}
  const canonical = optionalCanonical(record.canonical)
  const headVersion = nonNegativeInteger(record.head_version, "head_version")
  if (canonical && headVersion < 1) {
    projectionError(
      "INVALID_AUTHORITY_PROJECTION",
      "head_version must be positive when a canonical revision is selected",
    )
  }
  return Object.freeze({
    gene_id: requiredText(record.gene_id, "gene_id"),
    canonical_symbol: requiredText(record.canonical_symbol, "canonical_symbol").toUpperCase(),
    head_version: headVersion,
    gene_revision: positiveVersion(record.gene_revision, "gene_revision"),
    last_event_id: requiredText(record.last_event_id, "last_event_id"),
    last_event_sequence: positiveVersion(record.last_event_sequence, "last_event_sequence"),
    canonical,
    accepted_tags_derivative: optionalDerivative(record.accepted_tags_derivative, canonical),
  })
}

async function readProjectionAuthority(primaryDb) {
  if (!primaryDb?.prepare) projectionError("PRIMARY_DB_REQUIRED", "ICONOPLASM_DB binding missing")
  const row = await primaryDb
    .prepare(
      `SELECT authority_epoch, mode, source_snapshot_sha256, expected_gene_count
         FROM icono_manifestation_projection_authority
        WHERE singleton = 1`,
    )
    .first()
  if (!row)
    projectionError("PROJECTION_AUTHORITY_NOT_CONFIGURED", "Projection authority is missing")
  return {
    authority_epoch: positiveVersion(row.authority_epoch, "authority_epoch"),
    mode: String(row.mode || "").trim(),
    source_snapshot_sha256: optionalSha256(row.source_snapshot_sha256, "source_snapshot_sha256"),
    expected_gene_count:
      row.expected_gene_count === null || row.expected_gene_count === undefined
        ? null
        : nonNegativeInteger(row.expected_gene_count, "expected_gene_count"),
  }
}

export async function requireManifestationAuthorityWriteMode(primaryDb) {
  const authority = await readProjectionAuthority(primaryDb)
  if (authority.mode !== ACTIVE_AUTHORITY_MODE) {
    projectionError(
      "MANIFESTATION_AUTHORITY_NOT_WRITABLE",
      "Caretaker manifestation writes are unavailable until authority cutover is complete",
      503,
    )
  }
  return Object.freeze(authority)
}

function callbackGeneId(event) {
  return requiredText(event?.gene_id || event?.payload?.gene?.gene_id, "event.gene_id")
}

function assertMatchingCurrentCallback(event, exact) {
  const callbackSequence = positiveVersion(event?.event_sequence, "event.event_sequence")
  const callbackEventId = requiredText(event?.event_id, "event.event_id")
  if (callbackSequence > exact.last_event_sequence) {
    projectionError(
      "AUTHORITY_EVENT_AHEAD_OF_HEAD",
      "Authority callback sequence is ahead of the exact current head",
    )
  }
  if (callbackSequence !== exact.last_event_sequence) return
  if (callbackEventId !== exact.last_event_id) {
    projectionError(
      "AUTHORITY_EVENT_ID_MISMATCH",
      "Authority callback ID does not match the exact current head event",
    )
  }
  const payloadCanonical = event?.payload?.canonical
  if (!payloadCanonical) return
  const payloadRevisionId = String(payloadCanonical.manifestation_revision_id || "").trim() || null
  const exactRevisionId = exact.canonical?.manifestation_revision_id || null
  if (
    Number(payloadCanonical.head_version) !== exact.head_version ||
    Number(payloadCanonical.gene_revision) !== exact.gene_revision ||
    payloadRevisionId !== exactRevisionId
  ) {
    projectionError(
      "AUTHORITY_EVENT_HEAD_MISMATCH",
      "Authority callback payload does not match the exact current head",
    )
  }
}

async function persistCanonicalManifestationProjection({ primaryDb, authority, event, exact }) {
  const geneId = callbackGeneId(event)
  if (exact.gene_id !== geneId) {
    projectionError(
      "AUTHORITY_GENE_ID_MISMATCH",
      "Exact authority record belongs to a different gene",
    )
  }
  assertMatchingCurrentCallback(event, exact)

  const canonical = exact.canonical
  const derivative = exact.accepted_tags_derivative
  if (typeof primaryDb.batch !== "function") {
    projectionError(
      "PRIMARY_DB_TRANSACTION_REQUIRED",
      "Canonical projection and publication wake require an atomic D1 batch",
    )
  }
  const projectionWrite = primaryDb
    .prepare(
      `INSERT INTO icono_manifestation_canonical_projection (
         gene_id, canonical_symbol,
         canonical_manifestation_id, canonical_revision_id,
         canonical_selection_id, canonical_body_sha256, canonical_body_bytes,
         canonical_revision_lifecycle, canonical_public_page_visible,
         accepted_tags_derivative_id, accepted_tags_derivative_head_version,
         accepted_tags_status, accepted_tags_source_body_sha256,
         accepted_tags_body_sha256, accepted_tags_body_bytes,
         accepted_tags_text_sha256, accepted_tags_text_bytes,
         accepted_tags_fields_sha256, accepted_tags_fields_bytes,
         accepted_tags_recipe_id, accepted_tags_recipe_version,
         accepted_tags_provider_id, accepted_tags_model_id,
         accepted_tags_config_sha256, accepted_tags_provenance_status,
          head_version, gene_revision, authority_event_id,
          authority_event_sequence, authority_epoch, public_material_event_id,
          public_material_version, projection_version,
          projected_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1,
         CURRENT_TIMESTAMP
       )
       ON CONFLICT(gene_id) DO UPDATE SET
         canonical_symbol = excluded.canonical_symbol,
         canonical_manifestation_id = excluded.canonical_manifestation_id,
         canonical_revision_id = excluded.canonical_revision_id,
         canonical_selection_id = excluded.canonical_selection_id,
         canonical_body_sha256 = excluded.canonical_body_sha256,
         canonical_body_bytes = excluded.canonical_body_bytes,
         canonical_revision_lifecycle = excluded.canonical_revision_lifecycle,
         canonical_public_page_visible = excluded.canonical_public_page_visible,
         accepted_tags_derivative_id = excluded.accepted_tags_derivative_id,
         accepted_tags_derivative_head_version = excluded.accepted_tags_derivative_head_version,
         accepted_tags_status = excluded.accepted_tags_status,
         accepted_tags_source_body_sha256 = excluded.accepted_tags_source_body_sha256,
         accepted_tags_body_sha256 = excluded.accepted_tags_body_sha256,
         accepted_tags_body_bytes = excluded.accepted_tags_body_bytes,
         accepted_tags_text_sha256 = excluded.accepted_tags_text_sha256,
         accepted_tags_text_bytes = excluded.accepted_tags_text_bytes,
         accepted_tags_fields_sha256 = excluded.accepted_tags_fields_sha256,
         accepted_tags_fields_bytes = excluded.accepted_tags_fields_bytes,
         accepted_tags_recipe_id = excluded.accepted_tags_recipe_id,
         accepted_tags_recipe_version = excluded.accepted_tags_recipe_version,
         accepted_tags_provider_id = excluded.accepted_tags_provider_id,
         accepted_tags_model_id = excluded.accepted_tags_model_id,
         accepted_tags_config_sha256 = excluded.accepted_tags_config_sha256,
         accepted_tags_provenance_status = excluded.accepted_tags_provenance_status,
         head_version = excluded.head_version,
         gene_revision = excluded.gene_revision,
         authority_event_id = excluded.authority_event_id,
          authority_event_sequence = excluded.authority_event_sequence,
          authority_epoch = excluded.authority_epoch,
          public_material_event_id = CASE
            WHEN ${PUBLIC_MATERIAL_CHANGED_SQL}
              THEN excluded.authority_event_id
            ELSE public_material_event_id
          END,
          public_material_version = CASE
            WHEN ${PUBLIC_MATERIAL_CHANGED_SQL}
              THEN public_material_version + 1
            ELSE public_material_version
          END,
          projection_version = CASE
           WHEN excluded.authority_event_sequence > authority_event_sequence
             THEN projection_version + 1
           ELSE projection_version
         END,
         projected_at = CASE
           WHEN excluded.authority_event_sequence > authority_event_sequence
             THEN CURRENT_TIMESTAMP
           ELSE projected_at
         END
       WHERE excluded.authority_event_sequence >= authority_event_sequence`,
    )
    .bind(
      exact.gene_id,
      exact.canonical_symbol,
      canonical?.manifestation_id || null,
      canonical?.manifestation_revision_id || null,
      canonical?.canonical_selection_id || null,
      canonical?.body_sha256 || null,
      canonical?.body_bytes || null,
      canonical?.lifecycle || null,
      canonical?.public_page_visible ? 1 : 0,
      derivative?.manifestation_derivative_id || null,
      derivative?.derivative_head_version || null,
      derivative?.status || null,
      derivative?.source_body_sha256 || null,
      derivative?.body_sha256 || null,
      derivative?.body_bytes || null,
      derivative?.tags_sha256 || null,
      derivative?.tags_bytes || null,
      derivative?.fields_sha256 || null,
      derivative?.fields_bytes || null,
      derivative?.recipe_id || null,
      derivative?.recipe_version || null,
      derivative?.provider_id || null,
      derivative?.model_id || null,
      derivative?.tagger_config_sha256 || null,
      derivative?.provenance_status || null,
      exact.head_version,
      exact.gene_revision,
      exact.last_event_id,
      exact.last_event_sequence,
      authority.authority_epoch,
      exact.last_event_id,
    )

  const publicationWakeWrite = primaryDb
    .prepare(
      `INSERT OR IGNORE INTO icono_manifestation_publication_wakes (
         authority_event_id, authority_event_sequence, gene_id, canonical_symbol
       )
       SELECT authority_event_id, authority_event_sequence, gene_id, canonical_symbol
         FROM icono_manifestation_canonical_projection
        WHERE gene_id = ?
          AND authority_event_id = ?
          AND public_material_event_id = ?`,
    )
    .bind(exact.gene_id, exact.last_event_id, exact.last_event_id)
  await primaryDb.batch([projectionWrite, publicationWakeWrite])

  const projected = await primaryDb
    .prepare(
      `SELECT *
         FROM icono_manifestation_canonical_projection
        WHERE gene_id = ?`,
    )
    .bind(exact.gene_id)
    .first()
  if (!projected) {
    projectionError("AUTHORITY_PROJECTION_MISSING", "Canonical projection was not persisted")
  }
  const wake = await primaryDb
    .prepare(
      `SELECT authority_event_sequence, gene_id, canonical_symbol
         FROM icono_manifestation_publication_wakes WHERE authority_event_id = ?`,
    )
    .bind(exact.last_event_id)
    .first()
  if (
    wake &&
    (Number(wake.authority_event_sequence) !== exact.last_event_sequence ||
      wake.gene_id !== exact.gene_id ||
      String(wake.canonical_symbol || "").toUpperCase() !== exact.canonical_symbol)
  ) {
    projectionError(
      "AUTHORITY_PUBLICATION_WAKE_CONFLICT",
      "Canonical publication wake conflicts with the exact authority event",
    )
  }
  return Object.freeze({
    ok: true,
    stale_callback: Number(event.event_sequence) < exact.last_event_sequence,
    authority_event_id: exact.last_event_id,
    authority_event_sequence: exact.last_event_sequence,
    head_version: exact.head_version,
    gene_revision: exact.gene_revision,
    canonical_revision_id: canonical?.manifestation_revision_id || null,
    public_material_changed: Boolean(wake),
    projection_version: Number(projected.projection_version),
  })
}

async function exactCanonicalRecord(authoringDb, geneId, readCanonical) {
  if (!authoringDb?.prepare) {
    projectionError("AUTHORING_DB_REQUIRED", "ICONOPLASM_AUTHORING_DB binding missing")
  }
  return normalizeExactRecord(await readCanonical(authoringDb, geneId))
}

export async function projectCanonicalManifestationAuthorityEvent(
  { primaryDb, authoringDb, event } = {},
  { readCanonical = readCanonicalProjectionRecord } = {},
) {
  const authority = await requireManifestationAuthorityWriteMode(primaryDb)
  const geneId = callbackGeneId(event)
  const exact = await exactCanonicalRecord(authoringDb, geneId, readCanonical)
  return persistCanonicalManifestationProjection({ primaryDb, authority, event, exact })
}

function requireCutoverIdentity(authority) {
  if (authority.mode !== CUTOVER_AUTHORITY_MODE) {
    projectionError(
      "CUTOVER_PROJECTION_NOT_WRITABLE",
      "Cutover projection is available only while the frozen source is being imported",
    )
  }
  if (!authority.source_snapshot_sha256 || authority.expected_gene_count === null) {
    projectionError(
      "CUTOVER_PROJECTION_IDENTITY_MISSING",
      "The primary cutover snapshot identity is incomplete",
    )
  }
}

async function readCutoverProjectionFence(authoringDb, { cutoverRunId, event, geneId }) {
  const runId = requiredText(cutoverRunId, "cutover_run_id")
  const eventId = requiredText(event?.event_id, "event.event_id")
  const eventSequence = positiveVersion(event?.event_sequence, "event.event_sequence")
  const run = await authoringDb
    .prepare(
      `SELECT cutover_run_id, source_snapshot_sha256, source_gene_count,
              target_authority_epoch, status
         FROM icono_manifestation_cutover_runs
        WHERE cutover_run_id = ?`,
    )
    .bind(runId)
    .first()
  if (!run) projectionError("CUTOVER_RUN_NOT_FOUND", "The authoring cutover run was not found", 404)

  const item = await authoringDb
    .prepare(
      `SELECT cutover_run_id, canonical_symbol, gene_id, source_kind,
              seed_manifestation_id, seed_revision_id, seed_selection_id,
              seed_command_id, seed_tags_derivative_id, seed_tags_command_id,
              seed_tags_selection_command_id, source_body_sha256, source_body_bytes,
              source_tags_sha256, source_tags_bytes, source_fields_sha256,
              source_fields_bytes, status
         FROM icono_manifestation_cutover_items
        WHERE cutover_run_id = ? AND gene_id = ?`,
    )
    .bind(runId, geneId)
    .first()
  if (!item) {
    projectionError(
      "CUTOVER_ITEM_NOT_FOUND",
      "The gene is not part of the selected authoring cutover run",
      404,
    )
  }

  const acceptedEvent = await authoringDb
    .prepare(
      `SELECT accepted.command_id,
              head.last_event_sequence,
              current.event_uuid AS last_event_id
         FROM icono_manifestation_events accepted
         JOIN icono_manifestation_heads head ON head.gene_id = accepted.gene_id
         JOIN icono_manifestation_events current
           ON current.event_sequence = head.last_event_sequence
        WHERE accepted.event_uuid = ?
          AND accepted.event_sequence = ?
          AND accepted.gene_id = ?`,
    )
    .bind(eventId, eventSequence, geneId)
    .first()
  if (!acceptedEvent) {
    projectionError(
      "CUTOVER_EVENT_NOT_FOUND",
      "The cutover callback does not identify an accepted authoring event",
    )
  }
  if (
    Number(acceptedEvent.last_event_sequence) !== eventSequence ||
    String(acceptedEvent.last_event_id || "") !== eventId
  ) {
    projectionError(
      "CUTOVER_EVENT_NOT_CURRENT",
      "The cutover callback is not the exact current authoring head event",
    )
  }
  return { runId, run, item, commandId: String(acceptedEvent.command_id || "").trim() }
}

function assertMatchingCutoverRun(authority, fence) {
  const allowedRunStatuses = new Set(["importing", "seeded", "shadow_verified"])
  if (!allowedRunStatuses.has(String(fence.run.status || ""))) {
    projectionError("CUTOVER_RUN_NOT_PROJECTABLE", "The cutover run is not in a projectable state")
  }
  if (
    positiveVersion(fence.run.target_authority_epoch, "target_authority_epoch") !==
      authority.authority_epoch ||
    sha256(fence.run.source_snapshot_sha256, "cutover.source_snapshot_sha256") !==
      authority.source_snapshot_sha256 ||
    nonNegativeInteger(fence.run.source_gene_count, "cutover.source_gene_count") !==
      authority.expected_gene_count
  ) {
    projectionError(
      "CUTOVER_RUN_IDENTITY_MISMATCH",
      "The authoring cutover run does not match the frozen primary snapshot",
    )
  }
  const itemStatus = String(fence.item.status || "")
  const noManifestationRegistration =
    fence.item.source_kind === "no_manifestation" && itemStatus === "registered_unseeded"
  if (
    !noManifestationRegistration &&
    !new Set(["adopted", "projected", "verified"]).has(itemStatus)
  ) {
    projectionError("CUTOVER_ITEM_NOT_ADOPTED", "The cutover item has not been adopted")
  }
  const allowedCommands = new Set(
    [
      fence.item.seed_command_id,
      fence.item.seed_tags_command_id,
      fence.item.seed_tags_selection_command_id,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )
  if (!allowedCommands.has(fence.commandId)) {
    projectionError(
      "CUTOVER_EVENT_COMMAND_MISMATCH",
      "The current authoring event was not produced by this cutover item's deterministic seed commands",
    )
  }
}

function assertMatchingCutoverPlan(item, exact) {
  if (
    requiredText(item.gene_id, "cutover.gene_id") !== exact.gene_id ||
    requiredText(item.canonical_symbol, "cutover.canonical_symbol").toUpperCase() !==
      exact.canonical_symbol
  ) {
    projectionError(
      "CUTOVER_PLAN_GENE_MISMATCH",
      "The exact authority gene differs from the cutover plan",
    )
  }
  if (String(item.source_kind || "") === "no_manifestation") {
    if (
      exact.canonical ||
      exact.accepted_tags_derivative ||
      exact.head_version !== 0 ||
      exact.gene_revision !== 1
    ) {
      projectionError(
        "CUTOVER_PLAN_EMPTY_HEAD_MISMATCH",
        "The registered no-manifestation gene does not have its exact empty seed head",
      )
    }
    return
  }
  if (String(item.source_kind || "") !== "manifestation") {
    projectionError("CUTOVER_PLAN_SOURCE_KIND_INVALID", "The cutover source kind is invalid")
  }
  const canonical = exact.canonical
  if (
    !canonical ||
    canonical.manifestation_id !== String(item.seed_manifestation_id || "") ||
    canonical.manifestation_revision_id !== String(item.seed_revision_id || "") ||
    canonical.canonical_selection_id !== String(item.seed_selection_id || "") ||
    canonical.body_sha256 !== sha256(item.source_body_sha256, "cutover.source_body_sha256") ||
    canonical.body_bytes !== positiveVersion(item.source_body_bytes, "cutover.source_body_bytes")
  ) {
    projectionError(
      "CUTOVER_PLAN_CANONICAL_MISMATCH",
      "The exact canonical authority record differs from the immutable cutover plan",
    )
  }

  const plannedDerivativeId = String(item.seed_tags_derivative_id || "").trim() || null
  const derivative = exact.accepted_tags_derivative
  if (!plannedDerivativeId && derivative) {
    projectionError(
      "CUTOVER_PLAN_DERIVATIVE_MISMATCH",
      "The authority head has an accepted Tags derivative that is absent from the cutover plan",
    )
  }
  if (!plannedDerivativeId) return
  if (
    !derivative ||
    derivative.manifestation_derivative_id !== plannedDerivativeId ||
    derivative.tags_sha256 !== sha256(item.source_tags_sha256, "cutover.source_tags_sha256") ||
    derivative.tags_bytes !==
      positiveVersion(item.source_tags_bytes, "cutover.source_tags_bytes") ||
    derivative.fields_sha256 !==
      sha256(item.source_fields_sha256, "cutover.source_fields_sha256") ||
    derivative.fields_bytes !==
      positiveVersion(item.source_fields_bytes, "cutover.source_fields_bytes")
  ) {
    projectionError(
      "CUTOVER_PLAN_DERIVATIVE_MISMATCH",
      "The exact accepted Tags derivative differs from the immutable cutover plan",
    )
  }
}

export async function projectCanonicalManifestationCutoverEvent(
  { primaryDb, authoringDb, event, cutoverRunId } = {},
  { readCanonical = readCanonicalProjectionRecord } = {},
) {
  const authority = await readProjectionAuthority(primaryDb)
  requireCutoverIdentity(authority)
  if (!authoringDb?.prepare) {
    projectionError("AUTHORING_DB_REQUIRED", "ICONOPLASM_AUTHORING_DB binding missing")
  }
  const geneId = callbackGeneId(event)
  const fence = await readCutoverProjectionFence(authoringDb, { cutoverRunId, event, geneId })
  assertMatchingCutoverRun(authority, fence)
  const exact = await exactCanonicalRecord(authoringDb, geneId, readCanonical)
  assertMatchingCurrentCallback(event, exact)
  assertMatchingCutoverPlan(fence.item, exact)
  const projected = await persistCanonicalManifestationProjection({
    primaryDb,
    authority,
    event,
    exact,
  })
  return Object.freeze({ ...projected, cutover_run_id: fence.runId })
}

function projectionRetryAt(attempts, now) {
  const exponent = Math.min(8, Math.max(0, Number(attempts || 0)))
  const delayMs = Math.min(15 * 60_000, 5_000 * 2 ** exponent)
  return new Date(now.getTime() + delayMs).toISOString()
}

async function pendingProjectionEvents(authoringDb, { limit, now, priorityEventId = null }) {
  const priority = String(priorityEventId || "").trim()
  if (priority) {
    // Accepted-event delivery owns this exact event. The projector independently
    // reads the authoritative current head and cannot rewind it. Do not sort
    // or drain the unrelated backlog while handling a single accepted command.
    const row = await authoringDb
      .prepare(
        `SELECT event_uuid, event_sequence, gene_id, gene_revision, payload_json,
              projection_status, projection_attempts
         FROM icono_manifestation_events
        WHERE event_uuid = ? AND projection_status IN ('pending', 'failed')`,
      )
      .bind(priority)
      .first()
    return { rows: row ? [row] : [], hasMore: Boolean(row) && limit === 1 }
  }
  // Four disjoint ranges follow the existing retry index, each stopping at
  // limit entries. Coalesce only this bounded window; looking for the newest
  // pending event across all history turns LIMIT into an unbounded scan.
  // Older callbacks still project the exact current authority head below.
  const candidates = []
  let fullRange = false
  for (const status of ["pending", "failed"]) {
    for (const scheduled of [false, true]) {
      const response = await authoringDb
        .prepare(
          `SELECT event_uuid, event_sequence, gene_id, gene_revision, payload_json,
                  projection_status, projection_attempts
             FROM icono_manifestation_events
             INDEXED BY idx_icono_events_projection_due
            WHERE projection_status = ? AND ${
              scheduled
                ? "projection_next_attempt_at IS NOT NULL AND projection_next_attempt_at <= ?"
                : "projection_next_attempt_at IS NULL"
            }
            ORDER BY projection_next_attempt_at, event_sequence
            LIMIT ?`,
        )
        .bind(...(scheduled ? [status, now.toISOString(), limit] : [status, limit]))
        .all()
      const rows = Array.isArray(response?.results) ? response.results : []
      fullRange ||= rows.length === limit
      candidates.push(...rows)
    }
  }
  const latest = new Map()
  for (const row of candidates) {
    if (!latest.has(row.gene_id) || latest.get(row.gene_id).event_sequence < row.event_sequence)
      latest.set(row.gene_id, row)
  }
  const rows = [...latest.values()].sort((a, b) => a.event_sequence - b.event_sequence)
  return { rows: rows.slice(0, limit), hasMore: fullRange || rows.length > limit }
}

function projectionEnvelope(row) {
  let payload
  try {
    payload = JSON.parse(String(row?.payload_json || ""))
  } catch {
    projectionError("INVALID_AUTHORITY_EVENT_PAYLOAD", "Authority event payload is invalid JSON")
  }
  return {
    event_id: requiredText(row?.event_uuid, "event.event_id"),
    event_sequence: positiveVersion(row?.event_sequence, "event.event_sequence"),
    gene_revision: positiveVersion(row?.gene_revision, "event.gene_revision"),
    gene_id: requiredText(row?.gene_id, "event.gene_id"),
    payload,
  }
}

async function markProjectionPublished(authoringDb, envelope) {
  // UNIQUE(gene_id, gene_revision) bounds this numeric interval to 250 rows,
  // regardless of event history length or gaps in global event sequences.
  // Older pending records remain durable for the scheduled recovery pass.
  const revision = positiveVersion(envelope.gene_revision, "event.gene_revision")
  await authoringDb
    .prepare(
      `UPDATE icono_manifestation_events
          INDEXED BY sqlite_autoindex_icono_manifestation_events_3
          SET projection_status = 'published',
              projection_attempts = projection_attempts + CASE WHEN event_uuid = ? THEN 1 ELSE 0 END,
              projection_next_attempt_at = NULL
        WHERE gene_id = ? AND gene_revision BETWEEN ? AND ?
          AND projection_status IN ('pending', 'failed')`,
    )
    .bind(envelope.event_id, envelope.gene_id, Math.max(1, revision - 249), revision)
    .run()
}

async function markProjectionFailed(authoringDb, row, now) {
  const attempts = Math.max(0, Number(row?.projection_attempts || 0))
  await authoringDb
    .prepare(
      `UPDATE icono_manifestation_events
          SET projection_status = 'failed',
              projection_attempts = projection_attempts + 1,
              projection_next_attempt_at = ?
        WHERE event_uuid = ? AND event_sequence = ?
          AND projection_status IN ('pending', 'failed')`,
    )
    .bind(
      projectionRetryAt(attempts, now),
      requiredText(row?.event_uuid, "event.event_id"),
      positiveVersion(row?.event_sequence, "event.event_sequence"),
    )
    .run()
}

export async function drainManifestationAuthorityProjectionOutbox(
  {
    primaryDb,
    authoringDb,
    projectAssignmentEvent,
    projectPublicMaterialEvent,
    limit = 10,
    now = new Date(),
    priorityEventId = null,
    onIntegrityFailure = null,
  } = {},
  { readCanonical = readCanonicalProjectionRecord } = {},
) {
  if (!authoringDb?.prepare) {
    projectionError("AUTHORING_DB_REQUIRED", "ICONOPLASM_AUTHORING_DB binding missing")
  }
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 10)))
  const clock = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(clock.getTime())) throw new TypeError("Invalid projection drain timestamp")
  const pending = await pendingProjectionEvents(authoringDb, {
    limit: boundedLimit,
    now: clock,
    priorityEventId,
  })
  const rows = pending.rows
  const results = []
  for (const row of rows) {
    let envelope = null
    try {
      envelope = projectionEnvelope(row)
      const canonical = await projectCanonicalManifestationAuthorityEvent(
        { primaryDb, authoringDb, event: envelope },
        { readCanonical },
      )
      const assignment = envelope.payload?.assignment
      if (assignment) {
        if (typeof projectAssignmentEvent !== "function") {
          projectionError(
            "ASSIGNMENT_PROJECTOR_REQUIRED",
            "Caretaker assignment projection requires its durable-object projector",
          )
        }
        await projectAssignmentEvent({
          event_id: envelope.event_id,
          event_sequence: envelope.event_sequence,
          gene_id: envelope.gene_id,
          ...envelope.payload,
        })
      }
      if (canonical.public_material_changed) {
        if (typeof projectPublicMaterialEvent !== "function") {
          projectionError(
            "PUBLIC_MATERIAL_PROJECTOR_REQUIRED",
            "Canonical manifestation projection requires its public card publication wake",
          )
        }
        await projectPublicMaterialEvent({
          event_id: canonical.authority_event_id,
          event_sequence: canonical.authority_event_sequence,
          gene_id: envelope.gene_id,
        })
      }
      await markProjectionPublished(authoringDb, envelope)
      results.push({
        event_id: envelope.event_id,
        event_sequence: envelope.event_sequence,
        status: "published",
        canonical_projection_sequence: canonical.authority_event_sequence,
        assignment_projected: Boolean(assignment),
        public_material_projected: canonical.public_material_changed,
      })
    } catch (error) {
      await markProjectionFailed(authoringDb, row, clock)
      if (typeof onIntegrityFailure === "function") {
        await onIntegrityFailure({
          event_id: envelope?.event_id || String(row?.event_uuid || ""),
          event_sequence: Number(envelope?.event_sequence || row?.event_sequence || 0),
          code: String(error?.code || "AUTHORITY_PROJECTION_FAILED"),
          message: String(error?.message || error || "Authority projection failed"),
        })
      }
      results.push({
        event_id: envelope?.event_id || String(row?.event_uuid || ""),
        event_sequence: Number(envelope?.event_sequence || row?.event_sequence || 0),
        status: "failed",
        code: String(error?.code || "AUTHORITY_PROJECTION_FAILED"),
      })
    }
  }
  return Object.freeze({
    ok: results.every((item) => item.status === "published"),
    attempted: results.length,
    published: results.filter((item) => item.status === "published").length,
    failed: results.filter((item) => item.status === "failed").length,
    has_more: pending.hasMore,
    results: Object.freeze(results),
  })
}
