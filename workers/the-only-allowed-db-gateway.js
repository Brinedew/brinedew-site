import { handleIconoplasmDbGatewayRequest } from "./iconoplasm.js"

export default {
  async fetch(request, env, ctx) {
    return handleIconoplasmDbGatewayRequest(request, env, ctx)
  },
}