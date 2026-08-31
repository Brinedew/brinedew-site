import { authorityError } from "./manifestation-authority-contract.js"
import {
  jsonResponse,
  readBoundedJson,
  requireAuthorityBearer,
} from "./manifestation-authority-http-security.js"
import {
  advanceManifestationAuthorityCutover,
  readManifestationCutoverStatus,
} from "./manifestation-cutover-processor.js"

function routeId(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

function errorResponse(error) {
  const code = String(error?.code || "MANIFESTATION_CUTOVER_INTERNAL_ERROR")
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
      ? error.status
      : 500
  return jsonResponse({ error: { code } }, status)
}

function inputFromBody(runId, body) {
  return {
    action: body.action,
    cutoverRunId: runId,
    sourceSnapshotId: body.source_snapshot_id,
    targetAuthorityEpoch: body.target_authority_epoch,
    limit: body.limit,
    retryFailed: body.retry_failed === true,
    dryRun: body.dry_run === true,
    confirm: body.confirm,
    backupArtifactId: body.backup_artifact_id,
  }
}

export function createManifestationCutoverServiceHandler({
  db: authoringDb,
  primaryDb,
  env,
  authorizeCutoverBearer,
  projectManifestationCutoverEvent,
} = {}) {
  return async function handleManifestationCutoverService(request) {
    const url = new URL(request.url)
    const statusRoute = url.pathname.match(/^\/api\/iconoplasm\/authority\/cutover\/runs\/([^/]+)$/)
    const actionRoute = url.pathname.match(
      /^\/api\/iconoplasm\/authority\/cutover\/runs\/([^/]+)\/actions$/,
    )
    if (!statusRoute && !actionRoute) return null
    try {
      if (!authoringDb || !primaryDb || !env) {
        throw authorityError(
          "CUTOVER_BINDINGS_REQUIRED",
          "Both cutover database bindings and env are required",
          503,
        )
      }
      const actor = await requireAuthorityBearer(request, env, authorizeCutoverBearer)
      const runId = routeId((statusRoute || actionRoute)[1])
      if (request.method === "GET" && statusRoute) {
        return jsonResponse(await readManifestationCutoverStatus(authoringDb, primaryDb, runId))
      }
      if (request.method !== "POST" || !actionRoute) return null
      const type = String(request.headers.get("content-type") || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase()
      if (type !== "application/json") {
        throw authorityError("JSON_CONTENT_TYPE_REQUIRED", "JSON request body required", 415)
      }
      const body = (await readBoundedJson(request, 12 * 1024)).value
      const result = await advanceManifestationAuthorityCutover({
        primaryDb,
        authoringDb,
        env,
        projectShadowEvent: projectManifestationCutoverEvent,
        input: inputFromBody(runId, body),
        actor,
      })
      return jsonResponse(result)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

// ARCHITECTURE FENCE [IPD-012]
