import { authorityError, defaultIdFactory } from "./manifestation-authority-contract.js"
import {
  jsonResponse,
  readBoundedJson,
  requireAuthorityBearer,
  safeErrorResponse,
} from "./manifestation-authority-http-security.js"
import {
  acknowledgeManifestationEvents,
  buildManifestationSnapshotPage,
  completeManifestationSnapshot,
  createManifestationSnapshot,
  readManifestationEventPage,
  readManifestationSnapshotPage,
  readManifestationSnapshotStatus,
} from "./manifestation-authority-sync.js"

function routeId(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return ""
  }
}

function requireJson(request) {
  const type = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (type !== "application/json") {
    throw authorityError("JSON_CONTENT_TYPE_REQUIRED", "JSON request body required", 415)
  }
}

export async function buildManifestationSnapshotBounded(
  db,
  snapshotId,
  { maxPages = 25, pageSize = 50 } = {},
) {
  const pages = Math.max(1, Math.min(100, Math.trunc(Number(maxPages)) || 25))
  let result = null
  for (let page = 0; page < pages; page += 1) {
    result = await buildManifestationSnapshotPage(db, {
      snapshotId,
      limit: Math.max(1, Math.min(50, Math.trunc(Number(pageSize)) || 50)),
    })
    if (result.status === "ready") break
  }
  return result
}

export function createManifestationAuthoritySyncHandler({
  db,
  env,
  authorizeReplicaBearer,
  cursorSecret = env?.ICONOPLASM_AUTHORING_CURSOR_SECRET,
  scheduleBackground,
  idFactory = defaultIdFactory,
} = {}) {
  if (!db || !env) throw new TypeError("Authority sync handler requires db and env")
  return async function handleManifestationAuthoritySync(request) {
    try {
      const url = new URL(request.url)
      const snapshotRoot = url.pathname === "/api/iconoplasm/authority/snapshots"
      const snapshotStatus = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/snapshots\/([^/]+)$/,
      )
      const snapshotParts = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/snapshots\/([^/]+)\/parts$/,
      )
      const snapshotComplete = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/snapshots\/([^/]+)\/complete$/,
      )
      const events = url.pathname === "/api/iconoplasm/authority/events"
      const ack = url.pathname === "/api/iconoplasm/authority/events/ack"
      if (!(snapshotRoot || snapshotStatus || snapshotParts || snapshotComplete || events || ack))
        return null
      await requireAuthorityBearer(request, env, authorizeReplicaBearer)

      if (request.method === "GET" && events) {
        return jsonResponse(
          await readManifestationEventPage(db, {
            cursorSecret,
            cursor: url.searchParams.get("cursor"),
            limit: url.searchParams.get("limit"),
          }),
        )
      }
      if (request.method === "GET" && snapshotStatus) {
        return jsonResponse(
          await readManifestationSnapshotStatus(db, {
            snapshotId: routeId(snapshotStatus[1]),
            cursorSecret,
          }),
        )
      }
      if (request.method === "GET" && snapshotParts) {
        return jsonResponse(
          await readManifestationSnapshotPage(db, {
            snapshotId: routeId(snapshotParts[1]),
            cursorSecret,
            cursor: url.searchParams.get("cursor"),
            limit: url.searchParams.get("limit"),
          }),
        )
      }
      if (request.method !== "POST") return null
      requireJson(request)
      const { value: body } = await readBoundedJson(request, 16 * 1024)
      if (snapshotRoot) {
        const result = await createManifestationSnapshot(db, {
          consumerId: body.consumer_id,
          snapshotId: body.snapshot_id,
          ttlSeconds: body.ttl_seconds,
          idFactory,
        })
        if (result.status === "building" && typeof scheduleBackground === "function") {
          scheduleBackground(buildManifestationSnapshotBounded(db, result.snapshot_id))
        }
        return jsonResponse(result, result.status === "building" ? 202 : 200)
      }
      if (snapshotComplete) {
        return jsonResponse(
          await completeManifestationSnapshot(db, {
            snapshotId: routeId(snapshotComplete[1]),
            cursorSecret,
            totalParts: body.total_parts,
            manifestSha256: body.manifest_sha256,
          }),
        )
      }
      if (ack) {
        return jsonResponse(
          await acknowledgeManifestationEvents(db, {
            consumerId: body.consumer_id,
            cursorSecret,
            resumeCursor: body.resume_cursor,
          }),
        )
      }
      return null
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
}
