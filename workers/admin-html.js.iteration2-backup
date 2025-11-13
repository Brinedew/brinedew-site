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
      color: #e2e8f0;
      padding: 2rem;
      line-height: 1.6;
    }
    
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    
    h1 {
      color: #38bdf8;
      margin-bottom: 0.5rem;
      font-size: 2rem;
    }
    
    .subtitle {
      color: #64748b;
      margin-bottom: 2rem;
    }
    
    .section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid #334155;
    }
    
    h2 {
      color: #38bdf8;
      margin-bottom: 1rem;
      font-size: 1.25rem;
    }
    
    .form-group {
      margin-bottom: 1rem;
    }
    
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #94a3b8;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    input, select, textarea {
      width: 100%;
      padding: 0.75rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 4px;
      color: #e2e8f0;
      font-size: 0.875rem;
      font-family: inherit;
    }
    
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #38bdf8;
    }
    
    button {
      background: #38bdf8;
      color: #0f172a;
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
      color: #94a3b8;
      font-size: 0.875rem;
    }
    
    .status-value {
      color: #e2e8f0;
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
      color: #38bdf8;
      font-weight: 600;
    }
    
    .override-protein {
      color: #94a3b8;
    }
    
    .btn-delete {
      background: #ef4444;
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
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
      color: #d1fae5;
    }
    
    .message.error {
      background: #7f1d1d;
      border: 1px solid #dc2626;
      color: #fecaca;
    }
    
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    input[type="checkbox"] {
      width: auto;
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
        <p style="color: #64748b; font-size: 0.875rem;">Loading...</p>
      </div>
    </div>
    
    <!-- Protein Override -->
    <div class="section">
      <h2>Protein Override</h2>
      <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 1rem;">
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
      <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 1rem;">
        Configure 3D protein viewer rendering settings.
      </p>
      
      <form id="graphics-form">
        <!-- Camera -->
        <div class="form-group">
          <label for="graphics-cameraMode" style="display: block; font-weight: 600; margin-bottom: 0.5rem;">Camera Mode</label>
          <select id="graphics-cameraMode" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; background: white;">
            <option value="perspective">Perspective</option>
            <option value="orthographic">Orthographic</option>
          </select>
        </div>

        <!-- Ambient Occlusion -->
        <div class="form-group">
          <label for="graphics-occlusionQuality" style="display: block; font-weight: 600; margin-bottom: 0.5rem;">Ambient Occlusion</label>
          <select id="graphics-occlusionQuality" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; background: white;">
            <option value="off">Off</option>
            <option value="low">Low (16 samples, radius 2)</option>
            <option value="medium">Medium (32 samples, radius 4)</option>
            <option value="high">High (64 samples, radius 6)</option>
            <option value="ultra">Ultra (128 samples, radius 8)</option>
          </select>
        </div>

        <!-- Antialiasing -->
        <div class="form-group">
          <label for="graphics-antialiasingMode" style="display: block; font-weight: 600; margin-bottom: 0.5rem;">Antialiasing</label>
          <select id="graphics-antialiasingMode" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; background: white;">
            <option value="off">Off</option>
            <option value="fxaa">FXAA</option>
          </select>
        </div>

        <!-- Fog Intensity -->
        <div class="form-group">
          <label for="graphics-fogIntensity" style="display: block; font-weight: 600; margin-bottom: 0.5rem;">
            Fog Intensity <span id="fog-value" style="font-weight: 400; color: #64748b;">0.50</span>
          </label>
          <input type="range" id="graphics-fogIntensity" min="0" max="1" step="0.05" value="0.5" 
                 style="width: 100%;"
                 oninput="document.getElementById('fog-value').textContent = parseFloat(this.value).toFixed(2)">
        </div>

        <!-- Outline -->
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-outlineEnabled" checked 
                   onchange="document.getElementById('outline-controls').style.display = this.checked ? 'block' : 'none'">
            <label for="graphics-outlineEnabled" style="margin: 0; font-weight: 600;">Outline Rendering</label>
          </div>
        </div>
        <div id="outline-controls" style="margin-left: 1.5rem; display: block;">
          <div class="form-group">
            <label for="graphics-outlineScale" style="display: block; margin-bottom: 0.5rem;">
              Scale <span id="outline-scale-value" style="color: #64748b;">0.50</span>
            </label>
            <input type="range" id="graphics-outlineScale" min="0.1" max="2" step="0.1" value="0.5"
                   style="width: 100%;"
                   oninput="document.getElementById('outline-scale-value').textContent = parseFloat(this.value).toFixed(2)">
          </div>
          <div class="form-group">
            <label for="graphics-outlineThreshold" style="display: block; margin-bottom: 0.5rem;">
              Threshold <span id="outline-threshold-value" style="color: #64748b;">0.35</span>
            </label>
            <input type="range" id="graphics-outlineThreshold" min="0.1" max="1" step="0.05" value="0.35"
                   style="width: 100%;"
                   oninput="document.getElementById('outline-threshold-value').textContent = parseFloat(this.value).toFixed(2)">
          </div>
        </div>

        <!-- Lighting Preset -->
        <div class="form-group">
          <label for="graphics-lightingPreset" style="display: block; font-weight: 600; margin-bottom: 0.5rem;">Lighting Preset</label>
          <select id="graphics-lightingPreset" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; background: white;">
            <option value="default">Default (Single Light)</option>
            <option value="dramatic">Dramatic (High Contrast)</option>
            <option value="soft">Soft (Balanced)</option>
            <option value="studio">Studio (Three-Point)</option>
          </select>
        </div>

        <!-- Simple Toggles -->
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-backgroundColor" checked>
            <label for="graphics-backgroundColor" style="margin: 0;">Custom Background Color</label>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-hideAxes" checked>
            <label for="graphics-hideAxes" style="margin: 0;">Hide XYZ Axes</label>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="graphics-disableMarking" checked>
            <label for="graphics-disableMarking" style="margin: 0;">Disable Selection Marking</label>
          </div>
        </div>
        
        <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
          <button type="submit">Apply Graphics Settings</button>
          <button type="button" onclick="resetGraphics()">Reset to Defaults</button>
        </div>
      </form>
      
      <div id="graphics-message"></div>
    </div>
    
    <!-- Feature Flags -->
    <div class="section">
      <h2>Feature Flags</h2>
      <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 1rem;">
        Toggle experimental features and game modes.
      </p>
      
      <form id="flags-form">
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="flag-randomizer">
            <label for="flag-randomizer" style="margin: 0;">Enable Randomizer Mode</label>
          </div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="flag-archive">
            <label for="flag-archive" style="margin: 0;">Enable Archive Mode</label>
          </div>
        </div>
        
        <button type="submit">Update Flags</button>
      </form>
      
      <div id="flags-message"></div>
    </div>
  </div>
  
  <script>
    const API_BASE = 'https://geneguessr-api.decap.workers.dev';
    
    // Load current status
    async function loadStatus() {
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/status\`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error('Failed to load status');
        }
        
        const data = await response.json();
        displayStatus(data);
        displayOverrides(data.all_overrides);
        updateFlagCheckboxes(data.feature_flags);
        updateGraphicsCheckboxes(data.graphics_settings);
      } catch (err) {
        console.error('Error loading status:', err);
        document.getElementById('status-display').innerHTML = 
          '<p style="color: #ef4444;">Failed to load status</p>';
      }
    }
    
    function displayStatus(data) {
      const statusHtml = \`
        <div class="status-item">
          <span class="status-label">Today's Date</span>
          <span class="status-value">\${data.today.date}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Today's Override</span>
          <span class="status-value">\${data.today.override || 'None (using random selection)'}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Active Overrides</span>
          <span class="status-value">\${data.all_overrides.length}</span>
        </div>
      \`;
      document.getElementById('status-display').innerHTML = statusHtml;
    }
    
    function displayOverrides(overrides) {
      const listEl = document.getElementById('override-list');
      
      if (overrides.length === 0) {
        listEl.innerHTML = '<p style="color: #64748b; font-size: 0.875rem; margin-top: 1rem;">No active overrides</p>';
        return;
      }
      
      listEl.innerHTML = '<h3 style="color: #94a3b8; font-size: 0.875rem; margin-bottom: 0.5rem; margin-top: 1rem;">Active Overrides:</h3>';
      
      overrides.sort((a, b) => b.date.localeCompare(a.date)).forEach(override => {
        const item = document.createElement('div');
        item.className = 'override-item';
        item.innerHTML = \`
          <div class="override-info">
            <span class="override-date">\${override.date}</span>
            <span class="override-protein">\${override.uniprot_id}</span>
          </div>
          <button class="btn-delete" onclick="deleteOverride('\${override.date}')">Delete</button>
        \`;
        listEl.appendChild(item);
      });
    }
    
    function updateFlagCheckboxes(flags) {
      document.getElementById('flag-randomizer').checked = flags.randomizer || false;
      document.getElementById('flag-archive').checked = flags.archive || false;
    }
    
    function updateGraphicsCheckboxes(graphics) {
      if (!graphics) return;
      
      // Dropdowns and selects
      document.getElementById('graphics-cameraMode').value = graphics.cameraMode || 'perspective';
      document.getElementById('graphics-occlusionQuality').value = graphics.occlusionQuality || 'off';
      document.getElementById('graphics-antialiasingMode').value = graphics.antialiasingMode || 'fxaa';
      document.getElementById('graphics-lightingPreset').value = graphics.lightingPreset || 'default';
      
      // Sliders
      const fogIntensity = graphics.fogIntensity !== undefined ? graphics.fogIntensity : 0.5;
      document.getElementById('graphics-fogIntensity').value = fogIntensity;
      document.getElementById('fog-value').textContent = fogIntensity.toFixed(2);
      
      // Outline controls
      const outlineEnabled = graphics.outlineEnabled !== false;
      document.getElementById('graphics-outlineEnabled').checked = outlineEnabled;
      document.getElementById('outline-controls').style.display = outlineEnabled ? 'block' : 'none';
      
      const outlineScale = graphics.outlineScale !== undefined ? graphics.outlineScale : 0.5;
      document.getElementById('graphics-outlineScale').value = outlineScale;
      document.getElementById('outline-scale-value').textContent = outlineScale.toFixed(2);
      
      const outlineThreshold = graphics.outlineThreshold !== undefined ? graphics.outlineThreshold : 0.35;
      document.getElementById('graphics-outlineThreshold').value = outlineThreshold;
      document.getElementById('outline-threshold-value').textContent = outlineThreshold.toFixed(2);
      
      // Simple checkboxes
      document.getElementById('graphics-backgroundColor').checked = graphics.backgroundColor !== false;
      document.getElementById('graphics-hideAxes').checked = graphics.hideAxes !== false;
      document.getElementById('graphics-disableMarking').checked = graphics.disableMarking !== false;
    }
    
    // Set today's date as default
    document.getElementById('override-date').valueAsDate = new Date();
    
    // Handle protein override form
    document.getElementById('override-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const date = document.getElementById('override-date').value;
      const uniprot_id = document.getElementById('override-uniprot').value;
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/override-protein\`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, uniprot_id })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          showMessage('override-message', data.message, 'success');
          document.getElementById('override-uniprot').value = '';
          await loadStatus();
        } else {
          showMessage('override-message', data.error || 'Failed to set override', 'error');
        }
      } catch (err) {
        console.error('Error setting override:', err);
        showMessage('override-message', 'Failed to set override', 'error');
      }
    });
    
    // Handle feature flags form
    document.getElementById('flags-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const flags = {
        randomizer: document.getElementById('flag-randomizer').checked,
        archive: document.getElementById('flag-archive').checked
      };
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/feature-flags\`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(flags)
        });
        
        const data = await response.json();
        
        if (response.ok) {
          showMessage('flags-message', data.message, 'success');
          await loadStatus();
        } else {
          showMessage('flags-message', data.error || 'Failed to update flags', 'error');
        }
      } catch (err) {
        console.error('Error updating flags:', err);
        showMessage('flags-message', 'Failed to update flags', 'error');
      }
    });
    
    // Handle graphics form
    document.getElementById('graphics-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const graphics = {
        cameraMode: document.getElementById('graphics-cameraMode').value,
        occlusionQuality: document.getElementById('graphics-occlusionQuality').value,
        antialiasingMode: document.getElementById('graphics-antialiasingMode').value,
        fogIntensity: parseFloat(document.getElementById('graphics-fogIntensity').value),
        outlineEnabled: document.getElementById('graphics-outlineEnabled').checked,
        outlineScale: parseFloat(document.getElementById('graphics-outlineScale').value),
        outlineThreshold: parseFloat(document.getElementById('graphics-outlineThreshold').value),
        lightingPreset: document.getElementById('graphics-lightingPreset').value,
        backgroundColor: document.getElementById('graphics-backgroundColor').checked,
        hideAxes: document.getElementById('graphics-hideAxes').checked,
        disableMarking: document.getElementById('graphics-disableMarking').checked,
      };
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/graphics-settings\`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(graphics)
        });
        
        const data = await response.json();
        
        if (response.ok) {
          showMessage('graphics-message', data.message, 'success');
          await loadStatus();
        } else {
          showMessage('graphics-message', data.error || 'Failed to update graphics', 'error');
        }
      } catch (err) {
        console.error('Error updating graphics:', err);
        showMessage('graphics-message', 'Failed to update graphics', 'error');
      }
    });
    
    // Reset graphics to defaults
    window.resetGraphics = function() {
      document.getElementById('graphics-cameraMode').value = 'perspective';
      document.getElementById('graphics-occlusionQuality').value = 'off';
      document.getElementById('graphics-antialiasingMode').value = 'fxaa';
      document.getElementById('graphics-fogIntensity').value = 0.5;
      document.getElementById('fog-value').textContent = '0.50';
      document.getElementById('graphics-outlineEnabled').checked = true;
      document.getElementById('graphics-outlineScale').value = 0.5;
      document.getElementById('outline-scale-value').textContent = '0.50';
      document.getElementById('graphics-outlineThreshold').value = 0.35;
      document.getElementById('outline-threshold-value').textContent = '0.35';
      document.getElementById('outline-controls').style.display = 'block';
      document.getElementById('graphics-lightingPreset').value = 'default';
      document.getElementById('graphics-backgroundColor').checked = true;
      document.getElementById('graphics-hideAxes').checked = true;
      document.getElementById('graphics-disableMarking').checked = true;
    };
    
    // Delete override
    window.deleteOverride = async function(date) {
      if (!confirm(\`Delete override for \${date}?\`)) {
        return;
      }
      
      try {
        const response = await fetch(\`\${API_BASE}/api/admin/override-protein?date=\${date}\`, {
          method: 'DELETE',
          credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok) {
          showMessage('override-message', data.message, 'success');
          await loadStatus();
        } else {
          showMessage('override-message', data.error || 'Failed to delete override', 'error');
        }
      } catch (err) {
        console.error('Error deleting override:', err);
        showMessage('override-message', 'Failed to delete override', 'error');
      }
    };
    
    function showMessage(elementId, message, type) {
      const el = document.getElementById(elementId);
      el.innerHTML = \`<div class="message \${type}">\${message}</div>\`;
      setTimeout(() => {
        el.innerHTML = '';
      }, 5000);
    }
    
    // Load status on page load
    loadStatus();
  </script>
</body>
</html>`;
