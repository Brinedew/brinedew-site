import {
  MAX_PROSE_CODE_POINTS,
  allRevisions,
  codePointLength,
  manifestationWordDiff,
  ownManifestation,
} from "./caretaker-manifestations-model.js?v=de638e47ba183354"
import { dialogMarkup } from "./dialog.js?v=a5c98f9ed0ae3eb6"
import { IMAGE_ORIGIN } from "./portrait-delivery.js?v=df8daed0d00d6780"

// B-740: attribute payloads must not rely on the mounted escaper covering
// quotes. The iconoplasm app passes a text-node escaper that leaves raw
// quotes, which truncated the data-fields-json attribute at its first key and
// made the tag editor unreachable for caretakers with saved fields.
function escapeAttributeValue(escapeHtml, value) {
  return String(escapeHtml(value)).replaceAll('"', "&quot;")
}

export function diffMarkup(before, after, escapeHtml) {
  if (String(before || "") === String(after || "")) {
    return '<p class="icono-caretaker-diff__unchanged">This version matches the canonical text.</p>'
  }
  return manifestationWordDiff(before, after)
    .map(function (part) {
      const text = escapeHtml(part.text)
      if (part.kind === "removed") return `<del>${text}</del>`
      if (part.kind === "added") return `<ins>${text}</ins>`
      return text
    })
    .join("")
}

function tagLines(fields) {
  return Object.entries(fields || {}).flatMap(function ([category, tags]) {
    return Array.isArray(tags)
      ? tags.map(function (tag) {
          return `${category}: ${tag}`
        })
      : []
  })
}

// Owner, 2026-10-05: after an Auto button the caretaker saw "Unsaved changes" and a
// 4,000-character box that looked the same; nothing said what had changed. The
// suggestion now shows as a diff where the text is, with VS Code's two choices for
// an AI edit (chatEditingEditorActions.ts: "Keep" / "Undo"). Nothing is saved
// until Keep.
export function suggestionReviewMarkup(review, escapeHtml) {
  let changes = ""
  let added = 0
  let removed = 0
  if (review.kind === "prose") {
    changes =
      review.before === review.after
        ? escapeHtml(review.after)
        : diffMarkup(review.before, review.after, escapeHtml)
    ;({ added, removed } = wordDelta(review.before, review.after))
  } else {
    const before = new Set(tagLines(review.before))
    const after = new Set(tagLines(review.after))
    const gone = [...before].filter((line) => !after.has(line))
    const fresh = [...after].filter((line) => !before.has(line))
    added = fresh.length
    removed = gone.length
    changes = gone
      .map((line) => `<del>${escapeHtml(line)}</del>`)
      .concat(fresh.map((line) => `<ins>${escapeHtml(line)}</ins>`))
      .join("\n")
  }
  return (
    '<div class="icono-caretaker-review" data-icono-caretaker-review="' +
    escapeHtml(review.kind) +
    '">' +
    '<div class="icono-caretaker-preview__text icono-caretaker-review__changes" tabindex="0">' +
    changes +
    "</div>" +
    '<div class="icono-caretaker-editor__meta">' +
    '<span class="icono-caretaker-timeline__delta"><span class="icono-caretaker-delta-add">+' +
    added +
    '</span> <span class="icono-caretaker-delta-remove">−' +
    removed +
    "</span></span>" +
    '<span class="icono-actions">' +
    '<button type="button" class="icono-button icono-button--primary" data-icono-caretaker-review-keep>Keep</button>' +
    '<button type="button" class="icono-button" data-icono-caretaker-review-undo>Undo</button>' +
    "</span></div></div>"
  )
}

function provenanceMarkup(revision, escapeHtml) {
  const provenance = revision?.generation_provenance
  if (!provenance || typeof provenance !== "object") return ""
  const origin = String(provenance.origin || "")
  const source = String(provenance.source_label || provenance.model_id || origin)
  // B-874 walkthrough: recipe numbers and source hashes meant nothing to a
  // caretaker. The model that wrote the tags is the one fact worth showing.
  const details = [source].filter(Boolean)
  if (!details.length) return ""
  return (
    '<details class="icono-caretaker-provenance"><summary>How the tags were made</summary><p>' +
    escapeHtml(details.join(" — ")) +
    "</p></details>"
  )
}

