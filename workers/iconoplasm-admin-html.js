export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Admin</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #111827;
      --panel-2: #1f2937;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --line: #374151;
      --ok: #22c55e;
      --warn: #f59e0b;
      --bad: #ef4444;
      --accent: #3b82f6;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #0b1220, #111827 45%, #0f172a);
      color: var(--text);
      line-height: 1.5;
    }

    .wrap {
      max-width: 960px;
      margin: 0 auto;
      padding: 24px;
    }

    h1, h2, h3, p { margin: 0; }

    .header {
      margin-bottom: 32px;
    }

    .header h1 {
      font-size: 22px;
      margin-bottom: 4px;
    }

    .header .subtitle {
      color: var(--muted);
      font-size: 14px;
    }

    /* Workflow guide */
    .guide {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: color-mix(in hsl, var(--panel) 88%, black 12%);
      padding: 20px;
      margin-bottom: 24px;
    }

    .guide h2 {
      font-size: 15px;
      margin-bottom: 12px;
      color: var(--text);
    }

    .steps {
      display: grid;
      gap: 16px;
    }

    .step {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 12px;
      align-items: start;
    }

    .step-num {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .step-num.once { background: #1e3a5f; color: #93c5fd; border: 1px solid #2563eb; }
    .step-num.repeat { background: #1a3329; color: #86efac; border: 1px solid #22c55e; }

    .step-body h3 {
      font-size: 14px;
      margin-bottom: 2px;
    }

    .step-body p {
      font-size: 13px;
      color: var(--muted);
    }

    .freq {
      display: inline-block;
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      margin-left: 6px;
    }

    .freq-once { background: #1e3a5f; color: #93c5fd; }
    .freq-every { background: #1a3329; color: #86efac; }

    /* Sections */
    .section {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: color-mix(in hsl, var(--panel) 88%, black 12%);
      padding: 20px;
      margin-bottom: 16px;
    }

    .section h2 {
      font-size: 16px;
      margin-bottom: 4px;
    }

    .section .desc {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 14px;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: end;
    }

    .field {
      display: grid;
      gap: 4px;
    }

    .field-label {
      font-size: 12px;
      color: var(--muted);
    }

    input, select, textarea, button {
      font: inherit;
    }

    input, select {
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 14px;
    }

    input.wide { width: 280px; }

    button {
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 8px;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 14px;
    }

    button:hover { border-color: #4b5563; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: #1d4ed8; border-color: #2563eb; }
    .btn-warn { background: #b45309; border-color: #d97706; }
    .btn-bad { background: #b91c1c; border-color: #dc2626; }

    .msg-box {
      background: #0b1220;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      min-height: 60px;
      max-height: 300px;
      overflow: auto;
      margin-top: 12px;
    }

    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }

    /* Asset table */
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #0b1220;
      margin-top: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 620px;
    }

    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      font-size: 13px;
      text-align: left;
      vertical-align: middle;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #111827;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .gene-name {
      font-weight: 600;
      font-size: 14px;
    }

    .status-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid var(--line);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .status-draft { color: #93c5fd; }
    .status-approved { color: #86efac; }
    .status-rejected { color: #fca5a5; }

    .preview-img {
      width: 48px;
      height: 48px;
      border-radius: 6px;
      border: 1px solid var(--line);
      object-fit: cover;
      background: #111827;
      cursor: pointer;
    }

    .actions {
      display: flex;
      gap: 6px;
    }

    .actions button {
      padding: 5px 10px;
      font-size: 12px;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--muted);
    }

    .empty-state p {
      margin-bottom: 8px;
    }

    textarea.payload {
      width: 100%;
      min-height: 160px;
      resize: vertical;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 8px;
      padding: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
    }

    details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 13px;
      margin-top: 12px;
    }

    details summary:hover { color: var(--text); }

    .collapsible-content {
      margin-top: 12px;
    }

    @media (max-width: 700px) {
      input.wide { width: 100%; }
      .row { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="header">
      <h1>Iconoplasm Admin</h1>
      <p class="subtitle">Manage which gene portraits are live on the website.</p>
    </header>

    <!-- Workflow guide -->
    <section class="guide" id="guide">
      <h2>How this works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num once">1</div>
          <div class="step-body">
            <h3>Pick your portraits locally <span class="freq freq-once">you already did this</span></h3>
            <p>In the NiceGUI dashboard, you browse generated images, vote on them, and click "Set as Canon" to pick the official portrait for each gene. That part happens on your computer.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num once">2</div>
          <div class="step-body">
            <h3>Upload to the website <span class="freq freq-once">once per portrait</span></h3>
            <p>The publish script reads your canonical picks from the local database and pushes them here.
               Once uploaded, they show up in the table below as "draft" -- visible to you but not live on gene pages yet.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num repeat">3</div>
          <div class="step-body">
            <h3>Make them live <span class="freq freq-every">this page</span></h3>
            <p>Find the portrait in the table below and click <strong>Publish</strong>.
               That's it -- the portrait now shows up on the gene's page
               and in the browser extension.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num repeat">4</div>
          <div class="step-body">
            <h3>Change your mind? <span class="freq freq-every">whenever</span></h3>
            <p><strong>Rollback</strong> swaps back to the previous portrait.
               <strong>Reject</strong> takes a portrait out of the queue entirely.
               Neither deletes the image file -- you can always re-upload later.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Portraits table -->
    <section class="section">
      <h2>Uploaded portraits</h2>
      <p class="desc">These are the portraits pushed from your local machine. Click a button to make one live or take it down.</p>
      <div class="row">
        <div class="field">
          <span class="field-label">Show</span>
          <select id="assets-status">
            <option value="draft">Waiting to publish (drafts)</option>
            <option value="approved">Currently live</option>
            <option value="rejected">Rejected</option>
            <option value="all">Everything</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">Filter by gene</span>
          <input id="assets-search" type="text" placeholder="e.g. TP53" class="wide" />
        </div>
        <button class="btn-primary" id="assets-refresh">Refresh</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px" id="assets-meta">Loading...</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gene</th>
              <th>Status</th>
              <th>Preview</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="assets-body">
            <tr><td colspan="5" class="empty-state"><p>Loading portraits...</p></td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Quick actions -->
    <section class="section">
      <h2>Quick actions</h2>
      <p class="desc">If you already know the gene name, you can act without scrolling through the table.</p>
      <div class="row">
        <div class="field">
          <span class="field-label">Gene name</span>
          <input id="manual-symbol" type="text" placeholder="e.g. TP53" />
        </div>
        <div class="field">
          <span class="field-label">Image&nbsp;ID <span style="color:var(--muted);font-weight:normal">(for publish/reject)</span></span>
          <input id="manual-asset" type="text" placeholder="from the table or upload log" class="wide" />
        </div>
      </div>
      <div class="row" style="margin-top: 8px;">
        <div class="field">
          <span class="field-label">Note (optional)</span>
          <input id="action-reason" type="text" placeholder="Why you're making this change" class="wide" />
        </div>
      </div>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn-primary" id="manual-publish">Publish</button>
        <button class="btn-warn" id="manual-rollback">Rollback to previous</button>
        <button class="btn-bad" id="manual-reject">Reject</button>
      </div>
      <div class="msg-box" id="action-log">No actions yet. Results appear here when you click a button.</div>
    </section>

    <!-- Batch upload (advanced, collapsed) -->
    <section class="section">
      <details>
        <summary>Advanced: batch upload from local machine</summary>
        <div class="collapsible-content">
          <p class="desc">Sends portrait images directly to the website and registers them in the database. You probably don't need this -- the publish script does it for you.</p>
          <div class="row">
            <div class="field">
              <span class="field-label">Mode</span>
              <select id="ingest-endpoint">
                <option value="/ingest">Upload (as draft)</option>
                <option value="/publish-local">Upload + publish immediately</option>
              </select>
            </div>
            <div class="field">
              <span class="field-label">Test first?</span>
              <select id="ingest-dry-run">
                <option value="true">Yes, dry run (don't actually upload)</option>
                <option value="false">No, do it for real</option>
              </select>
            </div>
            <button class="btn-primary" id="ingest-run">Run</button>
          </div>
          <div style="margin-top: 12px;">
            <span class="field-label">JSON data (the publish script fills this in automatically)</span>
            <textarea class="payload" id="ingest-payload"></textarea>
          </div>
          <div class="msg-box" id="ingest-log">No uploads yet.</div>
        </div>
      </details>
    </section>

  </div>

  <script>
    (function () {
      var state = { assets: [] };
      var API_BASE = '/api/iconoplasm/admin';

      var els = {
        status: document.getElementById('assets-status'),
        search: document.getElementById('assets-search'),
        refresh: document.getElementById('assets-refresh'),
        meta: document.getElementById('assets-meta'),
        body: document.getElementById('assets-body'),
        reason: document.getElementById('action-reason'),
        manualSymbol: document.getElementById('manual-symbol'),
        manualAsset: document.getElementById('manual-asset'),
        manualPublish: document.getElementById('manual-publish'),
        manualReject: document.getElementById('manual-reject'),
        manualRollback: document.getElementById('manual-rollback'),
        actionLog: document.getElementById('action-log'),
        ingestEndpoint: document.getElementById('ingest-endpoint'),
        ingestDryRun: document.getElementById('ingest-dry-run'),
        ingestRun: document.getElementById('ingest-run'),
        ingestPayload: document.getElementById('ingest-payload'),
        ingestLog: document.getElementById('ingest-log')
      };

      function esc(v) {
        return String(v == null ? '' : v)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function statusLabel(s) {
        var labels = { draft: 'draft', approved: 'live', rejected: 'rejected' };
        return labels[String(s || '').toLowerCase()] || s;
      }

      function statusPill(status) {
        var s = String(status || 'unknown').toLowerCase();
        return '<span class="status-pill status-' + esc(s) + '">' + esc(statusLabel(s)) + '</span>';
      }

      function previewCell(asset) {
        var url = asset.thumb_url || asset.medium_url || asset.hero_url;
        if (!url) return '<span style="color:var(--muted)">--</span>';
        var fullUrl = asset.hero_url || url;
        return '<img class="preview-img" src="' + esc(url) + '" alt="' + esc(asset.gene_symbol) + '" loading="lazy" title="Click to see full size" onclick="window.open(\\'' + esc(fullUrl) + '\\',\\'_blank\\')" />';
      }

      function timeAgo(dateStr) {
        if (!dateStr) return '--';
        try {
          var d = new Date(dateStr);
          var now = new Date();
          var mins = Math.floor((now - d) / 60000);
          if (mins < 1) return 'just now';
          if (mins < 60) return mins + 'm ago';
          var hrs = Math.floor(mins / 60);
          if (hrs < 24) return hrs + 'h ago';
          var days = Math.floor(hrs / 24);
          if (days < 30) return days + 'd ago';
          return d.toLocaleDateString();
        } catch (e) { return dateStr; }
      }

      async function apiJson(url, options) {
        var opts = options || {};
        var resp = await fetch(url, Object.assign({}, opts, { credentials: 'include' }));
        var text = await resp.text();
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
        if (!resp.ok) {
          var err = new Error('HTTP ' + resp.status);
          err.response = data;
          throw err;
        }
        return data;
      }

      function showResult(el, value) {
        if (typeof value === 'object' && value && value.ok) {
          el.innerHTML = '<span class="ok">Done.</span> ' + esc(value.action || '') + ' ' + esc(value.symbol || '');
        } else if (typeof value === 'object' && value && value.error) {
          el.innerHTML = '<span class="bad">Error:</span> ' + esc(value.error);
        } else {
          el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        }
      }

      function filteredAssets() {
        var q = String(els.search.value || '').trim().toUpperCase();
        if (!q) return state.assets.slice();
        return state.assets.filter(function (a) {
          return String(a.gene_symbol || '').toUpperCase().indexOf(q) !== -1;
        });
      }

      function renderAssets() {
        var assets = filteredAssets();
        if (assets.length === 0) {
          var msg = state.assets.length === 0
            ? 'No portraits uploaded yet. Run the publish script on your machine to push your canonical picks here.'
            : 'No portraits match your filter.';
          els.body.innerHTML = '<tr><td colspan="5" class="empty-state"><p>' + esc(msg) + '</p></td></tr>';
          return;
        }
        els.body.innerHTML = assets.map(function (a) {
          var sym = esc(a.gene_symbol || '');
          var sha = esc(a.asset_sha256 || '');
          var isLive = String(a.status || '').toLowerCase() === 'approved';
          return [
            '<tr>',
            '<td><span class="gene-name">' + sym + '</span></td>',
            '<td>' + statusPill(a.status) + '</td>',
            '<td>' + previewCell(a) + '</td>',
            '<td>' + esc(timeAgo(a.created_at)) + '</td>',
            '<td>',
            '<div class="actions">',
            isLive
              ? '<button class="btn-warn" data-action="rollback" data-symbol="' + sym + '" data-sha="' + sha + '">Rollback</button>'
              : '<button class="btn-primary" data-action="publish" data-symbol="' + sym + '" data-sha="' + sha + '">Publish</button>',
            '<button class="btn-bad" data-action="reject" data-symbol="' + sym + '" data-sha="' + sha + '">Reject</button>',
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
          var statusVal = encodeURIComponent(String(els.status.value || 'draft').toLowerCase());
          var data = await apiJson(API_BASE + '/assets?status=' + statusVal + '&limit=250', { method: 'GET' });
          state.assets = Array.isArray(data.assets) ? data.assets : [];
          var labels = { draft: 'drafts', approved: 'live portraits', rejected: 'rejected', all: 'portraits total' };
          els.meta.textContent = state.assets.length + ' ' + (labels[els.status.value] || 'portraits') + '.';
          renderAssets();
        } catch (err) {
          els.meta.innerHTML = '<span class="bad">Could not load portraits. Are you logged in?</span>';
          showResult(els.actionLog, { error: String(err.message || err) });
        } finally {
          els.refresh.disabled = false;
        }
      }

      async function runMutation(path, payload) {
        return apiJson(API_BASE + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });
      }

      function buildReason() {
        var r = String(els.reason.value || '').trim();
        return r || undefined;
      }

      async function doPublish(symbol, assetSha) {
        var body = { symbol: symbol, asset_sha256: assetSha };
        var reason = buildReason();
        if (reason) body.reason = reason;
        var data = await runMutation('/publish', body);
        showResult(els.actionLog, data);
        await refreshAssets();
      }

      async function doReject(symbol, assetSha) {
        if (!confirm('Reject this portrait for ' + symbol + '? You can re-upload it later if you change your mind.')) return;
        var body = { symbol: symbol, asset_sha256: assetSha };
        var reason = buildReason();
        if (reason) body.reason = reason;
        var data = await runMutation('/reject', body);
        showResult(els.actionLog, data);
        await refreshAssets();
      }

      async function doRollback(symbol) {
        if (!confirm('Roll back ' + symbol + ' to the previous portrait?')) return;
        var body = { symbol: symbol };
        var reason = buildReason();
        if (reason) body.reason = reason;
        var data = await runMutation('/rollback', body);
        showResult(els.actionLog, data);
        await refreshAssets();
      }

      async function runIngest() {
        try {
          els.ingestRun.disabled = true;
          var payloadText = String(els.ingestPayload.value || '').trim();
          if (!payloadText) throw new Error('The JSON field is empty.');
          var payload = JSON.parse(payloadText);
          if (!payload || typeof payload !== 'object') throw new Error('Must be a JSON object.');
          if (!Object.prototype.hasOwnProperty.call(payload, 'dry_run')) {
            payload.dry_run = String(els.ingestDryRun.value) === 'true';
          }
          var endpoint = String(els.ingestEndpoint.value || '/ingest');
          var data = await runMutation(endpoint, payload);
          showResult(els.ingestLog, data);
          await refreshAssets();
        } catch (err) {
          showResult(els.ingestLog, { error: String(err.message || err) });
        } finally {
          els.ingestRun.disabled = false;
        }
      }

      // Table button clicks
      els.body.addEventListener('click', async function (ev) {
        var btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        var symbol = btn.getAttribute('data-symbol') || '';
        var sha = btn.getAttribute('data-sha') || '';
        try {
          btn.disabled = true;
          if (action === 'publish') await doPublish(symbol, sha);
          else if (action === 'reject') await doReject(symbol, sha);
          else if (action === 'rollback') await doRollback(symbol);
        } catch (err) {
          showResult(els.actionLog, { error: String(err.message || err) });
        } finally {
          btn.disabled = false;
        }
      });

      // Manual action buttons
      els.manualPublish.addEventListener('click', async function () {
        var symbol = String(els.manualSymbol.value || '').trim();
        var sha = String(els.manualAsset.value || '').trim();
        if (!symbol || !sha) { showResult(els.actionLog, { error: 'Enter the gene name and image ID.' }); return; }
        try { els.manualPublish.disabled = true; await doPublish(symbol, sha); }
        catch (err) { showResult(els.actionLog, { error: String(err.message || err) }); }
        finally { els.manualPublish.disabled = false; }
      });

      els.manualReject.addEventListener('click', async function () {
        var symbol = String(els.manualSymbol.value || '').trim();
        var sha = String(els.manualAsset.value || '').trim();
        if (!symbol || !sha) { showResult(els.actionLog, { error: 'Enter the gene name and image ID.' }); return; }
        try { els.manualReject.disabled = true; await doReject(symbol, sha); }
        catch (err) { showResult(els.actionLog, { error: String(err.message || err) }); }
        finally { els.manualReject.disabled = false; }
      });

      els.manualRollback.addEventListener('click', async function () {
        var symbol = String(els.manualSymbol.value || '').trim();
        if (!symbol) { showResult(els.actionLog, { error: 'Enter the gene name.' }); return; }
        try { els.manualRollback.disabled = true; await doRollback(symbol); }
        catch (err) { showResult(els.actionLog, { error: String(err.message || err) }); }
        finally { els.manualRollback.disabled = false; }
      });

      // Ingest
      els.ingestRun.addEventListener('click', runIngest);
      els.ingestPayload.value = JSON.stringify({
        dry_run: true,
        items: [{
          symbol: "TP53",
          asset_sha256: "<from your local database>",
          publish: false,
          renditions: {
            full: { base64: "<image data>" },
            medium: { base64: "<image data>" },
            thumb: { base64: "<image data>" }
          }
        }]
      }, null, 2);

      // Events
      els.search.addEventListener('input', renderAssets);
      els.status.addEventListener('change', refreshAssets);
      refreshAssets();
    })();
  </script>
</body>
</html>
`;
