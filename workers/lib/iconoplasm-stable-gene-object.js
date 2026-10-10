// ARCHITECTURE FENCE [IPD-011]: THE ONLY builder of the stable gene object,
// genes/v3/<SYMBOL>.json (B-898, B-1063). A card is a pure function of two
// inputs:
//
//   card = buildGeneCard(content, facts)
//
// - `content` is what the factory made for the gene: its catalogue row, its
//   essence, its portraits and their blots. It lives in one private file per
//   gene, content/v1/<SYMBOL>.json, and only the factory writes it.
// - `facts` is what readers did: vote counts per portrait, the caretaker's
//   supervote, an administrator's pin, the canonical text, and the gene's vote
//   version. They live in D1.
//
// The winner rule lives here and nowhere else. The function reads no storage,
// network or clock (the clock is injected), so the Worker can rebuild one gene
// right after a reader acts on it and a test can rebuild every live card.
// The output keeps the exact shape readers already parse (the gene page, the
// extension, the catalogue builder in GitHub Actions).
import {
  ICONOPLASM_API_SCHEMA_VERSION,
  ICONOPLASM_PUBLIC_API_VERSION,
} from "../iconoplasm-route-contract.js"
import {
  ICONOPLASM_GENE_BLOT_HEIGHT,
  ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
  ICONOPLASM_GENE_BLOT_WIDTH,
  iconoplasmGeneBlotCdnUrl,
  iconoplasmGeneBlotFilename,
  iconoplasmGeneBlotFingerprint,
  iconoplasmGeneBlotObjectKey,
} from "../iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
import { CARETAKER_SUPERVOTE_WEIGHT } from "../iconoplasm/caretaker/caretaker-supervote.js"
import { electGeneAuthorityWinner } from "../iconoplasm/vote-authority/gene-authority-election.js"
import { iconoplasmGeneName } from "./iconoplasm-gene-name.js"

const HASH = /^[a-f0-9]{64}$/
const SYMBOL = /^[A-Z0-9][A-Z0-9-]{0,63}$/

export const STABLE_GENE_OBJECT_VERSION = 3
export const ICONOPLASM_CANONICAL_ORIGIN = "https://iconoplasm.brinedew.bio"

function normalizeSymbol(value) {
  const symbol = String(value ?? "")
    .trim()
    .toUpperCase()
  return SYMBOL.test(symbol) ? symbol : ""
}

function sha(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
  return HASH.test(text) ? text : null
}

function text(value, maxLength) {
  const trimmed = String(value ?? "").trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

// A missing number stays missing. (The D1 path turned a NULL into 0, which
// printed "first noted 0" for genes with no publication year.)
function wholeNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 0 ? number : null
}

function number(value, { min = -Infinity } = {}) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min ? parsed : null
}

function hexColor(value) {
  const color = String(value ?? "").trim()
  return /^#[a-f0-9]{6}$/i.test(color) ? color.toLowerCase() : null
}

function textList(value) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : []
}

function flag(value, fallback) {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  return fallback
}

function portraitUrl(assetSha256, rendition) {
  return `${ICONOPLASM_CANONICAL_ORIGIN}/portraits/v1/${assetSha256.slice(0, 2)}/${assetSha256}/${rendition}.webp`
}

// The card's essence block: the factory's essence row, named by the catalogue
// (B-908), with the transmembrane flag standing in for a sex the essence row
// doesn't give.
function cardEssence(essence, catalog, fullName) {
  const aesthetics = textList(essence.aesthetics)
  const aestheticsOrigin = textList(essence.aesthetics_origin)
  const politicsOrigin = textList(essence.politics_origin)
  const transmembrane = flag(catalog.tmh, null)
  const out = {}
  const put = (key, value) => {
    if (value !== null && value !== undefined) out[key] = value
  }
  put("weight_kg", number(essence.weight_kg))
  put("height_cm", number(essence.height_cm))
  put("sex", text(essence.sex, 32))
  put("age", text(essence.age, 32))
  put("age_years", number(essence.age_years))
  const faction = text(essence.faction, 64)
  if (faction) {
    out.faction = faction
    out.politics = faction
  }
  put("skin_hex", text(essence.skin_hex, 16))
  put("skin_name", text(essence.skin_name, 64))
  put("tissue_tau", number(essence.tissue_tau))
  put("loeuf", number(essence.loeuf))
  put("constraint_percentile", number(essence.constraint_percentile))
  if (aesthetics.length) out.aesthetics = aesthetics
  if (aestheticsOrigin.length) out.aesthetics_origin = aestheticsOrigin
  if (politicsOrigin.length) out.politics_origin = politicsOrigin
  put("family_surname", text(essence.family_surname, 64))
  put("family_members", number(essence.family_members))
  put("family_feature", text(essence.family_feature, 128))
  out.name = fullName
  if (!out.sex && transmembrane !== null) out.sex = transmembrane ? "Male" : "Female"
  if (transmembrane !== null) out.sex_origin = [transmembrane ? "Transmembrane" : "Soluble"]
  return out
}

