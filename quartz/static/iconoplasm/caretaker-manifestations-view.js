import {
  MAX_PROSE_CODE_POINTS,
  allRevisions,
  codePointLength,
  manifestationWordDiff,
  ownManifestation,
} from "./caretaker-manifestations-model.js"

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

function ownLineageManagementMarkup(dossier, escapeHtml) {
  const lineages = dossier.manifestations.filter(function (item) {
    return item?.author_is_viewer === true && (item.can_withdraw || item.can_restore)
  })
  if (!lineages.length) return ""
  return (
    '<section class="icono-caretaker-lineages" aria-labelledby="icono-caretaker-lineages-title">' +
    '<h3 id="icono-caretaker-lineages-title">Your manifestation records</h3>' +
    "<p>Each caretaker tenure has its own record. You may withdraw only records you wrote. A withdrawn record becomes eligible for hard purge after 30 days unless a legal hold applies.</p>" +
    lineages
      .map(function (manifestation) {
        const current = manifestation.belongs_to_current_assignment === true
        const title = current ? "Current caretaker record" : "Record from a previous tenure"
        const date = String(manifestation.created_at_label || manifestation.created_at || "")
        return (
          '<article class="icono-caretaker-lineage" data-manifestation-id="' +
          escapeHtml(String(manifestation.manifestation_id || "")) +
          '"><div><strong>' +
          escapeHtml(title) +
          "</strong>" +
          (date ? "<span>Started " + escapeHtml(date) + "</span>" : "") +
          '<span class="icono-caretaker-lineage__state">' +
          escapeHtml(String(manifestation.status || "active").replaceAll("_", " ")) +
          "</span></div>" +
          (manifestation.can_restore
            ? '<button type="button" class="icono-button" data-icono-caretaker-restore="' +
              escapeHtml(String(manifestation.manifestation_id || "")) +
              '">Restore this manifestation</button>'
            : manifestation.can_withdraw
              ? '<button type="button" class="icono-button icono-button--danger-quiet" data-icono-caretaker-withdraw="' +
                escapeHtml(String(manifestation.manifestation_id || "")) +
                '">Delete this manifestation</button>'
              : "") +
          "</article>"
        )
      })
      .join("") +
    "</section>"
  )
}

function versionMarkup(item, dossier, escapeHtml) {
  const revision = item.revision || {}
  const manifestation = item.manifestation || {}
  const revisionId = String(revision.manifestation_revision_id || "")
  const canonical = revisionId && revisionId === dossier.head.canonical_revision_id
  const bodyAvailable = revision.body_available !== false && revision.lifecycle !== "purged"
  const canSelect =
    dossier.viewer.can_edit && revision.lifecycle === "active" && bodyAvailable && !canonical
  const canFork = dossier.viewer.can_edit && revision.lifecycle === "active" && bodyAvailable
  const authorLabel = String(
    manifestation.author_label ||
      (manifestation.author_is_viewer
        ? "Your manifestation"
        : manifestation.origin === "system_seed"
          ? "Original manifestation"
          : "Previous caretaker"),
  )
  return (
    '<article class="icono-caretaker-version' +
    (canonical ? " is-canonical" : "") +
    '" data-manifestation-revision-id="' +
    escapeHtml(revisionId) +
    '">' +
    '<header><div><span class="icono-caretaker-version__number">Version ' +
    escapeHtml(String(revision.revision_number || "")) +
    "</span>" +
    '<span class="icono-caretaker-version__author">' +
    escapeHtml(authorLabel) +
    "</span></div>" +
    (canonical ? '<strong class="icono-caretaker-version__canonical">Canonical</strong>' : "") +
    "</header>" +
    '<p class="icono-caretaker-version__body">' +
    (bodyAvailable
      ? escapeHtml(String(revision.body || ""))
      : "<em>This version’s body is no longer available under its retention policy.</em>") +
    "</p>" +
    derivativeMarkup(revision, escapeHtml) +
    provenanceMarkup(revision, escapeHtml) +
    '<div class="icono-caretaker-diff" data-icono-caretaker-diff-for="' +
    escapeHtml(revisionId) +
    '" hidden></div>' +
    "<footer><span>" +
    escapeHtml(String(revision.created_at_label || revision.created_at || "")) +
    "</span>" +
    '<span class="icono-caretaker-version__actions">' +
    (!canonical
      ? '<button type="button" class="icono-button icono-button--quiet" data-icono-caretaker-compare="' +
        escapeHtml(revisionId) +
        '">Compare with canonical</button>'
      : "") +
    (canFork
      ? '<button type="button" class="icono-button icono-button--quiet" data-icono-caretaker-fork="' +
        escapeHtml(revisionId) +
        '">Start from this version</button>'
      : "") +
    (canSelect
      ? '<button type="button" class="icono-button icono-button--quiet" data-icono-caretaker-select="' +
        escapeHtml(revisionId) +
        '" data-manifestation-id="' +
        escapeHtml(String(manifestation.manifestation_id || "")) +
        '">Use this version</button>'
      : "") +
    "</span>" +
    "</footer></article>"
  )
}

