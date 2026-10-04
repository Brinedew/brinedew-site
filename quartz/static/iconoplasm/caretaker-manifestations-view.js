import {
  MAX_PROSE_CODE_POINTS,
  allRevisions,
  codePointLength,
  manifestationWordDiff,
  ownManifestation,
} from "./caretaker-manifestations-model.js?v=061f1b27d6945213"
import { dialogMarkup } from "./dialog.js?v=a5c98f9ed0ae3eb6"

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
  return (
    '<p class="icono-caretaker-derivative" data-state="' +
    escapeHtml(state) +
    '">' +
    escapeHtml(label) +
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

// B-874 (owner, 27 Sep 2026: "imagine all the inter-caretaker conflicts and
// optimize to survive those, not too spammy"). Autosave writes a version at
// every pause, so History groups them into sessions like Google Docs: one row
// per caretaker's run of saves, expandable to single saves. A session never
// spans two lineages, so a change of caretaker always starts a new row. That
// keeps the version before someone else's run one visible click away, which is
// the point Wikipedia's rollback returns to; "Edit from here" on it undoes the
// whole run. 30 minutes of quiet also ends a session (the common web-analytics
// session timeout).
const SESSION_GAP_MS = 30 * 60 * 1000

function historySessions(revisions) {
  const sessions = []
  for (const item of revisions) {
    const session = sessions[sessions.length - 1]
    const newer = session?.items[session.items.length - 1]
    const gap =
      Date.parse(newer?.revision?.created_at || "") - Date.parse(item.revision?.created_at || "")
    const sameRun =
      newer &&
      item.manifestation?.origin !== "system_seed" &&
      String(newer.manifestation?.manifestation_id || "") ===
        String(item.manifestation?.manifestation_id || "") &&
      !(gap > SESSION_GAP_MS)
    if (sameRun) session.items.push(item)
    else sessions.push({ items: [item] })
  }
  for (const session of sessions) {
    session.id = String(session.items[session.items.length - 1].revision?.manifestation_revision_id)
  }
  return sessions
}

// A session is open when the caretaker opened it, or when it holds the selected
// version below its header row (otherwise the selection would be invisible).
function openSessionIds(sessions, selectedId, expandedSessions) {
  const open = new Set(Array.from(expandedSessions || [], String))
  for (const session of sessions) {
    if (
      session.items.slice(1).some((item) => item.revision?.manifestation_revision_id === selectedId)
    )
      open.add(session.id)
  }
  return open
}

// Every row, and the preview, compares a version with the row below it on
// screen: a closed session shows what the whole run changed, an open one each save.
function visibleRevisions(sessions, open) {
  return sessions.flatMap((session) =>
    open.has(session.id) ? session.items : session.items.slice(0, 1),
  )
}

function deltaMarkup(item, previous, escapeHtml) {
  const revision = item.revision || {}
  if (!versionBodyAvailable(revision)) {
    return '<span class="icono-caretaker-timeline__delta">Text removed</span>'
  }
  if (!previous) return '<span class="icono-caretaker-timeline__delta">First version</span>'
  if (!versionBodyAvailable(previous.revision)) return ""
  if (String(previous.revision.body || "") === String(revision.body || "")) {
    const before = previous.revision.derivative?.tags_sha256
    const after = revision.derivative?.tags_sha256
    return (
      '<span class="icono-caretaker-timeline__delta">' +
      (before && after && before !== after ? "Tags changed" : "No text change") +
      "</span>"
    )
  }
  const { added, removed } = wordDelta(previous.revision.body, revision.body)
  return (
    '<span class="icono-caretaker-timeline__delta" aria-label="' +
    escapeHtml(`${added} words added, ${removed} removed`) +
    '"><span class="icono-caretaker-delta-add">+' +
    added +
    '</span> <span class="icono-caretaker-delta-remove">−' +
    removed +
    "</span></span>"
  )
}

function timelineItemMarkup(item, previous, context, options = {}) {
  const { dossier, selectedId, escapeHtml, revisions } = context
  const revision = item.revision || {}
  const revisionId = String(revision.manifestation_revision_id || "")
  const canonical =
    options.marked ?? (revisionId && revisionId === dossier.head.canonical_revision_id)
  const when = relativeTime(revision.created_at)
  const absolute = absoluteDate(revision)
  const withdrawn = options.header && item.manifestation?.status === "withdrawn"
  return (
    '<button type="button" class="icono-caretaker-timeline__item" data-icono-caretaker-version="' +
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
          '" title="' +
          escapeHtml(absolute) +
          '">' +
          escapeHtml(when) +
          "</time>"
        : "",
      escapeHtml(versionAuthor(item.manifestation)),
      withdrawn ? "Withdrawn" : "",
    ]
      .filter(Boolean)
      .join(" · ") +
    "</span>" +
    deltaMarkup(item, previous, escapeHtml) +
    "</button>"
  )
}

