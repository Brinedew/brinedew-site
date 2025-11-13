// Admin panel HTML content
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeneGuessr Admin Panel</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #ffffff;
      padding: 2rem;
      line-height: 1.6;
    }
    
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    
    h1 {
      color: #ffffff;
      margin-bottom: 0.5rem;
      font-size: 2rem;
    }
    
    .subtitle {
      color: #ffffff;
      margin-bottom: 2rem;
      opacity: 0.8;
    }
    
    .section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid #334155;
    }
    
    h2 {
      color: #ffffff;
      margin-bottom: 1rem;
      font-size: 1.25rem;
    }
    
    .form-group {
      margin-bottom: 1rem;
    }
    
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #ffffff;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    input, select, textarea {
      width: 100%;
      padding: 0.75rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 4px;
      color: #ffffff;
      font-size: 0.875rem;
      font-family: inherit;
    }
    
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #38bdf8;
    }
    
    button {
      background: #38bdf8;
      color: #000000;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.875rem;
      transition: background 0.2s;
    }
    
    button:hover {
      background: #0ea5e9;
    }
    
    button:disabled {
      background: #475569;
      cursor: not-allowed;
    }
    
    .status {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 1rem;
      margin-top: 1rem;
    }
    
    .status-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    
    .status-item:last-child {
      border-bottom: none;
    }
    
    .status-label {
      color: #ffffff;
      font-size: 0.875rem;
      opacity: 0.75;
    }
    
    .status-value {
      color: #ffffff;
      font-weight: 500;
      font-size: 0.875rem;
    }
    
    .override-list {
      margin-top: 1rem;
    }
    
    .override-item {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .override-info {
      font-size: 0.875rem;
    }
    
    .override-date {
      color: #ffffff;
      font-weight: 600;
    }
    
    .override-protein {
      color: #ffffff;
      opacity: 0.8;
    }
    
    .btn-delete {
      background: #ef4444;
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: #ffffff;
    }
    
    .btn-delete:hover {
      background: #dc2626;
    }
    
    .message {
      padding: 0.75rem;
      border-radius: 4px;
      margin-top: 1rem;
      font-size: 0.875rem;
    }
    
    .message.success {
      background: #065f46;
      border: 1px solid #059669;
      color: #ffffff;
    }
    
    .message.error {
      background: #7f1d1d;
      border: 1px solid #dc2626;
      color: #ffffff;
    }
    
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .checkbox-group label {
      margin: 0;
    }
    
    input[type="checkbox"] {
      width: auto;
    }

    input[type="range"] {
      width: 100%;
      accent-color: #38bdf8;
    }

    select {
      width: auto;
      min-width: 220px;
      max-width: 100%;
    }

    .helper-text {
      color: #ffffff;
      opacity: 0.8;
      font-size: 0.875rem;
    }

    .error-text {
      color: #ffffff;
      font-weight: 600;
    }

    .helper-text--title {
      margin-bottom: 1rem;
    }

    .value-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #ffffff;
      opacity: 0.85;
      background: rgba(255, 255, 255, 0.08);
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      margin-left: 0.5rem;
    }

    .outline-controls {
      margin-left: 1.5rem;
      display: none;
    }

    .outline-controls.is-visible {
      display: block;
    }

    .form-actions {
      display: flex;
      gap: 1rem;
      margin-top: 1.5rem;
      flex-wrap: wrap;
    }

    .viewer-preview {
      background: #0b1324;
      border: 1px solid #1f2a3d;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      transition: background 0.3s ease, border-color 0.3s ease;
    }

    .viewer-preview[data-theme="light"] {
      background: #f4f6fb;
      border-color: #c9d4ea;
      color: #000000;
    }

    .viewer-preview[data-theme="light"] .viewer-preview__canvas {
      background: #ffffff;
      border-color: #d4ddec;
    }

    .viewer-preview[data-theme="light"] .viewer-preview__status,
    .viewer-preview[data-theme="light"] .helper-text,
    .viewer-preview[data-theme="light"] .value-pill {
      color: #000000;
      opacity: 0.9;
      background: rgba(0, 0, 0, 0.06);
    }

    .viewer-preview__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }

    .viewer-preview__header h3 {
      font-size: 1rem;
      margin: 0;
      color: currentColor;
    }

    .viewer-preview__toggles {
      display: inline-flex;
      border: 1px solid currentColor;
      border-radius: 999px;
      overflow: hidden;
    }

    .viewer-preview__toggle {
      background: transparent;
      color: inherit;
      border: none;
      padding: 0.35rem 0.85rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      cursor: pointer;
    }

    .viewer-preview__toggle.is-active {
      background: currentColor;
      color: #000000;
    }

    .viewer-preview[data-theme="light"] .viewer-preview__toggle.is-active {
      color: #ffffff;
    }

    .viewer-preview__canvas {
      border: 1px solid #1f2a3d;
      border-radius: 8px;
      height: 320px;
      background: #050914;
      position: relative;
      overflow: hidden;
    }

    .viewer-preview__canvas canvas {
      border-radius: 8px;
    }

    .viewer-preview__status {
      margin: 0 0 0.5rem 0;
    }

    .viewer-placeholder,
    .viewer-loading,
    .viewer-error {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      padding: 1rem;
      text-align: center;
    }

    .viewer-loading {
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(6px);
    }

    .viewer-error {
      background: rgba(127, 29, 29, 0.85);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>GeneGuessr Admin Panel</h1>
    <p class="subtitle">Protected by Cloudflare Access</p>
    
    <!-- Current Status -->
    <div class="section">
      <h2>Current Status</h2>
      <div class="status" id="status-display">
        <p class="helper-text">Loading...</p>
      </div>
    </div>
    
    <!-- Protein Override -->
    <div class="section">
      <h2>Protein Override</h2>
      <p class="helper-text helper-text--title" style="margin-bottom: 1rem;">
        Set a specific protein for a given date. Overrides the daily random selection.
      </p>
      
      <form id="override-form">
        <div class="form-group">
          <label for="override-date">Date (YYYY-MM-DD)</label>
          <input type="date" id="override-date" required>
        </div>
        
        <div class="form-group">
          <label for="override-uniprot">UniProt ID</label>
          <input type="text" id="override-uniprot" placeholder="e.g., P04637" required>
        </div>
        
        <button type="submit">Set Override</button>
      </form>
      
      <div id="override-message"></div>
      
      <div class="override-list" id="override-list"></div>
    </div>
    
    <!-- Graphics Options -->
    <div class="section">
      <h2>Graphics Options</h2>
      <p class="helper-text helper-text--title" style="margin-bottom: 1rem;">
        Configure 3D protein viewer rendering settings.
      </p>
      
      <div class="viewer-preview" id="viewer-preview" data-theme="dark">
        <div class="viewer-preview__header">
          <h3>Live 3D Preview</h3>
          <div class="viewer-preview__toggles" role="group" aria-label="Toggle preview theme">
            <button type="button" class="viewer-preview__toggle is-active" data-theme="dark">Dark</button>
            <button type="button" class="viewer-preview__toggle" data-theme="light">Light</button>
          </div>
        </div>
        <p class="helper-text viewer-preview__status" id="viewer-preview-status">Loading preview...</p>
        <div class="viewer-preview__canvas" id="graphics-preview">
          <div class="viewer-placeholder" id="graphics-preview-placeholder">Preparing sample protein...</div>
          <div class="viewer-loading" id="graphics-preview-loading" hidden>Loading viewer...</div>
          <div class="viewer-error" id="graphics-preview-error" hidden></div>
        </div>
      </div>

      <form id="graphics-form">
        <div class="form-group">
          <label for="graphics-cameraMode">Camera Mode</label>
          <select id="graphics-cameraMode">
            <option value="perspective">Perspective</option>
            <option value="orthographic">Orthographic</option>
          </select>
        </div>

        <div class="form-group">
          <label for="graphics-occlusionQuality">Ambient Occlusion</label>
          <select id="graphics-occlusionQuality">
            <option value="off">Off</option>
            <option value="low">Low (16 samples, radius 2)</option>
            <option value="medium">Medium (32 samples, radius 4)</option>
            <option value="high">High (64 samples, radius 6)</option>
            <option value="ultra">Ultra (128 samples, radius 8)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="graphics-antialiasingMode">Antialiasing</label>
          <select id="graphics-antialiasingMode">
            <option value="off">Off</option>
            <option value="fxaa">FXAA</option>
          </select>
        </div>

        <div class="form-group">
          <label for="graphics-fogIntensity">
            Fog Intensity <span class="value-pill" id="fog-value">0.50</span>
          </label>
          <input type="range" id="graphics-fogIntensity" min="0" max="1" step="0.05" value="0.5">
        </div>

        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-outlineEnabled" checked>
            <label for="graphics-outlineEnabled">Outline Rendering</label>
          </div>
        </div>
        <div class="outline-controls is-visible" id="outline-controls">
          <div class="form-group">
            <label for="graphics-outlineScale">
              Scale <span class="value-pill" id="outline-scale-value">0.50</span>
            </label>
            <input type="range" id="graphics-outlineScale" min="0.1" max="2" step="0.1" value="0.5">
          </div>
          <div class="form-group">
            <label for="graphics-outlineThreshold">
              Threshold <span class="value-pill" id="outline-threshold-value">0.35</span>
            </label>
            <input type="range" id="graphics-outlineThreshold" min="0.1" max="1" step="0.05" value="0.35">
          </div>
        </div>

        <div class="form-group">
          <label for="graphics-lightingPreset">Lighting Preset</label>
          <select id="graphics-lightingPreset">
            <option value="default">Default (Single Light)</option>
            <option value="dramatic">Dramatic (High Contrast)</option>
            <option value="soft">Soft (Balanced)</option>
            <option value="studio">Studio (Three-Point)</option>
          </select>
        </div>

        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-backgroundColor" checked>
            <label for="graphics-backgroundColor">Auto Background (light/dark)</label>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-hideAxes" checked>
            <label for="graphics-hideAxes">Hide XYZ Axes</label>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-disableMarking" checked>
            <label for="graphics-disableMarking">Disable Selection Marking</label>
          </div>
        </div>
        
        <div class="form-actions">
          <button type="submit">Apply Graphics Settings</button>
          <button type="button" id="graphics-reset">Reset to Defaults</button>
          <button type="button" id="graphics-revert">Use Saved Settings</button>
        </div>
      </form>
      
      <div id="graphics-message"></div>
    </div>
    
    <!-- Feature Flags -->
    <div class="section">
      <h2>Feature Flags</h2>
      <p class="helper-text helper-text--title" style="margin-bottom: 1rem;">
        Toggle experimental features and game modes.
      </p>
      
      <form id="flags-form">
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="flag-randomizer">
            <label for="flag-randomizer">Enable Randomizer Mode</label>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="flag-archive">
            <label for="flag-archive">Enable Archive Mode</label>
          </div>
        </div>
        
        <button type="submit">Update Flags</button>
      </form>
      
      <div id="flags-message"></div>
    </div>
  </div>
  

  <script>
    const API_BASE = 'https://geneguessr-api.decap.workers.dev';

    function deepClone(value) {
      if (value === undefined || value === null) {
        return value;
      }
      return JSON.parse(JSON.stringify(value));
    }

    const LIGHTING_PRESETS = {
      default: {
        enabled: true,
        exposure: 1.1,
        lights: [
          { inclination: 170, azimuth: 30, intensity: 1.4, color: '#ffffff' },
          { inclination: 32, azimuth: 210, intensity: 0.7, color: '#c9d5ff' },
          { inclination: 85, azimuth: 315, intensity: 0.45, color: '#92b4ff' }
        ]
      },
      dramatic: {
        enabled: true,
        exposure: 1.25,
        lights: [
          { inclination: 160, azimuth: 20, intensity: 1.6, color: '#ffe7d3' },
          { inclination: 25, azimuth: 210, intensity: 0.8, color: '#c4d2ff' },
          { inclination: 95, azimuth: 315, intensity: 0.6, color: '#7dafff' }
        ]
      },
      soft: {
        enabled: true,
        exposure: 0.95,
        lights: [
          { inclination: 140, azimuth: 30, intensity: 1.1, color: '#fff7e8' },
          { inclination: 35, azimuth: 210, intensity: 0.5, color: '#f0f4ff' },
          { inclination: 80, azimuth: 300, intensity: 0.35, color: '#b6c7ff' }
        ]
      },
      studio: {
        enabled: true,
        exposure: 1.05,
        lights: [
          { inclination: 175, azimuth: 25, intensity: 1.2, color: '#ffffff' },
          { inclination: 35, azimuth: 200, intensity: 0.35, color: '#cdd5ff' },
          { inclination: 90, azimuth: 300, intensity: 0.25, color: '#91a4ff' }
        ]
      }
    };

    const DEFAULT_GRAPHICS_SETTINGS = {
      version: 2,
      camera: {
        mode: 'perspective',
        fieldOfView: 48,
        near: 0.1,
        far: 1800
      },
      lighting: deepClone(LIGHTING_PRESETS.default),
      occlusion: {
        enabled: true,
        samples: 64,
        radius: 6,
        bias: 0.8,
        blurKernelSize: 7,
        resolutionScale: 1
      },
      antialiasing: {
        mode: 'fxaa',
        edgeThresholdMin: 0.125,
        edgeThresholdMax: 0.25,
        iterations: 2,
        subpixelQuality: 0.75
      },
      fog: {
        enabled: true,
        intensity: 0.5,
        color: '#0f172a',
        near: 0,
        far: 200
      },
      outline: {
        enabled: true,
        scale: 0.5,
        threshold: 0.35,
        color: '#0f172a'
      },
      background: {
        mode: 'auto',
        dark: '#0f172a',
        light: '#f8f1e7',
        custom: '#0f172a'
      },
      extras: {
        hideAxes: true,
        disableMarking: true
      },
      profileManager: {
        activeProfileId: 'studio',
        profiles: []
      }
    };

    const OCCLUSION_PRESETS = {
      off: { enabled: false, samples: 0, radius: 0, bias: 0.8, blurKernelSize: 7, resolutionScale: 1 },
      low: { enabled: true, samples: 16, radius: 2, bias: 0.8, blurKernelSize: 7, resolutionScale: 1 },
      medium: { enabled: true, samples: 32, radius: 4, bias: 0.8, blurKernelSize: 7, resolutionScale: 1 },
      high: { enabled: true, samples: 64, radius: 6, bias: 0.8, blurKernelSize: 7, resolutionScale: 1 },
      ultra: { enabled: true, samples: 128, radius: 8, bias: 0.8, blurKernelSize: 9, resolutionScale: 1 }
    };

    const PREVIEW_PROTEIN = {
      name: 'AlphaFold Preview',
      structure: {
        primary_source: 'alphafold',
        alphafold: {
          id: 'P04637',
          model_url: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif'
        }
      }
    };

    const MOLSTAR_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar-plugin.js';
    const MOLSTAR_FALLBACK_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/pdbe-molstar@3.8.0/build/pdbe-molstar-plugin.js';
    const MOLSTAR_CSS_URL = 'https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar.css';
    const MOLSTAR_PRECONNECT_URL = 'https://cdn.jsdelivr.net';
    let currentGraphicsSettings = deepClone(DEFAULT_GRAPHICS_SETTINGS);
    let pendingGraphicsSettings = deepClone(DEFAULT_GRAPHICS_SETTINGS);
    let GRAPHICS_SETTINGS = deepClone(DEFAULT_GRAPHICS_SETTINGS);
    let previewViewer = null;
    let previewTheme = 'dark';
    let previewReady = false;
    let molstarLoaderPromise = null;
    let molstarCssLoaded = false;
    let molstarPreconnectAdded = false;

    const viewerPreviewEl = document.getElementById('viewer-preview');
    const previewContainer = document.getElementById('graphics-preview');
    const previewStatusEl = document.getElementById('viewer-preview-status');
    const previewPlaceholderEl = document.getElementById('graphics-preview-placeholder');
    const previewLoadingEl = document.getElementById('graphics-preview-loading');
    const previewErrorEl = document.getElementById('graphics-preview-error');

    document.getElementById('override-date').valueAsDate = new Date();

    setupPreviewToggle();
    setupGraphicsForm();
    bindForms();
    loadStatus();
    initializePreview();

    async function loadStatus() {
      try {
        const response = await fetch(API_BASE + '/api/admin/status', { credentials: 'include' });
        if (!response.ok) {
          throw new Error('Failed to load status');
        }
        const data = await response.json();
        displayStatus(data);
        displayOverrides(data.all_overrides);
        updateFlagCheckboxes(data.feature_flags || {});
        syncGraphicsSettings(data.graphics_settings);
      } catch (err) {
        console.error('Error loading status:', err);
        document.getElementById('status-display').innerHTML = '<p class="helper-text error-text">Failed to load status</p>';
      }
    }

    function bindForms() {
      document.getElementById('override-form').addEventListener('submit', handleOverrideSubmit);
      document.getElementById('flags-form').addEventListener('submit', handleFlagsSubmit);
      document.getElementById('graphics-form').addEventListener('submit', handleGraphicsSubmit);
      document.getElementById('graphics-reset').addEventListener('click', () => {
        pendingGraphicsSettings = deepClone(DEFAULT_GRAPHICS_SETTINGS);
        applyGraphicsSettingsToForm(pendingGraphicsSettings);
        refreshPreview({ immediate: true });
      });
      document.getElementById('graphics-revert').addEventListener('click', () => {
        pendingGraphicsSettings = deepClone(currentGraphicsSettings);
        applyGraphicsSettingsToForm(pendingGraphicsSettings);
        refreshPreview({ immediate: true });
      });
    }

    function setupPreviewToggle() {
      if (!viewerPreviewEl) {
        return;
      }
      viewerPreviewEl.dataset.theme = previewTheme;
      const toggles = viewerPreviewEl.querySelectorAll('.viewer-preview__toggle');
      toggles.forEach((toggle) => {
        toggle.addEventListener('click', () => {
          const theme = toggle.getAttribute('data-theme');
          if (!theme || theme === previewTheme) {
            return;
          }
          previewTheme = theme;
          viewerPreviewEl.dataset.theme = theme;
          toggles.forEach((btn) => btn.classList.toggle('is-active', btn === toggle));
          refreshPreview({ immediate: true });
        });
      });
    }

    function setupGraphicsForm() {
      const form = document.getElementById('graphics-form');
      const controls = form.querySelectorAll('select, input');
      controls.forEach((control) => {
        const eventName = control.type === 'range' ? 'input' : 'change';
        control.addEventListener(eventName, handleGraphicsInputChange);
      });
      applyGraphicsSettingsToForm(pendingGraphicsSettings);
      const debouncedResize = debounce(autoSizeSelects, 150);
      window.addEventListener('resize', debouncedResize);
    }
    function handleGraphicsInputChange(event) {
      if (event && event.target && event.target.id === 'graphics-outlineEnabled') {
        updateOutlineControlsVisibility();
      }
      updateValueBadges();
      pendingGraphicsSettings = collectGraphicsSettingsFromForm();
      refreshPreview();
    }

    function updateValueBadges() {
      const fog = document.getElementById('graphics-fogIntensity');
      const outlineScale = document.getElementById('graphics-outlineScale');
      const outlineThreshold = document.getElementById('graphics-outlineThreshold');
      document.getElementById('fog-value').textContent = Number(fog.value).toFixed(2);
      document.getElementById('outline-scale-value').textContent = Number(outlineScale.value).toFixed(2);
      document.getElementById('outline-threshold-value').textContent = Number(outlineThreshold.value).toFixed(2);
    }

    function updateOutlineControlsVisibility() {
      const controls = document.getElementById('outline-controls');
      if (!controls) {
        return;
      }
      const enabled = document.getElementById('graphics-outlineEnabled').checked;
      controls.classList.toggle('is-visible', enabled);
    }

    async function handleOverrideSubmit(event) {
      event.preventDefault();
      const date = document.getElementById('override-date').value;
      const uniprotId = document.getElementById('override-uniprot').value;
      try {
        const response = await fetch(API_BASE + '/api/admin/override-protein', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, uniprot_id: uniprotId })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to set override');
        }
        showMessage('override-message', data.message || 'Override updated', 'success');
        document.getElementById('override-uniprot').value = '';
        await loadStatus();
      } catch (err) {
        console.error('Error setting override:', err);
        showMessage('override-message', err.message || 'Failed to set override', 'error');
      }
    }

    async function handleFlagsSubmit(event) {
      event.preventDefault();
      const flags = {
        randomizer: document.getElementById('flag-randomizer').checked,
        archive: document.getElementById('flag-archive').checked
      };
      try {
        const response = await fetch(API_BASE + '/api/admin/feature-flags', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(flags)
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to update flags');
        }
        showMessage('flags-message', data.message || 'Flags updated', 'success');
        await loadStatus();
      } catch (err) {
        console.error('Error updating flags:', err);
        showMessage('flags-message', err.message || 'Failed to update flags', 'error');
      }
    }

    async function handleGraphicsSubmit(event) {
      event.preventDefault();
      const payload = collectGraphicsSettingsFromForm();
      pendingGraphicsSettings = deepClone(payload);
      GRAPHICS_SETTINGS = deepClone(payload);
      try {
        const response = await fetch(API_BASE + '/api/admin/graphics-settings', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to update graphics');
        }
        currentGraphicsSettings = deepClone(payload);
        showMessage('graphics-message', data.message || 'Graphics settings updated', 'success');
      } catch (err) {
        console.error('Error updating graphics:', err);
        showMessage('graphics-message', err.message || 'Failed to update graphics', 'error');
      }
    }
    function displayStatus(data) {
      const statusHtml =
        '<div class="status-item">' +
          '<span class="status-label">Today&#39;s Date</span>' +
          '<span class="status-value">' + data.today.date + '</span>' +
        '</div>' +
        '<div class="status-item">' +
          '<span class="status-label">Today&#39;s Override</span>' +
          '<span class="status-value">' + (data.today.override || 'None (using random selection)') + '</span>' +
        '</div>' +
        '<div class="status-item">' +
          '<span class="status-label">Active Overrides</span>' +
          '<span class="status-value">' + data.all_overrides.length + '</span>' +
        '</div>';
      document.getElementById('status-display').innerHTML = statusHtml;
    }

    function displayOverrides(overrides) {
      const listEl = document.getElementById('override-list');
      listEl.innerHTML = '';
      if (!overrides || overrides.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'helper-text';
        empty.style.marginTop = '1rem';
        empty.textContent = 'No active overrides';
        listEl.appendChild(empty);
        return;
      }
      const heading = document.createElement('h3');
      heading.className = 'helper-text';
      heading.style.margin = '1rem 0 0.5rem 0';
      heading.textContent = 'Active Overrides';
      listEl.appendChild(heading);
      overrides
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .forEach((override) => {
          const item = document.createElement('div');
          item.className = 'override-item';
          const info = document.createElement('div');
          info.className = 'override-info';
          const dateEl = document.createElement('span');
          dateEl.className = 'override-date';
          dateEl.textContent = override.date;
          const proteinEl = document.createElement('span');
          proteinEl.className = 'override-protein';
          proteinEl.textContent = override.uniprot_id;
          info.appendChild(dateEl);
          info.appendChild(proteinEl);
          const button = document.createElement('button');
          button.className = 'btn-delete';
          button.textContent = 'Delete';
          button.addEventListener('click', () => deleteOverride(override.date));
          item.appendChild(info);
          item.appendChild(button);
          listEl.appendChild(item);
        });
    }

    function updateFlagCheckboxes(flags) {
      document.getElementById('flag-randomizer').checked = !!flags.randomizer;
      document.getElementById('flag-archive').checked = !!flags.archive;
    }

    function syncGraphicsSettings(settings) {
      const next = settings ? deepClone(settings) : deepClone(DEFAULT_GRAPHICS_SETTINGS);
      currentGraphicsSettings = next;
      pendingGraphicsSettings = deepClone(next);
      GRAPHICS_SETTINGS = deepClone(next);
      applyGraphicsSettingsToForm(pendingGraphicsSettings);
      refreshPreview({ immediate: true });
    }

    function applyGraphicsSettingsToForm(settings) {
      const safe = settings || DEFAULT_GRAPHICS_SETTINGS;
      document.getElementById('graphics-cameraMode').value = safe.camera && safe.camera.mode ? safe.camera.mode : 'perspective';
      document.getElementById('graphics-occlusionQuality').value = deriveOcclusionQuality(safe.occlusion);
      document.getElementById('graphics-antialiasingMode').value = safe.antialiasing && safe.antialiasing.mode === 'off' ? 'off' : 'fxaa';
      document.getElementById('graphics-lightingPreset').value = deriveLightingPresetKey(safe.lighting);
      document.getElementById('graphics-fogIntensity').value = typeof safe.fog === 'object' && typeof safe.fog.intensity === 'number' ? safe.fog.intensity : 0.5;
      document.getElementById('graphics-outlineEnabled').checked = !safe.outline || safe.outline.enabled !== false;
      document.getElementById('graphics-outlineScale').value = typeof safe.outline === 'object' && typeof safe.outline.scale === 'number' ? safe.outline.scale : 0.5;
      document.getElementById('graphics-outlineThreshold').value = typeof safe.outline === 'object' && typeof safe.outline.threshold === 'number' ? safe.outline.threshold : 0.35;
      document.getElementById('graphics-backgroundColor').checked = !safe.background || safe.background.mode === 'auto';
      document.getElementById('graphics-hideAxes').checked = !safe.extras || safe.extras.hideAxes !== false;
      document.getElementById('graphics-disableMarking').checked = !safe.extras || safe.extras.disableMarking !== false;
      updateValueBadges();
      updateOutlineControlsVisibility();
      autoSizeSelects();
    }
    function collectGraphicsSettingsFromForm() {
      const source = pendingGraphicsSettings || currentGraphicsSettings || DEFAULT_GRAPHICS_SETTINGS;
      const next = deepClone(source || DEFAULT_GRAPHICS_SETTINGS);
      next.camera = next.camera || {};
      next.camera.mode = document.getElementById('graphics-cameraMode').value;
      const occlusionKey = document.getElementById('graphics-occlusionQuality').value;
      next.occlusion = Object.assign({}, OCCLUSION_PRESETS[occlusionKey] || OCCLUSION_PRESETS.medium);
      const aaMode = document.getElementById('graphics-antialiasingMode').value;
      next.antialiasing = aaMode === 'fxaa'
        ? {
            mode: 'fxaa',
            edgeThresholdMin: 0.125,
            edgeThresholdMax: 0.25,
            iterations: 2,
            subpixelQuality: 0.75
          }
        : { mode: 'off' };
      const fogValue = Number.parseFloat(document.getElementById('graphics-fogIntensity').value);
      next.fog = next.fog || {};
      next.fog.enabled = true;
      next.fog.intensity = Number.isFinite(fogValue) ? fogValue : 0.5;
      next.outline = next.outline || {};
      next.outline.enabled = document.getElementById('graphics-outlineEnabled').checked;
      next.outline.scale = Number.parseFloat(document.getElementById('graphics-outlineScale').value) || 0.5;
      next.outline.threshold = Number.parseFloat(document.getElementById('graphics-outlineThreshold').value) || 0.35;
      if (!next.outline.color) {
        next.outline.color = '#0f172a';
      }
      const presetKey = document.getElementById('graphics-lightingPreset').value;
      next.lighting = deepClone(LIGHTING_PRESETS[presetKey] || LIGHTING_PRESETS.default);
      next.background = next.background || deepClone(DEFAULT_GRAPHICS_SETTINGS.background);
      next.background.mode = document.getElementById('graphics-backgroundColor').checked ? 'auto' : 'dark';
      next.extras = next.extras || {};
      next.extras.hideAxes = document.getElementById('graphics-hideAxes').checked;
      next.extras.disableMarking = document.getElementById('graphics-disableMarking').checked;
      return next;
    }

    function deriveOcclusionQuality(occlusion) {
      if (!occlusion || occlusion.enabled === false) {
        return 'off';
      }
      if (occlusion.samples >= 120) {
        return 'ultra';
      }
      if (occlusion.samples >= 64) {
        return 'high';
      }
      if (occlusion.samples >= 32) {
        return 'medium';
      }
      return 'low';
    }

    function deriveLightingPresetKey(lighting) {
      if (!lighting) {
        return 'default';
      }
      const normalized = normalizeLightingForComparison(lighting);
      const entries = Object.entries(LIGHTING_PRESETS);
      for (let i = 0; i < entries.length; i += 1) {
        const key = entries[i][0];
        const preset = entries[i][1];
        if (JSON.stringify(normalized) === JSON.stringify(normalizeLightingForComparison(preset))) {
          return key;
        }
      }
      return 'default';
    }

    function normalizeLightingForComparison(lighting) {
      return {
        enabled: lighting.enabled !== false,
        exposure: Number(lighting.exposure !== undefined ? lighting.exposure : 1).toFixed(2),
        lights: (lighting.lights || []).map((light) => ({
          inclination: Math.round(light.inclination !== undefined ? light.inclination : 0),
          azimuth: Math.round(light.azimuth !== undefined ? light.azimuth : 0),
          intensity: Number(light.intensity !== undefined ? light.intensity : 1).toFixed(2),
          color: (light.color || '#ffffff').toLowerCase()
        }))
      };
    }

    function autoSizeSelects() {
      const selects = Array.from(document.querySelectorAll('#graphics-form select'));
      if (!selects.length) {
        return;
      }
      const tester = document.createElement('span');
      tester.style.visibility = 'hidden';
      tester.style.position = 'absolute';
      tester.style.whiteSpace = 'pre';
      document.body.appendChild(tester);
      let maxWidth = 0;
      selects.forEach((select) => {
        const style = window.getComputedStyle(select);
        tester.style.fontSize = style.fontSize;
        tester.style.fontFamily = style.fontFamily;
        tester.style.fontWeight = style.fontWeight;
        tester.style.fontStyle = style.fontStyle;
        Array.from(select.options).forEach((option) => {
          tester.textContent = option.textContent;
          maxWidth = Math.max(maxWidth, tester.offsetWidth);
        });
      });
      tester.remove();
      const container = document.querySelector('.section');
      const available = container ? Math.max(container.clientWidth - 48, 240) : 480;
      const finalWidth = Math.min(maxWidth + 48, available);
      selects.forEach((select) => {
        select.style.width = Math.max(finalWidth, 220) + 'px';
      });
    }

    function debounce(fn, delay) {
      let handle;
      return function debounced() {
        clearTimeout(handle);
        handle = setTimeout(() => fn(), delay);
      };
    }
    function refreshPreview(options) {
      GRAPHICS_SETTINGS = deepClone(pendingGraphicsSettings || DEFAULT_GRAPHICS_SETTINGS) || deepClone(DEFAULT_GRAPHICS_SETTINGS);
      if (!previewViewer || !previewReady) {
        return;
      }
      applyGraphicsToViewer(previewViewer, GRAPHICS_SETTINGS, options || {});
    }

    async function initializePreview() {
      if (!previewContainer || previewViewer) {
        return;
      }
      previewPlaceholderEl.hidden = false;
      previewLoadingEl.hidden = false;
      previewErrorEl.hidden = true;
      previewStatusEl.textContent = 'Loading preview...';
      try {
        await ensureMolstarAssets();
        const viewer = new window.PDBeMolstarPlugin();
        viewer.render(previewContainer, getPreviewRenderOptions());
        previewViewer = viewer;
        disableViewerUi(viewer);
        suppressViewerInteractivity(viewer);
        const finalize = () => {
          previewReady = true;
          previewPlaceholderEl.hidden = true;
          previewLoadingEl.hidden = true;
          previewStatusEl.textContent = 'Preview ready';
          refreshPreview({ immediate: true });
        };
        if (viewer.events && viewer.events.loadComplete) {
          viewer.events.loadComplete.subscribe(finalize);
        } else {
          setTimeout(finalize, 600);
        }
      } catch (err) {
        console.error('Preview viewer failed', err);
        previewLoadingEl.hidden = true;
        previewPlaceholderEl.hidden = true;
        previewErrorEl.hidden = false;
        previewErrorEl.textContent = 'Could not load 3D viewer. Please refresh.';
        previewStatusEl.textContent = 'Preview unavailable';
      }
    }

    function getPreviewRenderOptions() {
      const structure = PREVIEW_PROTEIN.structure;
      if (structure && structure.primary_source === 'alphafold' && structure.alphafold && structure.alphafold.model_url) {
        return {
          customData: {
            url: structure.alphafold.model_url,
            format: 'cif'
          },
          moleculeId: structure.alphafold.id || 'Preview',
          alphafoldView: true,
          hideControls: true,
          pdbeLink: false,
          hideCanvasControls: ['expand', 'controlToggle', 'controlInfo', 'selection', 'animation', 'trajectory', 'screenshot', 'reset'],
          visualStyle: 'cartoon',
          lighting: 'glossy',
          loadMaps: false,
          lowPrecisionCoords: false
        };
      }
      return {};
    }

    function disableViewerUi(viewer) {
      try {
        if (viewer.plugin && viewer.plugin.layout) {
          viewer.plugin.layout.setProps({ isExpanded: false, showControls: false });
        }
      } catch (err) {
        console.warn('Unable to hide viewer UI', err);
      }
    }

    function ensureMolstarAssets() {
      if (window.PDBeMolstarPlugin) {
        if (!molstarCssLoaded) {
          appendMolstarCssOnce();
        }
        return Promise.resolve();
      }
      if (!molstarLoaderPromise) {
        addMolstarPreconnectOnce();
        appendMolstarCssOnce();
        molstarLoaderPromise = loadScript(MOLSTAR_SCRIPT_URL).catch((err) => {
          console.warn('Primary Mol* load failed, falling back', err);
          return loadScript(MOLSTAR_FALLBACK_SCRIPT_URL);
        });
      }
      return molstarLoaderPromise;
    }

    function addMolstarPreconnectOnce() {
      if (molstarPreconnectAdded) {
        return;
      }
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = MOLSTAR_PRECONNECT_URL;
      link.crossOrigin = '';
      document.head.appendChild(link);
      molstarPreconnectAdded = true;
    }

    function appendMolstarCssOnce() {
      if (molstarCssLoaded) {
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MOLSTAR_CSS_URL;
      link.onload = () => {
        molstarCssLoaded = true;
      };
      document.head.appendChild(link);
    }

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = (err) => reject(err || new Error('Failed to load ' + src));
        document.head.appendChild(script);
      });
    }

    function suppressViewerInteractivity(viewer) {
      try {
        if (viewer.plugin && viewer.plugin.managers && viewer.plugin.managers.interactivity) {
          viewer.plugin.managers.interactivity.setProps({ granularity: 'element', maxFps: 0 });
          if (viewer.plugin.managers.interactivity.lociHighlights) {
            viewer.plugin.managers.interactivity.lociHighlights.setProps({ enabled: false });
          }
          if (viewer.plugin.managers.interactivity.lociSelects) {
            viewer.plugin.managers.interactivity.lociSelects.setProps({ enabled: false });
          }
        }
      } catch (err) {
        console.warn('Unable to adjust viewer interactivity', err);
      }
    }
    function applyGraphicsToViewer(viewer, settings, options) {
      if (!viewer || !viewer.plugin || !viewer.plugin.canvas3d) {
        return;
      }
      const canvas = viewer.plugin.canvas3d;
      const backgroundHex = resolveBackgroundHex(settings && settings.background);
      const occlusion = settings && settings.occlusion ? settings.occlusion : DEFAULT_GRAPHICS_SETTINGS.occlusion;
      const outline = settings && settings.outline ? settings.outline : DEFAULT_GRAPHICS_SETTINGS.outline;
      const fog = settings && settings.fog ? settings.fog : DEFAULT_GRAPHICS_SETTINGS.fog;
      const extras = settings && settings.extras ? settings.extras : DEFAULT_GRAPHICS_SETTINGS.extras;
      const lighting = settings && settings.lighting ? settings.lighting : LIGHTING_PRESETS.default;
      const antialiasing = settings && settings.antialiasing ? settings.antialiasing : DEFAULT_GRAPHICS_SETTINGS.antialiasing;
      const camera = settings && settings.camera ? settings.camera : DEFAULT_GRAPHICS_SETTINGS.camera;
      const occlusionProps = occlusion.enabled === false ? { name: 'off' } : {
        name: 'on',
        params: {
          samples: numericOr(occlusion.samples, 64),
          radius: numericOr(occlusion.radius, 6),
          bias: numericOr(occlusion.bias, 0.8),
          blurKernelSize: numericOr(occlusion.blurKernelSize, 7),
          resolutionScale: numericOr(occlusion.resolutionScale, 1)
        }
      };
      const outlineProps = outline && outline.enabled === false ? { name: 'off' } : {
        name: 'on',
        params: {
          scale: numericOr(outline && outline.scale, 0.5),
          threshold: numericOr(outline && outline.threshold, 0.35),
          color: hexToMolstarColor(outline && outline.color ? outline.color : '#0f172a')
        }
      };
      const fogProps = fog && fog.enabled === false ? { name: 'off' } : {
        name: 'on',
        params: {
          intensity: numericOr(fog && fog.intensity, 0.5),
          color: hexToMolstarColor(fog && fog.color ? fog.color : backgroundHex)
        }
      };
      const aaProps = antialiasing && antialiasing.mode === 'fxaa' ? {
        name: 'fxaa',
        params: {
          edgeThresholdMin: numericOr(antialiasing.edgeThresholdMin, 0.125),
          edgeThresholdMax: numericOr(antialiasing.edgeThresholdMax, 0.25),
          iterations: numericOr(antialiasing.iterations, 2),
          subpixelQuality: numericOr(antialiasing.subpixelQuality, 0.75)
        }
      } : { name: 'off' };
      const lights = buildLights(lighting);
      canvas.setProps({
        renderer: {
          backgroundColor: hexToMolstarColor(backgroundHex),
          ambientColor: hexToMolstarColor(backgroundHex),
          ambientIntensity: 0.55,
          light: lights
        },
        camera: {
          mode: camera && camera.mode === 'orthographic' ? 'orthographic' : 'perspective',
          helper: {
            axes: { name: extras && extras.hideAxes === false ? 'on' : 'off' }
          }
        },
        postprocessing: {
          occlusion: occlusionProps,
          outline: outlineProps,
          antialiasing: aaProps
        },
        cameraFog: fogProps,
        marking: extras && extras.disableMarking === false ? { enabled: true } : {
          enabled: false,
          edgeScale: 0,
          ghostEdgeStrength: 0,
          innerEdgeFactor: 0
        }
      });
      if (options && options.immediate) {
        previewStatusEl.textContent = 'Preview updated for ' + previewTheme + ' mode';
      }
    }

    function buildLights(lighting) {
      if (!lighting || lighting.enabled === false) {
        return [];
      }
      const exposure = numericOr(lighting.exposure, 1);
      return (lighting.lights || []).map((light, index) => ({
        inclination: numericOr(light.inclination, index === 0 ? 170 : 30),
        azimuth: numericOr(light.azimuth, index * 120),
        intensity: numericOr(light.intensity, 1) * exposure,
        color: hexToMolstarColor(light.color || '#ffffff')
      }));
    }

    function resolveBackgroundHex(background) {
      if (!background) {
        return previewTheme === 'dark' ? '#0f172a' : '#f8f1e7';
      }
      if (background.mode === 'dark') {
        return background.dark || '#0f172a';
      }
      if (background.mode === 'light') {
        return background.light || '#f8f1e7';
      }
      if (background.mode === 'custom') {
        return background.custom || '#0f172a';
      }
      return previewTheme === 'dark' ? (background.dark || '#0f172a') : (background.light || '#f8f1e7');
    }

    function hexToMolstarColor(hex) {
      const rgb = hexToRgb(hex);
      return (rgb.r << 16) | (rgb.g << 8) | rgb.b;
    }

    function hexToRgb(hex) {
      const normalized = typeof hex === 'string' ? hex.replace('#', '').trim() : '000000';
      if (normalized.length !== 6) {
        return { r: 0, g: 0, b: 0 };
      }
      return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
      };
    }

    function numericOr(value, fallback) {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    }

    function showMessage(elementId, message, type) {
      const el = document.getElementById(elementId);
      el.innerHTML = '<div class="message ' + type + '">' + message + '</div>';
      setTimeout(() => {
        if (el.innerHTML.indexOf(message) !== -1) {
          el.innerHTML = '';
        }
      }, 5000);
    }

    window.deleteOverride = async function deleteOverride(date) {
      if (!confirm('Delete override for ' + date + '?')) {
        return;
      }
      try {
        const response = await fetch(API_BASE + '/api/admin/override-protein?date=' + date, {
          method: 'DELETE',
          credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to delete override');
        }
        showMessage('override-message', data.message || 'Override removed', 'success');
        await loadStatus();
      } catch (err) {
        console.error('Error deleting override:', err);
        showMessage('override-message', err.message || 'Failed to delete override', 'error');
      }
    };
  </script>

</body>
</html>`;
