const versionEl = document.getElementById("version-text")
const CONTENT_STORAGE_KEYS = IconoplasmContentSettings.storageKeys
const HIGHLIGHT_MODE_KEY = CONTENT_STORAGE_KEYS.highlightMode
const HIGHLIGHT_VISIBILITY_KEY = CONTENT_STORAGE_KEYS.highlightVisibility
const CARD_VARIANT_KEY = CONTENT_STORAGE_KEYS.cardVariant
const USER_BLOCKLIST_KEY = CONTENT_STORAGE_KEYS.userBlocklist
const PDF_HIGHLIGHTING_KEY = CONTENT_STORAGE_KEYS.pdfHighlightingEnabled

if (versionEl) {
  versionEl.textContent = "v" + chrome.runtime.getManifest().version
}

// ---- Tab switching ----

const tabs = document.querySelectorAll(".popup-tab")
const panels = document.querySelectorAll(".popup-panel")

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const t of tabs) {
      t.classList.remove("popup-tab--active")
      t.setAttribute("aria-selected", "false")
    }
    for (const p of panels) {
      p.classList.add("popup-panel--hidden")
    }
    tab.classList.add("popup-tab--active")
    tab.setAttribute("aria-selected", "true")
    const panelId = tab.getAttribute("aria-controls")
    const panel = document.getElementById(panelId)
    if (panel) panel.classList.remove("popup-panel--hidden")
  })
}

// ---- Appearance settings ----

const normalizeCardVariant = (value) => IconoplasmContentSettings.normalizeCardVariant(value)
const normalizeHighlightMode = (value) => IconoplasmContentSettings.normalizeHighlightMode(value)
const normalizeHighlightVisibility = (value) =>
  IconoplasmContentSettings.normalizeHighlightVisibility(value)

function setCheckedValue(groupName, value) {
  const radio = document.querySelector(`input[name="${groupName}"][value="${value}"]`)
  if (radio) radio.checked = true
}

function bindRadioGroup(groupName, normalizeValue, storageKey) {
  const radios = document.querySelectorAll(`input[name="${groupName}"]`)
  for (const radio of radios) {
    radio.addEventListener("change", async () => {
      if (!radio.checked) return
      await chrome.storage.local.set({ [storageKey]: normalizeValue(radio.value) })
    })
  }
}

async function loadSettings() {
  const localSettings = await chrome.storage.local.get([
    HIGHLIGHT_MODE_KEY,
    HIGHLIGHT_VISIBILITY_KEY,
    CARD_VARIANT_KEY,
    PDF_HIGHLIGHTING_KEY,
  ])
  setCheckedValue("highlight-mode", normalizeHighlightMode(localSettings[HIGHLIGHT_MODE_KEY]))
  setCheckedValue(
    "highlight-visibility",
    normalizeHighlightVisibility(localSettings[HIGHLIGHT_VISIBILITY_KEY]),
  )
  setCheckedValue("card-variant", normalizeCardVariant(localSettings[CARD_VARIANT_KEY]))
  await loadPdfHighlightingSetting(localSettings[PDF_HIGHLIGHTING_KEY])
}

bindRadioGroup("highlight-mode", normalizeHighlightMode, HIGHLIGHT_MODE_KEY)
bindRadioGroup("highlight-visibility", normalizeHighlightVisibility, HIGHLIGHT_VISIBILITY_KEY)
bindRadioGroup("card-variant", normalizeCardVariant, CARD_VARIANT_KEY)

async function loadPdfHighlightingSetting(storedValue) {
  const field = document.getElementById("pdf-highlighting-field")
  let capability
  try {
    capability = await chrome.runtime.sendMessage({ type: "PDF_OWNERSHIP_GET_CAPABILITY" })
  } catch (_) {
    capability = null
  }
  if (!capability?.ok || !capability.supported) {
    if (field) field.hidden = true
    return
  }
  if (field) field.hidden = false
  try {
    const enabled = Boolean(capability.enabled)
    setCheckedValue("pdf-highlighting", enabled ? "on" : "off")
    if (storedValue !== enabled) {
      await chrome.storage.local.set({ [PDF_HIGHLIGHTING_KEY]: enabled })
    }
  } catch (_) {
    if (field) field.hidden = true
  }
}

