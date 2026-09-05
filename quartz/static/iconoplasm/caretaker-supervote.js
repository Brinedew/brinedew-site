const SUPERVOTE_WEIGHT = 10
const LONG_PRESS_MS = 650
const MOVE_TOLERANCE_PX = 12
const VOTE_BUTTON_SELECTOR = "[data-icono-vote-up], [data-icono-vote-down]"

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

function normalizedDirection(value) {
  const direction = Number(value)
  return direction === -1 || direction === 1 ? direction : null
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
  const assetSha = normalizedSha256(source.asset_sha256)
  const direction = assetSha ? normalizedDirection(source.direction) : null
  return {
    assignment_status: String(source.assignment_status || source.assignment?.status || ""),
    assignment_version: Math.max(
      0,
      Number(source.assignment_version || source.assignment?.assignment_version || 0) || 0,
    ),
    accepted_event_sequence: Math.max(0, Number(source.accepted_event_sequence || 0) || 0),
    supervote_version: Math.max(0, Number(source.supervote_version || 0) || 0),
    asset_sha256: assetSha,
    direction,
    active: source.active === true && Boolean(assetSha) && direction !== null,
    suspended: source.suspended === true || source.assignment_status === "suspended",
    can_mutate: source.can_mutate === true,
    weight: SUPERVOTE_WEIGHT,
  }
}

export function caretakerSupervoteMutation({ snapshot, assetSha256, direction } = {}) {
  const state = normalizeCaretakerSupervoteSnapshot(snapshot)
  const assetSha = normalizedSha256(assetSha256)
  const signedDirection = normalizedDirection(direction)
  const remove =
    state.active && state.asset_sha256 === assetSha && state.direction === signedDirection
  return {
    method: remove ? "DELETE" : "PUT",
    body: {
      command_id: newCommandId(),
      ...(remove ? {} : { asset_sha256: assetSha, direction: signedDirection }),
      expected_assignment_version: state.assignment_version,
      expected_supervote_version: state.supervote_version,
    },
  }
}

