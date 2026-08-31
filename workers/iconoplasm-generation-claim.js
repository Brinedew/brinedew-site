import {
  IconoplasmGenerationSourceError,
  validateExactGenerationSource,
} from "./lib/iconoplasm-generation-provenance.js"
import { claimExactGenerationLeases } from "./iconoplasm-generation-lease.js"
import { quarantinePermanentGenerationRequests } from "./iconoplasm-generation-request-quarantine.js"

function text(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max)
}

function validationKey(row) {
  return JSON.stringify([
    text(row?.generation_provenance_status),
    text(row?.source_gene_id),
    text(row?.source_manifestation_id),
    text(row?.source_manifestation_revision_id),
    text(row?.source_manifestation_body_sha256),
    text(row?.source_manifestation_derivative_id),
    text(row?.source_manifestation_derivative_sha256),
    text(row?.source_manifestation_derivative_tags_sha256),
    Number(row?.source_manifestation_derivative_tags_bytes || 0),
    text(row?.source_manifestation_derivative_fields_sha256),
    Number(row?.source_manifestation_derivative_fields_bytes || 0),
    text(row?.source_manifestation_derivative_recipe_id),
    text(row?.source_manifestation_derivative_recipe_version),
    text(row?.source_manifestation_derivative_provider_id),
    text(row?.source_manifestation_derivative_model_id),
    text(row?.source_manifestation_derivative_tagger_config_sha256),
    text(row?.source_canonical_selection_id),
    Number(row?.source_canonical_head_version || 0),
    Number(row?.source_gene_revision || 0),
    text(row?.source_sample_label),
    row?.source_sample_number == null ? null : Number(row.source_sample_number),
    text(row?.source_sample_text_sha256),
    text(row?.source_snapshot_sha256),
    text(row?.prompt_body_mode),
  ])
}

export async function validateGenerationRequestRowsForClaim(
  { env, rows = [] } = {},
  { validateSource = validateExactGenerationSource } = {},
) {
  if (typeof validateSource !== "function") {
    throw new TypeError("Generation claim source validator is required")
  }
  const sourceChecks = new Map()
  const uniqueSources = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = validationKey(row)
    if (!uniqueSources.has(key)) uniqueSources.set(key, row)
  }
  const entries = Array.from(uniqueSources.entries())
  for (let offset = 0; offset < entries.length; offset += 12) {
    await Promise.all(
      entries.slice(offset, offset + 12).map(async ([key, row]) => {
        try {
          await validateSource(env, row)
          sourceChecks.set(key, { ok: true })
        } catch (error) {
          sourceChecks.set(key, {
            ok: false,
            code:
              error instanceof IconoplasmGenerationSourceError
                ? error.code
                : text(error?.code, 96) || "GENERATION_SOURCE_VALIDATION_FAILED",
            error: text(error?.message || error || "Generation source validation failed"),
          })
        }
      }),
    )
  }

  const validRows = []
  const blockedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const check = sourceChecks.get(validationKey(row)) || {
      ok: false,
      code: "GENERATION_SOURCE_VALIDATION_FAILED",
      error: "Generation source validation did not complete.",
    }
    if (check.ok) {
      validRows.push(row)
      continue
    }
    blockedRows.push({
      id: Number(row?.id || 0),
      generation_request_id: text(row?.generation_request_id, 180),
      gene_symbol: text(row?.gene_symbol, 32).toUpperCase(),
      source_manifestation_revision_id: text(row?.source_manifestation_revision_id, 180),
      source_snapshot_sha256: text(row?.source_snapshot_sha256, 64).toLowerCase(),
      code: check.code,
      error: check.error,
    })
  }
  return Object.freeze({
    validRows: Object.freeze(validRows),
    blockedRows: Object.freeze(blockedRows),
  })
}

export async function claimValidatedGenerationRequests(
  { env, db, rows = [], leaseOwnerId, limit, leaseSeconds } = {},
  {
    validateRows = validateGenerationRequestRowsForClaim,
    quarantineRequests = quarantinePermanentGenerationRequests,
    claimLeases = claimExactGenerationLeases,
  } = {},
) {
  const validated = await validateRows({ env, rows })
  const quarantine = await quarantineRequests({ db, blockedRows: validated.blockedRows })
  const claimed = await claimLeases({
    db,
    rows: validated.validRows,
    leaseOwnerId,
    limit,
    leaseSeconds,
  })
  return Object.freeze({ validated, quarantine, claimed })
}
