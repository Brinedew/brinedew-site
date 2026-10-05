import "./vendor/diff.min.js?v=b51a9d2885f2c090"

// Same limit as workers/lib/iconoplasm-manifestation-prose.js; the rules behind it are in
// docs/CARETAKER_MANIFESTATION_AUTHORITY.md.
export const MAX_PROSE_CODE_POINTS = 10000
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
    // B-995: the server switches the Tags helper off (kill switch, or no AI binding).
    taggerizer_enabled: source.taggerizer_enabled === true,
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
    // B-724: which saved version made each candidate image (bound images only).
    candidate_sources: (Array.isArray(source.candidate_sources) ? source.candidate_sources : [])
      .map(function normalizeCandidateSource(entry) {
        return {
          asset_sha256: String(entry?.asset_sha256 || "").toLowerCase(),
          source_manifestation_revision_id: String(entry?.source_manifestation_revision_id || ""),
        }
      })
      .filter(function hasBoth(entry) {
        return entry.asset_sha256 && entry.source_manifestation_revision_id
      }),
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

// History diffs come from jsdiff's diffWords (npm `diff` 9.0.0, BSD-3, see
// vendor/diff.LICENSE.txt), the Myers word diff most JavaScript diff views use.
// Its browser build sets globalThis.Diff. The homemade LCS it replaced gave up
// above 160,000 token pairs, about two 700-word texts, and fell back to striking
// out the whole text: every full-length manifestation showed one mega diff.
// Whitespace is ignored when matching words; the "same" parts keep the newer
// text's spacing, so the preview reads like the version being shown.
export function manifestationWordDiff(beforeValue, afterValue) {
  return globalThis.Diff.diffWords(String(beforeValue || ""), String(afterValue || ""))
    .map(function (part) {
      return {
        kind: part.added ? "added" : part.removed ? "removed" : "same",
        text: part.value,
      }
    })
    .filter(function (part) {
      return part.text
    })
}
