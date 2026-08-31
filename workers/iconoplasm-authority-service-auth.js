export const AUTHORITY_BEARER_BINDINGS = Object.freeze({
  replica: "ICONOPLASM_AUTHORITY_REPLICA_TOKEN",
  generation: "ICONOPLASM_AUTHORITY_GENERATION_TOKEN",
  maintenance: "ICONOPLASM_AUTHORITY_MAINTENANCE_TOKEN",
  backup: "ICONOPLASM_AUTHORITY_BACKUP_TOKEN",
  cutover: "ICONOPLASM_AUTHORITY_CUTOVER_TOKEN",
})

function bearerToken(request) {
  const authorization = String(request?.headers?.get?.("authorization") || "")
  const match = authorization.match(/^Bearer ([^\s]+)$/i)
  return match ? match[1] : ""
}

async function sha256Bytes(value) {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") return null
  const encoded = new TextEncoder().encode(String(value || ""))
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoded))
}

async function constantTimeTokenMatch(expected, presented) {
  const [expectedDigest, presentedDigest] = await Promise.all([
    sha256Bytes(expected),
    sha256Bytes(presented),
  ])
  if (!expectedDigest || !presentedDigest || expectedDigest.length !== presentedDigest.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= expectedDigest[index] ^ presentedDigest[index]
  }
  return difference === 0
}

function createAudienceAuthorizer(audience) {
  const binding = AUTHORITY_BEARER_BINDINGS[audience]
  if (!binding) throw new TypeError(`Unknown authority bearer audience: ${audience}`)
  return async function authorizeAuthorityAudienceBearer(request, env) {
    const expected = String(env?.[binding] || "")
    const presented = bearerToken(request)
    const matched = await constantTimeTokenMatch(expected, presented)
    return Object.freeze({
      authorized: Boolean(expected && presented && matched),
      actor_kind: "service",
      account_id: null,
      audience,
    })
  }
}

export const authorizeIconoplasmAuthorityReplicaBearer = createAudienceAuthorizer("replica")
export const authorizeIconoplasmAuthorityGenerationBearer = createAudienceAuthorizer("generation")
export const authorizeIconoplasmAuthorityMaintenanceBearer = createAudienceAuthorizer("maintenance")
export const authorizeIconoplasmAuthorityBackupBearer = createAudienceAuthorizer("backup")
export const authorizeIconoplasmAuthorityCutoverBearer = createAudienceAuthorizer("cutover")