for (const radio of document.querySelectorAll('input[name="pdf-highlighting"]')) {
  radio.addEventListener("change", async () => {
    if (!radio.checked) return
    const enabled = radio.value === "on"
    const radios = document.querySelectorAll('input[name="pdf-highlighting"]')
    for (const option of radios) option.disabled = true
    try {
      const result = await chrome.runtime.sendMessage({
        type: "PDF_OWNERSHIP_SET_ENABLED",
        enabled,
      })
      if (!result?.ok) throw new Error(result?.error || "PDF highlighting is unavailable")
    } catch (_) {
      await loadPdfHighlightingSetting(undefined)
    } finally {
      for (const option of radios) option.disabled = false
    }
  })
}

loadSettings().catch(() => null)

// ---- Blocklist ----

const REMOVED_DEFAULTS_KEY = CONTENT_STORAGE_KEYS.removedDefaults
const SHARED_BLOCKLIST_KEY = CONTENT_STORAGE_KEYS.sharedBlocklist
const blocklistInput = document.getElementById("blocklist-input")
const blocklistAddBtn = document.getElementById("blocklist-add-btn")
const blocklistItemsEl = document.getElementById("blocklist-items")
const blocklistEmptyEl = document.getElementById("blocklist-empty")
const blocklistRestoreBtn = document.getElementById("blocklist-restore-btn")
const blocklistCountEl = document.getElementById("blocklist-count")

async function getBlocklistState() {
  const result = await chrome.storage.local.get([
    USER_BLOCKLIST_KEY,
    REMOVED_DEFAULTS_KEY,
    SHARED_BLOCKLIST_KEY,
  ])
  return {
    sharedDefaults: IconoplasmContentSettings.resolveSharedBlocklistDefaults(
      result[SHARED_BLOCKLIST_KEY],
      ICONOPLASM_DEFAULT_BLOCKLIST,
    ),
    userEntries: IconoplasmContentSettings.normalizeBlocklistTerms(result[USER_BLOCKLIST_KEY]),
    removedDefaults: IconoplasmContentSettings.normalizeBlocklistTerms(
      result[REMOVED_DEFAULTS_KEY],
    ),
  }
}

async function saveBlocklistOverrides({ userEntries, removedDefaults }) {
  await chrome.storage.local.set({
    [USER_BLOCKLIST_KEY]: IconoplasmContentSettings.normalizeBlocklistTerms(userEntries),
    [REMOVED_DEFAULTS_KEY]: IconoplasmContentSettings.normalizeBlocklistTerms(removedDefaults),
  })
}

// Build the effective list for rendering: { symbol, isDefault }
// Always a single alphabetically-sorted list — no defaults-first grouping.
function buildEffectiveList(sharedDefaults, removedDefaults, userAdded) {
  const defaultSet = new Set(sharedDefaults)
  const removedSet = new Set(removedDefaults)
  const entries = []
  for (const sym of sharedDefaults) {
    if (!removedSet.has(sym)) entries.push({ symbol: sym, isDefault: true })
  }
  for (const sym of userAdded) {
    if (!defaultSet.has(sym)) entries.push({ symbol: sym, isDefault: false })
  }
  entries.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return entries
}

function updateBlocklistCount(entries, sharedDefaultCount) {
  if (!blocklistCountEl) return
  const activeDefaults = entries.filter((e) => e.isDefault).length
  const custom = entries.filter((e) => !e.isDefault).length
  const parts = []
  parts.push(activeDefaults + "/" + sharedDefaultCount + " defaults")
  if (custom > 0) parts.push(custom + " custom")
  blocklistCountEl.textContent = parts.join(" + ")
}

async function renderBlocklist() {
  const { sharedDefaults, removedDefaults, userEntries } = await getBlocklistState()
  const entries = buildEffectiveList(sharedDefaults, removedDefaults, userEntries)
  const defaultSet = new Set(sharedDefaults)

  blocklistItemsEl.innerHTML = ""
  updateBlocklistCount(entries, sharedDefaults.length)

  // Show/hide restore button based on whether any defaults have been removed
  if (blocklistRestoreBtn) {
    blocklistRestoreBtn.classList.toggle(
      "popup-btn--hidden",
      !removedDefaults.some((term) => defaultSet.has(term)),
    )
  }

  if (entries.length === 0) {
    blocklistEmptyEl.classList.remove("popup-blocklist-empty--hidden")
    return
  }
  blocklistEmptyEl.classList.add("popup-blocklist-empty--hidden")

  for (const entry of entries) {
    const li = document.createElement("li")
    li.className = "popup-blocklist-item"

    const left = document.createElement("span")
    left.className = "popup-blocklist-left"

    const span = document.createElement("span")
    span.className = "popup-blocklist-symbol"
    span.textContent = entry.symbol

    left.appendChild(span)

    if (entry.isDefault) {
      const badge = document.createElement("span")
      badge.className = "popup-blocklist-badge"
      badge.textContent = "default"
      left.appendChild(badge)
    }

    const btn = document.createElement("button")
    btn.className = "popup-blocklist-remove"
    btn.textContent = "\u00d7"
    btn.setAttribute("aria-label", "Remove " + entry.symbol)
    btn.addEventListener("click", async () => {
      const state = await getBlocklistState()
      const next = IconoplasmContentSettings.removeBlocklistEntry(
        state.sharedDefaults,
        state.userEntries,
        state.removedDefaults,
        entry.symbol,
      )
      await saveBlocklistOverrides(next)
      renderBlocklist()
    })

    li.appendChild(left)
    li.appendChild(btn)
    blocklistItemsEl.appendChild(li)
  }
}

