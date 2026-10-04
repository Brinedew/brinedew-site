/**
 * B-762 / B-898 pure per-gene vote election.
 *
 * Composes one gene's D1 rows (its candidates, their vote summaries and the
 * caretaker supervote) into the winner that becomes the gene's published
 * portrait. Every caller elects through this one function: the vote and
 * supervote routes, and every admin path that changes a gene's candidates.
 *
 * Keep this module free of storage, network and clock access.
 *
 * The tie-break ordering mirrors the admin read-model leader SQL (its
 * `ROW_NUMBER() OVER` ranking blocks in the stateful runtime). Any change to
 * either ordering must change both implementations and their tests in the same
 * commit.
 */
import { compareCaretakerWeightedCandidates } from "../caretaker/caretaker-supervote.js"

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
 * Join candidate rows with their vote summaries and the caretaker supervote.
 * A vote row for an ineligible candidate remains stored (the user's intent is
 * kept) but cannot win. Eligible means what D1's candidate eligibility
 * projection means: not rejected, auto-pick eligible and not stale.
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
    .filter((row) => row.autopick_eligible && !row.is_stale && row.status !== "rejected")
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
  // Administrator override pins the current published asset: automatic
  // promotion must not fight an operator.
  if (adminOverride && current) {
    return { winner: rows.find((row) => row.asset_sha256 === current) || null, rows }
  }
  if (!rows.length) return { winner: null, rows }
  return {
    winner: [...rows].sort((left, right) => compareGeneAuthorityRows(left, right, current))[0],
    rows,
  }
}
