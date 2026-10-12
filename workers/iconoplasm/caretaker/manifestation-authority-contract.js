export class ManifestationAuthorityError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "ManifestationAuthorityError"
    this.code = code
    this.status = status
  }
}

export function authorityError(code, message, status = 400, cause) {
  return new ManifestationAuthorityError(code, message, { status, cause })
}
