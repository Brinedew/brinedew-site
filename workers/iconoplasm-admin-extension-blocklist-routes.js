// ARCHITECTURE FENCE [IPD-008]: authenticated desired-state mutation may use
// D1, but public recognition advances only through one immutable pair bundle.
import {
  ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
  ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES,
  ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
  IconoplasmExtensionBlocklistPolicyError,
  iconoplasmExtensionBlocklistPublicationState,
  normalizeIconoplasmExtensionBlocklistTerms,
  planIconoplasmExtensionBlocklistPolicyCandidate,
  readAuthoritativePublishedIconoplasmExtensionBlocklist,
  readIconoplasmExtensionBlocklistPolicy,
  saveIconoplasmExtensionBlocklistPolicy,
  validateIconoplasmExtensionBlocklistAgainstPublishedScanner,
} from "./iconoplasm-extension-blocklist-policy.js"
import {
  ICONOPLASM_ADMIN_POLICY_NO_STORE as NO_STORE,
  iconoplasmAdminPolicyMutationAdmissionError,
  readIconoplasmAdminPolicyBoundedJson,
} from "./iconoplasm-admin-policy-http.js"
import {
  loadIconoplasmPublishedScannerRecognitionContext,
  readIconoplasmPublicationAliasPolicy,
  readIconoplasmPublishedScannerVersion,
} from "./iconoplasm-publication-alias-policy.js"
import { iconoplasmRecognitionValidationTarget } from "./iconoplasm-recognition-policy-validation.js"
import {
  reconcileIconoplasmRecognitionPolicies,
  readAuthoritativePublishedIconoplasmRecognitionPolicies,
} from "./iconoplasm-recognition-policy-reconciliation.js"

