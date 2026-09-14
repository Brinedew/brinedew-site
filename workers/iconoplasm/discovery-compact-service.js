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

function compactSharedDeltas(deltas) {
  return (Array.isArray(deltas) ? deltas : []).map((delta) => [
    Number(delta.ordinal),
    delta.new_member ? 1 : 0,
    Number(delta.encounters),
    Number(delta.first_at),
    Number(delta.latest_at),
  ])
}

function sharedDelivery({ userId, batchId, dictionaryVersion, stateVersion, deltas }) {
  return {
    schema: "iconoplasm.discoverySharedDelivery.v1",
    delivery_id: `${userId}:${batchId}`,
    user_id: String(userId),
    batch_id: String(batchId),
    user_state_version: Number(stateVersion),
    dictionary_version: Number(dictionaryVersion),
    deltas: compactSharedDeltas(deltas),
  }
}

function receiptSharedDelivery(receipt, { userId, batchId, dictionaryVersion }) {
  const deltas = Array.isArray(receipt?.shared_deltas) ? receipt.shared_deltas : []
  if (!deltas.length) return null
  return {
    schema: "iconoplasm.discoverySharedDelivery.v1",
    delivery_id: `${userId}:${batchId}`,
    user_id: String(userId),
    batch_id: String(batchId),
    user_state_version: Number(receipt.state_version),
    dictionary_version: Number(receipt.dictionary_version || dictionaryVersion),
    deltas: deltas.map((delta) => [...delta]),
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
    sharedMode = "deferred",
    onAttempt = null,
  },
) {
  const attemptsLimit = Number(maxAttempts)
  if (!Number.isInteger(attemptsLimit) || attemptsLimit < 1 || attemptsLimit > 64)
    throw new TypeError("Invalid compact discovery attempt bound")
  if (!new Set(["deferred", "atomic", "none"]).has(sharedMode))
    throw new TypeError("Invalid compact discovery shared mode")
  const effectiveSharedMode = isAdmin ? "none" : sharedMode

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
        shared_delivery:
          effectiveSharedMode === "deferred"
            ? receiptSharedDelivery(applied.receipt, {
                userId,
                batchId,
                dictionaryVersion: dictionary.version,
              })
            : null,
      }
    }

    let delivery = null
    if (effectiveSharedMode === "deferred") {
      delivery = sharedDelivery({
        userId,
        batchId,
        dictionaryVersion: dictionary.version,
        stateVersion: applied.state.state_version,
        deltas: applied.shared_deltas,
      })
      // The exact derived delivery is part of the durable user receipt so a
      // lost response or failed enqueue can replay the same delta later without
      // re-deriving "new member" from already-mutated membership state.
      applied.receipt.shared_deltas = delivery.deltas.map((delta) => [...delta])
      const storedReceipt = applied.state.recent_receipts.find(
        (receipt) => receipt.batch_id === String(batchId),
      )
      if (storedReceipt) storedReceipt.shared_deltas = delivery.deltas.map((delta) => [...delta])
    }

    const includeShared = effectiveSharedMode === "atomic"
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
        shared_delivery: delivery,
      }
    }
  }
  throw new DiscoveryCompactConflictError(attemptsLimit)
}
