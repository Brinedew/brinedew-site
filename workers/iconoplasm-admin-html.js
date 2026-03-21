export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f5f4f1;
      --surface: #ffffff;
      --border: #e8e4df;
      --border-strong: #d4cfc8;
      --text: #1a1a1a;
      --muted: #6b7280;
      --faint: #9ca3af;
      --accent: #b84a26;
      --accent-light: #f5ebe7;
      --warn: #9e7415;
      --warn-light: #fef8e8;
      --danger: #bf3030;
      --danger-light: #fef0f0;
      --ok: #2a7a4d;
      --ok-light: #eef9f2;
    }

    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, p { margin: 0; }
    p { color: var(--muted); font-size: 13px; }

    .page {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 24px 56px;
    }

    .page > header {
      margin-bottom: 10px;
      display: grid;
      gap: 4px;
    }
    .page > header h1 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .page > header p {
      font-size: 13px;
      color: var(--muted);
      max-width: 760px;
    }

    nav#admin-tabs {
      display: flex;
      gap: 4px;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      margin: 14px 0 24px;
      min-height: 56px;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 20;
      background: color-mix(in srgb, var(--bg) 94%, transparent);
      backdrop-filter: blur(10px);
    }
    .tab-btn {
      padding: 8px 14px;
      background: none;
      border: 1px solid transparent;
      border-radius: 999px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .tab-btn:hover {
      color: var(--text);
      background: var(--accent-light);
      border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
    }
    .tab-btn.active {
      color: var(--surface);
      background: var(--text);
      border-color: var(--text);
    }

    /* ── panels ── */
    .panel { display: none; }
    .panel.active { display: grid; gap: 24px; }

    /* ── overview ── */
    #panel-overview .metric-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    #panel-overview .metric {
      flex: 1 1 180px;
      min-width: 180px;
      display: grid;
      gap: 6px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #f9f8f6;
    }
    #panel-overview .metric-label {
      font-size: 11px;
      font-weight: 600;
      color: #8a8a8a;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    #panel-overview .metric-value {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.04em;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    #panel-overview .metric-note {
      font-size: 12px;
      color: var(--muted);
      max-width: 220px;
    }
    .coverage-card {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }
    .coverage-bar {
      display: flex;
      width: 100%;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: #ebe7e2;
    }
    .coverage-segment { height: 100%; }
    .coverage-legend {
      display: grid;
      gap: 8px;
    }
    .coverage-row {
      display: grid;
      grid-template-columns: 12px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      font-size: 13px;
    }
    .coverage-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }

    .split {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 24px;
    }
    .stack { display: grid; gap: 10px; align-content: start; }

    #panel-overview .stack {
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      gap: 14px;
    }

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
    #panel-overview .list-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      min-height: 56px;
      padding: 10px 0;
      border-bottom: 1px solid #f0ede8;
    }
    #panel-overview .list-row:last-child { border-bottom: none; }
    #panel-overview .list-row strong { font-weight: 600; font-size: 13px; }

    #panel-overview .event-meta {
      font-size: 12px;
      color: var(--faint);
      text-align: right;
      font-variant-numeric: tabular-nums;
      max-width: 120px;
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
    .gallery-toolbar {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg) 70%, var(--surface));
    }
    .gallery-toolbar-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .toggle-group {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .toggle-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .toggle-pill.active {
      background: var(--text);
      color: var(--surface);
      border-color: var(--text);
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }
    .gallery-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(300px, 0.9fr);
      gap: 16px;
      align-items: start;
    }
    .gallery-sidebar {
      position: sticky;
      top: 124px;
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255,255,255,0.78);
      backdrop-filter: blur(12px);
    }
    .gallery-card {
      display: grid;
      gap: 8px;
      padding: 8px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: rgba(255,255,255,0.55);
      text-align: left;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    .gallery-card:hover {
      border-color: var(--border-strong);
      background: rgba(255,255,255,0.92);
      transform: translateY(-1px);
    }
    .gallery-card.is-selected {
      border-color: var(--accent);
      background: rgba(255,255,255,0.96);
    }
    .gallery-media {
      aspect-ratio: 1 / 1;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: #ece7e1;
    }
    .gallery-media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .gallery-empty {
      display: grid;
      place-items: center;
      min-height: 220px;
      border: 1px dashed var(--border-strong);
      border-radius: 12px;
      color: var(--muted);
      background: rgba(255,255,255,0.45);
      text-align: center;
      padding: 24px;
    }
    .gallery-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
    }
    .gallery-subtitle {
      font-size: 12px;
      color: var(--muted);
    }
    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge-pill {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
    }
    .badge-live { background: #d1fae5; color: #065f46; }
    .badge-pinned { background: #fef3c7; color: #92400e; }
    .badge-mismatch { background: #fee2e2; color: #991b1b; }
    .badge-missing { background: #f3f4f6; color: #374151; }
    .badge-stale { background: #f5ebe7; color: var(--accent); }
    .detail-kicker {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .detail-title {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.1;
      color: var(--text);
    }
    .detail-copy {
      font-size: 13px;
      line-height: 1.55;
      color: var(--muted);
    }
    .candidate-list,
    .event-list {
      display: grid;
      gap: 10px;
    }
    .candidate-row,
    .event-row {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255,255,255,0.7);
    }
    .candidate-thumb,
    .event-thumb {
      width: 64px;
      height: 64px;
      border-radius: 10px;
      overflow: hidden;
      background: #ece7e1;
      border: 1px solid var(--border);
    }
    .candidate-thumb img,
    .event-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .candidate-meta,
    .event-meta-block {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .candidate-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .vision-list {
      display: grid;
      gap: 10px;
    }
    .vision-row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) repeat(4, minmax(0, 0.6fr));
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255,255,255,0.72);
      align-items: center;
    }
    .vision-cell {
      min-width: 0;
    }
    @media (max-width: 980px) {
      .vision-row {
        grid-template-columns: 1fr 1fr;
      }
    }
    .activity-feed {
      display: grid;
      gap: 10px;
    }
    .activity-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255,255,255,0.76);
    }
    .activity-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .activity-actor {
      font-size: 12px;
      color: var(--muted);
    }
    @media (max-width: 1120px) {
      .gallery-layout {
        grid-template-columns: 1fr;
      }
      .gallery-sidebar {
        position: static;
      }
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
      .page { padding: 16px 16px 40px; }
      .split { grid-template-columns: 1fr; }
      .plot-frame { height: 260px; }
      .metric-grid { gap: 20px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <h1>Iconoplasm Admin</h1>
      <p>Images first, bookkeeping second. This page is for steering live canon, spotting breakage fast, and cleaning up the weird cases without drowning in spreadsheet sludge.</p>
    </header>

    <nav id="admin-tabs">
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="outliers">Outliers</button>
      <button class="tab-btn" data-tab="archive">Gallery</button>
      <button class="tab-btn" data-tab="styles">Visions</button>
      <button class="tab-btn" data-tab="activity">Log</button>
    </nav>

    <!-- ── overview ── -->
    <div class="panel active" id="panel-overview">
      <div class="metric-grid" id="overview-metrics"></div>
      <section class="coverage-card">
        <div class="section-head">
          <h2>Coverage</h2>
          <p class="small">How many genes have nothing, one fragile option, a healthy pool, or way too much clutter.</p>
        </div>
        <div id="overview-coverage"></div>
      </section>
      <div class="split">
        <section class="stack">
          <div class="section-head">
            <h2>System health</h2>
            <p class="small">What needs eyes first.</p>
          </div>
          <div class="list" id="attention-list"></div>
        </section>
        <section class="stack">
          <div class="section-head">
            <h2>What changed</h2>
            <p class="small">Recent publish and rollback activity.</p>
          </div>
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
      <div class="section-head">
        <div>
          <h2>Gallery</h2>
          <p class="small">This still has the old table under the hood for the moment, but the controls are being reshaped around visual triage instead of spreadsheet spelunking.</p>
        </div>
      </div>

      <div class="gallery-toolbar">
        <div class="gallery-toolbar-row">
          <div class="controls" style="flex: 1 1 720px;">
            <label>Search genes
              <input id="gallery-search" type="text" placeholder="Search genes..." />
            </label>
            <label>Show
              <select id="gallery-filter">
                <option value="all" selected>all portraits</option>
                <option value="mismatch">has mismatch</option>
                <option value="pinned">pinned</option>
                <option value="missing">missing portrait</option>
                <option value="stale">has stale images</option>
              </select>
            </label>
            <label>Sort
              <select id="gallery-sort">
                <option value="name" selected>gene name</option>
                <option value="votes">vote score</option>
                <option value="recency">recency</option>
                <option value="mismatch">mismatch first</option>
              </select>
            </label>
            <label>Limit
              <input id="gallery-limit" type="number" min="1" max="200" value="120" />
            </label>
          </div>
          <div class="toggle-group">
            <button class="toggle-pill active" type="button">Live</button>
            <button class="toggle-pill" type="button">All candidates</button>
            <button class="toggle-pill" type="button">Side by side</button>
          </div>
        </div>
        <div class="gallery-toolbar-row">
          <div class="small">Click a gene to open the review panel with candidate images and the admin actions.</div>
          <button class="btn-primary" id="assets-refresh">Refresh</button>
        </div>
      </div>

      <div class="stats" id="assets-meta">Not loaded.</div>

      <div class="gallery-layout">
        <div class="gallery-grid" id="gallery-grid"></div>
        <aside class="gallery-sidebar" id="gallery-detail">
          <div class="detail-kicker">Gene review</div>
          <div class="detail-title">Pick a gene</div>
          <div class="detail-copy">The gallery now works like a visual inbox. Click any card to inspect candidates, notes, and recent admin actions.</div>
        </aside>
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
          <h2>Vision scorecard</h2>
          <p class="small">Which sources are helping, which ones are making a mess, and which are already blacklisted.</p>
          <div class="vision-list" id="vision-stats-list"></div>
        </section>
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
          <h2>Blacklist log</h2>
          <div class="list" id="styles-notes"></div>
        </section>
      </div>
    </div>

    <!-- ── log (activity) ── -->
    <div class="panel" id="panel-activity">
      <h2>Activity log</h2>
      <p class="small">Recent changes and admin actions.</p>
      <div class="controls" style="margin-bottom: 12px;">
        <label>Filter log
          <input id="activity-filter" type="text" placeholder="publish, reject, TP53..." />
        </label>
      </div>
      <div class="activity-feed" id="activity-list"></div>
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
        overviewCoverage: null,
        overviewAttention: [],
        recentEvents: [],
        visionStats: [],
        blacklistedStyles: [],
        selectedOutlier: null,
        selectedGene: '',
        selectedGeneDetail: null,
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
        overviewCoverage: document.getElementById('overview-coverage'),
        attentionList: document.getElementById('attention-list'),
        overviewEvents: document.getElementById('overview-events'),
        outlierPlot: document.getElementById('outlier-plot'),
        outlierDetail: document.getElementById('outlier-detail'),
        styleTag: document.getElementById('style-tag'),
        styleName: document.getElementById('style-name'),
        styleReason: document.getElementById('style-reason'),
        styleRemove: document.getElementById('style-remove'),
        visionStatsList: document.getElementById('vision-stats-list'),
        stylesNotes: document.getElementById('styles-notes'),
        activityFilter: document.getElementById('activity-filter'),
        activityList: document.getElementById('activity-list'),
        status: document.getElementById('gallery-filter'),
        stale: document.getElementById('gallery-sort'),
        limit: document.getElementById('gallery-limit'),
        search: document.getElementById('gallery-search'),
        token: document.getElementById('admin-token'),
        refresh: document.getElementById('assets-refresh'),
        meta: document.getElementById('assets-meta'),
        body: document.getElementById('gallery-grid'),
        detail: document.getElementById('gallery-detail'),
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
        if (tab === 'styles' && !state.visionStats.length) {
          refreshVisionStats();
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
          '<article class="activity-card">',
          '<div>',
          '<div class="activity-title"><strong>' + esc(evt.symbol || 'unknown') + '</strong>' + statusPill(evt.action || 'event') + '</div>',
          '<div class="small">' + esc(evt.reason || '') + '</div>',
          (evt.actor ? '<div class="activity-actor">' + esc(evt.actor) + '</div>' : ''),
          '</div>',
          '<div class="event-meta">' + esc(evt.created_at || '') + '</div>',
          '</article>'
        ].join('');
      }

      function renderActivityFeed() {
        var query = String((els.activityFilter && els.activityFilter.value) || '').trim().toLowerCase();
        var events = (state.recentEvents || []).filter(function (evt) {
          if (!query) return true;
          return [evt.symbol, evt.action, evt.reason, evt.actor].some(function (value) {
            return String(value || '').toLowerCase().includes(query);
          });
        });
        els.activityList.innerHTML = events.map(eventMarkup).join('') || '<article class="activity-card"><div><strong>No matching activity.</strong></div><div></div></article>';
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

        var coverage = state.overviewCoverage || null;
        if (coverage) {
          var total = Math.max(1, Number(coverage.total || 0));
          var segments = [
            { key: 'zero', label: '0 candidates', color: '#c0392b' },
            { key: 'one', label: '1 candidate', color: '#e67e22' },
            { key: 'two_to_five', label: '2-5 candidates', color: '#7dcea0' },
            { key: 'six_plus', label: '6+ candidates', color: '#5dade2' }
          ];
          els.overviewCoverage.innerHTML = [
            '<div class="coverage-bar">',
            segments.map(function (segment) {
              var value = Number(coverage[segment.key] || 0);
              var width = (value / total) * 100;
              return '<div class="coverage-segment" style="width:' + width + '%; background:' + segment.color + '"></div>';
            }).join(''),
            '</div>',
            '<div class="coverage-legend">',
            segments.map(function (segment) {
              return [
                '<div class="coverage-row">',
                '<span class="coverage-dot" style="background:' + segment.color + '"></span>',
                '<span>' + esc(segment.label) + '</span>',
                '<strong>' + esc(String(coverage[segment.key] || 0)) + '</strong>',
                '</div>'
              ].join('');
            }).join(''),
            '</div>'
          ].join('');
        } else {
          els.overviewCoverage.innerHTML = '<div class="small">Loading coverage…</div>';
        }

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

        els.overviewEvents.innerHTML = (state.recentEvents || []).slice(0, 8).map(eventMarkup).join('') || '<article class="activity-card"><div><strong>No recent activity.</strong></div><div></div></article>';
        renderActivityFeed();
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
          var results = await Promise.all([
            apiJson('/overview?event_limit=24', { method: 'GET' }),
            apiJson('/coverage', { method: 'GET' })
          ]);
          var data = results[0] || {};
          state.overviewSummary = data.summary || null;
          state.overviewCoverage = results[1] || null;
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
        if (state.visionStats.length) {
          await refreshVisionStats();
        }
      }

      function renderVisionStats() {
        var rows = (state.visionStats || []).slice(0, 24);
        els.visionStatsList.innerHTML = rows.length ? rows.map(function (row) {
          return [
            '<article class="vision-row">',
            '<div class="vision-cell">',
            '<strong>' + esc(row.artist_name || row.artist_tag || row.vision_id || 'Unknown vision') + '</strong>',
            '<div class="small">' + esc(row.artist_tag || row.vision_id || '') + '</div>',
            '<div class="badge-row">' + (row.blacklisted ? '<span class="badge-pill badge-mismatch">Blacklisted</span>' : '<span class="badge-pill badge-live">Active</span>') + '</div>',
            '</div>',
            '<div class="vision-cell"><strong>' + esc(String(row.live_count || 0)) + '</strong><div class="small">live picks</div></div>',
            '<div class="vision-cell"><strong>' + esc(String(row.score || 0)) + '</strong><div class="small">net score</div></div>',
            '<div class="vision-cell"><strong>' + esc(String(row.image_count || 0)) + '</strong><div class="small">images</div></div>',
            '<div class="vision-cell"><strong>' + esc(String(Math.round((Number(row.rejection_rate || 0) * 1000)) / 10)) + '%</strong><div class="small">reject rate</div></div>',
            '</article>'
          ].join('');
        }).join('') : '<div class="gallery-empty">No vision stats yet.</div>';

        els.stylesNotes.innerHTML = (state.blacklistedStyles || []).length
          ? state.blacklistedStyles.map(function (row) {
              return [
                '<article class="list-row">',
                '<div>',
                '<strong>' + esc(row.artist_name || row.artist_tag || 'Unknown source') + '</strong>',
                '<div class="small">' + esc(row.reason || 'No reason recorded.') + '</div>',
                '</div>',
                '<div class="event-meta">' + esc(row.updated_at || row.created_at || '') + '</div>',
                '</article>'
              ].join('');
            }).join('')
          : '<article class="list-row"><div><strong>No blacklisted styles.</strong><div class="small">If one starts producing junk, remove it here and it will show up in this log.</div></div><div></div></article>';
      }

      async function refreshVisionStats() {
        try {
          if (els.visionStatsList) {
            els.visionStatsList.innerHTML = '<div class="gallery-empty">Loading vision scorecard…</div>';
          }
          var data = await apiJson('/votes/vision-stats', { method: 'GET' });
          state.visionStats = Array.isArray(data.rows) ? data.rows : [];
          state.blacklistedStyles = Array.isArray(data.blacklisted) ? data.blacklisted : [];
          renderVisionStats();
        } catch (err) {
          setLog({ error: 'Vision stats failed', details: err.response || String(err.message || err) });
        }
      }

      function filteredAssets() {
        return state.assets.slice();
      }

      function detailEventMarkup(evt) {
        return [
          '<article class="event-row">',
          '<div class="event-thumb">',
          (evt.thumb_url ? '<img src="' + esc(evt.thumb_url) + '" alt="Event thumbnail" loading="lazy" />' : ''),
          '</div>',
          '<div class="event-meta-block">',
          '<strong>' + esc(evt.action || 'event') + '</strong>',
          '<div class="small">' + esc(evt.reason || 'No note recorded.') + '</div>',
          '<div class="small mono">' + esc(evt.created_at || '') + '</div>',
          '</div>',
          '</article>'
        ].join('');
      }

      function renderGeneDetail() {
        var detail = state.selectedGeneDetail;
        if (!detail) {
          els.detail.innerHTML = [
            '<div class="detail-kicker">Gene review</div>',
            '<div class="detail-title">Pick a gene</div>',
            '<div class="detail-copy">The gallery now works like a visual inbox. Click any card to inspect candidates, notes, and recent admin actions.</div>'
          ].join('');
          return;
        }

        var headerBadges = [];
        if (detail.live_sha) headerBadges.push('<span class="badge-pill badge-live">Live portrait set</span>');
        if (detail.admin_override) headerBadges.push('<span class="badge-pill badge-pinned">Pinned override</span>');

        var candidates = Array.isArray(detail.candidates) ? detail.candidates : [];
        var recentEvents = Array.isArray(detail.recent_events) ? detail.recent_events : [];

        els.detail.innerHTML = [
          '<div class="detail-kicker">Gene review</div>',
          '<div class="detail-title">' + esc(detail.gene_symbol || '') + '</div>',
          (detail.full_name ? '<div class="small">' + esc(detail.full_name) + '</div>' : ''),
          '<div class="badge-row">' + headerBadges.join('') + '</div>',
          '<div class="detail-copy">' + esc(detail.manifestation || 'No manifestation note yet.') + '</div>',
          '<div class="candidate-actions">',
          '<button class="btn-flat" data-detail-action="rollback" data-symbol="' + esc(detail.gene_symbol || '') + '">Roll back</button>',
          '<button class="btn-flat" data-detail-action="unpublish" data-symbol="' + esc(detail.gene_symbol || '') + '">Unpublish</button>',
          (detail.admin_override ? '<button class="btn-flat" data-detail-action="clear-override" data-symbol="' + esc(detail.gene_symbol || '') + '">Unpin</button>' : ''),
          '</div>',
          '<div class="detail-kicker">Candidates</div>',
          '<div class="candidate-list">',
          (candidates.length ? candidates.map(function (candidate) {
            var badges = [statusPill(candidate.status)];
            if (candidate.is_live) badges.push('<span class="badge-pill badge-live">Live</span>');
            if (candidate.is_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>');
            if (candidate.is_legacy) badges.push('<span class="badge-pill badge-missing">Legacy</span>');
            return [
              '<article class="candidate-row">',
              '<div class="candidate-thumb">',
              (candidate.thumb_url ? '<img src="' + esc(candidate.thumb_url) + '" alt="Candidate portrait" loading="lazy" />' : ''),
              '</div>',
              '<div class="candidate-meta">',
              '<div><strong>' + esc(candidate.artist_name || candidate.artist_tag || candidate.vision_id || 'Unknown vision') + '</strong></div>',
              '<div class="small">score ' + esc(String(candidate.vote_score || 0)) + ' · +' + esc(String(candidate.image_upvotes || 0)) + ' / -' + esc(String(candidate.image_downvotes || 0)) + '</div>',
              '<div class="small mono">' + esc(shortSha(candidate.asset_sha256 || '')) + '</div>',
              '<div class="badge-row">' + badges.join('') + '</div>',
              '<div class="candidate-actions">',
              '<button class="btn-flat" data-detail-action="copy" data-symbol="' + esc(detail.gene_symbol || '') + '" data-sha="' + esc(candidate.asset_sha256 || '') + '">Copy SHA</button>',
              (!candidate.is_live ? '<button class="btn-primary" data-detail-action="publish" data-symbol="' + esc(detail.gene_symbol || '') + '" data-sha="' + esc(candidate.asset_sha256 || '') + '">Pin live</button>' : ''),
              '<button class="btn-danger" data-detail-action="reject" data-symbol="' + esc(detail.gene_symbol || '') + '" data-sha="' + esc(candidate.asset_sha256 || '') + '">Reject</button>',
              '</div>',
              '</div>',
              '</article>'
            ].join('');
          }).join('') : '<div class="gallery-empty">No candidate images found for this gene.</div>'),
          '</div>',
          '<div class="detail-kicker">Recent events</div>',
          '<div class="event-list">',
          (recentEvents.length ? recentEvents.slice(0, 6).map(detailEventMarkup).join('') : '<div class="gallery-empty">No admin events yet.</div>'),
          '</div>'
        ].join('');
      }

      async function refreshGeneDetail(symbol) {
        var safeSymbol = String(symbol || '').trim().toUpperCase();
        if (!safeSymbol) return;
        state.selectedGene = safeSymbol;
        state.selectedGeneDetail = null;
        els.detail.innerHTML = [
          '<div class="detail-kicker">Gene review</div>',
          '<div class="detail-title">' + esc(safeSymbol) + '</div>',
          '<div class="detail-copy">Loading candidate images and recent events…</div>'
        ].join('');
        var detail = await apiJson('/gene/' + encodeURIComponent(safeSymbol), { method: 'GET' });
        state.selectedGeneDetail = detail || null;
        renderGeneDetail();
      }

      function renderTable() {
        var assets = filteredAssets();
        if (!assets.length) {
          els.body.innerHTML = '<div class="gallery-empty" style="grid-column:1 / -1">Nothing matched this gallery slice.</div>';
          return;
        }
        els.body.innerHTML = assets.map(function (a) {
          var imageUrl = a.live_thumb_url || a.leader_thumb_url || a.live_medium_url || a.leader_medium_url || '';
          var badges = [];
          if (a.live_sha) badges.push('<span class="badge-pill badge-live">Live</span>');
          if (a.admin_override) badges.push('<span class="badge-pill badge-pinned">Pinned</span>');
          if (a.has_mismatch) badges.push('<span class="badge-pill badge-mismatch">Mismatch</span>');
          if (a.missing) badges.push('<span class="badge-pill badge-missing">No portrait</span>');
          if (a.has_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>');
          return [
            '<button class="gallery-card' + (state.selectedGene === String(a.gene_symbol || '') ? ' is-selected' : '') + '" type="button" data-gene-symbol="' + esc(a.gene_symbol || '') + '">',
            '<div class="gallery-media">',
            (imageUrl ? '<img src="' + esc(imageUrl) + '" alt="Portrait for ' + esc(a.gene_symbol || '') + '" loading="lazy" />' : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No portrait</div>'),
            '</div>',
            '<div class="gallery-title">' + esc(a.gene_symbol || '') + '</div>',
            '<div class="gallery-subtitle">' + esc((a.candidate_count || 0) + ' candidates · ' + (a.live_vision_id || a.leader_vision_id || 'no vision')) + '</div>',
            '<div class="badge-row">' + badges.join('') + '</div>',
            '</button>'
          ].join('');
        }).join('');
      }

      async function refreshAssets() {
        try {
          els.refresh.disabled = true;
          els.meta.textContent = 'Loading...';
          var status = encodeURIComponent(String(els.status.value || 'all').toLowerCase());
          var sort = encodeURIComponent(String(els.stale.value || 'name').toLowerCase());
          var limit = Math.max(1, Math.min(200, Number.parseInt(els.limit.value || '120', 10) || 120));
          var symbol = encodeURIComponent(String(els.search.value || '').trim().toUpperCase());
          var path = '/gallery?page=1&filter=' + status + '&sort=' + sort + '&limit=' + limit;
          if (symbol) path += '&query=' + symbol;
          var data = await apiJson(path, { method: 'GET' });
          state.assets = Array.isArray(data.rows) ? data.rows : [];
          state.archiveLoaded = true;
          els.meta.innerHTML = [
            '<span>' + state.assets.length + ' shown</span>',
            '<span>total ' + esc(String(data.total || state.assets.length)) + '</span>',
            '<span>filter ' + esc(String(els.status.value || 'all')) + '</span>',
            '<span>sort ' + esc(String(els.stale.value || 'name')) + '</span>'
          ].join(' &middot; ');
          renderTable();
          if (state.selectedGene && state.assets.some(function (row) { return String(row.gene_symbol || '') === state.selectedGene; })) {
            refreshGeneDetail(state.selectedGene).catch(function (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            });
          }
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
          els.stale.value = 'name';
          els.search.value = symbol;
          setActiveTab(tab);
          refreshAssets();
        });

        if (els.body) {
          els.body.addEventListener('click', function (ev) {
            var card = ev.target.closest('[data-gene-symbol]');
            if (!card) return;
            refreshGeneDetail(String(card.getAttribute('data-gene-symbol') || '')).catch(function (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            });
          });
        }

        if (els.detail) {
          els.detail.addEventListener('click', async function (ev) {
            var btn = ev.target.closest('[data-detail-action]');
            if (!btn) return;
            var action = String(btn.getAttribute('data-detail-action') || '');
            var symbol = String(btn.getAttribute('data-symbol') || '');
            var sha = String(btn.getAttribute('data-sha') || '');
            try {
              btn.disabled = true;
              await handleTableAction(action, symbol, sha);
              await refreshGeneDetail(symbol);
            } catch (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            } finally {
              btn.disabled = false;
            }
          });
        }

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
        els.visionStatsList.innerHTML = '<div class="gallery-empty">Open this tab to load the scorecard.</div>';
        els.stylesNotes.innerHTML = '<article class="list-row"><div><strong>No blacklisted styles.</strong><div class="small">Open the tab to load the current blacklist log.</div></div><div></div></article>';
        els.refresh.addEventListener('click', function () {
          refreshAssets();
        });
        els.status.addEventListener('change', refreshAssets);
        els.stale.addEventListener('change', refreshAssets);
        els.limit.addEventListener('change', refreshAssets);
        els.search.addEventListener('input', refreshAssets);
        if (els.activityFilter) {
          els.activityFilter.addEventListener('input', renderActivityFeed);
        }
        bindActions();
        refreshOverview();
      }

      init();
    })();
  </script>
</body>
</html>
`
