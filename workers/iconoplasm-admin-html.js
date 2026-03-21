export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm</title>
  <style>
    /* ── palette ── */
    :root {
      --bg: #f5f4f1;
      --surface: #ffffff;
      --border: #e2dfda;
      --text: #1c1a17;
      --muted: #807a72;
      --accent: #b84a26;
      --accent-light: #fdf2ee;
      --warn: #9e7415;
      --warn-light: #fef8e8;
      --danger: #bf3030;
      --danger-light: #fef0f0;
      --ok: #2a7a4d;
      --ok-light: #eef9f2;
    }

    /* ── reset ── */
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, p { margin: 0; }
    p { color: var(--muted); font-size: 13px; }

    /* ── page shell ── */
    .page {
      max-width: 1240px;
      margin: 0 auto;
      padding: 28px 32px 48px;
    }

    /* ── header ── */
    .page > header {
      margin-bottom: 4px;
    }
    .page > header h1 {
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .page > header p {
      margin-top: 2px;
      font-size: 13px;
    }

    /* ── tab nav ── */
    nav#admin-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin: 12px 0 24px;
    }
    .tab-btn {
      padding: 9px 14px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      margin-bottom: -1px;
      transition: color 0.15s;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--text);
      border-bottom-color: var(--accent);
    }

    /* ── panels ── */
    .panel { display: none; }
    .panel.active { display: grid; gap: 20px; }

    /* ── metric row ── */
    .metric-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 36px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .metric { display: grid; gap: 2px; }
    .metric-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .metric-note {
      font-size: 11px;
      color: var(--muted);
      opacity: 0.6;
      max-width: 180px;
    }

    /* ── layout helpers ── */
    .split {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 32px;
    }
    .stack { display: grid; gap: 10px; align-content: start; }

    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px 20px;
    }

    h2 { font-size: 14px; font-weight: 600; }
    h3 { font-size: 13px; font-weight: 600; color: var(--muted); }

    /* ── lists ── */
    .list { display: grid; gap: 0; }
    .list-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      align-items: start;
    }
    .list-row:last-child { border-bottom: none; }
    .list-row strong { font-weight: 600; font-size: 13px; }

    .event-meta {
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 0.02em;
      text-align: right;
      font-variant-numeric: tabular-nums;
      word-break: break-all;
      max-width: 200px;
    }

    .small { font-size: 12px; color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace; }

    /* ── status / flag badges ── */
    .status {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid var(--border);
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-draft { color: #4a7aba; background: #f0f5fc; border-color: #d0dff2; }
    .status-approved { color: var(--ok); background: var(--ok-light); border-color: #c8e8d4; }
    .status-rejected { color: var(--danger); background: var(--danger-light); border-color: #f0c8c8; }

    .flag {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid var(--border);
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
      margin-right: 4px;
      margin-bottom: 3px;
    }
    .flag-stale { color: var(--warn); background: var(--warn-light); border-color: #e8d8a0; }
    .flag-legacy { color: #4a7aba; background: #f0f5fc; border-color: #d0dff2; }
    .flag-current { color: var(--ok); background: var(--ok-light); border-color: #c8e8d4; }
    .flag-leader { color: #9a6e10; background: #fef8e8; border-color: #e8d8a0; }
    .flag-override { color: #904098; background: #f8f0fa; border-color: #dcc0e0; }

    /* ── form controls ── */
    .controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      align-items: end;
    }
    label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
    }
    input, select {
      font: inherit;
      font-size: 13px;
      color: var(--text);
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      padding: 7px 10px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-light);
    }

    /* ── buttons ── */
    button {
      font: inherit;
      font-size: 13px;
      color: var(--text);
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      padding: 7px 12px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    button:hover { border-color: #c0bbb4; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover { background: #a34020; border-color: #a34020; }
    .btn-warn { background: var(--warn); border-color: var(--warn); color: #fff; }
    .btn-warn:hover { background: #8a6510; }
    .btn-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
    .btn-danger:hover { background: #a82828; }
    .btn-flat { background: transparent; border-color: transparent; color: var(--accent); padding: 4px 8px; }
    .btn-flat:hover { background: var(--accent-light); }

    /* ── stats bar ── */
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
      padding: 8px 0;
    }

    /* ── data table ── */
    .table-wrap {
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
      background: var(--surface);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 960px;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      font-size: 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #faf9f6;
      font-weight: 600;
      font-size: 11px;
      color: var(--muted);
    }
    .sha { word-break: break-all; font-size: 11px; }

    .thumbs { display: flex; gap: 5px; flex-wrap: wrap; }
    .thumbs a {
      display: inline-flex;
      width: 42px; height: 42px;
      border: 1px solid var(--border);
      border-radius: 4px;
      overflow: hidden;
      background: #f0efec;
    }
    .thumbs img { width: 42px; height: 42px; object-fit: cover; }

    .actions { display: flex; flex-wrap: wrap; gap: 4px; }
    .actions button { padding: 3px 7px; font-size: 11px; }

    /* ── log output ── */
    .log {
      margin-top: 8px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #faf9f6;
      padding: 12px;
      min-height: 60px;
      max-height: 280px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace;
      color: var(--muted);
    }

    /* ── outlier scatter plot ── */
    .plot-wrap {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .plot-frame {
      position: relative;
      height: 360px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background:
        linear-gradient(to right, rgba(0,0,0,0.04) 1px, transparent 1px) 0 0 / 20% 100%,
        linear-gradient(to top, rgba(0,0,0,0.04) 1px, transparent 1px) 0 0 / 100% 20%,
        #faf9f6;
      overflow: hidden;
    }
    .plot-dot {
      position: absolute;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: var(--ok);
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      transform: translate(-50%, 50%);
      cursor: pointer;
      transition: box-shadow 0.15s;
    }
    .plot-dot:hover { box-shadow: 0 1px 6px rgba(0,0,0,0.2); }
    .plot-dot.override { background: #9050a0; }
    .plot-dot.drift { background: var(--warn); }
    .plot-dot.missing { background: var(--danger); }
    .plot-dot.is-selected {
      width: 14px; height: 14px;
      box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent);
      z-index: 2;
    }
    .plot-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    .plot-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .plot-label span {
      width: 10px; height: 10px;
      border-radius: 50%;
      display: inline-block;
    }

    /* ── details/summary ── */
    details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      margin-top: 8px;
    }

    /* ── responsive ── */
    @media (max-width: 900px) {
      .page { padding: 16px; }
      .split { grid-template-columns: 1fr; }
      .plot-frame { height: 260px; }
      .metric-grid { gap: 20px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <h1>Iconoplasm</h1>
      <p>What's live, what needs fixing.</p>
    </header>

    <nav id="admin-tabs">
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="outliers">Outliers</button>
      <button class="tab-btn" data-tab="archive">Browse</button>
      <button class="tab-btn" data-tab="styles">Visions</button>
      <button class="tab-btn" data-tab="activity">Log</button>
    </nav>

    <!-- ── overview ── -->
    <div class="panel active" id="panel-overview">
      <div class="metric-grid" id="overview-metrics"></div>
      <div class="split">
        <section class="stack">
          <h2>Heads up</h2>
          <div class="list" id="attention-list"></div>
        </section>
        <section class="stack">
          <h2>Latest</h2>
          <div class="list" id="overview-events"></div>
        </section>
      </div>
    </div>

    <!-- ── outliers ── -->
    <div class="panel" id="panel-outliers">
      <div class="section-head">
        <div>
          <h2>Pageviews vs. portrait score</h2>
          <p class="small">Click dots to inspect.</p>
        </div>
        <div class="plot-legend">
          <span class="plot-label"><span style="background: var(--ok)"></span> normal</span>
          <span class="plot-label"><span style="background: var(--warn)"></span> mismatch</span>
          <span class="plot-label"><span style="background: #9050a0"></span> pinned</span>
          <span class="plot-label"><span style="background: var(--danger)"></span> missing</span>
        </div>
      </div>
      <div class="split">
        <section class="plot-wrap">
          <div class="plot-frame" id="outlier-plot"></div>
        </section>
        <section class="stack">
          <h2>Selected</h2>
          <div class="list" id="outlier-detail"></div>
        </section>
      </div>
    </div>

    <!-- ── browse (archive) ── -->
    <div class="panel" id="panel-archive" style="display:none;">
      <h2>All portraits</h2>

      <div class="controls">
        <label>Show
          <select id="assets-status">
            <option value="all" selected>all</option>
            <option value="approved">live</option>
            <option value="draft">draft</option>
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
        <label>Gene
          <input id="assets-search" type="text" placeholder="TP53" />
        </label>
        <label>Token
          <input id="admin-token" type="password" placeholder="If no session" />
        </label>
        <button class="btn-primary" id="assets-refresh">Refresh</button>
      </div>

      <div class="stats" id="assets-meta">Not loaded.</div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gene</th>
              <th>SHA</th>
              <th>Status</th>
              <th>Canon</th>
              <th>State</th>
              <th>Vision</th>
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
        <summary>Reason (for the log)</summary>
        <div class="controls" style="margin-top: 8px;">
          <label>Note
            <input id="action-reason" type="text" placeholder="Optional note about this change" />
          </label>
        </div>
      </details>
    </div>

    <!-- ── visions (styles) ── -->
    <div class="panel" id="panel-styles">
      <div class="split">
        <section class="stack">
          <h2>Vision cleanup</h2>
          <p class="small">Remove sources that produce bad results.</p>
          <div class="controls">
            <label>Vision tag
              <input id="style-tag" type="text" placeholder="artist-example" />
            </label>
            <label>Vision name
              <input id="style-name" type="text" placeholder="Readable name" />
            </label>
            <label>Why
              <input id="style-reason" type="text" placeholder="Reason for removal" />
            </label>
            <button class="btn-danger" id="style-remove">Remove vision</button>
          </div>
        </section>
        <section class="stack">
          <h2>About this</h2>
          <div class="list" id="styles-notes"></div>
        </section>
      </div>
    </div>

    <!-- ── log (activity) ── -->
    <div class="panel" id="panel-activity">
      <h2>Activity log</h2>
      <p class="small">Recent changes and admin actions.</p>
      <div class="list" id="activity-list"></div>
    </div>

    <pre class="log" id="action-log">No actions yet.</pre>
  </div>

  <script>
    (function () {
      var API_BASE = '/api/iconoplasm/admin';
      var state = {
        assets: [],
        auditRows: [],
        overviewSummary: null,
        overviewAttention: [],
        recentEvents: [],
        selectedOutlier: null,
        activeTab: 'overview',
        archiveLoaded: false,
        outliersLoaded: false
      };

      var els = {
        tabs: document.getElementById('admin-tabs'),
        panels: {
          overview: document.getElementById('panel-overview'),
          outliers: document.getElementById('panel-outliers'),
          archive: document.getElementById('panel-archive'),
          styles: document.getElementById('panel-styles'),
          activity: document.getElementById('panel-activity')
        },
        overviewMetrics: document.getElementById('overview-metrics'),
        attentionList: document.getElementById('attention-list'),
        overviewEvents: document.getElementById('overview-events'),
        outlierPlot: document.getElementById('outlier-plot'),
        outlierDetail: document.getElementById('outlier-detail'),
        styleTag: document.getElementById('style-tag'),
        styleName: document.getElementById('style-name'),
        styleReason: document.getElementById('style-reason'),
        styleRemove: document.getElementById('style-remove'),
        stylesNotes: document.getElementById('styles-notes'),
        activityList: document.getElementById('activity-list'),
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

      function setActiveTab(tab) {
        state.activeTab = tab;
        Object.keys(els.panels).forEach(function (key) {
          var panel = els.panels[key];
          if (!panel) return;
          if (key === tab) {
            panel.classList.add('active');
            panel.style.display = '';
          } else {
            panel.classList.remove('active');
            panel.style.display = 'none';
          }
        });
        if (els.tabs) {
          els.tabs.querySelectorAll('[data-tab]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
          });
        }
        if (tab === 'archive' && !state.archiveLoaded) {
          refreshAssets();
        }
        if (tab === 'outliers' && !state.outliersLoaded) {
          refreshCanonAudit();
        }
      }

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
        return html ? '<div class="thumbs">' + html + '</div>' : '<span class="small">-</span>';
      }

      function flagsCell(asset) {
        var out = [];
        if (asset.is_stale) out.push('<span class="flag flag-stale">stale</span>');
        if (asset.is_legacy) out.push('<span class="flag flag-legacy">legacy</span>');
        return out.length ? out.join('') : '<span class="small">-</span>';
      }

      function canonCell(asset) {
        var out = [];
        if (asset.is_current) out.push('<span class="flag flag-current">live</span>');
        if (asset.is_vote_leader) out.push('<span class="flag flag-leader">top voted</span>');
        if (asset.is_current && asset.admin_override) out.push('<span class="flag flag-override">pinned</span>');
        return out.length ? out.join('') : '<span class="small">-</span>';
      }

      function votesCell(asset) {
        return [
          '<div><strong>' + esc(String(asset.image_score || 0)) + '</strong></div>',
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

      function metricMarkup(label, value, note) {
        return [
          '<article class="metric">',
          '<div class="metric-label">' + esc(label) + '</div>',
          '<div class="metric-value">' + esc(String(value == null ? '-' : value)) + '</div>',
          '<div class="metric-note">' + esc(note || '') + '</div>',
          '</article>'
        ].join('');
      }

      function eventMarkup(evt) {
        return [
          '<article class="list-row">',
          '<div>',
          '<strong>' + esc(evt.symbol || 'unknown') + '</strong>',
          '<div class="small">' + esc(evt.reason || '') + '</div>',
          '</div>',
          '<div class="event-meta">' + esc(evt.action || 'event') + '<br />' + esc(evt.created_at || '') + '</div>',
          '</article>'
        ].join('');
      }

      function attentionMarkup(title, note, buttonLabel, symbol) {
        return [
          '<article class="list-row">',
          '<div>',
          '<strong>' + esc(title) + '</strong>',
          '<div class="small">' + esc(note) + '</div>',
          '</div>',
          '<div>',
          (symbol ? '<button class="btn-flat" data-jump-symbol="' + esc(symbol) + '" data-jump-tab="archive">' + esc(buttonLabel || 'Open') + '</button>' : ''),
          '</div>',
          '</article>'
        ].join('');
      }

      function renderOverview() {
        var summary = state.overviewSummary || {};
        els.overviewMetrics.innerHTML = [
          metricMarkup('Published', summary.with_live, 'Genes with a live portrait.'),
          metricMarkup('Mismatched', summary.drift, summary.drift == null ? 'Open Outliers for exact count.' : 'Live portrait differs from top voted.'),
          metricMarkup('Pinned', summary.overrides || 0, 'Manually set, bypasses auto-selection.'),
          metricMarkup('Missing', summary.current_asset_missing, summary.current_asset_missing == null ? 'See Outliers or Browse.' : 'Published but image file is gone.'),
          metricMarkup('Stale', summary.stale_assets, summary.stale_assets == null ? 'Browse to clean up.' : 'Old images waiting for cleanup.'),
          metricMarkup('Legacy', summary.legacy_assets, summary.legacy_assets == null ? 'Browse to clean up.' : 'Leftovers from old syncs.')
        ].join('');

        var notes = (state.overviewAttention || []).map(function (item) {
          if (!item || !item.symbol) return '';
          if (item.kind === 'drift') {
            return attentionMarkup(item.symbol + ' -- mismatched', 'Live portrait differs from what voters picked.', 'Browse', item.symbol);
          }
          if (item.kind === 'missing') {
            return attentionMarkup(item.symbol + ' -- missing image', 'Published but the file is gone.', 'Look', item.symbol);
          }
          if (item.kind === 'override') {
            return attentionMarkup(item.symbol + ' -- pinned', 'Auto-selection off until you unpin.', 'Look', item.symbol);
          }
          if (item.kind === 'stale') {
            return attentionMarkup(item.symbol + ' -- stale images', String(item.stale_assets || 0) + ' old images hanging around.', 'Clean up', item.symbol);
          }
          return '';
        }).filter(Boolean);
        if (!notes.length) notes.push('<article class="list-row"><div><strong>Nothing needs attention.</strong><div class="small">Use Outliers or Browse for a deeper look.</div></div><div></div></article>');
        els.attentionList.innerHTML = notes.join('');

        els.overviewEvents.innerHTML = (state.recentEvents || []).slice(0, 8).map(eventMarkup).join('') || '<article class="list-row"><div><strong>No recent activity.</strong></div><div></div></article>';
        els.activityList.innerHTML = (state.recentEvents || []).map(eventMarkup).join('') || '<article class="list-row"><div><strong>No recent activity.</strong></div><div></div></article>';
      }

      function renderOutlierDetail(row) {
        if (!row) {
          els.outlierDetail.innerHTML = '<article class="list-row"><div><strong>Click a dot to inspect.</strong></div><div></div></article>';
          return;
        }
        var current = row.current || null;
        var leader = row.leader || null;
        els.outlierDetail.innerHTML = [
          '<article class="list-row"><div><strong>' + esc(row.symbol || '') + '</strong><div class="small">popularity ' + esc(String(row.popularity_score || 0)) + ' &middot; ' + esc(String(row.total_assets || 0)) + ' images</div></div><div>' + (row.symbol ? '<button class="btn-flat" data-jump-symbol="' + esc(row.symbol) + '" data-jump-tab="archive">Browse</button>' : '') + '</div></article>',
          '<article class="list-row"><div><strong>Live portrait</strong><div class="small">' + esc(current ? ((current.score || 0) + ' score \u00B7 ' + (current.vision_id || 'no vision')) : 'No live portrait.') + '</div></div><div class="event-meta">' + esc(current ? (current.asset_sha256 || '') : '') + '</div></article>',
          '<article class="list-row"><div><strong>Top voted</strong><div class="small">' + esc(leader ? ((leader.score || 0) + ' score \u00B7 ' + (leader.vision_id || 'no vision')) : 'No votes yet.') + '</div></div><div class="event-meta">' + esc(leader ? (leader.asset_sha256 || '') : '') + '</div></article>'
        ].join('');
      }

      function renderOutlierPlot() {
        var rows = (state.auditRows || []).slice();
        if (!rows.length) {
          els.outlierPlot.innerHTML = '<div class="small" style="padding: 12px;">Not loaded yet.</div>';
          renderOutlierDetail(state.selectedOutlier);
          return;
        }
        var maxPopularity = rows.reduce(function (max, row) { return Math.max(max, Number(row.popularity_score || 0)); }, 1);
        var maxScore = rows.reduce(function (max, row) {
          var currentScore = row.current ? Number(row.current.score || 0) : 0;
          var leaderScore = row.leader ? Number(row.leader.score || 0) : 0;
          return Math.max(max, currentScore, leaderScore, 1);
        }, 1);
        els.outlierPlot.innerHTML = rows.map(function (row) {
          var currentScore = row.current ? Number(row.current.score || 0) : 0;
          var x = Math.max(4, Math.min(96, (Number(row.popularity_score || 0) / maxPopularity) * 100));
          var y = Math.max(4, Math.min(96, (currentScore / maxScore) * 100));
          var klass = 'plot-dot';
          if (row.current_asset_missing) klass += ' missing';
          else if (row.drift) klass += ' drift';
          else if (row.admin_override) klass += ' override';
          if (state.selectedOutlier && state.selectedOutlier.symbol === row.symbol) klass += ' is-selected';
          return '<button class="' + klass + '" data-outlier-symbol="' + esc(row.symbol || '') + '" style="left:' + x + '%; bottom:' + y + '%" title="' + esc((row.symbol || '') + ' -- views ' + (row.popularity_score || 0) + ' -- score ' + currentScore) + '"></button>';
        }).join('');
        renderOutlierDetail(state.selectedOutlier);
      }

      async function refreshOverview() {
        try {
          var data = await apiJson('/overview?event_limit=24', { method: 'GET' });
          state.overviewSummary = data.summary || null;
          state.overviewAttention = Array.isArray(data.attention) ? data.attention : [];
          state.recentEvents = Array.isArray(data.recent_events) ? data.recent_events : [];
          renderOverview();
        } catch (err) {
          setLog({ error: 'Overview load failed', details: err.response || String(err.message || err) });
        }
      }

      async function refreshCanonAudit() {
        try {
          els.outlierPlot.innerHTML = '<div class="small" style="padding: 12px;">Loading...</div>';
          var data = await apiJson('/canon-audit?limit=1500&event_limit=0', { method: 'GET' });
          state.auditRows = Array.isArray(data.rows) ? data.rows : [];
          state.outliersLoaded = true;
          if (state.selectedOutlier) {
            state.selectedOutlier = state.auditRows.find(function (row) { return row.symbol === state.selectedOutlier.symbol; }) || null;
          }
          if (!state.selectedOutlier && state.auditRows.length) {
            state.selectedOutlier = state.auditRows[0];
          }
          renderOutlierPlot();
        } catch (err) {
          state.outliersLoaded = false;
          setLog({ error: 'Canon audit failed', details: err.response || String(err.message || err) });
        }
      }

      async function refreshDerivedAdminViews() {
        await refreshOverview();
        if (state.outliersLoaded) {
          await refreshCanonAudit();
        }
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
          var visionBits = [];
          if (a.artist_tag) visionBits.push('<div><strong>' + esc(a.artist_tag) + '</strong></div>');
          if (a.artist_name) visionBits.push('<div class="small">' + esc(a.artist_name) + '</div>');
          if (a.vision_id) visionBits.push('<div class="small mono">' + esc(a.vision_id) + '</div>');
          return [
            '<tr>',
            '<td><strong>' + esc(a.gene_symbol || '') + '</strong></td>',
            '<td class="mono sha" title="' + esc(a.asset_sha256 || '') + '">' + esc(shortSha(a.asset_sha256 || '')) + '</td>',
            '<td>' + statusPill(a.status) + '</td>',
            '<td>' + canonCell(a) + '</td>',
            '<td>' + flagsCell(a) + '</td>',
            '<td>' + (visionBits.join('') || '<span class="small">-</span>') + '</td>',
            '<td>' + votesCell(a) + '</td>',
            '<td>' + previewCell(a) + '</td>',
            '<td><div>' + esc(a.created_at || '-') + '</div><div class="small">' + esc(a.created_by || '-') + '</div></td>',
            '<td>',
            '<div class="actions">',
            '<button class="btn-flat" data-action="copy" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Copy SHA</button>',
            '<button class="btn-primary" data-action="publish" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Pin as live</button>',
            ((a.is_current && a.admin_override)
              ? '<button class="btn-flat" data-action="clear-override" data-symbol="' + esc(a.gene_symbol || '') + '">Unpin</button>'
              : ''),
            ((a.is_stale || a.is_legacy)
              ? '<button class="btn-primary" data-action="unstale" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Restore</button>'
              : ''),
            (a.is_legacy
              ? '<button class="btn-danger" data-action="purge-legacy" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Delete</button>'
              : ''),
            '<button class="btn-warn" data-action="rollback" data-symbol="' + esc(a.gene_symbol || '') + '">Roll back</button>',
            '<button class="btn-flat" data-action="unpublish" data-symbol="' + esc(a.gene_symbol || '') + '">Unpublish</button>',
            '<button class="btn-danger" data-action="reject" data-symbol="' + esc(a.gene_symbol || '') + '" data-sha="' + esc(a.asset_sha256 || '') + '">Reject</button>',
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
          var symbol = encodeURIComponent(String(els.search.value || '').trim().toUpperCase());
          var path = '/assets?status=' + status + '&stale=' + stale + '&legacy=' + legacy + '&limit=' + limit;
          if (symbol) path += '&symbol=' + symbol;
          var data = await apiJson(path, { method: 'GET' });
          state.assets = Array.isArray(data.assets) ? data.assets : [];
          state.archiveLoaded = true;

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
            '<span>approved ' + counts.approved + '</span>',
            '<span>current ' + currentCount + '</span>',
            '<span>pinned ' + overrideCount + '</span>',
            '<span>draft ' + counts.draft + '</span>',
            '<span>rejected ' + counts.rejected + '</span>',
            '<span>stale ' + staleCount + '</span>',
            '<span>legacy ' + legacyCount + '</span>'
          ].join(' &middot; ');
          renderTable();
        } catch (err) {
          state.archiveLoaded = false;
          els.meta.innerHTML = '<span style="color: var(--danger)">Failed to load.</span>';
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
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'publish') {
          if (!sha) throw new Error('Missing SHA for publish');
          if (!window.confirm('Pin this as live for ' + symbol + '?')) return;
          var publishBody = { symbol: symbol, asset_sha256: sha };
          if (reason) publishBody.reason = reason;
          setLog(await runMutation('/publish', publishBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'clear-override') {
          if (!window.confirm('Unpin ' + symbol + ' and let votes decide?')) return;
          var clearBody = { symbol: symbol };
          if (reason) clearBody.reason = reason;
          setLog(await runMutation('/clear-override', clearBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'unpublish') {
          if (!window.confirm('Unpublish ' + symbol + '?')) return;
          var unpublishBody = { symbol: symbol };
          if (reason) unpublishBody.reason = reason;
          setLog(await runMutation('/unpublish', unpublishBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'unstale') {
          if (!sha) throw new Error('Missing SHA for unstale');
          if (!window.confirm('Restore this image for ' + symbol + '?')) return;
          var unstaleBody = { symbol: symbol, asset_sha256: sha };
          if (reason) unstaleBody.reason = reason;
          setLog(await runMutation('/unstale', unstaleBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'purge-legacy') {
          if (!sha) throw new Error('Missing SHA for purge legacy');
          if (!window.confirm('Permanently delete this legacy image for ' + symbol + '? No undo.')) return;
          var purgeBody = { symbol: symbol, asset_sha256: sha };
          if (reason) purgeBody.reason = reason;
          setLog(await runMutation('/purge-legacy', purgeBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'rollback') {
          if (!window.confirm('Roll back ' + symbol + ' to previous portrait?')) return;
          var rollbackBody = { symbol: symbol };
          if (reason) rollbackBody.reason = reason;
          setLog(await runMutation('/rollback', rollbackBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }
      }

      function bindActions() {
        if (els.tabs) {
          els.tabs.addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-tab]');
            if (!btn) return;
            setActiveTab(String(btn.getAttribute('data-tab') || 'overview'));
          });
        }

        if (els.outlierPlot) {
          els.outlierPlot.addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-outlier-symbol]');
            if (!btn) return;
            var symbol = String(btn.getAttribute('data-outlier-symbol') || '');
            state.selectedOutlier = state.auditRows.find(function (row) { return row.symbol === symbol; }) || null;
            renderOutlierPlot();
          });
        }

        document.body.addEventListener('click', function (ev) {
          var jump = ev.target.closest('[data-jump-symbol]');
          if (!jump) return;
          var symbol = String(jump.getAttribute('data-jump-symbol') || '');
          var tab = String(jump.getAttribute('data-jump-tab') || 'archive');
          els.status.value = 'all';
          els.stale.value = 'all';
          els.legacy.value = 'all';
          els.search.value = symbol;
          setActiveTab(tab);
          refreshAssets();
        });

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

        if (els.styleRemove) {
          els.styleRemove.addEventListener('click', async function () {
            var visionTag = String(els.styleTag.value || '').trim();
            var visionName = String(els.styleName.value || '').trim();
            var reason = String(els.styleReason.value || '').trim();
            if (!visionTag) {
              setLog('Vision tag is required.');
              return;
            }
            if (!window.confirm('Remove vision ' + visionTag + '?')) return;
            try {
              els.styleRemove.disabled = true;
              setLog(await runMutation('/artist-styles/remove', {
                artist_tag: visionTag,
                artist_name: visionName || undefined,
                reason: reason || undefined
              }));
              els.stylesNotes.innerHTML = '<article class="list-row"><div><strong>' + esc(visionTag) + ' removed.</strong><div class="small">Recorded.</div></div><div></div></article>';
              await refreshDerivedAdminViews();
            } catch (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            } finally {
              els.styleRemove.disabled = false;
            }
          });
        }
      }

      function init() {
        setActiveTab('overview');
        els.stylesNotes.innerHTML = [
          '<article class="list-row"><div><strong>What this is for</strong><div class="small">Remove vision sources that produce junk. Not a moderation queue.</div></div><div></div></article>',
          '<article class="list-row"><div><strong>What it is not</strong><div class="small">Not for approving individual images. You only step in when something needs removal, pinning, or cleanup.</div></div><div></div></article>'
        ].join('');
        els.refresh.addEventListener('click', function () {
          // Archive refresh must stay archive-scoped. Tying this button back to the
          // global audit queries would reintroduce the production bug we just removed.
          refreshAssets();
        });
        els.status.addEventListener('change', refreshAssets);
        els.stale.addEventListener('change', refreshAssets);
        els.legacy.addEventListener('change', refreshAssets);
        els.limit.addEventListener('change', refreshAssets);
        els.search.addEventListener('input', renderTable);
        bindActions();
        refreshOverview();
      }

      init();
    })();
  </script>
</body>
</html>
`
