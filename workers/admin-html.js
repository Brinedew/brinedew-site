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

    .form-subsection {
      border: 1px solid #2c3a52;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
      background: #111b2f;
    }

    .form-subsection h3 {
      margin-bottom: 0.5rem;
      font-size: 1rem;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
    }

    .inline-inputs {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .inline-inputs input[type="range"] {
      flex: 1;
    }

    input[type="color"] {
      height: 42px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid #334155;
      background: transparent;
    }

    .profile-manager {
      border: 1px solid #2c3a52;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.25rem;
      background: #111b2f;
    }

    .profile-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .profile-actions button {
      flex: none;
      padding: 0.5rem 1rem;
    }

    .light-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
    }

    .light-card {
      border: 1px solid #2c3a52;
      border-radius: 8px;
      padding: 0.75rem;
      background: rgba(0, 0, 0, 0.15);
    }

    .light-card h4 {
      margin-bottom: 0.5rem;
      font-size: 0.95rem;
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
        <div class="profile-manager">
          <h3>Profile Manager</h3>
          <div class="form-grid">
            <div>
              <label for="profile-select">Profile Preset</label>
              <select id="profile-select"></select>
            </div>
            <div class="profile-actions">
              <button type="button" id="profile-load">Load</button>
              <button type="button" id="profile-save">Save As</button>
              <button type="button" id="profile-delete">Delete</button>
              <button type="button" id="profile-reset">Restore Built-ins</button>
            </div>
          </div>
          <div class="form-grid">
            <div>
              <label for="profile-name">Profile Name</label>
              <input type="text" id="profile-name" placeholder="Custom Studio">
            </div>
            <div>
              <label for="profile-description">Description</label>
              <textarea id="profile-description" rows="2" placeholder="Short note for this preset"></textarea>
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Camera</h3>
          <div class="form-group">
            <label for="camera-mode">Projection Mode</label>
            <select id="camera-mode">
              <option value="perspective">Perspective</option>
              <option value="orthographic">Orthographic</option>
            </select>
          </div>
          <div class="form-group">
            <label for="camera-fov">Field of View <span class="value-pill" id="camera-fov-value">48°</span></label>
            <input type="range" id="camera-fov" min="20" max="120" step="1" value="48">
          </div>
          <div class="form-grid">
            <div>
              <label for="camera-near">Near Plane</label>
              <input type="number" id="camera-near" min="0.01" max="10" step="0.01">
            </div>
            <div>
              <label for="camera-far">Far Plane</label>
              <input type="number" id="camera-far" min="10" max="5000" step="10">
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Background & Theme</h3>
          <div class="form-group">
            <label for="background-mode">Background Mode</label>
            <select id="background-mode">
              <option value="auto">Auto (match site)</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="form-grid">
            <div>
              <label for="background-dark">Dark Color</label>
              <input type="color" id="background-dark" value="#0f172a">
            </div>
            <div>
              <label for="background-light">Light Color</label>
              <input type="color" id="background-light" value="#f8f1e7">
            </div>
            <div>
              <label for="background-custom">Custom Color</label>
              <input type="color" id="background-custom" value="#0f172a">
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Lighting & Exposure</h3>
          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="lighting-enabled" checked>
              <label for="lighting-enabled">Enable Lighting</label>
            </div>
          </div>
          <div class="form-group">
            <label for="lighting-exposure">Exposure <span class="value-pill" id="lighting-exposure-value">1.00</span></label>
            <input type="range" id="lighting-exposure" min="0" max="3" step="0.05" value="1">
          </div>
          <div class="form-group">
            <label for="lighting-preset">Lighting Preset</label>
            <select id="lighting-preset">
              <option value="studio">Studio Balanced</option>
              <option value="cinematic">Cinematic Ultra</option>
              <option value="performance">Performance</option>
            </select>
          </div>
          <div class="light-grid">
            <div class="light-card">
              <h4>Key Light</h4>
              <div class="form-group">
                <label for="light-key-color">Color</label>
                <input type="color" id="light-key-color" value="#ffffff">
              </div>
              <div class="form-group">
                <label for="light-key-intensity">Intensity <span class="value-pill" id="light-key-intensity-value">1.00</span></label>
                <input type="range" id="light-key-intensity" min="0" max="3" step="0.05">
              </div>
              <div class="form-group">
                <label for="light-key-inclination">Inclination</label>
                <input type="number" id="light-key-inclination" min="0" max="180" step="1">
              </div>
              <div class="form-group">
                <label for="light-key-azimuth">Azimuth</label>
                <input type="number" id="light-key-azimuth" min="0" max="360" step="1">
              </div>
            </div>
            <div class="light-card">
              <h4>Fill Light</h4>
              <div class="form-group">
                <label for="light-fill-color">Color</label>
                <input type="color" id="light-fill-color" value="#c9d5ff">
              </div>
              <div class="form-group">
                <label for="light-fill-intensity">Intensity <span class="value-pill" id="light-fill-intensity-value">0.70</span></label>
                <input type="range" id="light-fill-intensity" min="0" max="3" step="0.05">
              </div>
              <div class="form-group">
                <label for="light-fill-inclination">Inclination</label>
                <input type="number" id="light-fill-inclination" min="0" max="180" step="1">
              </div>
              <div class="form-group">
                <label for="light-fill-azimuth">Azimuth</label>
                <input type="number" id="light-fill-azimuth" min="0" max="360" step="1">
              </div>
            </div>
            <div class="light-card">
              <h4>Rim Light</h4>
              <div class="form-group">
                <label for="light-rim-color">Color</label>
                <input type="color" id="light-rim-color" value="#92b4ff">
              </div>
              <div class="form-group">
                <label for="light-rim-intensity">Intensity <span class="value-pill" id="light-rim-intensity-value">0.45</span></label>
                <input type="range" id="light-rim-intensity" min="0" max="3" step="0.05">
              </div>
              <div class="form-group">
                <label for="light-rim-inclination">Inclination</label>
                <input type="number" id="light-rim-inclination" min="0" max="180" step="1">
              </div>
              <div class="form-group">
                <label for="light-rim-azimuth">Azimuth</label>
                <input type="number" id="light-rim-azimuth" min="0" max="360" step="1">
              </div>
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Ambient Occlusion</h3>
          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="occlusion-enabled" checked>
              <label for="occlusion-enabled">Enable Ambient Occlusion</label>
            </div>
          </div>
          <div class="form-group">
            <label for="occlusion-quality">Quality Preset</label>
            <select id="occlusion-quality">
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="ultra">Ultra</option>
            </select>
          </div>
          <div class="form-grid">
            <div>
              <label for="occlusion-samples">Samples</label>
              <input type="number" id="occlusion-samples" min="0" max="256" step="1">
            </div>
            <div>
              <label for="occlusion-radius">Radius</label>
              <input type="number" id="occlusion-radius" min="0" max="20" step="0.25">
            </div>
            <div>
              <label for="occlusion-bias">Bias</label>
              <input type="number" id="occlusion-bias" min="0" max="2" step="0.05">
            </div>
            <div>
              <label for="occlusion-blur">Blur Kernel</label>
              <input type="number" id="occlusion-blur" min="1" max="15" step="1">
            </div>
            <div>
              <label for="occlusion-resolution">Resolution Scale</label>
              <input type="number" id="occlusion-resolution" min="0.25" max="2" step="0.05">
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Antialiasing</h3>
          <div class="form-group">
            <label for="antialiasing-mode">Mode</label>
            <select id="antialiasing-mode">
              <option value="fxaa">FXAA</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div class="form-grid">
            <div>
              <label for="antialiasing-edgeMin">Edge Threshold (Min)</label>
              <input type="number" id="antialiasing-edgeMin" min="0" max="1" step="0.01">
            </div>
            <div>
              <label for="antialiasing-edgeMax">Edge Threshold (Max)</label>
              <input type="number" id="antialiasing-edgeMax" min="0" max="1" step="0.01">
            </div>
            <div>
              <label for="antialiasing-iterations">Iterations</label>
              <input type="number" id="antialiasing-iterations" min="1" max="4" step="1">
            </div>
            <div>
              <label for="antialiasing-subpixel">Subpixel Quality</label>
              <input type="number" id="antialiasing-subpixel" min="0" max="1" step="0.05">
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Fog</h3>
          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="fog-enabled" checked>
              <label for="fog-enabled">Enable Fog</label>
            </div>
          </div>
          <div class="form-group">
            <label for="fog-intensity">Intensity <span class="value-pill" id="fog-value">0.50</span></label>
            <input type="range" id="fog-intensity" min="0" max="1" step="0.01" value="0.5">
          </div>
          <div class="form-grid">
            <div>
              <label for="fog-color">Fog Color</label>
              <input type="color" id="fog-color" value="#0f172a">
            </div>
            <div>
              <label for="fog-near">Near Distance</label>
              <input type="number" id="fog-near" min="0" max="500" step="5">
            </div>
            <div>
              <label for="fog-far">Far Distance</label>
              <input type="number" id="fog-far" min="0" max="5000" step="10">
            </div>
          </div>
        </div>

        <div class="form-subsection">
          <h3>Outlines</h3>
          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="outline-enabled" checked>
              <label for="outline-enabled">Enable Outline Rendering</label>
            </div>
          </div>
          <div class="form-group">
            <label for="outline-color">Outline Color</label>
            <input type="color" id="outline-color" value="#0f172a">
          </div>
          <div class="form-group">
            <label for="outline-scale">Scale <span class="value-pill" id="outline-scale-value">0.50</span></label>
            <input type="range" id="outline-scale" min="0.05" max="2" step="0.05" value="0.5">
          </div>
          <div class="form-group">
            <label for="outline-threshold">Threshold <span class="value-pill" id="outline-threshold-value">0.35</span></label>
            <input type="range" id="outline-threshold" min="0.05" max="1" step="0.01" value="0.35">
          </div>
        </div>

        <div class="form-subsection">
          <h3>Extras</h3>
          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="extras-hideAxes" checked>
              <label for="extras-hideAxes">Hide XYZ Axes</label>
            </div>
          </div>
          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="extras-disableMarking" checked>
              <label for="extras-disableMarking">Disable Selection Marking</label>
            </div>
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
      studio: {
        enabled: true,
        exposure: 1.1,
        lights: [
          { id: 'key', label: 'Key', inclination: 170, azimuth: 30, intensity: 1.4, color: '#ffffff' },
          { id: 'fill', label: 'Fill', inclination: 32, azimuth: 210, intensity: 0.7, color: '#c9d5ff' },
          { id: 'rim', label: 'Rim', inclination: 85, azimuth: 315, intensity: 0.45, color: '#92b4ff' }
        ]
      },
      cinematic: {
        enabled: true,
        exposure: 1.25,
        lights: [
          { id: 'key', label: 'Key', inclination: 160, azimuth: 20, intensity: 1.6, color: '#ffe7d3' },
          { id: 'fill', label: 'Fill', inclination: 25, azimuth: 210, intensity: 0.8, color: '#c4d2ff' },
          { id: 'rim', label: 'Rim', inclination: 95, azimuth: 315, intensity: 0.6, color: '#7dafff' }
        ]
      },
      performance: {
        enabled: true,
        exposure: 1,
        lights: [
          { id: 'key', label: 'Key', inclination: 175, azimuth: 25, intensity: 1.2, color: '#ffffff' },
          { id: 'fill', label: 'Fill', inclination: 35, azimuth: 200, intensity: 0.35, color: '#cdd5ff' },
          { id: 'rim', label: 'Rim', inclination: 90, azimuth: 300, intensity: 0.25, color: '#91a4ff' }
        ]
      }
    };

    function mergeDeep(target, source) {
      if (!source || typeof source !== 'object') {
        return target;
      }
      Object.entries(source).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          target[key] = value.map((item) => (item && typeof item === 'object' ? mergeDeep({}, item) : item));
          return;
        }
        if (value && typeof value === 'object') {
          target[key] = mergeDeep(target[key] || {}, value);
          return;
        }
        target[key] = value;
      });
      return target;
    }

    function createProfileTemplate() {
      return {
        camera: {
          mode: 'perspective',
          fieldOfView: 48,
          near: 0.1,
          far: 1800
        },
        lighting: deepClone(LIGHTING_PRESETS.studio),
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
        }
      };
    }

    function buildProfile(id, name, description, overrides = {}) {
      const template = createProfileTemplate();
      const merged = mergeDeep(template, overrides);
      return { id, name, description, ...merged };
    }

    const LIGHT_IDS = ['key', 'fill', 'rim'];
    const LIGHT_LABELS = {
      key: 'Key Light',
      fill: 'Fill Light',
      rim: 'Rim Light'
    };

    const BUILT_IN_PROFILES = [
      buildProfile('studio', 'Studio Balanced', 'Cinematic soft lighting with subtle fog.'),
      buildProfile('cinematic', 'Cinematic Ultra', 'High quality occlusion + deeper fog.', {
        occlusion: { samples: 128, radius: 8, blurKernelSize: 9, resolutionScale: 1 },
        fog: { intensity: 0.75, color: '#050816' },
        lighting: deepClone(LIGHTING_PRESETS.cinematic)
      }),
      buildProfile('performance', 'Performance', 'Lightweight settings for low-power GPUs.', {
        occlusion: { enabled: false, samples: 0, radius: 0 },
        fog: { enabled: false, intensity: 0 },
        outline: { enabled: false },
        antialiasing: { mode: 'fxaa', iterations: 1, subpixelQuality: 0.5 },
        lighting: deepClone(LIGHTING_PRESETS.performance)
      })
    ];

    function extractProfileSections(profile) {
      return {
        camera: deepClone(profile.camera),
        lighting: deepClone(profile.lighting),
        occlusion: deepClone(profile.occlusion),
        antialiasing: deepClone(profile.antialiasing),
        fog: deepClone(profile.fog),
        outline: deepClone(profile.outline),
        background: deepClone(profile.background),
        extras: deepClone(profile.extras)
      };
    }

    function slugifyProfileName(value) {
      return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    const DEFAULT_GRAPHICS_SETTINGS = {
      version: 2,
      ...extractProfileSections(BUILT_IN_PROFILES[0]),
      profileManager: {
        activeProfileId: BUILT_IN_PROFILES[0].id,
        profiles: BUILT_IN_PROFILES.map((profile) => deepClone(profile))
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
    const profileState = {
      builtInIds: new Set(BUILT_IN_PROFILES.map((p) => p.id)),
      profiles: deepClone(DEFAULT_GRAPHICS_SETTINGS.profileManager.profiles),
      activeId: DEFAULT_GRAPHICS_SETTINGS.profileManager.activeProfileId,
      selectedId: DEFAULT_GRAPHICS_SETTINGS.profileManager.activeProfileId
    };

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
        syncProfileState(pendingGraphicsSettings.profileManager);
        applyGraphicsSettingsToForm(pendingGraphicsSettings);
        refreshPreview({ immediate: true });
      });
      document.getElementById('graphics-revert').addEventListener('click', () => {
        pendingGraphicsSettings = deepClone(currentGraphicsSettings);
        syncProfileState(pendingGraphicsSettings.profileManager);
        applyGraphicsSettingsToForm(pendingGraphicsSettings);
        refreshPreview({ immediate: true });
      });
      document.getElementById('profile-select').addEventListener('change', (event) => {
        profileState.selectedId = event.target.value;
        hydrateProfileControls();
      });
      document.getElementById('profile-load').addEventListener('click', loadSelectedProfile);
      document.getElementById('profile-save').addEventListener('click', saveProfileFromCurrent);
      document.getElementById('profile-delete').addEventListener('click', deleteSelectedProfile);
      document.getElementById('profile-reset').addEventListener('click', resetBuiltInProfiles);
      document.getElementById('lighting-preset').addEventListener('change', (event) => {
        applyLightingPresetToFields(event.target.value);
      });
      document.getElementById('occlusion-quality').addEventListener('change', (event) => {
        applyOcclusionPresetToFields(event.target.value);
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
      hydrateProfileControls();
      const debouncedResize = debounce(autoSizeSelects, 150);
      window.addEventListener('resize', debouncedResize);
    }

    function handleGraphicsInputChange(event) {
      const target = event?.target;
      if (target) {
        if (target.id === 'profile-name' || target.id === 'profile-description') {
          return;
        }
        if (target.id === 'lighting-preset') {
          applyLightingPresetToFields(target.value);
          return;
        }
        if (target.id === 'occlusion-quality') {
          applyOcclusionPresetToFields(target.value);
          return;
        }
      }
      updateValueBadges();
      pendingGraphicsSettings = collectGraphicsSettingsFromForm();
      refreshPreview();
    }

    function updateValueBadges() {
      const fog = document.getElementById('fog-intensity');
      const outlineScale = document.getElementById('outline-scale');
      const outlineThreshold = document.getElementById('outline-threshold');
      const cameraFov = document.getElementById('camera-fov');
      const exposure = document.getElementById('lighting-exposure');
      const fogValueEl = document.getElementById('fog-value');
      if (fog && fogValueEl) {
        fogValueEl.textContent = Number(fog.value || 0).toFixed(2);
      }
      const outlineScaleEl = document.getElementById('outline-scale-value');
      if (outlineScale && outlineScaleEl) {
        outlineScaleEl.textContent = Number(outlineScale.value || 0).toFixed(2);
      }
      const outlineThresholdEl = document.getElementById('outline-threshold-value');
      if (outlineThreshold && outlineThresholdEl) {
        outlineThresholdEl.textContent = Number(outlineThreshold.value || 0).toFixed(2);
      }
      const cameraFovValueEl = document.getElementById('camera-fov-value');
      if (cameraFov && cameraFovValueEl) {
        cameraFovValueEl.textContent = `${Number(cameraFov.value || 0).toFixed(0)}°`;
      }
      const exposureValueEl = document.getElementById('lighting-exposure-value');
      if (exposure && exposureValueEl) {
        exposureValueEl.textContent = Number(exposure.value || 0).toFixed(2);
      }
      LIGHT_IDS.forEach((id) => {
        const el = document.getElementById(`light-${id}-intensity`);
        const pill = document.getElementById(`light-${id}-intensity-value`);
        if (el && pill) {
          pill.textContent = Number(el.value || 0).toFixed(2);
        }
      });
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
      syncProfileState(next.profileManager);
      applyGraphicsSettingsToForm(pendingGraphicsSettings);
      refreshPreview({ immediate: true });
    }

    function syncProfileState(manager) {
      const source = manager && Array.isArray(manager.profiles) && manager.profiles.length
        ? manager
        : DEFAULT_GRAPHICS_SETTINGS.profileManager;
      profileState.profiles = deepClone(source.profiles);
      profileState.activeId = source.activeProfileId || profileState.profiles[0].id;
      profileState.selectedId = profileState.activeId;
      hydrateProfileControls();
      persistProfilesToPending();
    }

    function hydrateProfileControls() {
      const select = document.getElementById('profile-select');
      if (!select) {
        return;
      }
      select.innerHTML = '';
      profileState.profiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || profile.id;
        select.appendChild(option);
      });
      select.value = profileState.selectedId;
      const currentProfile = profileState.profiles.find((p) => p.id === profileState.selectedId);
      document.getElementById('profile-name').value = currentProfile ? currentProfile.name : '';
      document.getElementById('profile-description').value = currentProfile ? (currentProfile.description || '') : '';
      document.getElementById('profile-delete').disabled = !currentProfile || profileState.builtInIds.has(currentProfile.id);
    }

    function loadSelectedProfile() {
      const profile = profileState.profiles.find((p) => p.id === profileState.selectedId);
      if (!profile) {
        return;
      }
      pendingGraphicsSettings = {
        ...pendingGraphicsSettings,
        ...extractProfileSections(profile),
        profileManager: {
          activeProfileId: profile.id,
          profiles: deepClone(profileState.profiles)
        }
      };
      profileState.activeId = profile.id;
      profileState.selectedId = profile.id;
      applyGraphicsSettingsToForm(pendingGraphicsSettings);
      refreshPreview({ immediate: true });
      showMessage('graphics-message', `Loaded profile \"${profile.name}\"`, 'success');
    }

    function saveProfileFromCurrent() {
      const name = document.getElementById('profile-name').value.trim();
      if (!name) {
        showMessage('graphics-message', 'Enter a profile name before saving', 'error');
        return;
      }
      let id = slugifyProfileName(name);
      if (!id) {
        showMessage('graphics-message', 'Profile name must include letters or numbers', 'error');
        return;
      }
      if (profileState.builtInIds.has(id)) {
        id = `${id}-custom`;
      }
      const profilePayload = {
        id,
        name,
        description: document.getElementById('profile-description').value.trim(),
        ...extractProfileSections(pendingGraphicsSettings)
      };
      const existingIndex = profileState.profiles.findIndex((p) => p.id === id);
      if (existingIndex >= 0) {
        profileState.profiles.splice(existingIndex, 1, profilePayload);
      } else {
        profileState.profiles.push(profilePayload);
      }
      profileState.selectedId = id;
      profileState.activeId = id;
      persistProfilesToPending();
      hydrateProfileControls();
      showMessage('graphics-message', `Saved profile \"${name}\"`, 'success');
    }

    function deleteSelectedProfile() {
      const profile = profileState.profiles.find((p) => p.id === profileState.selectedId);
      if (!profile || profileState.builtInIds.has(profile.id)) {
        showMessage('graphics-message', 'Built-in profiles cannot be deleted', 'error');
        return;
      }
      profileState.profiles = profileState.profiles.filter((p) => p.id !== profile.id);
      profileState.selectedId = profileState.profiles[0]?.id || profileState.activeId;
      profileState.activeId = profileState.selectedId;
      persistProfilesToPending();
      hydrateProfileControls();
      pendingGraphicsSettings.profileManager = {
        activeProfileId: profileState.activeId,
        profiles: deepClone(profileState.profiles)
      };
      showMessage('graphics-message', 'Profile deleted', 'success');
    }

    function resetBuiltInProfiles() {
      profileState.profiles = deepClone(DEFAULT_GRAPHICS_SETTINGS.profileManager.profiles);
      profileState.selectedId = DEFAULT_GRAPHICS_SETTINGS.profileManager.activeProfileId;
      profileState.activeId = profileState.selectedId;
      persistProfilesToPending();
      hydrateProfileControls();
      showMessage('graphics-message', 'Restored built-in profiles', 'success');
    }

    function persistProfilesToPending() {
      pendingGraphicsSettings.profileManager = {
        activeProfileId: profileState.activeId,
        profiles: deepClone(profileState.profiles)
      };
    }

    function applyLightingPresetToFields(key) {
      const preset = LIGHTING_PRESETS[key];
      if (!preset) {
        return;
      }
      document.getElementById('lighting-preset').value = key;
      document.getElementById('lighting-enabled').checked = preset.enabled !== false;
      document.getElementById('lighting-exposure').value = preset.exposure ?? 1;
      LIGHT_IDS.forEach((id, index) => {
        const light = preset.lights[index] || preset.lights[0];
        document.getElementById(`light-${id}-color`).value = light?.color || '#ffffff';
        document.getElementById(`light-${id}-intensity`).value = light?.intensity ?? 1;
        document.getElementById(`light-${id}-inclination`).value = light?.inclination ?? 160;
        document.getElementById(`light-${id}-azimuth`).value = light?.azimuth ?? (index * 120);
      });
      updateValueBadges();
      pendingGraphicsSettings = collectGraphicsSettingsFromForm();
      refreshPreview({ immediate: true });
    }

    function applyOcclusionPresetToFields(key) {
      const preset = OCCLUSION_PRESETS[key];
      if (!preset) {
        return;
      }
      document.getElementById('occlusion-quality').value = key;
      document.getElementById('occlusion-enabled').checked = preset.enabled !== false;
      document.getElementById('occlusion-samples').value = preset.samples ?? 32;
      document.getElementById('occlusion-radius').value = preset.radius ?? 4;
      document.getElementById('occlusion-bias').value = preset.bias ?? 0.8;
      document.getElementById('occlusion-blur').value = preset.blurKernelSize ?? 7;
      document.getElementById('occlusion-resolution').value = preset.resolutionScale ?? 1;
      pendingGraphicsSettings = collectGraphicsSettingsFromForm();
      refreshPreview({ immediate: true });
    }

    function applyGraphicsSettingsToForm(settings) {
      const safe = settings || DEFAULT_GRAPHICS_SETTINGS;
      document.getElementById('camera-mode').value = safe.camera?.mode || 'perspective';
      document.getElementById('camera-fov').value = safe.camera?.fieldOfView ?? 48;
      document.getElementById('camera-near').value = safe.camera?.near ?? 0.1;
      document.getElementById('camera-far').value = safe.camera?.far ?? 1800;
      document.getElementById('background-mode').value = safe.background?.mode || 'auto';
      document.getElementById('background-dark').value = safe.background?.dark || '#0f172a';
      document.getElementById('background-light').value = safe.background?.light || '#f8f1e7';
      document.getElementById('background-custom').value = safe.background?.custom || '#0f172a';
      document.getElementById('lighting-enabled').checked = safe.lighting?.enabled !== false;
      document.getElementById('lighting-exposure').value = safe.lighting?.exposure ?? 1;
      document.getElementById('lighting-preset').value = deriveLightingPresetKey(safe.lighting);
      LIGHT_IDS.forEach((id, index) => {
        const lightInput = safe.lighting?.lights?.find((light) => light.id === id) || safe.lighting?.lights?.[index] || LIGHTING_PRESETS.studio.lights[index];
        document.getElementById(`light-${id}-color`).value = lightInput?.color || '#ffffff';
        document.getElementById(`light-${id}-intensity`).value = lightInput?.intensity ?? 1;
        document.getElementById(`light-${id}-inclination`).value = lightInput?.inclination ?? 160;
        document.getElementById(`light-${id}-azimuth`).value = lightInput?.azimuth ?? (index * 120);
      });
      document.getElementById('occlusion-enabled').checked = safe.occlusion?.enabled !== false;
      document.getElementById('occlusion-quality').value = deriveOcclusionQuality(safe.occlusion);
      document.getElementById('occlusion-samples').value = safe.occlusion?.samples ?? 32;
      document.getElementById('occlusion-radius').value = safe.occlusion?.radius ?? 4;
      document.getElementById('occlusion-bias').value = safe.occlusion?.bias ?? 0.8;
      document.getElementById('occlusion-blur').value = safe.occlusion?.blurKernelSize ?? 7;
      document.getElementById('occlusion-resolution').value = safe.occlusion?.resolutionScale ?? 1;
      document.getElementById('antialiasing-mode').value = safe.antialiasing?.mode === 'off' ? 'off' : 'fxaa';
      document.getElementById('antialiasing-edgeMin').value = safe.antialiasing?.edgeThresholdMin ?? 0.125;
      document.getElementById('antialiasing-edgeMax').value = safe.antialiasing?.edgeThresholdMax ?? 0.25;
      document.getElementById('antialiasing-iterations').value = safe.antialiasing?.iterations ?? 2;
      document.getElementById('antialiasing-subpixel').value = safe.antialiasing?.subpixelQuality ?? 0.75;
      document.getElementById('fog-enabled').checked = safe.fog?.enabled !== false;
      document.getElementById('fog-intensity').value = safe.fog?.intensity ?? 0.5;
      document.getElementById('fog-color').value = safe.fog?.color || '#0f172a';
      document.getElementById('fog-near').value = safe.fog?.near ?? 0;
      document.getElementById('fog-far').value = safe.fog?.far ?? 200;
      document.getElementById('outline-enabled').checked = safe.outline?.enabled !== false;
      document.getElementById('outline-color').value = safe.outline?.color || '#0f172a';
      document.getElementById('outline-scale').value = safe.outline?.scale ?? 0.5;
      document.getElementById('outline-threshold').value = safe.outline?.threshold ?? 0.35;
      document.getElementById('extras-hideAxes').checked = safe.extras?.hideAxes !== false;
      document.getElementById('extras-disableMarking').checked = safe.extras?.disableMarking !== false;
      hydrateProfileControls();
      updateValueBadges();
      autoSizeSelects();
    }
    function collectGraphicsSettingsFromForm() {
      const cameraFov = readNumber('camera-fov', 48);
      const next = {
        version: 2,
        camera: {
          mode: document.getElementById('camera-mode').value,
          fieldOfView: cameraFov,
          near: readNumber('camera-near', 0.1),
          far: readNumber('camera-far', 1800)
        },
        background: {
          mode: document.getElementById('background-mode').value,
          dark: document.getElementById('background-dark').value || '#0f172a',
          light: document.getElementById('background-light').value || '#f8f1e7',
          custom: document.getElementById('background-custom').value || '#0f172a'
        },
        lighting: {
          enabled: document.getElementById('lighting-enabled').checked,
          exposure: readNumber('lighting-exposure', 1),
          lights: LIGHT_IDS.map((id) => ({
            id,
            label: LIGHT_LABELS[id],
            color: document.getElementById(`light-${id}-color`).value || '#ffffff',
            intensity: readNumber(`light-${id}-intensity`, 1),
            inclination: readNumber(`light-${id}-inclination`, 160),
            azimuth: readNumber(`light-${id}-azimuth`, 30)
          }))
        },
        occlusion: {
          enabled: document.getElementById('occlusion-enabled').checked,
          samples: readNumber('occlusion-samples', 32),
          radius: readNumber('occlusion-radius', 4),
          bias: readNumber('occlusion-bias', 0.8),
          blurKernelSize: readNumber('occlusion-blur', 7),
          resolutionScale: readNumber('occlusion-resolution', 1)
        },
        antialiasing: {
          mode: document.getElementById('antialiasing-mode').value,
          edgeThresholdMin: readNumber('antialiasing-edgeMin', 0.125),
          edgeThresholdMax: readNumber('antialiasing-edgeMax', 0.25),
          iterations: readNumber('antialiasing-iterations', 2),
          subpixelQuality: readNumber('antialiasing-subpixel', 0.75)
        },
        fog: {
          enabled: document.getElementById('fog-enabled').checked,
          intensity: readNumber('fog-intensity', 0.5),
          color: document.getElementById('fog-color').value || '#0f172a',
          near: readNumber('fog-near', 0),
          far: readNumber('fog-far', 200)
        },
        outline: {
          enabled: document.getElementById('outline-enabled').checked,
          color: document.getElementById('outline-color').value || '#0f172a',
          scale: readNumber('outline-scale', 0.5),
          threshold: readNumber('outline-threshold', 0.35)
        },
        extras: {
          hideAxes: document.getElementById('extras-hideAxes').checked,
          disableMarking: document.getElementById('extras-disableMarking').checked
        }
      };
      persistProfilesToPending();
      next.profileManager = {
        activeProfileId: profileState.activeId,
        profiles: deepClone(profileState.profiles)
      };
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
        return 'studio';
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
      return 'studio';
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

    function readNumber(id, fallback) {
      const el = document.getElementById(id);
      if (!el) {
        return fallback;
      }
      const value = Number.parseFloat(el.value);
      return Number.isFinite(value) ? value : fallback;
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