function statusMarkup(message, tone, escapeHtml) {
  if (!message) return '<p class="icono-caretaker-status" data-icono-caretaker-status hidden></p>'
  return (
    '<p class="icono-caretaker-status" data-icono-caretaker-status data-tone="' +
    escapeHtml(tone || "") +
    '" role="status">' +
    escapeHtml(message) +
    "</p>"
  )
}

// B-835 (owner, 2026-09-25): History and Settings follow the version-history and
// settings patterns of Google Docs, Notion and GitHub. History is a compact
// timeline (when, who, what changed) beside a preview that shows the selected
// version as a diff against the one before it; the full text of every version is
// never dumped in a column. Stopping as caretaker lives in Settings > Danger zone.

function wordDelta(before, after) {
  let added = 0
  let removed = 0
  for (const part of manifestationWordDiff(before, after)) {
    const words = String(part.text).trim().split(/\s+/).filter(Boolean).length
    if (part.kind === "added") added += words
    else if (part.kind === "removed") removed += words
  }
  return { added, removed }
}

// The author's name, as on every Wikipedia revision ("You" for the viewer). The
// seed row is already titled "Original", so it carries no second label.
function versionAuthor(manifestation) {
  if (manifestation?.origin === "system_seed") return ""
  return String(manifestation?.author_label || "Previous caretaker")
}

function absoluteDate(revision) {
  if (revision?.created_at_label) return String(revision.created_at_label)
  const time = Date.parse(revision?.created_at || "")
  if (!Number.isFinite(time)) return ""
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(
    time,
  )
}

// One global timeline, numbered oldest = 1 (like Google Docs), not each
// record's own revision_number: caretakers with several records across tenures
// otherwise saw "Version 1, Version 1, Version 2, Version 1".
function versionTitle(item, revisions) {
  if (item.manifestation?.origin === "system_seed") return "Original"
  const numbered = revisions.filter((entry) => entry.manifestation?.origin !== "system_seed")
  const index = numbered.indexOf(item)
  return (
    "Version " + String(index < 0 ? item.revision?.revision_number || "" : numbered.length - index)
  )
}

// B-724: the same label History shows for a version, for the "made from" links on
// candidate images. Empty when the version is not in the loaded history.
export function versionLabelForRevision(dossier, revisionId) {
  const revisions = allRevisions(dossier)
  const item = revisions.find(function (entry) {
    return entry.revision?.manifestation_revision_id === revisionId
  })
  return item ? versionTitle(item, revisions) : ""
}

function versionBodyAvailable(revision) {
  return revision?.body_available !== false && revision?.lifecycle !== "purged"
}

function defaultSelectedRevisionId(dossier, revisions) {
  const canonical = String(dossier?.head?.canonical_revision_id || "")
  if (canonical && revisions.some((item) => item.revision?.manifestation_revision_id === canonical))
    return canonical
  return String(revisions[0]?.revision?.manifestation_revision_id || "")
}

// B-1160 (owner, 2026-10-22): History has one row per look. The editor keeps one
// working copy a day and an order, a new day, "Edit from here" or a new caretaker
// seals it, so every stored version is a look worth returning to and nothing
// needs grouping. Each row says when, who, how many tags it added and removed
// against the look below it, and shows the portraits drawn from it. The
// Original is the base every caretaker started from, so it sits at the bottom
// whatever its date.
function historyRows(revisions) {
  const seed = revisions.filter((item) => item.manifestation?.origin === "system_seed")
  return revisions.filter((item) => item.manifestation?.origin !== "system_seed").concat(seed)
}

function dateTime(revision) {
  const time = Date.parse(revision?.created_at || "")
  if (!Number.isFinite(time)) return ""
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(time)
}

// Keyed by the tag alone: a tag that only moved category (old saves use older
// category names, generated/tag-categories.js) is the same look, and TP53's
// first look showed six tags as both added and removed.
function tagKeys(revision) {
  const keys = new Map()
  for (const [category, tags] of Object.entries(revision?.fields || {})) {
    if (!Array.isArray(tags)) continue
    for (const tag of tags) keys.set(String(tag), { category, tag: String(tag) })
  }
  return keys
}

function tagChanges(item, previous) {
  const after = tagKeys(item.revision)
  const before = tagKeys(previous?.revision)
  return {
    added: [...after].filter(([key]) => !before.has(key)).map(([, tag]) => tag),
    removed: [...before].filter(([key]) => !after.has(key)).map(([, tag]) => tag),
  }
}