function voteTargets(root) {
  return Array.from(root.querySelectorAll(VOTE_BUTTON_SELECTOR))
    .map(function (button) {
      const box = button.closest("[data-icono-gene-vote-box], [data-icono-candidate-vote-box]")
      const assetSha = normalizedSha256(
        box?.getAttribute("data-icono-gene-vote-box") ||
          box?.getAttribute("data-icono-candidate-vote-box"),
      )
      const direction = button.matches("[data-icono-vote-up]") ? 1 : -1
      return assetSha ? { button, assetSha, direction } : null
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

function restoreButton(button) {
  button.classList.remove("is-caretaker-supervoted", "is-caretaker-supervote-pending")
  button.removeAttribute("data-icono-caretaker-supervote-direction")
  button.querySelector("[data-icono-caretaker-supervote-mark]")?.remove()
  if (button.dataset.iconoCaretakerBaseLabel) {
    button.setAttribute("aria-label", button.dataset.iconoCaretakerBaseLabel)
  }
  if (button.dataset.iconoCaretakerBaseTitle) {
    button.setAttribute("title", button.dataset.iconoCaretakerBaseTitle)
  } else {
    button.removeAttribute("title")
  }
  delete button.dataset.iconoCaretakerBaseLabel
  delete button.dataset.iconoCaretakerBaseTitle
}

export function createCaretakerSupervoteControls({ fetchJSON, onChanged } = {}) {
  if (typeof fetchJSON !== "function") throw new TypeError("fetchJSON is required")
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

  function clearTimer(state) {
    if (state.gesture?.timer) window.clearTimeout(state.gesture.timer)
    state.gesture = null
  }

  function suppressTrailingClick(state, button) {
    state.suppressClickButton = button
    const wasDisabled = button.disabled
    button.disabled = true
    const blocker = function (event) {
      event.preventDefault()
      event.stopImmediatePropagation()
      state.suppressClickButton = null
      button.removeEventListener("click", blocker, true)
    }
    button.addEventListener("click", blocker, { capture: true, once: true })
    window.setTimeout(function () {
      button.removeEventListener("click", blocker, true)
      if (state.suppressClickButton === button) state.suppressClickButton = null
      if (!wasDisabled) button.disabled = false
    }, 80)
  }

  function render(state) {
    state.root
      .querySelectorAll("[data-icono-caretaker-supervote-mark]")
      .forEach((mark) => mark.remove())
    state.root
      .querySelectorAll(".icono-caretaker-seal-host")
      .forEach((host) => host.classList.remove("icono-caretaker-seal-host"))
    voteTargets(state.root).forEach(function ({ button, assetSha, direction }) {
      const selected =
        state.snapshot.active &&
        state.snapshot.asset_sha256 === assetSha &&
        state.snapshot.direction === direction
      if (!button.dataset.iconoCaretakerBaseLabel) {
        button.dataset.iconoCaretakerBaseLabel = button.getAttribute("aria-label") || "Vote"
        button.dataset.iconoCaretakerBaseTitle = button.getAttribute("title") || ""
      }
      button.classList.toggle("is-caretaker-supervoted", selected)
      button.classList.toggle("is-caretaker-supervote-pending", state.busy && selected)
      button.setAttribute("data-icono-caretaker-supervote-direction", String(direction))
      const action = selected
        ? `Long-press to recall your ${direction > 0 ? "+" : "-"}${SUPERVOTE_WEIGHT} caretaker supervote`
        : `Long-press to assign your ${direction > 0 ? "+" : "-"}${SUPERVOTE_WEIGHT} caretaker supervote`
      button.setAttribute(
        "aria-label",
        `${button.dataset.iconoCaretakerBaseLabel}. ${action}. Shift plus Enter or Space also assigns it.`,
      )
      button.setAttribute("title", `${action} · Shift+Enter/Space`)
      if (selected) {
        const host = button.closest(".icono-label-qc-block") || button.parentElement
        host.classList.add("icono-caretaker-seal-host")
        const mark = document.createElement("span")
        mark.className = "icono-caretaker-supervote-mark"
        mark.setAttribute("data-icono-caretaker-supervote-mark", "")
        mark.setAttribute("data-direction", String(direction))
        mark.setAttribute("aria-hidden", "true")
        mark.textContent = `${direction > 0 ? "+" : "-"}${SUPERVOTE_WEIGHT}`
        host.appendChild(mark)
      }
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
    if (typeof onChanged === "function") onChanged(state.snapshot)
    return state.snapshot
  }

  async function mutate(state, assetSha, direction) {
    if (state.busy || !state.snapshot.can_mutate || state.snapshot.suspended) return
    const previous = { ...state.snapshot }
    const mutation = caretakerSupervoteMutation({
      snapshot: previous,
      assetSha256: assetSha,
      direction,
    })
    const removing = mutation.method === "DELETE"
    state.busy = true
    state.snapshot = {
      ...state.snapshot,
      active: !removing,
      asset_sha256: removing ? "" : assetSha,
      direction: removing ? null : direction,
    }
    render(state)
    setStatus(
      state,
      removing ? "Recalling caretaker supervote." : "Transferring caretaker supervote.",
    )
    try {
      const payload = await fetchJSON(apiPath(state.symbol), {
        method: mutation.method,
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(mutation.body),
      })
      state.snapshot = normalizeCaretakerSupervoteSnapshot(payload)
      if (typeof onChanged === "function") onChanged(state.snapshot)
      setStatus(
        state,
        removing
          ? "Your 10x caretaker supervote is unspent."
          : `Your ${direction > 0 ? "+" : "-"}${SUPERVOTE_WEIGHT} caretaker supervote is assigned.`,
        "success",
      )
    } catch (error) {
      state.snapshot = previous
      if (Number(error?.status || 0) === 409) {
        await reload(state).catch(function () {})
        setStatus(
          state,
          "Caretaker state changed elsewhere. The current supervote is shown.",
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

  function targetFromEvent(state, event) {
    const button = event.target?.closest?.(VOTE_BUTTON_SELECTOR)
    if (!button || !state.root.contains(button)) return null
    return voteTargets(state.root).find((target) => target.button === button) || null
  }

  function wire(state) {
    if (state.listeners) return
    const listeners = {
      pointerdown(event) {
        const target = targetFromEvent(state, event)
        if (!target || event.button !== 0 || !state.snapshot.can_mutate || state.busy) return
        clearTimer(state)
        state.gesture = {
          button: target.button,
          assetSha: target.assetSha,
          direction: target.direction,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          fired: false,
          timer: window.setTimeout(function () {
            if (!state.gesture) return
            state.gesture.fired = true
            suppressTrailingClick(state, target.button)
            if (navigator.vibrate) navigator.vibrate(18)
            void mutate(state, target.assetSha, target.direction)
          }, LONG_PRESS_MS),
        }
      },
      pointermove(event) {
        const gesture = state.gesture
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.fired) return
        if (
          Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >
          MOVE_TOLERANCE_PX
        ) {
          clearTimer(state)
        }
      },
      pointerend(event) {
        if (state.gesture?.pointerId === event.pointerId) clearTimer(state)
      },
      click(event) {
        const button = event.target?.closest?.(VOTE_BUTTON_SELECTOR)
        if (!button || state.suppressClickButton !== button) return
        state.suppressClickButton = null
        event.preventDefault()
        event.stopImmediatePropagation()
      },
      contextmenu(event) {
        if (targetFromEvent(state, event)) event.preventDefault()
      },
      keydown(event) {
        const target = targetFromEvent(state, event)
        if (!target || !state.snapshot.can_mutate || state.busy) return
        if (event.shiftKey && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          event.stopImmediatePropagation()
          suppressTrailingClick(state, target.button)
          void mutate(state, target.assetSha, target.direction)
          return
        }
        if (event.key !== " " || event.repeat) return
        event.preventDefault()
        clearTimer(state)
        state.gesture = {
          button: target.button,
          assetSha: target.assetSha,
          direction: target.direction,
          pointerId: "keyboard",
          fired: false,
          timer: window.setTimeout(function () {
            if (!state.gesture) return
            state.gesture.fired = true
            suppressTrailingClick(state, target.button)
            void mutate(state, target.assetSha, target.direction)
          }, LONG_PRESS_MS),
        }
      },
      keyup(event) {
        if (event.key !== " " || state.gesture?.pointerId !== "keyboard") return
        event.preventDefault()
        const button = state.gesture.button
        const fired = state.gesture.fired
        clearTimer(state)
        if (!fired) button.click()
      },
    }
    state.root.addEventListener("pointerdown", listeners.pointerdown)
    state.root.addEventListener("pointermove", listeners.pointermove)
    state.root.addEventListener("pointerup", listeners.pointerend)
    state.root.addEventListener("pointercancel", listeners.pointerend)
    state.root.addEventListener("click", listeners.click, true)
    state.root.addEventListener("contextmenu", listeners.contextmenu)
    state.root.addEventListener("keydown", listeners.keydown, true)
    state.root.addEventListener("keyup", listeners.keyup, true)
    state.listeners = listeners
  }

  function unmount(root) {
    if (!root) return
    const state = mounted.get(root)
    if (state?.listeners) {
      const listeners = state.listeners
      root.removeEventListener("pointerdown", listeners.pointerdown)
      root.removeEventListener("pointermove", listeners.pointermove)
      root.removeEventListener("pointerup", listeners.pointerend)
      root.removeEventListener("pointercancel", listeners.pointerend)
      root.removeEventListener("click", listeners.click, true)
      root.removeEventListener("contextmenu", listeners.contextmenu)
      root.removeEventListener("keydown", listeners.keydown, true)
      root.removeEventListener("keyup", listeners.keyup, true)
      clearTimer(state)
    }
    voteTargets(root).forEach(({ button }) => restoreButton(button))
    root.querySelectorAll("[data-icono-caretaker-supervote-mark]").forEach((mark) => mark.remove())
    root
      .querySelectorAll(".icono-caretaker-seal-host")
      .forEach((host) => host.classList.remove("icono-caretaker-seal-host"))
    root.querySelector("[data-icono-caretaker-supervote-status]")?.remove()
    mounted.delete(root)
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
    const state = existing || {
      root,
      symbol: geneSymbol,
      snapshot: {},
      busy: false,
      gesture: null,
      suppressClickButton: null,
    }
    state.symbol = geneSymbol
    mounted.set(root, state)
    wire(state)
    try {
      return await reload(state)
    } catch (error) {
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

export { LONG_PRESS_MS, SUPERVOTE_WEIGHT }
