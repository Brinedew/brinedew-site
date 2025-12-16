// Admin panel v2 - Auto-generated GUI from Mol* runtime introspection
// Uses PDBeMolstarPlugin to match game's visual appearance
export const ADMIN_V2_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeneGuessr Admin Panel v2</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar.css">
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
      line-height: 1.5;
    }
    
    .container {
      display: grid;
      grid-template-columns: 1fr 400px;
      height: 100vh;
    }
    
    .viewer-panel {
      position: relative;
      background: #000;
    }
    
    #molstar-viewer {
      width: 100%;
      height: 100%;
    }
    
    .controls-panel {
      overflow-y: auto;
      padding: 1rem;
      background: #1e293b;
      border-left: 1px solid #334155;
    }
    
    h1 {
      font-size: 1.25rem;
      margin-bottom: 0.5rem;
      color: #f8fafc;
    }
    
    .subtitle {
      font-size: 0.875rem;
      color: #94a3b8;
      margin-bottom: 1rem;
    }
    
    .toolbar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      transition: background 0.2s;
    }
    
    button:hover {
      background: #2563eb;
    }
    
    button.secondary {
      background: #475569;
    }
    
    button.secondary:hover {
      background: #64748b;
    }
    
    button.danger {
      background: #dc2626;
    }
    
    button.danger:hover {
      background: #b91c1c;
    }
    
    .param-group {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      margin-bottom: 0.75rem;
      overflow: hidden;
    }
    
    .param-group-header {
      background: #1e293b;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 500;
      font-size: 0.875rem;
      border-bottom: 1px solid #334155;
    }
    
    .param-group-header:hover {
      background: #334155;
    }
    
    .param-group-header .toggle {
      font-size: 0.75rem;
      color: #94a3b8;
    }
    
    .param-group-content {
      padding: 0.75rem;
      display: none;
    }
    
    .param-group.open .param-group-content {
      display: block;
    }
    
    .param-group.open .toggle::before {
      content: '▼';
    }
    
    .param-group:not(.open) .toggle::before {
      content: '▶';
    }
    
    .param-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.8125rem;
    }
    
    .param-row:last-child {
      margin-bottom: 0;
    }
    
    .param-label {
      flex: 1;
      min-width: 0;
      color: #cbd5e1;
    }
    
    .param-label .path {
      font-size: 0.6875rem;
      color: #64748b;
      font-family: monospace;
    }
    
    .param-control {
      flex: 0 0 auto;
      min-width: 120px;
    }
    
    input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    
    input[type="number"],
    input[type="text"],
    select {
      width: 100%;
      padding: 0.375rem 0.5rem;
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 4px;
      color: #e2e8f0;
      font-size: 0.8125rem;
    }
    
    input[type="number"]:focus,
    input[type="text"]:focus,
    select:focus {
      outline: none;
      border-color: #3b82f6;
    }
    
    input[type="range"] {
      width: 100%;
    }
    
    input[type="color"] {
      width: 40px;
      height: 24px;
      padding: 0;
      border: 1px solid #475569;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .mapped-static {
      border: 1px solid #475569;
      border-radius: 4px;
      padding: 0.5rem;
      margin-top: 0.5rem;
    }
    
    .mapped-static-header {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    
    .nested-params {
      padding-left: 0.75rem;
      border-left: 2px solid #475569;
      margin-left: 0.25rem;
    }
    
    .status-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1e293b;
      border-top: 1px solid #334155;
      padding: 0.5rem 1rem;
      font-size: 0.8125rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .status-message {
      color: #94a3b8;
    }
    
    .status-message.success {
      color: #4ade80;
    }
    
    .status-message.error {
      color: #f87171;
    }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
    }
    
    /* Profile management */
    .profile-section {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    
    .profile-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    
    .profile-row select {
      flex: 1;
    }
    
    /* Theme toggle */
    .theme-section {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    
    .theme-toggle {
      display: flex;
      gap: 0.5rem;
    }
    
    .theme-btn {
      flex: 1;
      padding: 0.5rem;
      border: 2px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8125rem;
      transition: all 0.2s;
    }
    
    .theme-btn.light {
      background: #f1f5f9;
      color: #1e293b;
    }
    
    .theme-btn.dark {
      background: #1e293b;
      color: #e2e8f0;
    }
    
    .theme-btn.active {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
    }
    
    .theme-label {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-bottom: 0.5rem;
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="viewer-panel">
      <div id="molstar-viewer"></div>
    </div>
    
    <div class="controls-panel">
      <h1>GeneGuessr Admin v2</h1>
      <p class="subtitle">Auto-generated from Mol* runtime state</p>
      
      <div class="theme-section">
        <span class="theme-label">Preview Theme (background/ambient only)</span>
        <div class="theme-toggle">
          <button id="theme-dark" class="theme-btn dark active">Dark Mode</button>
          <button id="theme-light" class="theme-btn light">Light Mode</button>
        </div>
      </div>
      
      <div class="profile-section">
        <div class="profile-row">
          <select id="profile-select">
            <option value="">-- Select Profile --</option>
          </select>
          <button id="load-profile" class="secondary">Load</button>
          <button id="save-profile">Save</button>
          <button id="delete-profile" class="danger">Delete</button>
        </div>
      </div>
      
      <div class="toolbar">
        <button id="apply-btn">Apply Changes</button>
        <button id="reset-btn" class="secondary">Reset to Current</button>
        <button id="export-btn" class="secondary">Export JSON</button>
      </div>
      
      <div id="params-container">
        <div class="loading">Loading Mol* viewer...</div>
      </div>
    </div>
  </div>
  
  <div class="status-bar">
    <span id="status-message" class="status-message">Ready</span>
    <span id="changes-indicator"></span>
  </div>
  
  <script src="https://cdn.jsdelivr.net/npm/pdbe-molstar@latest/build/pdbe-molstar-plugin.js"></script>
  <script>
    const API_BASE = '';
    
    let viewer = null;
    let plugin = null;
    let currentProps = null;
    let pendingProps = null;
    let profiles = {};
    let currentTheme = 'dark';
    
    // Theme-specific colors (matches game's light/dark mode)
    const THEME_COLORS = {
      dark: {
        backgroundColor: 0x1a1a2e,
        ambientColor: 0x404060
      },
      light: {
        backgroundColor: 0xf8f8f8,
        ambientColor: 0xa0a0a0
      }
    };
    
    // ============ Mol* Initialization ============
    
    async function initMolstar() {
      const viewerContainer = document.getElementById('molstar-viewer');
      
      // Use PDBeMolstarPlugin exactly like the game does
      viewer = new window.PDBeMolstarPlugin();
      
      // Render with same options as game
      viewer.render(viewerContainer, {
        hideControls: true,
        hideCanvasControls: ['expand', 'controlToggle', 'controlInfo', 'selection', 'animation', 'trajectory', 'screenshot', 'reset'],
        pdbeLink: false,
        visualStyle: 'cartoon',
        lighting: 'glossy',
        loadMaps: false,
        selectInteraction: false,
        lowPrecisionCoords: false,
        hideStructureSourceTooltip: true,
        moleculeId: '1CRN'
      });
      
      // Wait for the viewer's plugin to be ready
      await waitForPlugin();
      
      plugin = viewer.plugin;
      
      // Apply game's stylization profile after load
      applyGameStylization();
      
      // Get current props for auto-generated controls
      currentProps = getCanvasProps();
      console.log('Raw canvas3d props:', currentProps);
      
      try {
        pendingProps = deepClone(currentProps);
      } catch (e) {
        console.error('deepClone failed:', e);
        pendingProps = extractSerializableProps(currentProps);
      }
      
      // Render controls
      renderParams();
      
      // Load profiles
      await loadProfiles();
      
      setStatus('Mol* loaded with game styling. Explore and modify settings.', 'success');
    }
    
    function waitForPlugin() {
      return new Promise((resolve) => {
        const check = () => {
          if (viewer.plugin && viewer.plugin.canvas3d) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    }
    
    function applyGameStylization() {
      if (!plugin?.canvas3d) return;
      
      // Hide axes
      if (plugin.canvas3d.helper && plugin.canvas3d.helper.axes) {
        plugin.canvas3d.helper.axes.behavior.props.visible = false;
        plugin.canvas3d.commit();
      }
      
      // Apply theme colors
      const colors = THEME_COLORS[currentTheme];
      
      // Apply canvas props matching game's applyViewerStylizationProfile
      plugin.canvas3d.setProps({
        renderer: {
          backgroundColor: colors.backgroundColor,
          ambientColor: colors.ambientColor,
          ambientIntensity: 1.0,
          lightIntensity: 1.0,
          directionalLight: [1, 0.5, 0.3],
          light: [{ inclination: 180, azimuth: 0, color: 0xFFFFFF }]
        },
        postprocessing: {
          occlusion: {
            name: 'on',
            params: {
              multiScale: { name: 'on', params: { levels: [{ radius: 5, bias: 1.0 }, { radius: 20, bias: 1.0 }], blurKernelSize: 13 } },
              samples: 32,
              radius: 8,
              bias: 0.8,
              resolutionScale: 1,
              color: colors.ambientColor
            }
          },
          antialiasing: {
            name: 'fxaa',
            params: {
              edgeThresholdMin: 0.125,
              edgeThresholdMax: 0.25,
              iterations: 2,
              subpixelQuality: 0.75
            }
          },
          outline: {
            name: 'on',
            params: {
              scale: 0.5,
              threshold: 0.35,
              color: colors.backgroundColor
            }
          }
        },
        cameraFog: {
          name: 'on',
          params: {
            intensity: 0.5,
            color: colors.backgroundColor
          }
        },
        marking: {
          enabled: false,
          edgeScale: 0,
          ghostEdgeStrength: 0,
          innerEdgeFactor: 0
        }
      });
    }
    
    function getCanvasProps() {
      if (!plugin?.canvas3d) return {};
      return plugin.canvas3d.props;
    }
    
    function deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }
    
    function extractSerializableProps(obj) {
      // Fallback for when deepClone fails (circular refs, non-serializable)
      const result = {};
      try {
        for (const key of Object.keys(obj)) {
          try {
            result[key] = JSON.parse(JSON.stringify(obj[key]));
          } catch (e) {
            console.warn('Skipping non-serializable prop:', key);
          }
        }
      } catch (e) {
        console.error('extractSerializableProps failed:', e);
      }
      return result;
    }
    
    // ============ Control Generation ============
    
    function renderParams() {
      const container = document.getElementById('params-container');
      container.innerHTML = '';
      
      if (!pendingProps || Object.keys(pendingProps).length === 0) {
        container.innerHTML = '<div class="loading">No props available</div>';
        return;
      }
      
      // Render each top-level section
      for (const [key, value] of Object.entries(pendingProps)) {
        const group = renderParamGroup(key, value, [key]);
        if (group) container.appendChild(group);
      }
    }
    
    function renderParamGroup(name, value, path) {
      if (value === null || value === undefined) return null;
      
      const type = typeof value;
      
      // Objects get collapsible groups
      if (type === 'object' && !Array.isArray(value)) {
        // Check if it's a MappedStatic pattern: { name: string, params: {} }
        if ('name' in value && 'params' in value && Object.keys(value).length === 2) {
          return renderMappedStatic(name, value, path);
        }
        
        const group = document.createElement('div');
        group.className = 'param-group';
        
        const header = document.createElement('div');
        header.className = 'param-group-header';
        header.innerHTML = \`<span>\${formatName(name)}</span><span class="toggle"></span>\`;
        header.onclick = () => group.classList.toggle('open');
        
        const content = document.createElement('div');
        content.className = 'param-group-content';
        
        for (const [k, v] of Object.entries(value)) {
          const childPath = [...path, k];
          const childEl = renderParam(k, v, childPath);
          if (childEl) content.appendChild(childEl);
        }
        
        if (content.children.length === 0) return null;
        
        group.appendChild(header);
        group.appendChild(content);
        return group;
      }
      
      // Arrays
      if (Array.isArray(value)) {
        return renderArray(name, value, path);
      }
      
      // Primitives get direct controls
      return renderParam(name, value, path);
    }
    
    function renderParam(name, value, path) {
      const type = typeof value;
      const row = document.createElement('div');
      row.className = 'param-row';
      
      const label = document.createElement('div');
      label.className = 'param-label';
      label.innerHTML = \`\${formatName(name)}<br><span class="path">\${path.join('.')}</span>\`;
      
      const control = document.createElement('div');
      control.className = 'param-control';
      
      if (type === 'boolean') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value;
        input.onchange = () => setValueAtPath(path, input.checked);
        control.appendChild(input);
      } else if (type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = value;
        input.step = inferStep(value);
        input.onchange = () => setValueAtPath(path, parseFloat(input.value));
        control.appendChild(input);
      } else if (type === 'string') {
        // Check if it looks like a color
        if (/^#[0-9a-fA-F]{6}$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value)) {
          const input = document.createElement('input');
          input.type = 'color';
          input.value = normalizeColor(value);
          input.onchange = () => setValueAtPath(path, hexToMolstarColor(input.value));
          control.appendChild(input);
        } else {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = value;
          input.onchange = () => setValueAtPath(path, input.value);
          control.appendChild(input);
        }
      } else if (type === 'object') {
        // Nested object - recurse
        const nested = renderParamGroup(name, value, path);
        if (nested) return nested;
        return null;
      } else {
        // Unknown type - show as text
        control.textContent = String(value);
      }
      
      row.appendChild(label);
      row.appendChild(control);
      return row;
    }
    
    function renderMappedStatic(name, value, path) {
      const container = document.createElement('div');
      container.className = 'param-group open';
      
      const header = document.createElement('div');
      header.className = 'param-group-header';
      header.innerHTML = \`<span>\${formatName(name)}</span><span class="toggle"></span>\`;
      header.onclick = () => container.classList.toggle('open');
      
      const content = document.createElement('div');
      content.className = 'param-group-content';
      
      // Mode selector
      const modeRow = document.createElement('div');
      modeRow.className = 'param-row';
      
      const modeLabel = document.createElement('div');
      modeLabel.className = 'param-label';
      modeLabel.textContent = 'Mode';
      
      const modeControl = document.createElement('div');
      modeControl.className = 'param-control';
      
      const select = document.createElement('select');
      // Common patterns - try to infer options
      const commonOptions = ['on', 'off', 'fxaa', 'smaa', 'perspective', 'orthographic'];
      const currentValue = value.name;
      
      // Add current value if not in common options
      const options = commonOptions.includes(currentValue) 
        ? commonOptions.filter(o => o === currentValue || o === 'on' || o === 'off')
        : [currentValue, 'on', 'off'];
      
      [...new Set(options)].forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        option.selected = opt === currentValue;
        select.appendChild(option);
      });
      
      select.onchange = () => {
        setValueAtPath([...path, 'name'], select.value);
        renderParams(); // Re-render to show/hide params
      };
      
      modeControl.appendChild(select);
      modeRow.appendChild(modeLabel);
      modeRow.appendChild(modeControl);
      content.appendChild(modeRow);
      
      // Nested params (if mode is 'on' or similar active state)
      if (value.name !== 'off' && Object.keys(value.params).length > 0) {
        const nested = document.createElement('div');
        nested.className = 'nested-params';
        
        for (const [k, v] of Object.entries(value.params)) {
          const childPath = [...path, 'params', k];
          const childEl = renderParam(k, v, childPath);
          if (childEl) nested.appendChild(childEl);
        }
        
        content.appendChild(nested);
      }
      
      container.appendChild(header);
      container.appendChild(content);
      return container;
    }
    
    function renderArray(name, value, path) {
      const group = document.createElement('div');
      group.className = 'param-group';
      
      const header = document.createElement('div');
      header.className = 'param-group-header';
      header.innerHTML = \`<span>\${formatName(name)} [\${value.length}]</span><span class="toggle"></span>\`;
      header.onclick = () => group.classList.toggle('open');
      
      const content = document.createElement('div');
      content.className = 'param-group-content';
      
      value.forEach((item, idx) => {
        const childPath = [...path, idx];
        if (typeof item === 'object') {
          const itemGroup = renderParamGroup(\`[\${idx}]\`, item, childPath);
          if (itemGroup) content.appendChild(itemGroup);
        } else {
          const childEl = renderParam(\`[\${idx}]\`, item, childPath);
          if (childEl) content.appendChild(childEl);
        }
      });
      
      group.appendChild(header);
      group.appendChild(content);
      return group;
    }
    
    // ============ Helpers ============
    
    function formatName(name) {
      return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim();
    }
    
    function inferStep(value) {
      if (!Number.isFinite(value)) return 1;
      if (Number.isInteger(value)) return 1;
      if (Math.abs(value) < 1) return 0.01;
      if (Math.abs(value) < 10) return 0.1;
      return 1;
    }
    
    function normalizeColor(value) {
      if (typeof value === 'number') {
        return '#' + value.toString(16).padStart(6, '0');
      }
      if (typeof value === 'string' && value.startsWith('0x')) {
        return '#' + value.slice(2).padStart(6, '0');
      }
      return value;
    }
    
    function hexToMolstarColor(hex) {
      // Mol* uses numbers for colors
      return parseInt(hex.slice(1), 16);
    }
    
    function setValueAtPath(path, value) {
      let obj = pendingProps;
      for (let i = 0; i < path.length - 1; i++) {
        obj = obj[path[i]];
      }
      obj[path[path.length - 1]] = value;
      updateChangesIndicator();
    }
    
    function getValueAtPath(path) {
      let obj = pendingProps;
      for (const key of path) {
        if (obj === undefined) return undefined;
        obj = obj[key];
      }
      return obj;
    }
    
    function updateChangesIndicator() {
      const indicator = document.getElementById('changes-indicator');
      const hasChanges = JSON.stringify(pendingProps) !== JSON.stringify(currentProps);
      indicator.textContent = hasChanges ? '● Unsaved changes' : '';
      indicator.style.color = hasChanges ? '#fbbf24' : '#94a3b8';
    }
    
    function setStatus(message, type = '') {
      const el = document.getElementById('status-message');
      el.textContent = message;
      el.className = 'status-message ' + type;
    }
    
    // ============ Actions ============
    
    function applyChanges() {
      if (!plugin?.canvas3d) {
        setStatus('Viewer not ready', 'error');
        return;
      }
      
      try {
        plugin.canvas3d.setProps(pendingProps);
        currentProps = deepClone(pendingProps);
        updateChangesIndicator();
        setStatus('Applied changes', 'success');
      } catch (err) {
        console.error('Apply failed:', err);
        setStatus('Apply failed: ' + err.message, 'error');
      }
    }
    
    function resetToCurrentProps() {
      pendingProps = deepClone(currentProps);
      renderParams();
      updateChangesIndicator();
      setStatus('Reset to current state');
    }
    
    function exportJSON() {
      const json = JSON.stringify(pendingProps, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'molstar-props.json';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Exported JSON');
    }
    
    // ============ Profile Management ============
    
    async function loadProfiles() {
      try {
        const resp = await fetch(API_BASE + '/api/admin/graphics-profiles', {
          credentials: 'include'
        });
        if (resp.ok) {
          const data = await resp.json();
          profiles = data.profiles || {};
          updateProfileSelect();
        }
      } catch (err) {
        console.warn('Failed to load profiles:', err);
      }
    }
    
    function updateProfileSelect() {
      const select = document.getElementById('profile-select');
      select.innerHTML = '<option value="">-- Select Profile --</option>';
      
      for (const name of Object.keys(profiles)) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      }
    }
    
    async function loadSelectedProfile() {
      const select = document.getElementById('profile-select');
      const name = select.value;
      if (!name || !profiles[name]) return;
      
      pendingProps = deepClone(profiles[name]);
      renderParams();
      updateChangesIndicator();
      setStatus('Loaded profile: ' + name);
    }
    
    async function saveProfile() {
      const name = prompt('Profile name:');
      if (!name) return;
      
      profiles[name] = deepClone(pendingProps);
      
      try {
        await fetch(API_BASE + '/api/admin/graphics-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ profiles })
        });
        
        updateProfileSelect();
        document.getElementById('profile-select').value = name;
        setStatus('Saved profile: ' + name, 'success');
      } catch (err) {
        console.error('Save failed:', err);
        setStatus('Save failed: ' + err.message, 'error');
      }
    }
    
    async function deleteSelectedProfile() {
      const select = document.getElementById('profile-select');
      const name = select.value;
      if (!name) return;
      if (!confirm('Delete profile "' + name + '"?')) return;
      
      delete profiles[name];
      
      try {
        await fetch(API_BASE + '/api/admin/graphics-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ profiles })
        });
        
        updateProfileSelect();
        setStatus('Deleted profile: ' + name);
      } catch (err) {
        console.error('Delete failed:', err);
        setStatus('Delete failed: ' + err.message, 'error');
      }
    }
    
    // ============ Theme Toggle ============
    
    function setTheme(theme) {
      currentTheme = theme;
      
      // Update UI
      document.getElementById('theme-dark').classList.toggle('active', theme === 'dark');
      document.getElementById('theme-light').classList.toggle('active', theme === 'light');
      
      // Apply theme colors to viewer
      if (plugin?.canvas3d) {
        const colors = THEME_COLORS[theme];
        plugin.canvas3d.setProps({
          renderer: {
            backgroundColor: colors.backgroundColor,
            ambientColor: colors.ambientColor
          },
          postprocessing: {
            occlusion: {
              name: 'on',
              params: { color: colors.ambientColor }
            },
            outline: {
              name: 'on',
              params: { color: colors.backgroundColor }
            }
          },
          cameraFog: {
            name: 'on',
            params: { color: colors.backgroundColor }
          }
        });
        
        // Update pendingProps with new theme colors
        if (pendingProps?.renderer) {
          pendingProps.renderer.backgroundColor = colors.backgroundColor;
          pendingProps.renderer.ambientColor = colors.ambientColor;
        }
        
        renderParams();
        setStatus('Switched to ' + theme + ' theme preview', 'success');
      }
    }
    
    // ============ Event Bindings ============
    
    document.getElementById('apply-btn').onclick = applyChanges;
    document.getElementById('reset-btn').onclick = resetToCurrentProps;
    document.getElementById('export-btn').onclick = exportJSON;
    document.getElementById('load-profile').onclick = loadSelectedProfile;
    document.getElementById('save-profile').onclick = saveProfile;
    document.getElementById('delete-profile').onclick = deleteSelectedProfile;
    document.getElementById('theme-dark').onclick = () => setTheme('dark');
    document.getElementById('theme-light').onclick = () => setTheme('light');
    
    // Initialize
    initMolstar().catch(err => {
      console.error('Init failed:', err);
      document.getElementById('params-container').innerHTML = 
        '<div class="loading" style="color: #f87171;">Failed to load: ' + err.message + '</div>';
    });
  </script>
</body>
</html>`;