function sessionMarkup(session, open, visible, context) {
  const { dossier, escapeHtml } = context
  const isOpen = open.has(session.id)
  const previousOf = (item) => visible[visible.indexOf(item) + 1] || null
  const canonical = String(dossier.head.canonical_revision_id || "")
  const holdsSource = session.items.some(
    (item) => item.revision?.manifestation_revision_id === canonical,
  )
  const [head, ...inner] = session.items
  return (
    '<div role="listitem" class="icono-caretaker-session" data-icono-caretaker-session="' +
    escapeHtml(session.id) +
    '">' +
    timelineItemMarkup(head, previousOf(head), context, {
      header: true,
      // A closed session carries the image-source mark of any version inside it.
      marked: isOpen ? undefined : holdsSource,
    }) +
    (inner.length
      ? '<button type="button" class="icono-caretaker-session__toggle" data-icono-caretaker-session-toggle="' +
        escapeHtml(session.id) +
        '" aria-expanded="' +
        (isOpen ? "true" : "false") +
        '">' +
        escapeHtml(`${session.items.length} saves`) +
        "</button>" +
        '<div role="list" class="icono-caretaker-session__versions" data-icono-caretaker-session-versions' +
        (isOpen ? "" : " hidden") +
        ">" +
        inner
          .map(
            (item) =>
              '<div role="listitem">' +
              timelineItemMarkup(
                item,
                context.revisions[context.revisions.indexOf(item) + 1] || null,
                context,
              ) +
              "</div>",
          )
          .join("") +
        "</div>"
      : "") +
    "</div>"
  )
}

// B-874: the save state is a cloud glyph, the convention Google Docs taught
// everyone: hollow = unsaved, arrow = saving, check = saved, slash = failed.
// CSS shows one mark per data-state; the word stays for screen readers.
const AUTOSAVE_GLYPH =
  '<svg class="icono-caretaker-cloud" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path class="icono-caretaker-cloud__shape" d="M7 18.5h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.3 9.3 4.6 4.6 0 0 0 7 18.5z"/>' +
  '<path class="icono-caretaker-cloud__mark" data-mark="saving" d="M12 16.2v-5.4m-2.3 2.3 2.3-2.3 2.3 2.3"/>' +
  '<path class="icono-caretaker-cloud__mark" data-mark="saved" d="m9.3 13.6 1.9 1.9 3.6-3.8"/>' +
  '<path class="icono-caretaker-cloud__mark" data-mark="failed" d="M4.5 4.5l15 15"/>' +
  "</svg>"

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

