const TEXT_DECODER = new TextDecoder()

function normalizedContentType(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
}

export function isUsableStructureProbe({ format, contentType, bytes }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return false
  }

  const type = normalizedContentType(contentType)
  if (type === "text/html" || type === "application/json" || type === "text/json") {
    return false
  }

  const normalizedFormat = String(format || "")
    .trim()
    .toLowerCase()
  if (normalizedFormat === "bcif") {
    return true
  }

  const prefix = TEXT_DECODER.decode(bytes).replace(/^\uFEFF/, "")
  if (normalizedFormat === "cif") {
    return /(?:^|\r?\n)\s*data_[^\s]*/i.test(prefix)
  }
  if (normalizedFormat === "pdb") {
    return /(?:^|\r?\n)(?:HEADER|TITLE\s|COMPND|SOURCE|KEYWDS|EXPDTA|AUTHOR|REMARK|DBREF|SEQRES|CRYST1|MODEL\s|ATOM\s{2}|HETATM)/m.test(
      prefix,
    )
  }

  return false
}
