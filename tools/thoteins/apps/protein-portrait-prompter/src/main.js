import {
  DEFAULT_TEMPLATE,
  renderTemplate,
  shortStats,
  classifyCategory,
  renderTemplateWithOverrides,
} from './logic.js';
import { initGallery } from './gallery.js';

const state = { proteins: [], filtered: [], selected: new Set(), results: [], mapping: null, mappingPath: null, writer: { url: 'http://127.0.0.1:8787', healthy: false } };
const el = (id) => document.getElementById(id);
const hide = (node) => { if (node && node.style) { node.style.display = 'none'; } };

// API-based mapping function - calls backend instead of local JS logic
async function applyMappingAPI(mapping, protein) {
  try {
    const response = await fetch(`${state.writer.url}/apply-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protein, mapping })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }

    return { overrides: result.mapped || {}, trace: [] };
  } catch (error) {
    console.warn('Mapping API failed:', error.message);
    return { overrides: {}, trace: [`API Error: ${error.message}`] };
  }
}

// Initialize default template
el('template').value = DEFAULT_TEMPLATE;

function refreshTable(){
  const tbody = document.querySelector('#table tbody');
  tbody.innerHTML = '';
  const query = el('filter').value.trim().toLowerCase();
  state.filtered = state.proteins.filter(p => {
    if (!query) return true;
    return (p.uniprot_id||'').toLowerCase().includes(query) || (p.symbol||'').toLowerCase().includes(query);
  });
  for (const p of state.filtered){
    const tr = document.createElement('tr');
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = state.selected.has(p.uniprot_id);
    chk.addEventListener('change', () => { if (chk.checked) state.selected.add(p.uniprot_id); else state.selected.delete(p.uniprot_id); });
    const td0 = document.createElement('td'); td0.appendChild(chk);
    const td1 = document.createElement('td'); td1.textContent = p.uniprot_id || '';
    const td2 = document.createElement('td'); td2.textContent = p.symbol || '';
    const td3 = document.createElement('td'); td3.textContent = p.title || '';
    const td4 = document.createElement('td'); td4.textContent = p.mass || '';
    const td5 = document.createElement('td'); td5.textContent = p.length || '';
    const td6 = document.createElement('td'); td6.textContent = (p.mobidb_percent_disordered ?? '') === '' ? '' : (p.mobidb_percent_disordered ?? '');
    tr.append(td0, td1, td2, td3, td4, td5, td6);
    tbody.appendChild(tr);
  }
  el('count').textContent = String(state.proteins.length);
}

function addProteins(list){
  for (const p of list){ if (p && p.uniprot_id){ state.proteins.push(p); } }
  const map = new Map();
  for (const p of state.proteins){ map.set(p.uniprot_id, p); }
  state.proteins = Array.from(map.values());
  refreshTable();
}

function refreshClassSummary(){
  if (!state.proteins.length){ el('class-summary').textContent = 'No proteins loaded.'; return; }
  const counts = { indoors:0, outer:0, both:0, outdoors:0 };
  for (const p of state.proteins){ counts[classifyCategory(p)]++; }
  el('class-summary').textContent = `Classified: indoors ${counts.indoors}, outer space ${counts.outer}, both ${counts.both}, outdoors ${counts.outdoors}`;
}

function setMappingStatus(text, good=false){
  const ms = el('mapping-status');
  if (!ms) return;
  ms.textContent = text;
  ms.style.borderColor = good ? 'var(--accent)' : 'var(--ui-border)';
}

async function tryLoadMapping(){
  const candidates = ['../../data/mapping.json', './mapping.json'];
  for (const path of candidates){
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) continue;
      const obj = await r.json();
      if (obj && Array.isArray(obj.mappings)){
        state.mapping = obj; state.mappingPath = path;
        setMappingStatus(`Mapping: loaded ${obj.mappings.length} rule(s)`, true);
        return true;
      }
    } catch (_) {
      // ignore and try next candidate
    }
  }
  state.mapping = null; state.mappingPath = null;
  setMappingStatus('Mapping: not loaded');
  return false;
}

function setWriterStatus(text, good=false){
  const ws = el('writer-status');
  if (!ws) return;
  const ascii = String(text).replace(/[^\x00-\x7F]/g, '');
  ws.textContent = ascii;
  ws.style.borderColor = good ? 'var(--accent)' : 'var(--ui-border)';
}

function setUpdateStatus(text, good=false){
  const us = el('update-status');
  if (!us) return;
  const ascii = String(text).replace(/[^\x00-\x7F]/g, '');
  us.textContent = ascii;
  us.style.borderColor = good ? 'var(--accent)' : 'var(--ui-border)';
}

async function checkWriter(){
  try {
    const r = await fetch(`${state.writer.url}/health`, { cache: 'no-store' });
    if (!r.ok) throw new Error('not ok');
    const obj = await r.json();
    state.writer.healthy = obj?.status === 'ok';
    if (state.writer.healthy){ setWriterStatus('Writer: connected', true); return true; }
  } catch { /* fall through */ }
  state.writer.healthy = false; setWriterStatus('Writer: not connected'); return false; 
} 
 
// Persona data support - load from backend API only
state.personaById = new Map();

async function tryLoadPersona(){
  if (!state.writer.healthy){
    throw new Error('Backend not connected - cannot load persona data');
  }

  const r = await fetch(`${state.writer.url}/api/persona`, { cache: 'no-store' });
  if (!r.ok) {
    throw new Error(`Failed to load persona: HTTP ${r.status}`);
  }

  const data = await r.json();
  if (data.error) {
    throw new Error(`Persona error: ${data.error}`);
  }

  // data is {"P00533": {"trait": "value"}, ...}
  state.personaById = new Map(Object.entries(data));
  return true;
}

async function saveToLocalIfPossible(p){ 
  if (!state.writer.healthy) return false;
  try {
    const payload = p?.raw_uniprot || p;
    const r = await fetch(`${state.writer.url}/put/${encodeURIComponent(p.uniprot_id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store'
    });
    if (!r.ok) throw new Error('save failed');
    setWriterStatus(p?.raw_uniprot ? 'Writer: saved full ✓' : 'Writer: saved ✓', true);
    return true;
  } catch {
    setWriterStatus('Writer: save failed');
    return false;
  }
}

// File handling - upload to backend for parsing
async function handleFiles(files){
  if (!state.writer.healthy){
    alert('Backend not connected. Start the writer server first.');
    return;
  }

  // Upload each file to backend for parsing
  for (const file of files){
    try {
      // Read file content as text
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });

      // Send as JSON to backend
      const response = await fetch(`${state.writer.url}/upload-proteins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      // Add proteins returned from backend
      if (result.proteins && result.proteins.length > 0) {
        addProteins(result.proteins);
      }
    } catch (e) {
      alert(`Failed to load ${file.name}: ${e.message}`);
    }
  }

  refreshClassSummary();
}

// Drag & drop
const drop = el('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); const files = e.dataTransfer.files; if (files && files.length) handleFiles(files); });
drop.addEventListener('click', () => el('file-input').click());

el('file-input').addEventListener('change', e => { const files = e.target.files; if (files && files.length) handleFiles(files); });

async function generateSelection(){ 
  const tpl = el('template').value; 
  const addStats = el('include-stats').checked; 
  const chosen = state.proteins.filter(p => state.selected.has(p.uniprot_id)); 
  const lines = []; 
  state.results = []; 
  try { await tryLoadPersona(); } catch {}
  for (const p of chosen){ 
    let overrides = {}; 
    let trace = []; 
    const saved = state.personaById.get(p.uniprot_id);
    if (saved && Object.keys(saved).length){
      overrides = saved;
    } else if (state.mapping){
      try { const res = await applyMappingAPI(state.mapping, p); overrides = res.overrides || {}; trace = res.trace || []; } catch {}
    } 
    const prompt = renderTemplateWithOverrides(tpl, p, overrides); 
    // Build mapping details text for the GUI 
    let details = ''; 
    if (!saved && state.mapping){ 
      if (trace.length){ 
        const lines2 = ['\nMappings:']; 
        for (const t of trace){ 
          if (t.type === 'numeric'){
            const raw = (t.raw_value ?? '').toString();
            const base = t.used_log ? `log10(${raw})=${(t.base_value ?? '').toString()}` : raw;
            lines2.push(`- ${t.source}=${base} * ${t.multiplier} -> ${t.target}=${t.result}`);
          } else if (t.type === 'categorical'){
            const matched = t.matched_token ? `matched "${t.matched_token}"` : 'no exact token matched';
            lines2.push(`- ${t.source} ${matched} -> ${t.target}="${t.result}"`);
          }
        }
        details = lines2.join('\n');
      } else {
        details = '\nMappings: none matched';
      }
    }
    const stats = addStats ? `\nStats: ${shortStats(p)}` : '';
    const out = `# ${p.symbol || p.title || p.uniprot_id}\n${prompt}${details}${stats}`;
    state.results.push({ uniprot_id: p.uniprot_id, symbol: p.symbol, title: p.title, prompt: prompt + stats });
    lines.push(out);
  }
  el('results').textContent = lines.length ? lines.join('\n\n') : 'No selection.';
}

el('btn-single-fetch').addEventListener('click', async () => {
  const id = (el('single-id').value || '').trim().toUpperCase();
  const pat = /^[A-Z0-9]{6,10}(-\d+)?$/i;
  if (!pat.test(id)){ alert('Please enter a valid UniProt ID (6–10 chars), e.g., P04637 or A0A024RBG1.'); return; }

  if (!state.writer.healthy){
    alert('Backend not connected. Start the writer server first.');
    return;
  }

  el('btn-single-fetch').disabled = true;
  el('btn-single-fetch').textContent = 'Fetching...';

  try {
    // Use backend to fetch all data sources
    const response = await fetch(`${state.writer.url}/refresh-proteins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uniprot_ids: [id] })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }

    if (!result.proteins || result.proteins.length === 0) {
      throw new Error('No protein data returned from backend');
    }

    // Add the fetched protein to state
    addProteins(result.proteins);
    state.selected = new Set([id]);
    await generateSelection();
    refreshClassSummary();
  } catch (e){
    alert('Fetch failed: ' + (e?.message || e));
  } finally {
    el('btn-single-fetch').disabled = false;
    el('btn-single-fetch').textContent = 'Fetch & Generate';
  }
});

document.getElementById('btn-generate').addEventListener('click', generateSelection);
el('filter').addEventListener('input', refreshTable);
el('select-all').addEventListener('change', () => {
  if (el('select-all').checked){ for (const p of state.filtered){ state.selected.add(p.uniprot_id); } }
  else { for (const p of state.filtered){ state.selected.delete(p.uniprot_id); } }
  refreshTable();
});

el('btn-copy').addEventListener('click', async () => {
  const txt = el('results').textContent || '';
  try { await navigator.clipboard.writeText(txt); alert('Copied to clipboard'); } catch { alert('Copy failed'); }
});

el('btn-export-csv').addEventListener('click', () => {
  if (!state.results.length){ alert('No results to export'); return; }
  const escape = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['uniprot_id','symbol','title','prompt']].concat(state.results.map(r => [r.uniprot_id, r.symbol||'', r.title||'', r.prompt]));
  const csv = rows.map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'protein_prompts.csv'; a.click(); URL.revokeObjectURL(url);
});

// Mapping init and reload control
(async () => { await tryLoadMapping(); })(); 
const btnReload = document.getElementById('btn-load-mapping'); 
if (btnReload){ btnReload.addEventListener('click', async () => { await tryLoadMapping(); }); } 

// Writer init and retry control 
(async () => { await checkWriter(); })(); 
// Auto-check writer every 15s to avoid a manual reconnect button
setInterval(checkWriter, 15000);

// Persona CSV init
(async () => { await tryLoadPersona(); })(); 

// Attempt graceful shutdown of local writer when user closes the tab/window
function requestShutdown(){
  if (!state.writer?.healthy) return;
  try { navigator.sendBeacon?.(`${state.writer.url}/shutdown`, new Blob([])); } catch {}
  try { fetch(`${state.writer.url}/shutdown`, { method: 'POST', keepalive: true }); } catch {}
  try { const img = new Image(); img.src = `${state.writer.url}/shutdown?t=${Date.now()}`; } catch {}
}
window.addEventListener('beforeunload', requestShutdown);
window.addEventListener('pagehide', requestShutdown);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') requestShutdown(); });

// Unified Update All - uses backend /refresh-proteins endpoint
const btnUpdateAll = document.getElementById('btn-update-all');
const btnGenerateAll = document.getElementById('btn-generate-all');
if (btnUpdateAll){
  btnUpdateAll.addEventListener('click', async () => {
    const list = state.proteins.slice();
    if (!list.length){ setUpdateStatus('Update: no proteins'); return; }

    if (!state.writer.healthy){
      setUpdateStatus('Update: writer not connected');
      return;
    }

    btnUpdateAll.disabled = true;
    setUpdateStatus(`Update: fetching data for ${list.length} proteins... (this may take several minutes)`);

    try {
      // Call unified backend endpoint - backend decides what sources to fetch
      const uniprot_ids = list.map(p => p.uniprot_id);
      const response = await fetch(`${state.writer.url}/refresh-proteins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniprot_ids }),
        signal: AbortSignal.timeout(600000)  // 10 minute timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      // Update status with details - show whatever sources the backend fetched
      const d = result.details || {};
      const sourceCounts = Object.entries(d).map(([k, v]) => `${k}:${v}`).join(' ');
      setUpdateStatus(`Updated ${sourceCounts} (skipped ${result.skipped || 0})`, true);

      // Refresh table to show any updated data
      refreshTable();
    } catch (error) {
      setUpdateStatus(`Update failed: ${error.message}`);
    } finally {
      btnUpdateAll.disabled = false;
    }
  });
}

if (btnGenerateAll){
  btnGenerateAll.addEventListener('click', async () => {
    // select all loaded proteins
    state.selected = new Set(state.proteins.map(p => p.uniprot_id));
    refreshTable();
    await generateSelection();
  });
}

// Hide advanced/legacy controls to streamline UX
hide(el('btn-single-fetch'));
hide(document.getElementById('btn-load-mapping'));
hide(document.getElementById('btn-retry-writer'));
hide(document.getElementById('btn-generate'));
hide(el('btn-copy'));

// Initialize card gallery on page load
(async () => {
  await initGallery();
})();