function textChanged(item, previous) {
  return (
    Boolean(previous) &&
    versionBodyAvailable(previous.revision) &&
    String(previous.revision.body || "") !== String(item.revision?.body || "")
  )
}

// B-724: the portraits each saved version made, from the dossier's receipts.
function portraitsBySource(dossier) {
  const bySource = new Map()
  for (const entry of dossier?.candidate_sources || []) {
    const sha = String(entry.asset_sha256 || "").toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha)) continue
    const id = String(entry.source_manifestation_revision_id || "")
    if (!bySource.has(id)) bySource.set(id, [])
    bySource.get(id).push(sha)
  }
  return bySource
}

function portraitUrl(sha, size) {
  return `${IMAGE_ORIGIN}/portraits/v1/${sha.slice(0, 2)}/${sha}/${size}.webp`
}

const STRIP_THUMBS = 4

function portraitStripMarkup(shas, escapeHtml) {
  if (!shas.length) return ""
  const more = shas.length - STRIP_THUMBS
  return (
    '<span class="icono-caretaker-timeline__portraits" aria-label="' +
    escapeHtml(`${shas.length} portraits`) +
    '">' +
    shas
      .slice(0, STRIP_THUMBS)
      .map(
        (sha) =>
          '<img src="' +
          escapeHtml(portraitUrl(sha, "small")) +
          '" alt="" loading="lazy" decoding="async" width="34" height="34">',
      )
      .join("") +
    (more > 0 ? '<span class="icono-caretaker-timeline__more">+' + more + "</span>" : "") +
    "</span>"
  )
}

function deltaMarkup(item, previous, escapeHtml) {
  const revision = item.revision || {}
  if (!versionBodyAvailable(revision)) {
    return '<span class="icono-caretaker-timeline__delta">Text removed</span>'
  }
  if (!previous) return ""
  const { added, removed } = tagChanges(item, previous)
  const edited = textChanged(item, previous)
  if (!added.length && !removed.length && !edited) return ""
  return (
    '<span class="icono-caretaker-timeline__delta">' +
    (added.length || removed.length
      ? '<span aria-label="' +
        escapeHtml(`${added.length} tags added, ${removed.length} removed`) +
        '"><span class="icono-caretaker-delta-add">+' +
        added.length +
        '</span> <span class="icono-caretaker-delta-remove">−' +
        removed.length +
        "</span></span>"
      : "") +
    (edited ? '<span class="icono-caretaker-timeline__text-change">Text edited</span>' : "") +
    "</span>"
  )
}

function timelineItemMarkup(item, previous, context) {
  const { dossier, selectedId, escapeHtml, revisions, portraits } = context
  const revision = item.revision || {}
  const revisionId = String(revision.manifestation_revision_id || "")
  const canonical = revisionId && revisionId === dossier.head.canonical_revision_id
  const when =
    item.manifestation?.origin === "system_seed" ? absoluteDate(revision) : dateTime(revision)
  return (
    '<li><button type="button" class="icono-caretaker-timeline__item" data-icono-caretaker-version="' +
    escapeHtml(revisionId) +
    '"' +
    (revisionId === selectedId ? ' aria-current="true"' : "") +
    ">" +
    '<span class="icono-caretaker-timeline__title">' +
    escapeHtml(versionTitle(item, revisions)) +
    (canonical ? SOURCE_MARK : "") +
    "</span>" +
    '<span class="icono-caretaker-timeline__meta">' +
    [
      when
        ? '<time datetime="' +
          escapeHtml(String(revision.created_at || "")) +
          '">' +
          escapeHtml(when) +
          "</time>"
        : "",
      escapeHtml(versionAuthor(item.manifestation)),
      item.manifestation?.status === "withdrawn" ? "Withdrawn" : "",
    ]
      .filter(Boolean)
      .join(" · ") +
    "</span>" +
    deltaMarkup(item, previous, escapeHtml) +
    portraitStripMarkup(portraits.get(revisionId) || [], escapeHtml) +
    "</button></li>"
  )
}

// B-874: the version new images are drawn from. It used to be a "Public" badge,
// which clashed with "Show on the gene page": the word meant two things.
const SOURCE_MARK_LABEL = "New images are drawn from this version"
const SOURCE_MARK =
  '<span class="icono-caretaker-source-mark" data-icono-caretaker-source-mark role="img" aria-label="' +
  SOURCE_MARK_LABEL +
  '" title="' +
  SOURCE_MARK_LABEL +
  '"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m3.5 16 5-5 4 4 3-3 5 5"/>' +
  '<circle cx="15.5" cy="9.5" r="1.4"/></svg></span>'