export function renderCaretakerManifestationPanel(dossier, escapeHtml) {
  const esc = escapeHtml
  const assignment = dossier.assignment
  const own = ownManifestation(dossier)
  const revisions = allRevisions(dossier)
  const assignmentState = String(assignment?.status || "")
  const editable = dossier.viewer.can_edit && assignmentState === "active"
  const canWrite = editable && own?.status !== "withdrawn"
  let body =
    '<section class="icono-caretaker-panel" aria-labelledby="icono-caretaker-title">' +
    '<header class="icono-caretaker-panel__header"><div>' +
    '<p class="icono-caretaker-panel__eyebrow">Caretaker record</p>' +
    '<h2 id="icono-caretaker-title">Manifestation versions</h2>' +
    "<p>Every save creates a version you can return to while it remains retained. Choose exactly which retained version is canonical.</p>" +
    "</div>" +
    (assignmentState
      ? '<span class="icono-caretaker-panel__state" data-state="' +
        esc(assignmentState) +
        '">' +
        esc(assignmentState.replaceAll("_", " ")) +
        "</span>"
      : "") +
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
        '<fieldset class="icono-caretaker-invitation__policy"><legend>If I later stop being caretaker, default to:</legend>' +
        '<label><input type="radio" name="caretaker-invitation-policy" value="retain"> Keep my manifestation in the gene history</label>' +
        '<label><input type="radio" name="caretaker-invitation-policy" value="withdraw"> Withdraw it, fall back to another eligible version, and make it eligible for hard purge after 30 days unless legally held</label>' +
        "</fieldset>" +
        '<div class="icono-caretaker-invitation__actions"><button type="button" class="icono-button" data-icono-caretaker-accept disabled>Accept caretaker role</button>' +
        (dossier.viewer.can_decline
          ? '<button type="button" class="icono-button icono-button--quiet" data-icono-caretaker-decline>Decline invitation</button>'
          : "") +
        "</div>"
    } else {
      body +=
        '<p class="icono-caretaker-callout" data-tone="warn">The versioned caretaker terms are temporarily unavailable. This invitation remains open, but it cannot be accepted until the exact document is restored.</p>' +
        (dossier.viewer.can_decline
          ? '<div class="icono-caretaker-invitation__actions"><button type="button" class="icono-button icono-button--quiet" data-icono-caretaker-decline>Decline invitation</button></div>'
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

  if (canWrite) {
    const currentBody = String(own?.head_body || "")
    body +=
      '<form class="icono-caretaker-editor" data-icono-caretaker-editor>' +
      '<label for="icono-caretaker-prose">Your manifestation</label>' +
      '<textarea id="icono-caretaker-prose" rows="8" maxlength="' +
      MAX_PROSE_CODE_POINTS +
      '" data-icono-caretaker-prose>' +
      esc(currentBody) +
      "</textarea>" +
      '<p class="icono-caretaker-editor__basis" data-icono-caretaker-basis hidden></p>' +
      '<div class="icono-caretaker-editor__meta"><span data-icono-caretaker-count>' +
      codePointLength(currentBody).toLocaleString() +
      " / " +
      MAX_PROSE_CODE_POINTS.toLocaleString() +
      "</span><span>Saving adds a version. Use “Use this version” to make it canonical.</span></div>" +
      '<div class="icono-caretaker-editor__actions"><button type="submit" class="icono-button">Save new version</button>' +
      "</div></form>"
  }

  body += statusMarkup("", "", esc)
  body += ownLineageManagementMarkup(dossier, esc)
  body += '<div class="icono-caretaker-versions" aria-label="Manifestation version history">'
  body += revisions.length
    ? revisions
        .map(function (item) {
          return versionMarkup(item, dossier, esc)
        })
        .join("")
    : '<p class="icono-caretaker-empty">No manifestation versions have been recorded yet.</p>'
  body += "</div>"

  if (dossier.history?.next_cursor) {
    body +=
      '<button type="button" class="icono-button icono-button--quiet icono-caretaker-history-more" data-icono-caretaker-history-more>Load older versions</button>'
  }

  if (editable && assignment) {
    const leavePolicy = assignment.leave_policy
    body +=
      '<details class="icono-caretaker-leave"><summary>Stop being caretaker</summary>' +
      "<p>Choose what happens to the manifestation you wrote. This choice becomes final when the role ends.</p>" +
      '<label><input type="radio" name="caretaker-end-policy" value="retain"' +
      (leavePolicy === "retain" ? " checked" : "") +
      "> Keep it in the gene history</label>" +
      '<label><input type="radio" name="caretaker-end-policy" value="withdraw"' +
      (leavePolicy === "withdraw" ? " checked" : "") +
      "> Withdraw it, fall back, and make it eligible for hard purge after 30 days unless legally held</label>" +
      '<button type="button" class="icono-button icono-button--danger-quiet" data-icono-caretaker-end>Confirm and stop</button></details>'
  }
  return body + "</section>"
}
