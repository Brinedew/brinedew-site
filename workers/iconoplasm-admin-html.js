export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Admin</title>
  <style>
    :root {
      --bg: #0b1220;
      --surface: #111a2b;
      --surface-2: #0d1626;
      --line: #26354d;
      --text: #e8edf6;
      --muted: #9eb0cf;
      --accent: #2d6bff;
      --warn: #e8a63f;
      --danger: #ef5d5d;
      --ok: #4fcf83;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at 0% 0%, #0f1d38, #0b1220 55%);
      color: var(--text);
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    .wrap {
      max-width: 1320px;
      margin: 0 auto;
      padding: 22px;
      display: grid;
      gap: 14px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(20, 33, 56, 0.86), rgba(13, 22, 38, 0.96));
      padding: 14px;
    }

    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; }
    h2 { font-size: 20px; }
    h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    p { color: var(--muted); }

    .hero {
      display: grid;
      gap: 8px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(140deg, rgba(45, 107, 255, 0.08), rgba(17, 26, 43, 0.8));
    }

    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
    }

    .step {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface-2);
      padding: 10px;
      display: grid;
      gap: 6px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 12px;
      color: var(--muted);
      background: rgba(0, 0, 0, 0.15);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
    }

    .controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      align-items: end;
      margin-top: 10px;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    input, select, button {
      font: inherit;
      color: var(--text);
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--surface-2);
      padding: 9px 10px;
    }

    button { cursor: pointer; }
    button:hover { border-color: #3b5176; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-primary { background: var(--accent); border-color: #4b7fff; }
    .btn-warn { background: #92682a; border-color: #b58639; }
    .btn-danger { background: #9a3535; border-color: #bc4343; }
    .btn-flat { background: transparent; }

    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .table-wrap {
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: auto;
      background: rgba(8, 14, 24, 0.6);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 980px;
    }

    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px;
      font-size: 12px;
      text-align: left;
      vertical-align: top;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #0e1a2f;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }

    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .sha { word-break: break-all; font-size: 11px; }

    .status {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 2px 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 11px;
    }
    .status-draft { color: #8cb4ff; }
    .status-approved { color: #8ee5af; }
    .status-rejected { color: #f6a7a7; }

    .flag {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 2px 8px;
      letter-spacing: 0.05em;
      font-size: 11px;
      margin-right: 6px;
      margin-bottom: 4px;
    }
    .flag-stale { color: #ffd280; }
    .flag-legacy { color: #9ed0ff; }
    .flag-current { color: #8ee5af; }
    .flag-leader { color: #ffd166; }
    .flag-override { color: #ff8dc7; }

    .thumbs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .thumbs a {
      display: inline-flex;
      width: 46px;
      height: 46px;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
      background: #0a1322;
    }
    .thumbs img {
      width: 46px;
      height: 46px;
      object-fit: cover;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .actions button {
      padding: 4px 8px;
      font-size: 11px;
    }

    .log {
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(8, 14, 24, 0.7);
      padding: 10px;
      min-height: 120px;
      max-height: 340px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 12px;
      color: #d6e0f1;
    }

    details summary {
      cursor: pointer;
      color: var(--warn);
      font-weight: 600;
      margin-bottom: 8px;
    }

    .small { font-size: 12px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Iconoplasm Admin</h1>
      <p>Local NiceGUI still owns generation. This page owns live-site canon and publish governance.</p>
      <div class="steps">
        <article class="step">
          <div class="badge"><span class="dot"></span>1. Curate locally</div>
          <p class="small">Delete bad images in NiceGUI. Keep the ones you want to remain in circulation.</p>
        </article>
        <article class="step">
          <div class="badge"><span class="dot"></span>2. Click Sync to Website</div>
          <p class="small">NiceGUI uploads all non-deleted local images. Locally cleared stale images stay here as stale legacy candidates until an admin unstales or purges them.</p>
        </article>
        <article class="step">
          <div class="badge"><span class="dot"></span>3. Govern live canon here</div>
          <p class="small">See what is live, what voting wants to promote, and whether admin override is locking canon.</p>
        </article>
      </div>
    </section>

    <section class="card">
      <h2>Website Portrait Inventory</h2>
      <p>The table shows live canon state, vote pressure, and whether admin override is active.</p>

      <div class="controls">
        <label>Show
          <select id="assets-status">
            <option value="all" selected>all candidates</option>
            <option value="approved">currently live</option>
            <option value="draft">draft (awaiting publish)</option>
            <option value="rejected">rejected</option>
          </select>
        </label>
        <label>Stale
          <select id="assets-stale">
            <option value="all" selected>all</option>
            <option value="yes">stale only</option>
            <option value="no">not stale</option>
          </select>
        </label>
        <label>Legacy
          <select id="assets-legacy">
            <option value="all" selected>all</option>
            <option value="yes">legacy only</option>
            <option value="no">not legacy</option>
          </select>
        </label>
        <label>Limit
          <input id="assets-limit" type="number" min="1" max="250" value="120" />
        </label>
        <label>Filter by gene
          <input id="assets-search" type="text" placeholder="TP53" />
        </label>
        <label>Admin token (optional)
          <input id="admin-token" type="password" placeholder="Only needed if no session cookie" />
        </label>
        <button class="btn-primary" id="assets-refresh">Refresh</button>
      </div>

      <div class="stats" id="assets-meta">Not loaded.</div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gene</th>
              <th>Asset SHA256</th>
              <th>Status</th>
              <th>Canon</th>
              <th>Flags</th>
              <th>Artist</th>
              <th>Votes</th>
              <th>Preview</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="assets-body"></tbody>
        </table>
      </div>

      <details>
        <summary>Action audit reason</summary>
        <div class="controls">
          <label>Reason for audit log
            <input id="action-reason" type="text" placeholder="Why this emergency change is needed" />
          </label>
        </div>
      </details>

      <pre class="log" id="action-log">No actions yet.</pre>
    </section>
  </div>

  <script>
    (function () {
      var API_BASE = '/api/iconoplasm/admin';
      var state = { assets: [] };

      var els = {
        status: document.getElementById('assets-status'),
        stale: document.getElementById('assets-stale'),
        legacy: document.getElementById('assets-legacy'),
        limit: document.getElementById('assets-limit'),
        search: document.getElementById('assets-search'),
        token: document.getElementById('admin-token'),
        refresh: document.getElementById('assets-refresh'),
        meta: document.getElementById('assets-meta'),
        body: document.getElementById('assets-body'),
        actionReason: document.getElementById('action-reason'),
        actionLog: document.getElementById('action-log')
      };

      function esc(v) {
        return String(v == null ? '' : v)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function shortSha(sha) {
        var s = String(sha || '');
        if (s.length <= 20) return s;
        return s.slice(0, 10) + '...' + s.slice(-8);
      }

      function statusPill(status) {
        var s = String(status || 'unknown').toLowerCase();
        return '<span class="status status-' + esc(s) + '">' + esc(s) + '</span>';
      }

      function previewCell(asset) {
        function thumb(url, label) {
          if (!url) return '';
          var safe = esc(url);
          return '<a href="' + safe + '" target="_blank" rel="noreferrer" title="' + esc(label) + '"><img src="' + safe + '" alt="' + esc(label) + '" loading="lazy" /></a>';
        }
        var html = [
          thumb(asset.hero_url, 'full'),
          thumb(asset.medium_url, 'medium'),
          thumb(asset.thumb_url, 'thumb')
        ].filter(Boolean).join('');
        return html ? '<div class="thumbs">' + html + '</div>' : '<span class="small">No image</span>';
      }

      function flagsCell(asset) {
        var out = [];
        if (asset.is_stale) out.push('<span class="flag flag-stale">stale</span>');
        if (asset.is_legacy) out.push('<span class="flag flag-legacy">legacy</span>');
        return out.length ? out.join('') : '<span class="small">normal</span>';
      }

      function canonCell(asset) {
        var out = [];
        if (asset.is_current) out.push('<span class="flag flag-current">live canon</span>');
        if (asset.is_vote_leader) out.push('<span class="flag flag-leader">vote leader</span>');
        if (asset.is_current && asset.admin_override) out.push('<span class="flag flag-override">admin override</span>');
        return out.length ? out.join('') : '<span class="small">candidate</span>';
      }

      function votesCell(asset) {
        return [
          '<div><strong>' + esc(String(asset.image_score || 0)) + '</strong> score</div>',
          '<div class="small">+' + esc(String(asset.image_upvotes || 0)) + ' / -' + esc(String(asset.image_downvotes || 0)) + '</div>'
        ].join('');
      }

      function authHeaders() {
        var out = {};
        var token = String(els.token.value || '').trim();
        if (token) out['X-Iconoplasm-Admin-Token'] = token;
        return out;
      }

      async function apiJson(path, options) {
        var opts = options || {};
        var headers = Object.assign({}, opts.headers || {}, authHeaders());
        var resp = await fetch(API_BASE + path, Object.assign({}, opts, { headers: headers, credentials: 'include' }));
        var text = await resp.text();
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
        if (!resp.ok) {
          var err = new Error('HTTP ' + resp.status);
          err.response = data;
          throw err;
        }
        return data;
      }

      function setLog(v) {
        els.actionLog.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      }

      function filteredAssets() {
        var q = String(els.search.value || '').trim().toUpperCase();
        if (!q) return state.assets.slice();
        return state.assets.filter(function (a) {
          return String(a.gene_symbol || '').toUpperCase().includes(q);
        });
      }

      function renderTable() {
        var assets = filteredAssets();
        els.body.innerHTML = assets.map(function (a) {
          var artistBits = [];
          if (a.artist_tag) artistBits.push('<div><strong>' + esc(a.artist_tag) + '</strong></div>');
          if (a.artist_name) artistBits.push('<div class="small">' + esc(a.artist_name) + '</div>');
          if (a.vision_id) artistBits.push('<div class="small mono">' + esc(a.vision_id) + '</div>');
          return [
            '<tr>',
            '<td><strong>' + esc(a.gene_symbol || '') + '</strong></td>',
            '<td class="mono sha" title="' + esc(a.asset_sha256 || '') + '">' + esc(shortSha(a.asset_sha256 || '')) + '</td>',
            '<td>' + statusPill(a.status) + '</td>',
            '<td>' + canonCell(a) + '</td>',
            '<td>' + flagsCell(a) + '</td>',
            '<td>' + (artistBits.join('') || '<span class="small">-</span>') + '</td>',
            '<td>' + votesCell(a) + '</td>',
            '<td>' + previewCell(a) + '</td>',
            '<td><div>' + esc(a.created_at || '-') + '</div><div class="small">' + esc(a.created_by || '-') + '</div></td>',
            '<td>',
            '<div class="actions">',
            '<button class="btn-flat" data-action="copy" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Copy SHA</button>',
            '<button class="btn-primary" data-action="publish" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Set live canon</button>',
            ((a.is_current && a.admin_override)
              ? '<button class="btn-flat" data-action="clear-override" data-symbol="' + esc(a.gene_symbol || '') + '">Return to auto</button>'
              : ''),
            ((a.is_stale || a.is_legacy)
              ? '<button class="btn-primary" data-action="unstale" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Unstale</button>'
              : ''),
            (a.is_legacy
              ? '<button class="btn-danger" data-action="purge-legacy" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Purge legacy</button>'
              : ''),
            '<button class="btn-warn" data-action="rollback" data-symbol="' + esc(a.gene_symbol || '') + '">Rollback gene</button>',
            '<button class="btn-flat" data-action="unpublish" data-symbol="' + esc(a.gene_symbol || '') + '">Unpublish gene</button>',
            '<button class="btn-danger" data-action="reject" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Reject image</button>',
            '</div>',
            '</td>',
            '</tr>'
          ].join('');
        }).join('');
      }

      async function refreshAssets() {
        try {
          els.refresh.disabled = true;
          els.meta.textContent = 'Loading...';
          var status = encodeURIComponent(String(els.status.value || 'all').toLowerCase());
          var stale = encodeURIComponent(String(els.stale.value || 'all').toLowerCase());
          var legacy = encodeURIComponent(String(els.legacy.value || 'all').toLowerCase());
          var limit = Math.max(1, Math.min(250, Number.parseInt(els.limit.value || '120', 10) || 120));
          var data = await apiJson('/assets?status=' + status + '&stale=' + stale + '&legacy=' + legacy + '&limit=' + limit, { method: 'GET' });
          state.assets = Array.isArray(data.assets) ? data.assets : [];

          var counts = { draft: 0, approved: 0, rejected: 0 };
          var staleCount = 0;
          var legacyCount = 0;
          var currentCount = 0;
          var overrideCount = 0;
          state.assets.forEach(function (row) {
            var s = String(row.status || '').toLowerCase();
            if (Object.prototype.hasOwnProperty.call(counts, s)) counts[s] += 1;
            if (row.is_stale) staleCount += 1;
            if (row.is_legacy) legacyCount += 1;
            if (row.is_current) currentCount += 1;
            if (row.is_current && row.admin_override) overrideCount += 1;
          });
          els.meta.innerHTML = [
            '<span>' + state.assets.length + ' shown</span>',
            '<span>live ' + counts.approved + '</span>',
            '<span>current canon ' + currentCount + '</span>',
            '<span>override ' + overrideCount + '</span>',
            '<span>draft ' + counts.draft + '</span>',
            '<span>rejected ' + counts.rejected + '</span>',
            '<span>stale ' + staleCount + '</span>',
            '<span>legacy ' + legacyCount + '</span>'
          ].join(' · ');
          renderTable();
        } catch (err) {
          els.meta.innerHTML = '<span style="color: var(--danger)">Failed to load assets.</span>';
          setLog({ error: String(err.message || err), details: err.response || null });
        } finally {
          els.refresh.disabled = false;
        }
      }

      function reasonOrUndefined() {
        var r = String(els.actionReason.value || '').trim();
        return r || undefined;
      }

      async function runMutation(path, payload) {
        return apiJson(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });
      }

      async function handleTableAction(action, symbol, sha) {
        if (action === 'copy') {
          await navigator.clipboard.writeText(String(sha || ''));
          setLog('Copied SHA for ' + symbol + ': ' + sha);
          return;
        }

        var reason = reasonOrUndefined();
        if (action === 'reject') {
          if (!sha) throw new Error('Missing SHA for reject');
          if (!window.confirm('Reject this image for ' + symbol + '?')) return;
          var rejectBody = { symbol: symbol, asset_sha256: sha };
          if (reason) rejectBody.reason = reason;
          setLog(await runMutation('/reject', rejectBody));
          await refreshAssets();
          return;
        }

        if (action === 'publish') {
          if (!sha) throw new Error('Missing SHA for publish');
          if (!window.confirm('Set this image as live canon for ' + symbol + ' and lock admin override?')) return;
          var publishBody = { symbol: symbol, asset_sha256: sha };
          if (reason) publishBody.reason = reason;
          setLog(await runMutation('/publish', publishBody));
          await refreshAssets();
          return;
        }

        if (action === 'clear-override') {
          if (!window.confirm('Release admin override for ' + symbol + ' and return canon to automatic vote resolution?')) return;
          var clearBody = { symbol: symbol };
          if (reason) clearBody.reason = reason;
          setLog(await runMutation('/clear-override', clearBody));
          await refreshAssets();
          return;
        }

        if (action === 'unpublish') {
          if (!window.confirm('Unpublish current live image for ' + symbol + '?')) return;
          var unpublishBody = { symbol: symbol };
          if (reason) unpublishBody.reason = reason;
          setLog(await runMutation('/unpublish', unpublishBody));
          await refreshAssets();
          return;
        }

        if (action === 'unstale') {
          if (!sha) throw new Error('Missing SHA for unstale');
          if (!window.confirm('Return this image to the normal candidate pool for ' + symbol + '?')) return;
          var unstaleBody = { symbol: symbol, asset_sha256: sha };
          if (reason) unstaleBody.reason = reason;
          setLog(await runMutation('/unstale', unstaleBody));
          await refreshAssets();
          return;
        }

        if (action === 'purge-legacy') {
          if (!sha) throw new Error('Missing SHA for purge legacy');
          if (!window.confirm('Permanently purge this legacy image for ' + symbol + '? This deletes it from the site DB and storage.')) return;
          var purgeBody = { symbol: symbol, asset_sha256: sha };
          if (reason) purgeBody.reason = reason;
          setLog(await runMutation('/purge-legacy', purgeBody));
          await refreshAssets();
          return;
        }

        if (action === 'rollback') {
          if (!window.confirm('Rollback live image for ' + symbol + ' to previous publish?')) return;
          var rollbackBody = { symbol: symbol };
          if (reason) rollbackBody.reason = reason;
          setLog(await runMutation('/rollback', rollbackBody));
          await refreshAssets();
          return;
        }
      }

      function bindActions() {
        els.body.addEventListener('click', async function (ev) {
          var btn = ev.target.closest('button[data-action]');
          if (!btn) return;
          var action = String(btn.getAttribute('data-action') || '');
          var symbol = String(btn.getAttribute('data-symbol') || '');
          var sha = String(btn.getAttribute('data-sha') || '');
          try {
            btn.disabled = true;
            await handleTableAction(action, symbol, sha);
          } catch (err) {
            setLog({ error: String(err.message || err), details: err.response || null });
          } finally {
            btn.disabled = false;
          }
        });
      }

      function init() {
        els.refresh.addEventListener('click', refreshAssets);
        els.status.addEventListener('change', refreshAssets);
        els.stale.addEventListener('change', refreshAssets);
        els.legacy.addEventListener('change', refreshAssets);
        els.limit.addEventListener('change', refreshAssets);
        els.search.addEventListener('input', renderTable);
        bindActions();
        refreshAssets();
      }

      init();
    })();
  </script>
</body>
</html>
`