// Titles are fixed strings, never user text. setBusy re-enables every control
// that lacks data-icono-caretaker-disabled, so a grey button must carry it.
function greyButton(title, label) {
  return (
    '<button type="button" class="icono-button" disabled data-icono-caretaker-disabled' +
    ' title="' +
    title +
    '">' +
    label +
    "</button>"
  )
}

function tagChipsMarkup(item, previous, escapeHtml) {
  const { added, removed } = tagChanges(item, previous)
  if (!added.length && !removed.length) return ""
  const chip = (entry, element) =>
    "<" +
    element +
    ' class="icono-caretaker-tag-chip" title="' +
    escapeHtml(entry.category) +
    '">' +
    escapeHtml(entry.tag) +
    "</" +
    element +
    ">"
  return (
    '<p class="icono-caretaker-tag-changes">' +
    added.map((entry) => chip(entry, "ins")).join("") +
    removed.map((entry) => chip(entry, "del")).join("") +
    "</p>"
  )
}

// The gene page's own viewer (lightbox.js) opens these, as it opens candidates.
function portraitGridMarkup(shas, symbol, escapeHtml) {
  if (!shas.length) return ""
  return (
    '<div class="icono-caretaker-preview__portraits" data-icono-lightbox>' +
    shas
      .map(
        (sha) =>
          '<button type="button" data-icono-pswp data-icono-pswp-src="' +
          escapeHtml(portraitUrl(sha, "full")) +
          '" aria-label="' +
          escapeHtml(`Open candidate portrait for ${symbol}`) +
          '"><img src="' +
          escapeHtml(portraitUrl(sha, "medium")) +
          '" alt="" loading="lazy" decoding="async"></button>',
      )
      .join("") +
    "</div>"
  )
}