// One candidate as the pool shows it, before the winner is known.
function candidateFromPortrait(portrait, votes, supervote) {
  const assetSha256 = sha(portrait.asset_sha256)
  const tally = votes.get(assetSha256) || {}
  const upvotes = wholeNumber(tally.upvotes) || 0
  const downvotes = wholeNumber(tally.downvotes) || 0
  const score = number(tally.score) || 0
  const supervoted = Boolean(supervote && supervote.asset_sha256 === assetSha256)
  const direction = supervoted ? supervote.direction : null
  const width = wholeNumber(portrait.width)
  const height = wholeNumber(portrait.height)
  return {
    asset_sha256: assetSha256,
    status: text(portrait.status, 32) || "draft",
    autopick_eligible: flag(portrait.autopick_eligible, true),
    is_current: false,
    candidate_image_id: wholeNumber(portrait.candidate_image_id),
    vision_id: text(portrait.vision_id, 128),
    emulsion_id: text(portrait.emulsion_id, 64),
    emulsion_label: text(portrait.emulsion_label, 64),
    sample_label: text(portrait.sample_label, 64),
    sample_number: wholeNumber(portrait.sample_number),
    sample_text_hash: sha(portrait.sample_text_hash),
    artist_id: text(portrait.artist_id, 64),
    image_upvotes: upvotes,
    image_downvotes: downvotes,
    image_score: score,
    caretaker_supervote: supervoted,
    caretaker_supervote_direction: direction,
    caretaker_supervote_weight: supervoted ? direction * CARETAKER_SUPERVOTE_WEIGHT : 0,
    weighted_score: score + (supervoted ? direction * CARETAKER_SUPERVOTE_WEIGHT : 0),
    created_at: text(portrait.created_at, 64),
    full_url: portraitUrl(assetSha256, "full"),
    medium_url: portraitUrl(assetSha256, "medium"),
    thumb_url: portraitUrl(assetSha256, "thumb"),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
  }
}

function compareDescending(left, right) {
  return String(right ?? "").localeCompare(String(left ?? ""))
}

// The pool's reading order: the winner first, then what readers rate highest.
function comparePoolOrder(left, right) {
  return (
    Number(right.is_current) - Number(left.is_current) ||
    right.weighted_score - left.weighted_score ||
    Number(right.caretaker_supervote_direction === 1) -
      Number(left.caretaker_supervote_direction === 1) ||
    right.image_score - left.image_score ||
    right.image_upvotes - left.image_upvotes ||
    compareDescending(left.created_at, right.created_at) ||
    String(left.asset_sha256).localeCompare(String(right.asset_sha256))
  )
}

