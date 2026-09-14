import { applyDiscoveryBatch, applySharedDiscoveryDeltas } from "./discovery-compact-state.js"
import { commitCompactDiscoveryBatch, readCompactDiscoveryState } from "./discovery-compact-store.js"

export class DiscoveryCompactConflictError extends Error {
  constructor(attempts) {
    super(`Compact discovery write remained contended after ${attempts} attempts`)
    this.name = "DiscoveryCompactConflictError"
    this.code = "DISCOVERY_COMPACT_CONFLICT"
    this.attempts = attempts
  }
}

export async function recordCompactDiscoveryBatch(
  db,
  {
    userId,
    isAdmin = false,
    batchId,
    dictionary,
    encounters,
    maxAttempts = 8,
    onAttempt = null,
  },
) {
  const attemptsLimit = Number(maxAttempts)
  if (!Number.isInteger(attemptsLimit) || attemptsLimit < 1 || attemptsLimit > 64)
    throw new TypeError("Invalid compact discovery attempt bound")
  for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
    const current = await readCompactDiscoveryState(db, userId)
    const applied = applyDiscoveryBatch(current.user, { batchId, dictionary, encounters })
    if (applied.replay) {
      onAttempt?.({ attempt, replay: true, conflict: false })
      return {
        ok: true,
        replay: true,
        attempts: attempt,
        receipt: applied.receipt,
        state_version: applied.state.state_version,
      }
    }
    const includeShared = !isAdmin
    const nextSharedState = includeShared
      ? applySharedDiscoveryDeltas(current.shared, {
          dictionaryVersion: dictionary.version,
          deltas: applied.shared_deltas,
        })
      : null
    const committed = await commitCompactDiscoveryBatch(db, {
      userId,
      expectedUserVersion: current.user?.state_version || 0,
      expectedSharedVersion: current.shared.state_version,
      nextUserState: applied.state,
      nextSharedState,
      sealedChunks: applied.sealed_chunks,
      batchId,
      includeShared,
    })
    onAttempt?.({ attempt, replay: false, conflict: !committed.committed })
    if (committed.committed) {
      return {
        ok: true,
        replay: false,
        attempts: attempt,
        receipt: applied.receipt,
        state_version: committed.state_version,
      }
    }
  }
  throw new DiscoveryCompactConflictError(attemptsLimit)
}
