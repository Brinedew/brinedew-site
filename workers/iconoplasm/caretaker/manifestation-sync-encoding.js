const ENCODER = new TextEncoder()

export function utf8Bytes(value) {
  return ENCODER.encode(value)
}

export function bytesToBase64Url(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}
