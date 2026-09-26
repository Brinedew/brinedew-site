import {
  MAX_PROSE_CODE_POINTS,
  allRevisions,
  codePointLength,
  manifestationWordDiff,
  ownManifestation,
} from "./caretaker-manifestations-model.js?v=fcee998f5b583a90"

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

function provenanceMarkup(revision, escapeHtml) {
  const provenance = revision?.generation_provenance
  if (!provenance || typeof provenance !== "object") return ""
  const origin = String(provenance.origin || "")
  const source = String(provenance.source_label || provenance.model_id || origin)
  const details = [
    source,
    provenance.recipe_version ? `recipe ${provenance.recipe_version}` : "",
    provenance.source_body_sha256
      ? `source ${String(provenance.source_body_sha256).slice(0, 12)}…`
      : "",
  ].filter(Boolean)
  if (!details.length) return ""
  return (
    '<details class="icono-caretaker-provenance"><summary>Generation provenance</summary><p>' +
    escapeHtml(details.join(" — ")) +
    "</p></details>"
  )
}

function derivativeMarkup(revision, escapeHtml) {
  const derivative = revision?.derivative
  if (!derivative || typeof derivative !== "object") return ""
  const state = String(derivative.status || "pending")
  const label =
    state === "accepted"
      ? "Tags current"
      : state === "failed"
        ? "Tagging failed"
        : state === "stale"
          ? "Tags stale"
          : "Tags pending"
  const detail = derivative.recipe_version ? ` — recipe ${derivative.recipe_version}` : ""
  return (
    '<p class="icono-caretaker-derivative" data-state="' +
    escapeHtml(state) +
    '">' +
    escapeHtml(label + detail) +
    "</p>"
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
// never dumped in a column. Destructive actions live in Settings > Danger zone.

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

function relativeTime(iso) {
  const time = Date.parse(iso || "")
  if (!Number.isFinite(time)) return ""
  const seconds = (time - Date.now()) / 1000
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

function versionAuthor(manifestation) {
  return String(
    manifestation?.author_label ||
      (manifestation?.origin === "system_seed" ? "Original" : "Previous caretaker"),
  )
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

function versionBodyAvailable(revision) {
  return revision?.body_available !== false && revision?.lifecycle !== "purged"
}

function defaultSelectedRevisionId(dossier, revisions) {
  const canonical = String(dossier?.head?.canonical_revision_id || "")
  if (canonical && revisions.some((item) => item.revision?.manifestation_revision_id === canonical))
    return canonical
  return String(revisions[0]?.revision?.manifestation_revision_id || "")
}

function timelineItemMarkup(item, previous, dossier, selectedId, escapeHtml, revisions) {
  const revision = item.revision || {}
  const revisionId = String(revision.manifestation_revision_id || "")
  const canonical = revisionId && revisionId === dossier.head.canonical_revision_id
  const when = relativeTime(revision.created_at)
  const absolute = absoluteDate(revision)
  let delta = '<span class="icono-caretaker-timeline__delta">First version</span>'
  if (!versionBodyAvailable(revision)) {
    delta = '<span class="icono-caretaker-timeline__delta">Text removed</span>'
  } else if (previous && versionBodyAvailable(previous.revision)) {
    const { added, removed } = wordDelta(previous.revision.body, revision.body)
    delta =
      '<span class="icono-caretaker-timeline__delta" aria-label="' +
      escapeHtml(`${added} words added, ${removed} removed`) +
      '"><span class="icono-caretaker-delta-add">+' +
      added +
      '</span> <span class="icono-caretaker-delta-remove">−' +
      removed +
      "</span></span>"
  }
  return (
    '<div role="listitem"><button type="button" class="icono-caretaker-timeline__item" data-icono-caretaker-version="' +
    escapeHtml(revisionId) +
    '"' +
    (revisionId === selectedId ? ' aria-current="true"' : "") +
    ">" +
    '<span class="icono-caretaker-timeline__title">' +
    escapeHtml(versionTitle(item, revisions)) +
    (canonical ? '<span class="icono-caretaker-badge">Public</span>' : "") +
    "</span>" +
    '<span class="icono-caretaker-timeline__meta">' +
    (when
      ? '<time datetime="' +
        escapeHtml(String(revision.created_at || "")) +
        '" title="' +
        escapeHtml(absolute) +
        '">' +
        escapeHtml(when) +
        "</time> · "
      : "") +
    escapeHtml(versionAuthor(item.manifestation)) +
    "</span>" +
    delta +
    "</button></div>"
  )
}

// Titles are fixed strings, never user text. setBusy re-enables every control
// that lacks data-icono-caretaker-disabled, so a grey button must carry it.
function greyButton(title, label, state = "") {
  return (
    '<button type="button" class="icono-button" disabled data-icono-caretaker-disabled' +
    (state ? ' data-state="' + state + '"' : "") +
    ' title="' +
    title +
    '">' +
    label +
    "</button>"
  )
}

export function historyPreviewMarkup(dossier, selectedId, escapeHtml) {
  const revisions = allRevisions(dossier)
  const index = revisions.findIndex(function (item) {
    return item.revision?.manifestation_revision_id === selectedId
  })
  if (index < 0) {
    return '<section class="icono-caretaker-preview" data-icono-caretaker-preview></section>'
  }
  const item = revisions[index]
  const previous = revisions[index + 1] || null
  const revision = item.revision || {}
  const manifestation = item.manifestation || {}
  const canonical = selectedId === dossier.head.canonical_revision_id
  const available = versionBodyAvailable(revision)
  const canSelect =
    dossier.viewer.can_edit && revision.lifecycle === "active" && available && !canonical
  const canFork = dossier.viewer.can_edit && revision.lifecycle === "active" && available
  let body
  if (!available) {
    body =
      '<p class="icono-caretaker-preview__empty">This version’s text was removed under the retention policy.</p>'
  } else if (previous && versionBodyAvailable(previous.revision)) {
    const same = String(previous.revision.body || "") === String(revision.body || "")
    body = same
      ? '<p class="icono-caretaker-preview__empty">Same text as the version before; only tags or settings changed.</p>'
      : '<p class="icono-caretaker-preview__text">' +
        diffMarkup(previous.revision.body, revision.body, escapeHtml) +
        "</p>"
  } else {
    body =
      '<p class="icono-caretaker-preview__text">' + escapeHtml(String(revision.body || "")) + "</p>"
  }
  // B-872: an editor's actions stay in place and grey out; they never pop in.
  // A grey button carries no action attribute, so it cannot act on this version.
  const actions = !dossier.viewer.can_edit
    ? ""
    : (canFork
        ? '<button type="button" class="icono-button" data-icono-caretaker-fork="' +
          escapeHtml(selectedId) +
          '">Edit from here</button>'
        : greyButton("This version's text is no longer available", "Edit from here")) +
      (canSelect
        ? '<button type="button" class="icono-button icono-button--primary" data-icono-caretaker-select="' +
          escapeHtml(selectedId) +
          '" data-manifestation-id="' +
          escapeHtml(String(manifestation.manifestation_id || "")) +
          '" title="The gene page and new candidate images will use this version">Make public</button>'
        : canonical
          ? greyButton("This version is already public", "Make public", "in-use")
          : greyButton("This version's text is no longer available", "Make public"))
  return (
    '<section class="icono-caretaker-preview" data-icono-caretaker-preview aria-live="polite">' +
    '<header class="icono-caretaker-preview__header"><h3>' +
    escapeHtml(versionTitle(item, revisions)) +
    (canonical ? '<span class="icono-caretaker-badge">Public</span>' : "") +
    "</h3><p>" +
    escapeHtml(
      [
        versionAuthor(manifestation),
        absoluteDate(revision),
        previous ? "changes since " + versionTitle(previous, revisions).toLowerCase() : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ) +
    "</p></header>" +
    '<div class="icono-caretaker-preview__body">' +
    body +
    derivativeMarkup(revision, escapeHtml) +
    provenanceMarkup(revision, escapeHtml) +
    "</div>" +
    (actions
      ? '<div class="icono-caretaker-preview__actions icono-actions">' + actions + "</div>"
      : "") +
    "</section>"
  )
}

function historyMarkup(dossier, revisions, selectedId, escapeHtml) {
  if (!revisions.length) {
    return '<p class="icono-caretaker-empty">No versions yet. Your first save becomes version 1.</p>'
  }
  return (
    '<div class="icono-caretaker-history">' +
    // role=list divs, not <ol>: the blog's .markdown-preview-view :is(ul, ol) rule
    // outranks app classes and re-adds numbering (see Linear pet-peeves doc, #2).
    '<nav class="icono-caretaker-timeline-pane" aria-label="Versions"><div class="icono-caretaker-timeline" role="list">' +
    revisions
      .map(function (item, index) {
        return timelineItemMarkup(
          item,
          revisions[index + 1] || null,
          dossier,
          selectedId,
          escapeHtml,
          revisions,
        )
      })
      .join("") +
    "</div>" +
    (dossier.history?.next_cursor
      ? '<button type="button" class="icono-button icono-button--small icono-caretaker-history-more" data-icono-caretaker-history-more>Load older versions</button>'
      : "") +
    "</nav>" +
    historyPreviewMarkup(dossier, selectedId, escapeHtml) +
    "</div>"
  )
}

// Settings rows for the viewer's own manifestation records: restore is a normal
// row, delete belongs to the danger zone.
function lineageRows(dossier, escapeHtml) {
  const lineages = dossier.manifestations.filter(function (item) {
    return item?.can_withdraw || item?.can_restore
  })
  const restore = []
  const danger = []
  for (const manifestation of lineages) {
    const id = escapeHtml(String(manifestation.manifestation_id || ""))
    const current = manifestation.belongs_to_current_assignment === true
    const date = String(manifestation.created_at_label || manifestation.created_at || "")
    const which = current
      ? "the current manifestation"
      : "an earlier manifestation" + (date ? " (" + date + ")" : "")
    if (manifestation.can_restore) {
      restore.push(
        '<div class="icono-setting-row"><div class="icono-setting-row__text"><h4>Restore ' +
          escapeHtml(which) +
          "</h4><p>It was deleted. Restoring brings it back and makes it public.</p></div>" +
          '<button type="button" class="icono-button icono-button--primary" data-icono-caretaker-restore="' +
          id +
          '">Restore</button></div>',
      )
    } else if (manifestation.can_withdraw) {
      danger.push(
        '<div class="icono-setting-row"><div class="icono-setting-row__text"><h4>Delete ' +
          escapeHtml(which) +
          "</h4><p>Hidden at once; the next eligible version becomes public. Purged after 30 days unless legally held.</p></div>" +
          '<button type="button" class="icono-button icono-button--danger" data-icono-caretaker-withdraw="' +
          id +
          '">Delete…</button></div>',
      )
    }
  }
  return { restore: restore.join(""), danger: danger.join("") }
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
  const ownHead = revisions.find(function (item) {
    return item.revision?.manifestation_revision_id === own?.manifestation_head_revision_id
  })
  const savedSourceReady =
    ownHead?.revision?.lifecycle === "active" &&
    ownHead.revision.body_available !== false &&
    ownHead.revision.derivative?.status === "accepted" &&
    ownHead.revision.derivative.body_available !== false
  const ownSourceIsCanonical =
    own?.manifestation_head_revision_id === dossier.head?.canonical_revision_id
  let footerSource = ""
  let body =
    '<dialog class="icono-caretaker-dialog" data-icono-caretaker-dialog aria-labelledby="icono-caretaker-title">' +
    '<section class="icono-caretaker-panel">' +
    '<header class="icono-caretaker-panel__header"><div>' +
    '<p class="icono-caretaker-panel__eyebrow">' +
    esc(dossier.gene.symbol) +
    "</p>" +
    '<h2 id="icono-caretaker-title">Caretaker record</h2>' +
    "</div>" +
    (assignmentState
      ? '<span class="icono-caretaker-panel__state" data-state="' +
        esc(assignmentState) +
        '">' +
        esc(assignmentState.replaceAll("_", " ")) +
        "</span>"
      : "") +
    '<button type="button" class="icono-caretaker-dialog__close" data-icono-caretaker-close aria-label="Close caretaker record">×</button>' +
    "</header>"

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

  if (editable && own?.status === "withdrawn") {
    body +=
      '<p class="icono-caretaker-callout" data-tone="warn">Your current caretaker manifestation is withdrawn. Restore it before writing another version.</p>' +
      (own.can_restore
        ? ""
        : '<p class="icono-caretaker-callout" data-tone="warn">This manifestation can no longer be restored because its retained body is unavailable.</p>')
  }

  body +=
    '<div class="icono-caretaker-tabs" role="tablist" aria-label="Caretaker record sections">' +
    '<button type="button" role="tab" aria-selected="true" aria-controls="icono-caretaker-tab-manifestation" id="icono-caretaker-tab-button-manifestation" data-icono-caretaker-tab="manifestation">Manifestation</button>' +
    '<button type="button" role="tab" aria-selected="false" aria-controls="icono-caretaker-tab-history" id="icono-caretaker-tab-button-history" data-icono-caretaker-tab="history" tabindex="-1">History</button>' +
    '<button type="button" role="tab" aria-selected="false" aria-controls="icono-caretaker-tab-settings" id="icono-caretaker-tab-button-settings" data-icono-caretaker-tab="settings" tabindex="-1">Settings</button>' +
    "</div>" +
    '<div class="icono-caretaker-body">' +
    '<div class="icono-caretaker-tabpanel" role="tabpanel" id="icono-caretaker-tab-manifestation" aria-labelledby="icono-caretaker-tab-button-manifestation" data-icono-caretaker-tabpanel="manifestation">'

  if (canWrite) {
    const currentBody = String(own?.head_body || canonicalRevisionBody(dossier) || "")
    const currentTags = String(dossier?.prefill_tags_text ?? own?.head_tags ?? "")
    const tagsUnavailable =
      own?.tags_body_unavailable === true || dossier.tags_body_unavailable === true
    footerSource =
      '<div class="icono-caretaker-footer__source" data-icono-caretaker-generation-source>' +
      // B-872: always present; primary only when it is the next step.
      (savedSourceReady && !ownSourceIsCanonical && !tagsUnavailable
        ? '<button type="button" class="icono-button icono-button--primary" data-icono-caretaker-select="' +
          esc(own.manifestation_head_revision_id) +
          '" data-manifestation-id="' +
          esc(own.manifestation_id) +
          '" title="New candidate images and the gene page will use your latest saved version">Use my version</button>'
        : savedSourceReady && ownSourceIsCanonical
          ? greyButton(
              "New candidate images and the gene page already use your latest version",
              "Use my version",
              "in-use",
            )
          : tagsUnavailable
            ? greyButton("Saved Tags must load before your version can be used", "Use my version")
            : greyButton("Available once your version is saved", "Use my version")) +
      "</div>"
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
      "</span></div>" +
      "</section>" +
      '<section class="icono-caretaker-pane icono-caretaker-pane--tags">' +
      '<div class="icono-caretaker-pane__label icono-caretaker-tags-heading">Generation tags</div><div class="icono-caretaker-tag-scroll" data-icono-caretaker-tag-categories></div>' +
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
    revisions,
    String(options.selectedRevisionId || "") || defaultSelectedRevisionId(dossier, revisions),
    esc,
  )
  body += "</div>"

  body +=
    '<div class="icono-caretaker-tabpanel" role="tabpanel" id="icono-caretaker-tab-settings" aria-labelledby="icono-caretaker-tab-button-settings" data-icono-caretaker-tabpanel="settings" hidden>'

  const rows = lineageRows(dossier, esc)
  body += '<div class="icono-caretaker-settings">'
  if (editable) {
    const visible = own?.public_page_visible === true
    body +=
      '<section class="icono-settings-group" aria-label="Gene page">' +
      '<div class="icono-setting-row"><div class="icono-setting-row__text">' +
      '<h4 id="icono-caretaker-visibility-title">Show on the gene page</h4>' +
      "<p>Readers see your prose under the card. Tags always stay private.</p></div>" +
      '<label class="icono-caretaker-switch"><input type="checkbox" role="switch" aria-labelledby="icono-caretaker-visibility-title" data-icono-caretaker-visibility' +
      (visible ? " checked" : "") +
      (own ? "" : " disabled") +
      '><span aria-hidden="true"></span></label></div>' +
      rows.restore +
      "</section>"
  } else if (rows.restore) {
    body += '<section class="icono-settings-group">' + rows.restore + "</section>"
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
  if (rows.danger || leave) {
    body +=
      '<section class="icono-danger-zone" aria-labelledby="icono-caretaker-danger-title">' +
      '<h3 id="icono-caretaker-danger-title">Danger zone</h3>' +
      rows.danger +
      leave +
      "</section>"
  }
  body += "</div>"
  body += "</div>"
  body += "</div>"
  body +=
    '<div class="icono-caretaker-panel__footer">' +
    '<div class="icono-caretaker-footer__status">' +
    (canWrite
      ? '<span data-icono-caretaker-autosave-state role="status">Saved</span><button type="button" class="icono-caretaker-link-button" data-icono-caretaker-retry-save hidden>Retry</button>'
      : "") +
    "</div>" +
    '<div class="icono-caretaker-footer__actions icono-actions">' +
    footerSource +
    '<button type="button" class="icono-button" data-icono-caretaker-close>Close</button>' +
    "</div>" +
    "</div>"
  return body + "</section></dialog>"
}
