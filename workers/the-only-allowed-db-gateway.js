import { handleIconoplasmDbGatewayRequest } from "./iconoplasm-gateway.js"

export default {
  async fetch(request, env, ctx) {
    return handleIconoplasmDbGatewayRequest(request, env, ctx)
  },
}
