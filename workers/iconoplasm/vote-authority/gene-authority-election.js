/**
 * B-762 pure per-gene vote-authority election.
 *
 * The per-gene Durable Object is the complete hot authority for voting. This
 * module composes its candidate rows, vote summaries and caretaker supervote
 * into the exact winner the shipped D1 pipeline would elect, and into the
 * canonical selection reference stored as the durable publication identity.
 *
 * Keep this module free of storage, network and clock access: it runs inside
 * the vote storage transaction and must stay synchronous.
 *
 * The tie-break ordering mirrors the shipped `compareAdminLeaderRows` contract.
 * Any change to either ordering must change both implementations and their
 * tests in the same commit.
 */
import { compareCaretakerWeightedCandidates } from "../caretaker/caretaker-supervote.js"

// v2 (B-876): the reference also carries the candidate-set revision, because
// the published card includes the whole gallery, not only the winner.
export const GENE_AUTHORITY_SELECTION_REFERENCE_SCHEMA = "gene-authority-selection-v2"

const SHA256 = /^[a-f0-9]{64}$/

function normalizedSha(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
  return SHA256.test(text) ? text : ""
}

function compareNullableTextDesc(a, b) {
  return String(b || "").localeCompare(String(a || ""))
}

function compareNullableTextAsc(a, b) {
  return String(a || "").localeCompare(String(b || ""))
}

export function compareGeneAuthorityRows(left, right, currentAssetSha = null) {
  const existingTieBreak = () =>
    Number(right?.score || 0) - Number(left?.score || 0) ||
    Number(left?.is_legacy || 0) - Number(right?.is_legacy || 0) ||
    Number(right?.upvotes || 0) - Number(left?.upvotes || 0) ||
    compareNullableTextDesc(left?.created_at || "", right?.created_at || "") ||
    Number(normalizedSha(right?.asset_sha256) === normalizedSha(currentAssetSha)) -
      Number(normalizedSha(left?.asset_sha256) === normalizedSha(currentAssetSha)) ||
    compareNullableTextAsc(left?.asset_sha256 || "", right?.asset_sha256 || "")
  return compareCaretakerWeightedCandidates(left, right, existingTieBreak)
}

/**
 * Join candidate authority rows with the coordinator's own vote summaries and
 * caretaker supervote. A vote row for an ineligible candidate remains stored
 * (the user's intent is kept) but cannot win.
 */
export function projectGeneAuthorityRows({
  candidates = [],
  summaries = [],
  caretaker = null,
} = {}) {
  const summaryByAsset = new Map()
  for (const row of Array.isArray(summaries) ? summaries : []) {
    const sha = normalizedSha(row?.asset_sha256)
    if (sha) summaryByAsset.set(sha, row)
  }
  const supervoteAsset = normalizedSha(caretaker?.asset_sha256)
  const supervoteActive = Boolean(supervoteAsset && caretaker?.active)
  const direction = Number(caretaker?.direction) === -1 ? -1 : 1
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
      const sha = normalizedSha(candidate?.asset_sha256)
      if (!sha) return null
      const summary = summaryByAsset.get(sha) || {}
      const isSupervote = supervoteActive && sha === supervoteAsset
      return {
        asset_sha256: sha,
        status:
          String(candidate?.status || "draft")
            .trim()
            .toLowerCase()
            .slice(0, 32) || "draft",
        autopick_eligible: Number(candidate?.autopick_eligible || 0) > 0,
        is_stale: Number(candidate?.is_stale || 0) > 0,
        is_legacy: Number(candidate?.is_legacy || 0) > 0,
        created_at: String(candidate?.created_at || "").slice(0, 64),
        revision: Math.max(0, Number(candidate?.revision || 0) || 0),
        vision_id: String(summary?.vision_id || candidate?.vision_id || "").slice(0, 64),
        candidate_image_id: summary?.candidate_image_id ?? candidate?.candidate_image_id ?? null,
        upvotes: Math.max(0, Number(summary?.upvotes || 0) || 0),
        downvotes: Math.max(0, Number(summary?.downvotes || 0) || 0),
        score: Number(summary?.score || 0) || 0,
        vote_count: Math.max(0, Number(summary?.vote_count || 0) || 0),
        caretaker_supervote: isSupervote,
        caretaker_supervote_direction: isSupervote ? direction : null,
      }
    })
    .filter(Boolean)
    .filter((row) => row.autopick_eligible && row.status !== "rejected")
}

export function electGeneAuthorityWinner({
  candidates = [],
  summaries = [],
  caretaker = null,
  currentAssetSha = null,
  adminOverride = false,
} = {}) {
  const rows = projectGeneAuthorityRows({ candidates, summaries, caretaker })
  const current = normalizedSha(currentAssetSha)
  // Administrator override pins the current published asset exactly like the
  // shipped D1 pipeline: automatic promotion must not fight an operator.
  if (adminOverride && current) {
    return { winner: rows.find((row) => row.asset_sha256 === current) || null, rows }
  }
  if (!rows.length) return { winner: null, rows }
  return {
    winner: [...rows].sort((left, right) => compareGeneAuthorityRows(left, right, current))[0],
    rows,
  }
}

/**
 * Canonical selection reference. It is the durable publication identity and is
 * hashed into the selectionKey, so it must change whenever the rendered card
 * could change and must not change when only non-card state (for example raw
 * scores behind an unchanged winner) changes.
 */
export function composeGeneSelectionReference(fields = {}) {
  const winner = fields?.winner || null
  const segments = [
    GENE_AUTHORITY_SELECTION_REFERENCE_SCHEMA,
    `symbol=${String(fields?.symbol || "")
      .trim()
      .toUpperCase()
      .slice(0, 32)}`,
    `winner=${winner?.asset_sha256 || "none"}`,
    `candidate_revision=${Math.max(0, Number(winner?.revision || 0) || 0)}`,
    `candidate_set=${Math.max(0, Number(fields?.candidateSetRevision || 0) || 0)}`,
    `caretaker=${Math.max(0, Number(fields?.caretakerSupervoteVersion || 0) || 0)}:${Number(fields?.caretakerDirection || 0) || 0}`,
    `admin=${fields?.adminOverride ? 1 : 0}`,
  ]
  return segments.join("|")
}

export function winnerAssetShaFromSelectionReference(reference) {
  const match = /(?:^|\|)winner=([a-f0-9]{64}|none)(?:\||$)/.exec(String(reference || ""))
  return match && match[1] !== "none" ? match[1] : null
}
