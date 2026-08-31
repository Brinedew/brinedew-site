import {
  authorizeIconoplasmAuthorityBackupBearer,
  authorizeIconoplasmAuthorityCutoverBearer,
  authorizeIconoplasmAuthorityMaintenanceBearer,
  authorizeIconoplasmAuthorityReplicaBearer,
} from "./iconoplasm-authority-service-auth.js"
import { createManifestationAuthorityRouteHandler } from "./iconoplasm/caretaker/manifestation-authority.js"
import { projectCanonicalManifestationCutoverEvent } from "./lib/iconoplasm-manifestation-authority-projection.js"

export function createIconoplasmManifestationAuthorityRuntimeHandler({
  env,
  resolveSession,
  onAuthorityEvent,
  onIntegrityFailure,
  scheduleBackground,
} = {}) {
  if (!env) throw new TypeError("Iconoplasm manifestation authority env is required")
  if (typeof resolveSession !== "function") {
    throw new TypeError("Iconoplasm manifestation authority session resolver is required")
  }
  if (typeof onAuthorityEvent !== "function") {
    throw new TypeError("Iconoplasm manifestation authority projection wake is required")
  }
  return createManifestationAuthorityRouteHandler({
    db: env.ICONOPLASM_AUTHORING_DB,
    primaryDb: env.ICONOPLASM_DB,
    env,
    authorizeReplicaBearer: authorizeIconoplasmAuthorityReplicaBearer,
    authorizeMaintenanceBearer: authorizeIconoplasmAuthorityMaintenanceBearer,
    authorizeBackupBearer: authorizeIconoplasmAuthorityBackupBearer,
    authorizeCutoverBearer: authorizeIconoplasmAuthorityCutoverBearer,
    projectManifestationCutoverEvent: projectCanonicalManifestationCutoverEvent,
    resolveSession,
    onAuthorityEvent,
    onIntegrityFailure,
    scheduleBackground,
  })
}
