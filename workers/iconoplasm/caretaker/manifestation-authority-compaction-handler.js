import { authorityError } from "./manifestation-authority-contract.js"
import {
  activateManifestationEventCheckpoint,
  buildManifestationEventCheckpointPage,
  pruneManifestationEventPage,
  readManifestationEventCheckpointStatus,
  startManifestationEventCheckpoint,
  sweepManifestationEventCheckpoints,
} from "./manifestation-authority-checkpoints.js"

function routeId(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

export function matchManifestationEventCompactionRoute(pathname) {
  const root = pathname === "/api/iconoplasm/authority/maintenance/event-compaction/checkpoints"
  if (root) return { action: "start", checkpointId: null }
  if (pathname === "/api/iconoplasm/authority/maintenance/event-compaction/checkpoints/sweep") {
    return { action: "sweep", checkpointId: null }
  }
  const match = pathname.match(
    /^\/api\/iconoplasm\/authority\/maintenance\/event-compaction\/checkpoints\/([^/]+)(?:\/(build|activate|prune))?$/,
  )
  if (!match) return null
  return { action: match[2] || "status", checkpointId: routeId(match[1]) }
}

export function runManifestationEventCompactionRoute(db, route, body = {}) {
  if (route.action === "start") {
    return startManifestationEventCheckpoint(db, {
      checkpointId: body.checkpoint_id,
      watermarkSequence: body.watermark_sequence,
      auditRetentionSeconds: body.audit_retention_seconds,
      ttlSeconds: body.ttl_seconds,
      now: body.now,
    })
  }
  if (route.action === "status") {
    return readManifestationEventCheckpointStatus(db, { checkpointId: route.checkpointId })
  }
  if (route.action === "build") {
    return buildManifestationEventCheckpointPage(db, {
      checkpointId: route.checkpointId,
      limit: body.limit,
      now: body.now,
    })
  }
  if (route.action === "activate") {
    return activateManifestationEventCheckpoint(db, {
      checkpointId: route.checkpointId,
      totalEntities: body.total_entities,
      manifestSha256: body.manifest_sha256,
      consumerActiveSeconds: body.consumer_active_seconds,
      now: body.now,
    })
  }
  if (route.action === "prune") {
    return pruneManifestationEventPage(db, {
      checkpointId: route.checkpointId,
      limit: body.limit,
      now: body.now,
    })
  }
  return sweepManifestationEventCheckpoints(db, {
    retentionSeconds: body.retention_seconds,
    limit: body.limit,
    now: body.now,
  })
}
