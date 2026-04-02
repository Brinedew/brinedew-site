const versionEl = document.getElementById("version-text")
const HIGHLIGHT_MODE_KEY = "iconoplasm_highlight_mode"
const TOOLTIP_THEME_KEY = "iconoplasm_tooltip_theme"
const CARD_VARIANT_KEY = "iconoplasm_card_variant"

if (versionEl) {
  versionEl.textContent = "v" + chrome.runtime.getManifest().version
}

function normalizeTooltipTheme(value) {
  return value === "dark" ? "dark" : "light"
}

function normalizeCardVariant(value) {
  if (value === "image-only") return "image-only"
  if (value === "lab-label" || value === "lit-archival") return "lit-archival"
  return "simple"
}

function normalizeHighlightMode(value) {
  return value === "pill" || value === "ellipse" ? value : "underline"
}

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
    TOOLTIP_THEME_KEY,
    CARD_VARIANT_KEY,
  ])
  setCheckedValue("highlight-mode", normalizeHighlightMode(localSettings[HIGHLIGHT_MODE_KEY]))
  setCheckedValue("tooltip-theme", normalizeTooltipTheme(localSettings[TOOLTIP_THEME_KEY]))
  setCheckedValue("card-variant", normalizeCardVariant(localSettings[CARD_VARIANT_KEY]))
}

bindRadioGroup("highlight-mode", normalizeHighlightMode, HIGHLIGHT_MODE_KEY)
bindRadioGroup("tooltip-theme", normalizeTooltipTheme, TOOLTIP_THEME_KEY)
bindRadioGroup("card-variant", normalizeCardVariant, CARD_VARIANT_KEY)

loadSettings().catch(() => null)
