const SUPERVOTE_WEIGHT = 10

function normalizedSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
}

function normalizedSha256(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : ""
}

function newCommandId() {
  if (globalThis.crypto?.randomUUID) {
    return `cmd_${globalThis.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
  }
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
}

export function normalizeCaretakerSupervoteSnapshot(payload) {
  const source =
    payload?.supervote && typeof payload.supervote === "object" ? payload.supervote : payload || {}
  return {
    assignment_status: String(source.assignment_status || source.assignment?.status || ""),
    assignment_version: Math.max(
      0,
      Number(source.assignment_version || source.assignment?.assignment_version || 0) || 0,
    ),
    accepted_event_sequence: Math.max(0, Number(source.accepted_event_sequence || 0) || 0),
    supervote_version: Math.max(0, Number(source.supervote_version || 0) || 0),
    asset_sha256: normalizedSha256(source.asset_sha256),
    active: source.active === true,
    suspended: source.suspended === true || source.assignment_status === "suspended",
    can_mutate: source.can_mutate === true,
    weight: SUPERVOTE_WEIGHT,
  }
}

export function caretakerSupervoteButtonMarkup(
  { assetSha256, snapshot, busy = false } = {},
  escapeHtml,
) {
  const assetSha = normalizedSha256(assetSha256)
  if (!assetSha) return ""
  const state = normalizeCaretakerSupervoteSnapshot(snapshot)
  const selected = state.active && state.asset_sha256 === assetSha
  const disabled = busy || state.suspended || !state.can_mutate
  const accessibleAction = selected
    ? "Remove caretaker supervote from this blot"
    : state.asset_sha256
      ? "Move caretaker supervote to this blot"
      : "Give caretaker supervote to this blot"
  return (
    '<button type="button" class="icono-caretaker-supervote' +
    (selected ? " is-selected" : "") +
    (state.suspended ? " is-suspended" : "") +
    '" data-icono-caretaker-supervote="' +
    escapeHtml(assetSha) +
    '" aria-pressed="' +
    (selected ? "true" : "false") +
    '" aria-label="' +
    escapeHtml(accessibleAction) +
    '" title="' +
    escapeHtml(accessibleAction) +
    '"' +
    (disabled ? " disabled" : "") +
    '><span class="icono-caretaker-supervote__seal" aria-hidden="true">C</span>' +
    '<span class="icono-caretaker-supervote__label">Caretaker supervote <span aria-hidden="true">·</span> <strong>+10</strong></span>' +
    (state.suspended ? '<span class="icono-caretaker-supervote__state">Suspended</span>' : "") +
    "</button>"
  )
}

export function caretakerSupervoteMutation({ snapshot, assetSha256, remove = false } = {}) {
  const state = normalizeCaretakerSupervoteSnapshot(snapshot)
  return {
    method: remove ? "DELETE" : "PUT",
    body: {
      command_id: newCommandId(),
      ...(remove ? {} : { asset_sha256: normalizedSha256(assetSha256) }),
      expected_assignment_version: state.assignment_version,
      expected_supervote_version: state.supervote_version,
    },
  }
}

function targetVoteBoxes(root) {
  const boxes = Array.from(
    root.querySelectorAll("[data-icono-gene-vote-box], [data-icono-candidate-vote-box]"),
  )
  const seen = new Set()
  return boxes
    .map(function (box) {
      const assetSha = normalizedSha256(
        box.getAttribute("data-icono-gene-vote-box") ||
          box.getAttribute("data-icono-candidate-vote-box"),
      )
      if (!assetSha || seen.has(box)) return null
      seen.add(box)
      return { box, assetSha }
    })
    .filter(Boolean)
}

function statusNode(root) {
  var existing = root.querySelector("[data-icono-caretaker-supervote-status]")
  if (existing) return existing
  var node = document.createElement("p")
  node.className = "icono-caretaker-supervote-status"
  node.setAttribute("data-icono-caretaker-supervote-status", "")
  node.setAttribute("role", "status")
  node.hidden = true
  var heading = root.querySelector(".icono-candidate-gallery-heading")
  if (heading) heading.appendChild(node)
  else root.prepend(node)
  return node
}

export function createCaretakerSupervoteControls({ fetchJSON, escapeHtml } = {}) {
  if (typeof fetchJSON !== "function") throw new TypeError("fetchJSON is required")
  if (typeof escapeHtml !== "function") throw new TypeError("escapeHtml is required")
  const mounted = new WeakMap()

  function apiPath(symbol) {
    return `/api/iconoplasm/caretaker/genes/${encodeURIComponent(symbol)}/supervote`
  }

  function setStatus(state, message, tone = "") {
    const node = statusNode(state.root)
    node.hidden = !message
    node.textContent = String(message || "")
    node.dataset.tone = tone
  }

  function clearControls(root) {
    root.querySelectorAll("[data-icono-caretaker-supervote-host]").forEach(function (node) {
      node.remove()
    })
  }

  function unmount(root) {
    if (!root) return
    const state = mounted.get(root)
    if (state?.listener) root.removeEventListener("click", state.listener)
    clearControls(root)
    root.querySelector("[data-icono-caretaker-supervote-status]")?.remove()
    mounted.delete(root)
  }

  function render(state) {
    clearControls(state.root)
    targetVoteBoxes(state.root).forEach(function ({ box, assetSha }) {
      var host = document.createElement("div")
      host.className = "icono-caretaker-supervote-host"
      host.setAttribute("data-icono-caretaker-supervote-host", assetSha)
      host.innerHTML = caretakerSupervoteButtonMarkup(
        { assetSha256: assetSha, snapshot: state.snapshot, busy: state.busy },
        escapeHtml,
      )
      box.insertAdjacentElement("afterend", host)
    })
  }

  async function reload(state) {
    const payload = await fetchJSON(apiPath(state.symbol), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    })
    state.snapshot = normalizeCaretakerSupervoteSnapshot(payload)
    render(state)
    return state.snapshot
  }

  async function mutate(state, assetSha) {
    if (state.busy || !state.snapshot.can_mutate) return
    const selected = state.snapshot.active && state.snapshot.asset_sha256 === assetSha
    const previous = { ...state.snapshot }
    state.busy = true
    state.snapshot = {
      ...state.snapshot,
      active: !selected,
      asset_sha256: selected ? "" : assetSha,
    }
    render(state)
    setStatus(state, selected ? "Removing caretaker supervote…" : "Moving caretaker supervote…")
    const mutation = caretakerSupervoteMutation({
      snapshot: previous,
      assetSha256: assetSha,
      remove: selected,
    })
    try {
      const payload = await fetchJSON(apiPath(state.symbol), {
        method: mutation.method,
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(mutation.body),
      })
      state.snapshot = normalizeCaretakerSupervoteSnapshot(payload)
      setStatus(
        state,
        selected
          ? "Caretaker supervote removed."
          : `Caretaker supervote moved. This blot now receives +${SUPERVOTE_WEIGHT}.`,
        "success",
      )
    } catch (error) {
      state.snapshot = previous
      if (Number(error?.status || 0) === 409) {
        await reload(state).catch(function () {})
        setStatus(
          state,
          "Caretaker state changed elsewhere. The newest selection is shown.",
          "warn",
        )
      } else {
        setStatus(
          state,
          String(error?.message || "Caretaker supervote could not be saved."),
          "error",
        )
      }
    } finally {
      state.busy = false
      render(state)
    }
  }

  function wire(state) {
    if (state.listener) return
    const listener = function (event) {
      const button = event.target.closest?.("[data-icono-caretaker-supervote]")
      if (!button || !state.root.contains(button)) return
      const current = mounted.get(state.root)
      if (!current) return
      void mutate(current, normalizedSha256(button.dataset.iconoCaretakerSupervote))
    }
    state.root.addEventListener("click", listener)
    state.listener = listener
  }

  async function mount(root, { symbol, dossier } = {}) {
    if (!root) return null
    const geneSymbol = normalizedSymbol(symbol || dossier?.gene?.symbol)
    const assignmentStatus = String(dossier?.assignment?.status || "")
    const isCaretaker = dossier?.viewer?.is_caretaker === true
    if (!geneSymbol || !isCaretaker || !["active", "suspended"].includes(assignmentStatus)) {
      unmount(root)
      return null
    }
    const existing = mounted.get(root)
    const state = existing || { root, symbol: geneSymbol, snapshot: {}, busy: false }
    state.symbol = geneSymbol
    mounted.set(root, state)
    wire(state)
    try {
      return await reload(state)
    } catch (error) {
      clearControls(root)
      setStatus(
        state,
        String(error?.message || "Caretaker supervote could not be loaded."),
        "error",
      )
      return null
    }
  }

  return Object.freeze({ mount, unmount })
}

export { SUPERVOTE_WEIGHT }