export function historyPreviewMarkup(dossier, selectedId, escapeHtml) {
  const revisions = allRevisions(dossier)
  const rows = historyRows(revisions)
  const index = rows.findIndex(function (item) {
    return item.revision?.manifestation_revision_id === selectedId
  })
  if (index < 0) {
    return '<section class="icono-caretaker-preview" data-icono-caretaker-preview></section>'
  }
  const item = rows[index]
  const previous = rows[index + 1] || null
  const revision = item.revision || {}
  const manifestation = item.manifestation || {}
  const canonical = selectedId === dossier.head.canonical_revision_id
  const available = versionBodyAvailable(revision)
  const canFork = dossier.viewer.can_edit && revision.lifecycle === "active" && available
  let text = ""
  if (!available) {
    text =
      '<p class="icono-caretaker-preview__empty">This version’s text was removed under the retention policy.</p>'
  } else if (!previous) {
    text =
      '<p class="icono-caretaker-preview__text">' + escapeHtml(String(revision.body || "")) + "</p>"
  } else if (textChanged(item, previous)) {
    text =
      '<p class="icono-caretaker-preview__text">' +
      diffMarkup(previous.revision.body, revision.body, escapeHtml) +
      "</p>"
  }
  // B-874: no "Make public". Saving makes a version the image source; going back
  // to an older one is "Edit from here", which saves it as the newest version.
  // B-872: when a version can't be edited, the button greys out instead of vanishing.
  const actions = !dossier.viewer.can_edit
    ? ""
    : canFork
      ? '<button type="button" class="icono-button" data-icono-caretaker-fork="' +
        escapeHtml(selectedId) +
        '">Edit from here</button>'
      : greyButton("This version's text is no longer available", "Edit from here")
  return (
    '<section class="icono-caretaker-preview" data-icono-caretaker-preview aria-live="polite">' +
    '<header class="icono-caretaker-preview__header"><h3>' +
    escapeHtml(versionTitle(item, revisions)) +
    (canonical ? SOURCE_MARK : "") +
    "</h3><p>" +
    escapeHtml(
      [
        versionAuthor(manifestation),
        manifestation.origin === "system_seed" ? absoluteDate(revision) : dateTime(revision),
        previous ? "changes since " + versionTitle(previous, revisions).toLowerCase() : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ) +
    "</p></header>" +
    '<div class="icono-caretaker-preview__body">' +
    (previous ? tagChipsMarkup(item, previous, escapeHtml) : "") +
    text +
    portraitGridMarkup(
      portraitsBySource(dossier).get(selectedId) || [],
      dossier.gene.symbol,
      escapeHtml,
    ) +
    provenanceMarkup(revision, escapeHtml) +
    "</div>" +
    (actions
      ? '<div class="icono-caretaker-preview__actions icono-actions">' + actions + "</div>"
      : "") +
    "</section>"
  )
}

export function historyMarkup(dossier, selectedId, escapeHtml) {
  const revisions = allRevisions(dossier)
  if (!revisions.length) {
    return '<p class="icono-caretaker-empty">No versions yet. Your first save becomes version 1.</p>'
  }
  const rows = historyRows(revisions)
  const context = {
    dossier,
    selectedId,
    escapeHtml,
    revisions,
    portraits: portraitsBySource(dossier),
  }
  return (
    '<div class="icono-caretaker-history" data-icono-caretaker-history>' +
    '<nav class="icono-caretaker-timeline-pane" aria-label="Versions"><ol class="icono-caretaker-timeline">' +
    rows.map((item, index) => timelineItemMarkup(item, rows[index + 1] || null, context)).join("") +
    "</ol>" +
    (dossier.history?.next_cursor
      ? '<button type="button" class="icono-button icono-button--small icono-caretaker-history-more" data-icono-caretaker-history-more>Load older versions</button>'
      : "") +
    "</nav>" +
    historyPreviewMarkup(dossier, selectedId, escapeHtml) +
    "</div>"
  )
}

function canonicalRevisionBody(dossier) {
  const canonicalId = String(dossier?.head?.canonical_revision_id || "")
  if (!canonicalId) return ""
  const found = allRevisions(dossier).find(function (item) {
    return item.revision?.manifestation_revision_id === canonicalId
  })
  return String(found?.revision?.body || "")
}

export function renderCaretakerManifestationPanel(dossier, escapeHtml, options = {}) {
  const esc = escapeHtml
  const assignment = dossier.assignment
  const own = ownManifestation(dossier)
  const revisions = allRevisions(dossier)
  const assignmentState = String(assignment?.status || "")
  const editable = dossier.viewer.can_edit && assignmentState === "active"
  const canWrite = editable && own?.status !== "withdrawn"
  // B-849: the frame is the shared dialog. What the caretaker record adds is the
  // state pill beside the title, the notices and tabs under the header, the tab
  // panels as the scrolling body, and the save state beside Close.
  // Owner, 2026-10-05: the title is "Caretaker panel: <gene>", in those words. The
  // state pill appears only when the state is news (never for "active").
  const title = "Caretaker panel: " + dossier.gene.symbol
  const headerExtra =
    assignmentState && assignmentState !== "active"
      ? '<span class="icono-caretaker-panel__state" data-state="' +
        esc(assignmentState) +
        '">' +
        esc(assignmentState.replaceAll("_", " ")) +
        "</span>"
      : ""
  let body = ""

  if (dossier.gene.status === "merged") {
    body +=
      '<p class="icono-caretaker-callout" data-tone="warn">This gene record was merged' +
      (dossier.gene.merged_into_symbol
        ? " into <strong>" + esc(dossier.gene.merged_into_symbol) + "</strong>"
        : "") +
      ". Its version history remains readable here, but new changes belong to the surviving gene record.</p>"
  }

  if (dossier.viewer.can_accept && assignment) {
    const terms = assignment.terms
    body += '<div class="icono-caretaker-invitation">'
    if (terms?.terms_version_id && terms?.document_url) {
      body +=
        "<p>You have been invited to care for <strong>" +
        esc(dossier.gene.symbol) +
        "</strong>. Review and accept the exact terms version below before editing.</p>" +
        '<p><a href="' +
        esc(terms.document_url) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(terms.display_label || "Caretaker terms") +
        "</a>" +
        (terms.content_sha256
          ? ' <span class="icono-caretaker-invitation__hash">document ' +
            esc(terms.content_sha256.slice(0, 12)) +
            "</span>"
          : "") +
        "</p>" +
        '<label class="icono-caretaker-invitation__confirmation"><input type="checkbox" data-icono-caretaker-terms-accepted> I have read and accept these caretaker terms.</label>' +
        '<div class="icono-caretaker-invitation__actions"><button type="button" class="icono-button icono-button--primary" data-icono-caretaker-accept disabled>Accept caretaker role</button>' +
        (dossier.viewer.can_decline
          ? '<button type="button" class="icono-button" data-icono-caretaker-decline>Decline invitation</button>'
          : "") +
        "</div>"
    } else {
      body +=
        '<p class="icono-caretaker-callout" data-tone="warn">The versioned caretaker terms are temporarily unavailable. This invitation remains open, but it cannot be accepted until the exact document is restored.</p>' +
        (dossier.viewer.can_decline
          ? '<div class="icono-caretaker-invitation__actions"><button type="button" class="icono-button" data-icono-caretaker-decline>Decline invitation</button></div>'
          : "")
    }
    body += "</div>"
  }

  if (dossier.viewer.suspended) {
    body +=
      '<p class="icono-caretaker-callout" data-tone="warn">This caretaker role is suspended. History remains readable and your local draft is preserved, but saving and canonical changes are paused.</p>'
  }

  body +=
    '<div class="icono-caretaker-tabs" role="tablist" aria-label="Caretaker sections">' +
    '<button type="button" role="tab" aria-selected="true" aria-controls="icono-caretaker-tab-manifestation" id="icono-caretaker-tab-button-manifestation" data-icono-caretaker-tab="manifestation">Manifestation</button>' +
    '<button type="button" role="tab" aria-selected="false" aria-controls="icono-caretaker-tab-history" id="icono-caretaker-tab-button-history" data-icono-caretaker-tab="history" tabindex="-1">History</button>' +
    '<button type="button" role="tab" aria-selected="false" aria-controls="icono-caretaker-tab-settings" id="icono-caretaker-tab-button-settings" data-icono-caretaker-tab="settings" tabindex="-1">Settings</button>' +
    "</div>"
  const afterHeader = body
  body =
    '<div class="icono-caretaker-tabpanel" role="tabpanel" id="icono-caretaker-tab-manifestation" aria-labelledby="icono-caretaker-tab-button-manifestation" data-icono-caretaker-tabpanel="manifestation">'

  if (canWrite) {
    const currentBody = String(own?.head_body || canonicalRevisionBody(dossier) || "")
    const currentTags = String(dossier?.prefill_tags_text ?? own?.head_tags ?? "")
    const tagsUnavailable =
      own?.tags_body_unavailable === true || dossier.tags_body_unavailable === true
    const helper = dossier.taggerizer_enabled === true && !tagsUnavailable
    body +=
      (tagsUnavailable
        ? '<div class="icono-caretaker-callout" data-tone="error"><p>Saved Tags could not be loaded. Editing is paused so they cannot be replaced by blank text. Any unsent draft on this device remains preserved.</p><button type="button" class="icono-button" data-icono-caretaker-retry-tags>Retry loading saved Tags</button></div>'
        : "") +
      '<form class="icono-caretaker-editor" data-icono-caretaker-editor>' +
      '<section class="icono-caretaker-pane icono-caretaker-pane--prose">' +
      '<label class="icono-caretaker-pane__label" for="icono-caretaker-prose">Manifestation</label>' +
      '<textarea id="icono-caretaker-prose" rows="8" maxlength="' +
      MAX_PROSE_CODE_POINTS +
      '" data-icono-caretaker-prose autofocus' +
      (tagsUnavailable ? " disabled data-icono-caretaker-disabled" : "") +
      ">" +
      esc(currentBody) +
      "</textarea>" +
      '<div class="icono-caretaker-editor__meta"><span data-icono-caretaker-count>' +
      codePointLength(currentBody).toLocaleString() +
      " / " +
      MAX_PROSE_CODE_POINTS.toLocaleString() +
      "</span>" +
      (helper
        ? '<button type="button" class="icono-button" data-icono-caretaker-taggerize="tags_from_prose">Auto-extract tags from prose</button>'
        : "") +
      "</div>" +
      "</section>" +
      '<section class="icono-caretaker-pane icono-caretaker-pane--tags">' +
      '<div class="icono-caretaker-pane__label icono-caretaker-tags-heading">Generation tags</div><div class="icono-caretaker-tag-scroll" data-icono-caretaker-tag-categories></div>' +
      (helper
        ? '<div class="icono-caretaker-editor__meta"><button type="button" class="icono-button" data-icono-caretaker-taggerize="prose_from_tags">Auto-correct prose from tags</button></div>'
        : "") +
      '<textarea id="icono-caretaker-tags" class="icono-caretaker-tags-source" data-icono-caretaker-tags aria-hidden="true" tabindex="-1"' +
      (tagsUnavailable ? " disabled data-icono-caretaker-disabled" : "") +
      ' data-fields-json="' +
      // B-740: attribute payloads must not trust the mounted escaper to cover
      // quotes. The iconoplasm app passes a text-node escaper that leaves raw
      // quotes, which truncated this JSON at the first key and made the tag
      // editor unreachable for every caretaker with saved fields.
      escapeAttributeValue(esc, JSON.stringify(dossier.prefill_fields || own?.head_fields || {})) +
      '"' +
      ">" +
      esc(currentTags) +
      "</textarea>" +
      '<p class="icono-caretaker-editor__basis" data-icono-caretaker-basis hidden></p>' +
      "</section>" +
      "</form>"
  }

  body += statusMarkup("", "", esc)
  body += "</div>"
  body +=
    '<div class="icono-caretaker-tabpanel" role="tabpanel" id="icono-caretaker-tab-history" aria-labelledby="icono-caretaker-tab-button-history" data-icono-caretaker-tabpanel="history" hidden>'
  body += historyMarkup(
    dossier,
    String(options.selectedRevisionId || "") || defaultSelectedRevisionId(dossier, revisions),
    esc,
  )
  body += "</div>"

  body +=
    '<div class="icono-caretaker-tabpanel" role="tabpanel" id="icono-caretaker-tab-settings" aria-labelledby="icono-caretaker-tab-button-settings" data-icono-caretaker-tabpanel="settings" hidden>'

  body += '<div class="icono-caretaker-settings">'
  if (editable) {
    // B-1106: the switch shows or hides the text the gene uses now, which for
    // a new caretaker is the original text or the previous caretaker's.
    const visible = dossier.head?.public_page_visible === true
    body +=
      '<section class="icono-settings-group" aria-label="Gene page">' +
      '<div class="icono-setting-row"><div class="icono-setting-row__text">' +
      '<h4 id="icono-caretaker-visibility-title">Show on the gene page</h4>' +
      "<p>Readers see your prose under the card. Tags always stay private.</p></div>" +
      '<label class="icono-caretaker-switch"><input type="checkbox" role="switch" aria-labelledby="icono-caretaker-visibility-title" data-icono-caretaker-visibility' +
      (visible ? " checked" : "") +
      (dossier.head?.manifestation_id ? "" : " disabled") +
      '><span aria-hidden="true"></span></label></div>' +
      "</section>"
  }
  const leave =
    editable && assignment
      ? '<details class="icono-setting-row icono-caretaker-leave"><summary><span class="icono-setting-row__text"><h4>Stop being caretaker</h4>' +
        "<p>Someone else can then care for " +
        esc(dossier.gene.symbol) +
        ".</p></span>" +
        '<span class="icono-button icono-button--danger" aria-hidden="true">Stop…</span></summary>' +
        '<div class="icono-actions"><button type="button" class="icono-button icono-button--danger" data-icono-caretaker-end>Stop being caretaker</button></div></details>'
      : ""
  if (leave) {
    body +=
      '<section class="icono-danger-zone" aria-labelledby="icono-caretaker-danger-title">' +
      '<h3 id="icono-caretaker-danger-title">Danger zone</h3>' +
      leave +
      "</section>"
  }
  body += "</div>"
  body += "</div>"
  // Owner, 2026-10-05: a bare cloud in the far corner went unnoticed. The save
  // state now reads like WordPress's editor (a spinner with "Saving", a check
  // with "Saved"), right beside the buttons a caretaker presses to leave.
  const footer =
    '<div class="icono-caretaker-footer__actions icono-actions">' +
    (canWrite
      ? '<span data-icono-caretaker-autosave-state data-state="saved" role="status">' +
        "<span data-icono-caretaker-autosave-label>Saved</span></span>" +
        '<button type="button" class="icono-caretaker-link-button" data-icono-caretaker-retry-save hidden>Retry</button>'
      : "") +
    '<button type="button" class="icono-button" data-icono-dialog-close>Close</button>' +
    "</div>"
  return dialogMarkup({
    title,
    titleId: "icono-caretaker-title",
    size: "wide",
    fixed: true,
    className: "icono-caretaker-dialog",
    attributes: "data-icono-caretaker-dialog",
    panelClass: "icono-caretaker-panel",
    headerExtra,
    afterHeader,
    bodyClass: "icono-caretaker-body",
    body,
    footerClass: "icono-caretaker-panel__footer",
    footer,
  })
}
