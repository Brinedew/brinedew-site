// ARCHITECTURE FENCE [IPD-008]: authenticated desired-state mutation may use
// D1, but public recognition advances only through one immutable pair bundle.
import { readIconoplasmExtensionBlocklistPolicy } from "./iconoplasm-extension-blocklist-policy.js"
import {
  ICONOPLASM_ADMIN_POLICY_NO_STORE as NO_STORE,
  iconoplasmAdminPolicyMutationAdmissionError,
  readIconoplasmAdminPolicyBoundedJson,
} from "./iconoplasm-admin-policy-http.js"
import {
  ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
  ICONOPLASM_PUBLICATION_ALIAS_MAX_REQUEST_BYTES,
  IconoplasmPublicationAliasPolicyError,
  iconoplasmPublicationAliasPoliciesEqual,
  iconoplasmPublicationAliasPublicationState,
  normalizeIconoplasmPublicationAliasPolicyCandidate,
  readAuthoritativePublishedIconoplasmPublicationAliases,
  readIconoplasmPublicationAliasPolicy,
  readIconoplasmPublishedScannerVersion,
  saveIconoplasmPublicationAliasPolicy,
  validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex,
} from "./iconoplasm-publication-alias-policy.js"
import {
  iconoplasmRecognitionValidationReceiptMatches,
  iconoplasmRecognitionValidationTarget,
  readIconoplasmRecognitionValidationReceipt,
} from "./iconoplasm-recognition-policy-validation.js"
import {
  reconcileIconoplasmRecognitionPolicies,
  readAuthoritativePublishedIconoplasmRecognitionPolicies,
} from "./iconoplasm-recognition-policy-reconciliation.js"