function assertServices(services) {
  for (const name of ["actor", "isAdmin", "json"]) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin extension-blocklist service is missing: ${name}`)
    }
  }
}

function publicPolicy(policy) {
  return {
    schema_version: ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
    revision: policy.revision,
    version: policy.version,
    terms: [...policy.terms],
    updated_at: policy.updated_at,
    updated_by: policy.updated_by,
    depends_on_alias_revision: policy.depends_on_alias_revision,
  }
}

function responsePayload(policy, projection, extra = {}, pair = null) {
  const publication = iconoplasmExtensionBlocklistPublicationState(policy, projection)
  const pairInSync = Boolean(
    pair?.blocklist_revision === policy.revision &&
    pair?.extension_blocklist?.version === policy.version &&
    JSON.stringify(pair.extension_blocklist.terms) === JSON.stringify(policy.terms),
  )
  return {
    ...extra,
    policy: publicPolicy(policy),
    publication: {
      ...publication,
      version: pairInSync ? pair.extension_blocklist.version : publication.version,
      revision: pairInSync ? pair.blocklist_revision : publication.revision,
      in_sync: pairInSync,
    },
    limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
  }
}

async function currentPayload(env, extra = {}) {
  const policy = await readIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB)
  const [projection, pair] = await Promise.all([
    readAuthoritativePublishedIconoplasmExtensionBlocklist(env.KV),
    readAuthoritativePublishedIconoplasmRecognitionPolicies(env.KV).catch(() => null),
  ])
  return responsePayload(policy, projection, extra, pair)
}

export function createIconoplasmAdminExtensionBlocklistHandlers(services) {
  assertServices(services)
  const { actor, isAdmin, json } = services

  async function handle({ request, env, done }) {
    if (!new Set(["GET", "HEAD", "POST"]).has(request.method)) {
      return done(
        "admin_extension_blocklist_405",
        json({ error: "Method not allowed", code: "method_not_allowed" }, 405, {
          ...NO_STORE,
          Allow: "GET, HEAD, POST",
        }),
      )
    }
    if (request.method === "POST") {
      const admissionError = iconoplasmAdminPolicyMutationAdmissionError(request, {
        mutationLabel: "extension blocklist",
      })
      if (admissionError) {
        return done(
          `admin_extension_blocklist_${admissionError.status}`,
          json(
            {
              error: admissionError.error,
              code: admissionError.code,
              limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
            },
            admissionError.status,
            NO_STORE,
          ),
        )
      }
    }
    if (!(await isAdmin(request, env))) {
      return done(
        "admin_extension_blocklist_403",
        json(
          {
            error: "Unauthorized",
            code: "unauthorized",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          403,
          NO_STORE,
        ),
      )
    }
    if (!env.ICONOPLASM_DB) {
      return done(
        "admin_extension_blocklist_500",
        json(
          {
            error: "ICONOPLASM_DB binding missing",
            code: "iconoplasm_db_binding_missing",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          500,
          NO_STORE,
        ),
      )
    }
    if (!env.KV) {
      return done(
        "admin_extension_blocklist_500",
        json(
          {
            error: "KV binding missing",
            code: "kv_binding_missing",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          500,
          NO_STORE,
        ),
      )
    }

    if (request.method === "GET" || request.method === "HEAD") {
      try {
        return done(
          "admin_extension_blocklist",
          json(await currentPayload(env, { ok: true }), 200, NO_STORE),
        )
      } catch (error) {
        const status = Number(error?.status) || 500
        return done(
          `admin_extension_blocklist_${status}`,
          json(
            {
              error: String(error?.message || error),
              code: String(error?.code || "extension_blocklist_read_failed"),
              limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
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
        maxBytes: ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES,
        tooLargeCode: "extension_blocklist_request_too_large",
      })
    } catch (error) {
      const status = Number(error?.status) || 400
      return done(
        `admin_extension_blocklist_${status}`,
        json(
          {
            error: String(error?.message || "Invalid JSON"),
            code: String(error?.code || "invalid_json"),
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          status,
          NO_STORE,
        ),
      )
    }
    if (!Number.isSafeInteger(body?.expected_revision) || body.expected_revision < 1) {
      return done(
        "admin_extension_blocklist_428",
        json(
          {
            error: "expected_revision must be a positive integer",
            code: "expected_revision_required",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          428,
          NO_STORE,
        ),
      )
    }

    try {
      const loadedPolicy = await readIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB)
      if (loadedPolicy.revision !== body.expected_revision) {
        throw new IconoplasmExtensionBlocklistPolicyError(
          "extension_blocklist_revision_conflict",
          "Extension blocklist changed since it was loaded",
          409,
          { current: loadedPolicy },
        )
      }
      const publicationAliasPolicy = await readIconoplasmPublicationAliasPolicy(env.ICONOPLASM_DB)
      const normalizedTerms = normalizeIconoplasmExtensionBlocklistTerms(body?.terms)
      let saved
      if (JSON.stringify(loadedPolicy.terms) === JSON.stringify(normalizedTerms)) {
        saved = { changed: false, policy: loadedPolicy }
      } else {
        const candidate = await planIconoplasmExtensionBlocklistPolicyCandidate(normalizedTerms, {
          revision: loadedPolicy.revision + 1,
          dependsOnAliasRevision: publicationAliasPolicy.revision,
        })
        const scannerContext = await loadIconoplasmPublishedScannerRecognitionContext(env.KV)
        const terms = await validateIconoplasmExtensionBlocklistAgainstPublishedScanner(
          env.KV,
          candidate.terms,
          { publicationAliases: publicationAliasPolicy, scannerContext },
        )
        const scannerAfterValidation = await readIconoplasmPublishedScannerVersion(env.KV)
        if (scannerAfterValidation !== scannerContext.scanner_version) {
          throw new IconoplasmExtensionBlocklistPolicyError(
            "published_scanner_changed_during_validation",
            "Published scanner changed during blocklist validation; retry against the new build",
            503,
          )
        }
        const validationTarget = iconoplasmRecognitionValidationTarget({
          scannerVersion: scannerContext.scanner_version,
          aliases: publicationAliasPolicy,
          blocklist: { revision: candidate.revision, version: candidate.version },
        })
        saved = await saveIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB, {
          terms,
          expectedRevision: body.expected_revision,
          expectedPublicationAliasRevision: publicationAliasPolicy.revision,
          recognitionValidationTarget: validationTarget,
          actor: await actor(request, env),
        })
      }
      policySaved = true
      policyChanged = saved.changed
      const reconciliation = await reconcileIconoplasmRecognitionPolicies(env, {
        cleanup: false,
      })
      if (reconciliation.extension_blocklist.status === "rejected") {
        throw reconciliation.extension_blocklist.reason
      }
      const published = reconciliation.extension_blocklist.value
      if (published?.busy || published?.reason === "projection_in_progress") {
        throw new IconoplasmExtensionBlocklistPolicyError(
          "extension_blocklist_projection_busy",
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
        throw new IconoplasmExtensionBlocklistPolicyError(
          "extension_blocklist_projection_not_visible",
          "Policy was saved but its coherent public recognition projection is not yet visible",
          503,
        )
      }
      return done("admin_extension_blocklist", json(payload, 200, NO_STORE))
    } catch (error) {
      const status =
        error instanceof IconoplasmExtensionBlocklistPolicyError
          ? error.status
          : Number(error?.status) || 500
      const invalidTerms = Array.isArray(error?.details?.invalid_terms)
        ? { invalid_terms: error.details.invalid_terms }
        : {}
      const base = {
        ok: false,
        error: String(error?.message || error),
        code: String(error?.code || "extension_blocklist_update_failed"),
        ...(policySaved ? { saved: true, policy_saved: true } : {}),
        ...(policySaved ? { changed: policyChanged } : {}),
        ...invalidTerms,
      }
      try {
        const payload = await currentPayload(env, base)
        return done(`admin_extension_blocklist_${status}`, json(payload, status, NO_STORE))
      } catch {
        return done(
          `admin_extension_blocklist_${status}`,
          json({ ...base, limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS }, status, NO_STORE),
        )
      }
    }
  }

  return Object.freeze({
    "admin_extension_blocklist.policy": handle,
  })
}
