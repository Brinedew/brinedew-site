export const ICONOPLASM_ADMIN_POLICY_NO_STORE = Object.freeze({ "Cache-Control": "no-store" })

const JSON_MEDIA_TYPE = "application/json"

function trustedMutationOrigin(rawOrigin) {
  const value = String(rawOrigin || "").trim()
  if (!value) return true
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.pathname !== "/" || url.search || url.hash) return false
  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return url.protocol === "http:" || url.protocol === "https:"
  }
  return (
    url.protocol === "https:" && (hostname === "brinedew.bio" || hostname.endsWith(".brinedew.bio"))
  )
}

export function iconoplasmAdminPolicyMutationAdmissionError(
  request,
  { mutationLabel = "policy" } = {},
) {
  const label = String(mutationLabel || "policy").trim() || "policy"
  if (
    String(request.headers.get("Sec-Fetch-Site") || "")
      .trim()
      .toLowerCase() === "cross-site"
  ) {
    return {
      code: "cross_site_request_forbidden",
      error: `Cross-site ${label} mutations are forbidden`,
      status: 403,
    }
  }
  if (!trustedMutationOrigin(request.headers.get("Origin"))) {
    return {
      code: "untrusted_origin",
      error: `${label.charAt(0).toUpperCase()}${label.slice(1)} mutation origin is not trusted`,
      status: 403,
    }
  }
  const mediaType = String(request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== JSON_MEDIA_TYPE) {
    return {
      code: "application_json_required",
      error: "Content-Type must be application/json",
      status: 415,
    }
  }
  return null
}

export async function readIconoplasmAdminPolicyBoundedJson(
  request,
  { maxBytes, tooLargeCode = "policy_request_too_large" } = {},
) {
  const byteLimit = Number(maxBytes)
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) {
    throw new TypeError("Admin policy JSON reader requires a positive maxBytes limit")
  }
  const tooLarge = () =>
    Object.assign(new Error("Request body is too large"), {
      code: tooLargeCode,
      status: 413,
    })
  const declaredLength = Number(request.headers.get("Content-Length"))
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) throw tooLarge()

  const reader = request.body?.getReader()
  if (!reader) {
    throw Object.assign(new Error("Invalid JSON"), { code: "invalid_json", status: 400 })
  }
  const chunks = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > byteLimit) {
      await reader.cancel("request_too_large").catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { code: "invalid_json", status: 400 })
  }
}