async function addToBlocklist() {
  const incoming = IconoplasmContentSettings.parseUserBlocklistInput(blocklistInput.value)
  if (!incoming.length) return
  const state = await getBlocklistState()
  await saveBlocklistOverrides(
    IconoplasmContentSettings.addBlocklistEntries(
      state.sharedDefaults,
      state.userEntries,
      state.removedDefaults,
      incoming,
    ),
  )
  blocklistInput.value = ""
  blocklistInput.focus()
  renderBlocklist()
}

if (blocklistRestoreBtn) {
  blocklistRestoreBtn.addEventListener("click", async () => {
    const state = await getBlocklistState()
    await saveBlocklistOverrides({ userEntries: state.userEntries, removedDefaults: [] })
    renderBlocklist()
  })
}

blocklistAddBtn.addEventListener("click", addToBlocklist)
blocklistInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    addToBlocklist()
  }
})

renderBlocklist().catch(() => null)

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return
  if (
    changes[USER_BLOCKLIST_KEY] ||
    changes[REMOVED_DEFAULTS_KEY] ||
    changes[SHARED_BLOCKLIST_KEY]
  ) {
    renderBlocklist().catch(() => null)
  }
})

// ---- Account status ----

const accountStatusText = document.getElementById("account-status-text")
const accountStatus = document.getElementById("account-status")
const accountSignInLink = document.getElementById("account-sign-in-link")
const accountSignOutBtn = document.getElementById("account-sign-out-btn")

function renderAccountState(state) {
  if (!accountStatusText) return
  const isSignedIn = state === "signed-in"
  accountStatusText.textContent =
    state === "checking"
      ? "Checking..."
      : isSignedIn
        ? "Signed in!"
        : state === "offline"
          ? "Could not reach Iconoplasm. Discoveries are stored locally."
          : "Not signed in. Discoveries are stored locally."
  accountStatus?.classList.toggle("popup-account-status--signed-in", isSignedIn)
  accountSignInLink?.classList.toggle("popup-btn--hidden", isSignedIn)
  accountSignOutBtn?.classList.toggle("popup-account-sign-out--hidden", !isSignedIn)
}

async function sendIconoplasmApiMessage({ url, method = "GET" }) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "ICONOPLASM_API_FETCH", url, method, credentials: "include", headers: {} },
      (result) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError)
        resolve(result)
      },
    )
  })
}

async function checkAccountStatus() {
  if (!accountStatusText) return
  renderAccountState("checking")
  try {
    const resp = await sendIconoplasmApiMessage({ url: "/api/iconoplasm/discoveries/membership" })
    if (resp && resp.ok) {
      const data = JSON.parse(resp.text || "{}")
      if (data.authenticated) {
        renderAccountState("signed-in")
      } else {
        renderAccountState("signed-out")
      }
    } else {
      renderAccountState("offline")
    }
  } catch (_err) {
    renderAccountState("offline")
  }
}

accountSignOutBtn?.addEventListener("click", async () => {
  accountSignOutBtn.disabled = true
  try {
    await sendIconoplasmApiMessage({ url: "/api/auth/logout", method: "POST" })
  } finally {
    accountSignOutBtn.disabled = false
    checkAccountStatus()
  }
})

checkAccountStatus()

// Read local status only; opening the popup must not start another origin check.
;(async () => {
  const element = document.getElementById("card-freshness")
  if (!element) return
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS", tabId: tab?.id })
    const freshness = status?.cardFreshness
    if (!freshness) return
    element.hidden = false
    element.textContent = freshness.verified
      ? `Images checked ${new Date(freshness.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Image check failed; using saved images."
  } catch (_) {}
})()
