import {
  handleIconoplasmDbGatewayRequest,
  IconoplasmVoteCoordinator,
} from "./iconoplasm-gateway.js"

export { IconoplasmVoteCoordinator }

export default {
  async fetch(request, env, ctx) {
    return handleIconoplasmDbGatewayRequest(request, env, ctx)
  },
}
