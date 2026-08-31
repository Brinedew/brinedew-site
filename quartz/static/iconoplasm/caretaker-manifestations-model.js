export const MAX_PROSE_CODE_POINTS = 4000
export const MAX_PROSE_BYTES = 16 * 1024

export function codePointLength(value) {
  return Array.from(String(value || "")).length
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || "")).byteLength
}

export function commandId() {
  if (globalThis.crypto?.randomUUID) {
    return `cmd_${globalThis.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("This browser cannot create a secure caretaker command ID.")
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return `cmd_${Array.from(bytes, function (value) {
    return value.toString(16).padStart(2, "0")
  }).join("")}`
}

export function normalizedSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
}

export function defaultDraftStorage() {
  try {
    return globalThis.sessionStorage || null
  } catch (_error) {
    return null
  }
}

export function normalizedDossier(payload, symbol) {
  const source = payload && typeof payload === "object" ? payload : {}
  const rawAssignment =
    source.assignment && typeof source.assignment === "object" ? source.assignment : null
  const assignment = rawAssignment
    ? {
        ...rawAssignment,
        terms:
          rawAssignment.terms && typeof rawAssignment.terms === "object"
            ? {
                terms_version_id: String(rawAssignment.terms.terms_version_id || ""),
                document_url: String(rawAssignment.terms.document_url || ""),
                display_label: String(rawAssignment.terms.display_label || "Caretaker terms"),
                content_sha256: String(rawAssignment.terms.content_sha256 || ""),
                effective_at: String(rawAssignment.terms.effective_at || ""),
              }
            : null,
      }
    : null
  const viewer = source.viewer && typeof source.viewer === "object" ? source.viewer : {}
  const head = source.head && typeof source.head === "object" ? source.head : {}
  const manifestations = (Array.isArray(source.manifestations) ? source.manifestations : []).map(
    function copyManifestation(manifestation) {
      return {
        ...manifestation,
        revisions: Array.isArray(manifestation?.revisions) ? manifestation.revisions.slice() : [],
      }
    },
  )
  const manifestationById = new Map(
    manifestations.map(function indexManifestation(manifestation) {
      return [String(manifestation.manifestation_id || ""), manifestation]
    }),
  )
  ;(Array.isArray(source.pinned_revisions) ? source.pinned_revisions : []).forEach(
    function mergePinnedRevision(revision) {
      const manifestation = manifestationById.get(String(revision?.manifestation_id || ""))
      if (
        !manifestation ||
        manifestation.revisions.some(function alreadyPresent(candidate) {
          return candidate.manifestation_revision_id === revision.manifestation_revision_id
        })
      )
        return
      manifestation.revisions.push({ ...revision, pinned: true })
    },
  )
  manifestations.forEach(function restorePinnedHeadBody(manifestation) {
    const headRevision = manifestation.revisions.find(function findHead(revision) {
      return revision.manifestation_revision_id === manifestation.manifestation_head_revision_id
    })
    if (headRevision) manifestation.head_body = String(headRevision.body || "")
  })
  return {
    enabled: source.enabled !== false,
    gene: {
      gene_id: String(source.gene?.gene_id || ""),
      symbol: normalizedSymbol(source.gene?.symbol || symbol),
      status: String(source.gene?.status || "active"),
      merged_into_symbol: normalizedSymbol(source.gene?.merged_into_symbol || ""),
      aliases: Array.isArray(source.gene?.aliases) ? source.gene.aliases : [],
    },
    assignment,
    viewer: {
      is_caretaker: viewer.is_caretaker === true,
      can_accept: viewer.can_accept === true,
      can_decline: viewer.can_decline === true,
      can_edit: viewer.can_edit === true,
      suspended: viewer.suspended === true,
    },
    head: {
      head_version: Math.max(0, Number(head.head_version || 0) || 0),
      canonical_selection_id: String(head.canonical_selection_id || ""),
      canonical_revision_id: String(head.canonical_revision_id || ""),
      gene_revision: Math.max(0, Number(head.gene_revision || 0) || 0),
    },
    manifestations,
    history: {
      next_cursor: String(source.history?.next_cursor || ""),
      total_count: Math.max(0, Number(source.history?.total_count || 0) || 0),
    },
  }
}

export function proseValidationError(prose) {
  const text = String(prose || "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
  if (!text.trim()) return "Write a manifestation before saving."
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    return "The manifestation contains an unsupported control character."
  }
  if (codePointLength(text) > MAX_PROSE_CODE_POINTS) {
    return `Keep the manifestation to ${MAX_PROSE_CODE_POINTS.toLocaleString()} characters or fewer.`
  }
  if (utf8Length(text) > MAX_PROSE_BYTES) {
    return "The manifestation is over the 16 KiB storage limit."
  }
  return ""
}

export function ownManifestation(dossier) {
  const own = dossier.manifestations.filter(function (item) {
    return item && item.author_is_viewer === true
  })
  return (
    own.find(function (item) {
      return item.belongs_to_current_assignment === true && item.status === "active"
    }) ||
    own.find(function (item) {
      return item.belongs_to_current_assignment === true
    }) ||
    null
  )
}

export function allRevisions(dossier) {
  const result = []
  dossier.manifestations.forEach(function (manifestation) {
    const revisions = Array.isArray(manifestation?.revisions) ? manifestation.revisions : []
    revisions.forEach(function (revision) {
      result.push({ manifestation, revision })
    })
  })
  return result.sort(function (left, right) {
    const eventDifference =
      Number(right.revision?.event_sequence || 0) - Number(left.revision?.event_sequence || 0)
    if (eventDifference) return eventDifference
    const timeDifference =
      Date.parse(right.revision?.created_at || "") - Date.parse(left.revision?.created_at || "")
    if (Number.isFinite(timeDifference) && timeDifference) return timeDifference
    return (
      Number(right.revision?.revision_number || 0) - Number(left.revision?.revision_number || 0)
    )
  })
}

export function revisionById(dossier, revisionId) {
  return allRevisions(dossier).find(function (item) {
    return item.revision?.manifestation_revision_id === revisionId
  })
}

function diffTokens(value) {
  return String(value || "").match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []
}

function commonEdgeDiff(before, after) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1
  }
  return [
    { kind: "same", text: before.slice(0, prefix).join("") },
    { kind: "removed", text: before.slice(prefix, before.length - suffix).join("") },
    { kind: "added", text: after.slice(prefix, after.length - suffix).join("") },
    { kind: "same", text: before.slice(before.length - suffix).join("") },
  ].filter(function (part) {
    return part.text
  })
}

export function manifestationWordDiff(beforeValue, afterValue) {
  const before = diffTokens(beforeValue)
  const after = diffTokens(afterValue)
  if (before.length * after.length > 160000) return commonEdgeDiff(before, after)
  const rows = Array.from({ length: before.length + 1 }, function () {
    return new Uint16Array(after.length + 1)
  })
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      rows[left][right] =
        before[left] === after[right]
          ? rows[left + 1][right + 1] + 1
          : Math.max(rows[left + 1][right], rows[left][right + 1])
    }
  }
  const parts = []
  function append(kind, text) {
    if (!text) return
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let left = 0
  let right = 0
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      append("same", before[left])
      left += 1
      right += 1
    } else if (rows[left + 1][right] >= rows[left][right + 1]) {
      append("removed", before[left])
      left += 1
    } else {
      append("added", after[right])
      right += 1
    }
  }
  while (left < before.length) append("removed", before[left++])
  while (right < after.length) append("added", after[right++])
  return parts
}
