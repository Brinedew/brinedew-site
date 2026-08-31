import { createCaretakerManifestationHttpHandler } from "./manifestation-authority-http-handlers.js"
import { createManifestationAuthorityServiceHandler } from "./manifestation-authority-service-handlers.js"
import { createManifestationAuthoritySyncHandler } from "./manifestation-authority-sync-handlers.js"
import { createManifestationCutoverServiceHandler } from "./manifestation-cutover-service-handler.js"

export function createManifestationAuthorityRouteHandler(options = {}) {
  const caretaker = createCaretakerManifestationHttpHandler(options)
  const service = createManifestationAuthorityServiceHandler(options)
  const sync = createManifestationAuthoritySyncHandler(options)
  const cutover = createManifestationCutoverServiceHandler(options)
  return async function handleManifestationAuthorityRoute(request) {
    return (
      (await cutover(request)) ||
      (await service(request)) ||
      (await sync(request)) ||
      (await caretaker(request)) ||
      null
    )
  }
}