// The winner rule. An administrator's pin wins while the pinned portrait is
// still in the pool. Otherwise the election picks among eligible portraits
// (not rejected, auto-pick eligible, not stale): caretaker-weighted score,
// then score, non-legacy, upvotes, newest, and on an exact tie the portrait
// readers already see, so a face never flips without a reason (135 live genes
// hold two portraits imported in the same second with no votes).
function electWinner(portraits, votes, supervote, pin, previousWinner) {
  if (pin) {
    const pinned = portraits.find((portrait) => sha(portrait.asset_sha256) === pin)
    if (pinned) return pin
  }
  const { winner } = electGeneAuthorityWinner({
    candidates: portraits.map((portrait) => ({
      asset_sha256: portrait.asset_sha256,
      status: portrait.status,
      autopick_eligible: flag(portrait.autopick_eligible, true) ? 1 : 0,
      is_stale: flag(portrait.is_stale, false) ? 1 : 0,
      is_legacy: flag(portrait.is_legacy, false) ? 1 : 0,
      created_at: portrait.created_at,
    })),
    summaries: [...votes.entries()].map(([assetSha256, tally]) => ({
      asset_sha256: assetSha256,
      upvotes: tally.upvotes,
      downvotes: tally.downvotes,
      score: tally.score,
    })),
    caretaker: supervote ? { ...supervote, active: true } : null,
    currentAssetSha: previousWinner,
  })
  return sha(winner?.asset_sha256)
}

function winnerPortrait(candidate) {
  if (!candidate) {
    return {
      status: "missing",
      hero_url: null,
      medium_url: null,
      thumb_url: null,
      width: null,
      height: null,
      asset_sha256: null,
      candidate_image_id: null,
      emulsion_id: null,
      emulsion_label: null,
      sample_label: null,
      sample_number: null,
      sample_text_hash: null,
      artist_id: null,
    }
  }
  return {
    status: "published",
    hero_url: candidate.full_url,
    medium_url: candidate.medium_url,
    thumb_url: candidate.thumb_url,
    width: candidate.width ?? null,
    height: candidate.height ?? null,
    asset_sha256: candidate.asset_sha256,
    candidate_image_id: candidate.candidate_image_id,
    vision_id: candidate.vision_id,
    emulsion_id: candidate.emulsion_id,
    emulsion_label: candidate.emulsion_label,
    sample_label: candidate.sample_label,
    sample_number: candidate.sample_number,
    sample_text_hash: candidate.sample_text_hash,
    artist_id: candidate.artist_id,
  }
}

// The print-copy blot the factory rendered for this winner, if it matches the
// card exactly (renderer, symbol, name and winning portrait). A blot made for
// another portrait waits until that portrait wins again.
function readyBlot(card, blots) {
  const winner = card.portrait?.asset_sha256
  if (!winner) return null
  const fingerprint = iconoplasmGeneBlotFingerprint(card)
  const objectKey = iconoplasmGeneBlotObjectKey(card.symbol, fingerprint)
  const blot = (Array.isArray(blots) ? blots : []).find(
    (entry) =>
      sha(entry?.portrait_asset_sha256) === winner &&
      String(entry?.blot_fingerprint || "").toLowerCase() === fingerprint &&
      String(entry?.object_key || "") === objectKey &&
      sha(entry?.asset_sha256),
  )
  if (!blot) return null
  return {
    status: "ready",
    blot_fingerprint: fingerprint,
    portrait_asset_sha256: winner,
    asset_sha256: sha(blot.asset_sha256),
    object_key: objectKey,
    image_url: iconoplasmGeneBlotCdnUrl(null, objectKey),
    canonical_url: `${ICONOPLASM_CANONICAL_ORIGIN}/${objectKey}`,
    semantic_url: `${ICONOPLASM_CANONICAL_ORIGIN}/blot/${encodeURIComponent(card.symbol)}.webp`,
    width: wholeNumber(blot.width) || ICONOPLASM_GENE_BLOT_WIDTH,
    height: wholeNumber(blot.height) || ICONOPLASM_GENE_BLOT_HEIGHT,
    filename: iconoplasmGeneBlotFilename(card.symbol),
    renderer_revision: ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
  }
}

// The canonical text's public record: an allowlist, so private fields (the
// tags the caretaker panel promises to keep private, B-859) can't reach a card
// whatever the fact reader hands over. The prose itself only when the
// caretaker made it visible.
function publicManifestation(record) {
  if (!record || typeof record !== "object") return null
  const visible = record.public_page_visible === true
  return {
    schema_version: record.schema_version ?? null,
    gene_id: record.gene_id ?? null,
    manifestation_id: record.manifestation_id ?? null,
    manifestation_revision_id: record.manifestation_revision_id ?? null,
    canonical_selection_id: record.canonical_selection_id ?? null,
    head_version: record.head_version ?? null,
    gene_revision: record.gene_revision ?? null,
    authority_event_id: record.authority_event_id ?? null,
    authority_event_sequence: record.authority_event_sequence ?? null,
    body_sha256: record.body_sha256 ?? null,
    body_bytes: record.body_bytes ?? null,
    public_page_visible: visible,
    prose: visible ? (record.prose ?? null) : null,
  }
}