function assertServices(services) {
  for (const name of ["actor", "isAdmin", "json"]) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin publication-alias service is missing: ${name}`)
    }
  }
}

function publicPolicy(policy) {
  return {
    schema_version: policy.schema_version,
    revision: policy.revision,
    version: policy.version,
    alias_count: policy.alias_count,
    removal_count: policy.removal_count,
    by_symbol: policy.by_symbol,
    remove_by_symbol: policy.remove_by_symbol,
    updated_at: policy.updated_at,
    updated_by: policy.updated_by,
    depends_on_blocklist_revision: policy.depends_on_blocklist_revision,
  }
}

function responsePayload(policy, projection, extra = {}, pair = null) {
  const publication = iconoplasmPublicationAliasPublicationState(policy, projection)
  const pairInSync = Boolean(
    pair?.alias_revision === policy.revision &&
    pair?.publication_aliases?.version === policy.version &&
    JSON.stringify(pair.publication_aliases.by_symbol) === JSON.stringify(policy.by_symbol) &&
    JSON.stringify(pair.publication_aliases.remove_by_symbol) ===
      JSON.stringify(policy.remove_by_symbol),
  )
  return {
    ...extra,
    policy: publicPolicy(policy),
    publication: {
      ...publication,
      version: pairInSync ? pair.publication_aliases.version : publication.version,
      revision: pairInSync ? pair.alias_revision : publication.revision,
      in_sync: pairInSync,
    },
    limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
  }
}

async function currentPayload(env, extra = {}) {
  const policy = await readIconoplasmPublicationAliasPolicy(env.ICONOPLASM_DB)
  const [projection, pair] = await Promise.all([
    readAuthoritativePublishedIconoplasmPublicationAliases(env.KV),
    readAuthoritativePublishedIconoplasmRecognitionPolicies(env.KV).catch(() => null),
  ])
  return responsePayload(policy, projection, extra, pair)
}

export function createIconoplasmAdminPublicationAliasHandlers(services) {
  assertServices(services)
  const { actor, isAdmin, json } = services

  async function handle({ request, env, done }) {
    if (!new Set(["GET", "HEAD", "POST"]).has(request.method)) {
      return done(
        "admin_publication_aliases_405",
        json({ error: "Method not allowed", code: "method_not_allowed" }, 405, {
          ...NO_STORE,
          Allow: "GET, HEAD, POST",
        }),
      )
    }
    if (request.method === "POST") {
      const admissionError = iconoplasmAdminPolicyMutationAdmissionError(request, {
        mutationLabel: "publication alias",
      })
      if (admissionError) {
        return done(
          `admin_publication_aliases_${admissionError.status}`,
          json(
            {
              error: admissionError.error,
              code: admissionError.code,
              limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
            },
            admissionError.status,
            NO_STORE,
          ),
        )
      }
    }
    if (!(await isAdmin(request, env))) {
      return done(
        "admin_publication_aliases_403",
        json(
          {
            error: "Unauthorized",
            code: "unauthorized",
            limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
          },
          403,
          NO_STORE,
        ),
      )
    }
    if (!env.ICONOPLASM_DB) {
      return done(
        "admin_publication_aliases_500",
        json(
          {
            error: "ICONOPLASM_DB binding missing",
            code: "iconoplasm_db_binding_missing",
            limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
          },
          500,
          NO_STORE,
        ),
      )
    }
    if (!env.KV) {
      return done(
        "admin_publication_aliases_500",
        json(
          {
            error: "KV binding missing",
            code: "kv_binding_missing",
            limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
          },
          500,
          NO_STORE,
        ),
      )
    }

    if (request.method === "GET" || request.method === "HEAD") {
      try {
        return done(
          "admin_publication_aliases",
          json(await currentPayload(env, { ok: true }), 200, NO_STORE),
        )
      } catch (error) {
        const status = Number(error?.status) || 500
        return done(
          `admin_publication_aliases_${status}`,
          json(
            {
              error: String(error?.message || error),
              code: String(error?.code || "publication_alias_read_failed"),
              limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
            },
            status,
            NO_STORE,
          ),
        )
      }
    }

    let body
    let policySaved = false
    let policyChanged = false
    try {
      body = await readIconoplasmAdminPolicyBoundedJson(request, {
        maxBytes: ICONOPLASM_PUBLICATION_ALIAS_MAX_REQUEST_BYTES,
        tooLargeCode: "publication_alias_request_too_large",
      })
    } catch (error) {
      const status = Number(error?.status) || 400
      return done(
        `admin_publication_aliases_${status}`,
        json(
          {
            error: String(error?.message || "Invalid JSON"),
            code: String(error?.code || "invalid_json"),
            limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
          },
          status,
          NO_STORE,
        ),
      )
    }
    if (!Number.isSafeInteger(body?.expected_revision) || body.expected_revision < 1) {
      return done(
        "admin_publication_aliases_428",
        json(
          {
            error: "expected_revision must be a positive integer",
            code: "expected_revision_required",
            limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS,
          },
          428,
          NO_STORE,
        ),
      )
    }

    try {
      const loadedPolicy = await readIconoplasmPublicationAliasPolicy(env.ICONOPLASM_DB)
      if (loadedPolicy.revision !== body.expected_revision) {
        throw new IconoplasmPublicationAliasPolicyError(
          "publication_alias_revision_conflict",
          "Publication alias policy changed since it was loaded",
          409,
          { current: loadedPolicy },
        )
      }
      const blocklist = await readIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB)
      const normalized = await normalizeIconoplasmPublicationAliasPolicyCandidate(
        body?.by_symbol,
        body?.remove_by_symbol || {},
      )
      let saved
      if (iconoplasmPublicationAliasPoliciesEqual(loadedPolicy, normalized)) {
        saved = { changed: false, policy: loadedPolicy }
      } else {
        const scannerVersion = await readIconoplasmPublishedScannerVersion(env.KV)
        const baselineTarget = iconoplasmRecognitionValidationTarget({
          scannerVersion,
          aliases: loadedPolicy,
          blocklist,
        })
        const receipt = await readIconoplasmRecognitionValidationReceipt(env.ICONOPLASM_DB)
        if (!iconoplasmRecognitionValidationReceiptMatches(receipt, baselineTarget, "valid")) {
          throw new IconoplasmPublicationAliasPolicyError(
            "recognition_validation_baseline_unavailable",
            "Current recognition policy is not validated for this catalog; republish the catalog before editing aliases",
            503,
          )
        }
        const validated =
          await validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex(
            env.KV,
            normalized,
            {
              baselinePolicy: loadedPolicy,
              requiredAliasTerms: blocklist.terms,
              scannerVersion,
            },
          )
        const scannerAfterValidation = await readIconoplasmPublishedScannerVersion(env.KV)
        if (scannerAfterValidation !== scannerVersion) {
          throw new IconoplasmPublicationAliasPolicyError(
            "published_scanner_changed_during_validation",
            "Published scanner changed during alias validation; retry against the new build",
            503,
          )
        }
        const validationTarget = iconoplasmRecognitionValidationTarget({
          scannerVersion,
          aliases: { revision: loadedPolicy.revision + 1, version: validated.version },
          blocklist,
        })
        saved = await saveIconoplasmPublicationAliasPolicy(env.ICONOPLASM_DB, {
          bySymbol: validated.by_symbol,
          removeBySymbol: validated.remove_by_symbol,
          expectedRevision: body.expected_revision,
          expectedBlocklistRevision: blocklist.revision,
          recognitionValidationTarget: validationTarget,
          actor: await actor(request, env),
        })
      }
      policySaved = true
      policyChanged = saved.changed
      const reconciliation = await reconcileIconoplasmRecognitionPolicies(env, {
        cleanup: false,
      })
      if (reconciliation.publication_aliases.status === "rejected") {
        throw reconciliation.publication_aliases.reason
      }
      const published = reconciliation.publication_aliases.value
      if (published?.busy || published?.reason === "projection_in_progress") {
        throw new IconoplasmPublicationAliasPolicyError(
          "publication_alias_projection_busy",
          "Policy was saved; another publication is already in progress",
          503,
        )
      }
      if (reconciliation.pair.status === "rejected") throw reconciliation.pair.reason
      const payload = await currentPayload(env, {
        ok: true,
        changed: saved.changed,
        republished: !saved.changed && Boolean(published?.changed),
      })
      if (!payload.publication.in_sync) {
        throw new IconoplasmPublicationAliasPolicyError(
          "publication_alias_projection_not_visible",
          "Policy was saved but its coherent public recognition projection is not yet visible",
          503,
        )
      }
      return done("admin_publication_aliases", json(payload, 200, NO_STORE))
    } catch (error) {
      const status =
        error instanceof IconoplasmPublicationAliasPolicyError
          ? error.status
          : Number(error?.status) || 500
      const details = error?.details && typeof error.details === "object" ? error.details : {}
      const base = {
        ok: false,
        error: String(error?.message || error),
        code: String(error?.code || "publication_alias_update_failed"),
        ...(policySaved ? { saved: true, policy_saved: true } : {}),
        ...(policySaved ? { changed: policyChanged } : {}),
        ...(Array.isArray(details.invalid_operations)
          ? { invalid_operations: details.invalid_operations }
          : {}),
        ...(Array.isArray(details.invalid_terms) ? { invalid_terms: details.invalid_terms } : {}),
      }
      try {
        return done(
          `admin_publication_aliases_${status}`,
          json(await currentPayload(env, base), status, NO_STORE),
        )
      } catch {
        return done(
          `admin_publication_aliases_${status}`,
          json({ ...base, limits: ICONOPLASM_PUBLICATION_ALIAS_LIMITS }, status, NO_STORE),
        )
      }
    }
  }

  return Object.freeze({
    "admin_publication_aliases.policy": handle,
  })
}
