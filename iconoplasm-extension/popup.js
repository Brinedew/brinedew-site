// Iconoplasm popup — shows status of gene data cache

const countEl = document.getElementById('gene-count');
const hashEl = document.getElementById('data-hash');
const fetchEl = document.getElementById('last-fetch');
const dotEl = document.getElementById('status-dot');
const textEl = document.getElementById('status-text');
const refreshBtn = document.getElementById('refresh-btn');
const versionEl = document.getElementById('version-text');
const highlightModeEl = document.getElementById('highlight-mode');
const tooltipThemeEl = document.getElementById('tooltip-theme');
const cardVariantEl = document.getElementById('card-variant');
const HIGHLIGHT_MODE_KEY = 'iconoplasm_highlight_mode';
const TOOLTIP_THEME_KEY = 'iconoplasm_tooltip_theme';
const CARD_VARIANT_KEY = 'iconoplasm_card_variant';

if (versionEl) {
  versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
}

function formatCount(n) {
  return n ? n.toLocaleString() : '--';
}

function formatDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  return d.toLocaleDateString();
}

function normalizeTooltipTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function normalizeCardVariant(value) {
  return value === 'lab-label' ? 'lab-label' : 'classic';
}

async function loadStatus() {
  try {
    const localSettings = await chrome.storage.local.get([HIGHLIGHT_MODE_KEY, TOOLTIP_THEME_KEY, CARD_VARIANT_KEY]);
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    countEl.textContent = formatCount(status.geneCount);
    hashEl.textContent = status.hash ? status.hash.slice(0, 12) : '--';
    fetchEl.textContent = formatDate(status.lastFetch);
    if (highlightModeEl) {
      highlightModeEl.value = localSettings[HIGHLIGHT_MODE_KEY] === 'pill' ? 'pill' : 'underline';
    }
    if (tooltipThemeEl) {
      tooltipThemeEl.value = normalizeTooltipTheme(localSettings[TOOLTIP_THEME_KEY]);
    }
    if (cardVariantEl) {
      cardVariantEl.value = normalizeCardVariant(localSettings[CARD_VARIANT_KEY]);
    }

    if (status.geneCount > 0) {
      dotEl.className = 'status-dot';
      textEl.textContent = 'Active - scanning pages';
    } else {
      dotEl.className = 'status-dot error';
      textEl.textContent = 'No data loaded';
    }
  } catch (err) {
    dotEl.className = 'status-dot error';
    textEl.textContent = 'Service worker inactive';
  }
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.textContent = 'Refreshing...';
  refreshBtn.disabled = true;
  dotEl.className = 'status-dot loading';
  textEl.textContent = 'Fetching data...';

  try {
    const result = await chrome.runtime.sendMessage({ type: 'REFRESH_DATA' });
    if (result?.ok) {
      textEl.textContent = 'Data refreshed';
      dotEl.className = 'status-dot';
    } else {
      textEl.textContent = 'Refresh failed';
      dotEl.className = 'status-dot error';
    }
    loadStatus();
  } catch (err) {
    textEl.textContent = 'Error: ' + err.message;
    dotEl.className = 'status-dot error';
  }

  refreshBtn.textContent = 'Refresh gene data';
  refreshBtn.disabled = false;
});

if (highlightModeEl) {
  highlightModeEl.addEventListener('change', async () => {
    const mode = highlightModeEl.value === 'pill' ? 'pill' : 'underline';
    await chrome.storage.local.set({ [HIGHLIGHT_MODE_KEY]: mode });
  });
}

if (tooltipThemeEl) {
  tooltipThemeEl.addEventListener('change', async () => {
    await chrome.storage.local.set({ [TOOLTIP_THEME_KEY]: normalizeTooltipTheme(tooltipThemeEl.value) });
  });
}

if (cardVariantEl) {
  cardVariantEl.addEventListener('change', async () => {
    await chrome.storage.local.set({ [CARD_VARIANT_KEY]: normalizeCardVariant(cardVariantEl.value) });
  });
}

loadStatus();