function voteTallies(facts) {
  const tallies = new Map()
  for (const row of Array.isArray(facts?.votes) ? facts.votes : []) {
    const assetSha256 = sha(row?.asset_sha256)
    if (assetSha256) tallies.set(assetSha256, row)
  }
  return tallies
}

function activeSupervote(facts) {
  const assetSha256 = sha(facts?.supervote?.asset_sha256)
  const direction = Number(facts?.supervote?.direction)
  return assetSha256 && [-1, 1].includes(direction)
    ? { asset_sha256: assetSha256, direction }
    : null
}

/**
 * Builds genes/v3/<SYMBOL>.json.
 *
 * content: { symbol, catalog: { full_name, color_hex, tmh }, essence: {...},
 *            portraits: [...], blots: [...] }
 * facts:   { votes: [{ asset_sha256, upvotes, downvotes, score }],
 *            supervote: { asset_sha256, direction } | null,
 *            pin: asset_sha256 | null,
 *            previous_winner: asset_sha256 readers see now | null,
 *            manifestation: public text record | null,
 *            vote_version: integer | null }
 */
export function buildGeneCard(content, facts = {}, { now = () => new Date().toISOString() } = {}) {
  const symbol = normalizeSymbol(content?.symbol)
  if (!symbol) throw new TypeError("Gene content needs a valid symbol")
  const catalog = content?.catalog && typeof content.catalog === "object" ? content.catalog : {}
  const essence = content?.essence && typeof content.essence === "object" ? content.essence : {}
  const portraits = (Array.isArray(content?.portraits) ? content.portraits : []).filter(
    (portrait) => sha(portrait?.asset_sha256) && text(portrait?.status, 32) !== "rejected",
  )
  const votes = voteTallies(facts)
  const supervote = activeSupervote(facts)
  const winnerSha256 = electWinner(
    portraits,
    votes,
    supervote,
    sha(facts?.pin),
    sha(facts?.previous_winner),
  )
  const pool = portraits.map((portrait) => candidateFromPortrait(portrait, votes, supervote))
  for (const candidate of pool) candidate.is_current = candidate.asset_sha256 === winnerSha256
  pool.sort(comparePoolOrder)

  const fullName = iconoplasmGeneName(catalog.full_name, symbol)
  const voteVersion = wholeNumber(facts?.vote_version)
  const card = {
    api_version: ICONOPLASM_PUBLIC_API_VERSION,
    schema_version: ICONOPLASM_API_SCHEMA_VERSION,
    canonical_key: "symbol",
    canonical_symbol: symbol,
    symbol,
    full_name: fullName,
    color: hexColor(catalog.color_hex),
    essence: cardEssence(essence, catalog, fullName),
    portrait: winnerPortrait(pool.find((candidate) => candidate.is_current) || null),
    portrait_candidates: pool,
    candidate_count: pool.length,
    canonical_manifestation: publicManifestation(facts?.manifestation),
    resolved_from: "published_card_catalog_bulk",
    stable_object_version: STABLE_GENE_OBJECT_VERSION,
    vote_version: voteVersion,
    published_at: now(),
  }
  for (const [key, value] of [
    ["weight_kg", number(essence.weight_kg)],
    ["molecular_weight_kda", number(essence.molecular_weight_kda, { min: 0 })],
    ["first_publication_year", wholeNumber(essence.first_publication_year)],
    ["primary_tissue", text(essence.primary_tissue, 64)],
    ["tissue_tau", number(essence.tissue_tau)],
    ["loeuf", number(essence.loeuf)],
    ["constraint_percentile", number(essence.constraint_percentile)],
  ]) {
    if (value !== null) card[key] = value
  }
  const blot = readyBlot(card, content?.blots)
  if (blot) card.blot = blot
  return card
}
