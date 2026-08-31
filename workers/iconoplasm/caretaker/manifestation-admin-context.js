import {
  authorityError,
  normalizeActorKind,
  normalizeOptionalId,
} from "./manifestation-authority-contract.js"
import { requireActiveAccount, resolveCommandReplay } from "./manifestation-authority-repository.js"

export async function administratorContext(db, command = {}) {
  const actorKind = normalizeActorKind(command.actorKind || "administrator")
  if (!new Set(["administrator", "service", "migration"]).has(actorKind)) {
    throw authorityError("ADMINISTRATOR_REQUIRED", "Administrator authority is required", 403)
  }
  const actorAccountId = normalizeOptionalId(command.actorAccountId, "actor_account_id")
  if (actorKind === "administrator" && !actorAccountId) {
    throw authorityError("AUDIT_ACCOUNT_REQUIRED", "Administrator account is required", 403)
  }
  const actor = actorAccountId
    ? await requireActiveAccount(db, actorAccountId)
    : { account_id: null }
  const replay = await resolveCommandReplay(db, command, {
    actorKind,
    actorAccountId: actor.account_id,
  })
  return { actor, actorKind, replay }
}

// ARCHITECTURE FENCE [IPD-012]