export function historyPreviewMarkup(dossier, selectedId, escapeHtml, expandedSessions) {
  const revisions = allRevisions(dossier)
  const index = revisions.findIndex(function (item) {
    return item.revision?.manifestation_revision_id === selectedId
  })
  if (index < 0) {
    return '<section class="icono-caretaker-preview" data-icono-caretaker-preview></section>'
  }
  const item = revisions[index]
  const sessions = historySessions(revisions)
  const visible = visibleRevisions(sessions, openSessionIds(sessions, selectedId, expandedSessions))
  const shown = visible.indexOf(item)
  const previous = (shown < 0 ? revisions[index + 1] : visible[shown + 1]) || null
  const revision = item.revision || {}
  const manifestation = item.manifestation || {}
  const canonical = selectedId === dossier.head.canonical_revision_id
  const available = versionBodyAvailable(revision)
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

export function historyMarkup(dossier, selectedId, escapeHtml, expandedSessions) {
  const revisions = allRevisions(dossier)
  if (!revisions.length) {
    return '<p class="icono-caretaker-empty">No versions yet. Your first save becomes version 1.</p>'
  }
  const sessions = historySessions(revisions)
  const open = openSessionIds(sessions, selectedId, expandedSessions)
  const visible = visibleRevisions(sessions, open)
  const context = { dossier, selectedId, escapeHtml, revisions }
  return (
    '<div class="icono-caretaker-history" data-icono-caretaker-history>' +
    // role=list divs, not <ol>: the blog's .markdown-preview-view :is(ul, ol) rule
    // outranks app classes and re-adds numbering (see Linear pet-peeves doc, #2).
    '<nav class="icono-caretaker-timeline-pane" aria-label="Versions"><div class="icono-caretaker-timeline" role="list">' +
    sessions.map((session) => sessionMarkup(session, open, visible, context)).join("") +
    "</div>" +
    (dossier.history?.next_cursor
      ? '<button type="button" class="icono-button icono-button--small icono-caretaker-history-more" data-icono-caretaker-history-more>Load older versions</button>'
      : "") +
    "</nav>" +
    historyPreviewMarkup(dossier, selectedId, escapeHtml, expandedSessions) +
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
          "</h4><p>Hidden at once; new images go back to the next available version. It is removed from public view on the site, though not from backups.</p></div>" +
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
  // B-849: the frame is the shared dialog. What the caretaker record adds is the
  // state pill beside the title, the notices and tabs under the header, the tab
  // panels as the scrolling body, and the autosave state beside Close.
  // B-874 walkthrough: the title names the task, not a database object, and the
  // state pill appears only when the state is news (never for "active").
  const title =
    (dossier.viewer.can_accept ? "Invitation to care for " : "Caring for ") + dossier.gene.symbol
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

  if (editable && own?.status === "withdrawn") {
    body +=
      '<p class="icono-caretaker-callout" data-tone="warn">Your current caretaker manifestation is withdrawn. Restore it before writing another version.</p>' +
      (own.can_restore
        ? ""
        : '<p class="icono-caretaker-callout" data-tone="warn">This manifestation can no longer be restored because its retained body is unavailable.</p>')
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
      '" data-icono-caretaker-prose autofocus aria-describedby="icono-caretaker-prose-purpose"' +
      (tagsUnavailable ? " disabled data-icono-caretaker-disabled" : "") +
      ">" +
      esc(currentBody) +
      "</textarea>" +
      // B-874 walkthrough, item 3: what this text is for used to live only in a
      // grey footer sentence the eye reached last. It now sits under the box.
      '<p class="icono-caretaker-editor__purpose" id="icono-caretaker-prose-purpose">' +
      esc(
        `New pictures of ${dossier.gene.symbol} are drawn from this text and its tags. ` +
          (own?.public_page_visible
            ? "Readers also see it on the gene page."
            : "Readers don’t see it; you can show it in Settings."),
      ) +
      "</p>" +
      '<div class="icono-caretaker-editor__meta"><span data-icono-caretaker-count>' +
      codePointLength(currentBody).toLocaleString() +
      " / " +
      MAX_PROSE_CODE_POINTS.toLocaleString() +
      "</span>" +
      (helper
        ? '<button type="button" class="icono-button" data-icono-caretaker-taggerize="tags_from_prose">Tags from prose</button>'
        : "") +
      "</div>" +
      "</section>" +
      '<section class="icono-caretaker-pane icono-caretaker-pane--tags">' +
      '<div class="icono-caretaker-pane__label icono-caretaker-tags-heading">Generation tags</div><div class="icono-caretaker-tag-scroll" data-icono-caretaker-tag-categories></div>' +
      (helper
        ? '<div class="icono-caretaker-editor__meta"><button type="button" class="icono-button" data-icono-caretaker-taggerize="prose_from_tags">Prose from Tags</button></div>'
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
    options.expandedSessions,
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
  const footer =
    '<div class="icono-caretaker-footer__status">' +
    (canWrite
      ? '<span data-icono-caretaker-autosave-state data-state="saved" role="status" title="Saved">' +
        AUTOSAVE_GLYPH +
        '<span class="icono-visually-hidden" data-icono-caretaker-autosave-label>Saved</span></span>' +
        '<button type="button" class="icono-caretaker-link-button" data-icono-caretaker-retry-save hidden>Retry</button>'
      : "") +
    "</div>" +
    '<div class="icono-caretaker-footer__actions icono-actions">' +
    (canWrite
      ? '<button type="button" class="icono-button icono-button--primary" data-icono-caretaker-save-suggestion hidden>Save</button>'
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
