export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Admin</title>
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
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
    .overview-event {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      min-height: 56px;
      padding: 8px 0;
      border-bottom: 1px solid #f0ede8;
    }
    .overview-event:last-child { border-bottom: none; }
    .overview-thumb {
      width: 40px;
      height: 40px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: #ece7e1;
    }
    .overview-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
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
      position: relative;
      display: grid;
      gap: 8px;
      padding: 8px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: rgba(255,255,255,0.55);
      text-align: left;
      cursor: pointer;
      overflow: hidden;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
      content-visibility: auto;
      contain-intrinsic-size: 220px;
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
    .gallery-media-split {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      height: 100%;
    }
    .gallery-media-panel {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      min-width: 0;
      background: rgba(255,255,255,0.2);
    }
    .gallery-media-panel + .gallery-media-panel {
      border-left: 1px solid rgba(111, 96, 83, 0.16);
    }
    .gallery-media-image {
      min-height: 0;
    }
    .gallery-media-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .gallery-media-label {
      padding: 8px;
      border-top: 1px solid rgba(111, 96, 83, 0.14);
      background: rgba(251,248,243,0.92);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
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
    .gallery-card-meta {
      display: grid;
      gap: 4px;
    }
    .gallery-card-overlay {
      position: absolute;
      inset: 8px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px;
      border-radius: 10px;
      background: rgba(38, 34, 29, 0.58);
      opacity: 0;
      transform: scale(0.98);
      transition: opacity 120ms ease, transform 120ms ease;
      pointer-events: none;
    }
    .gallery-card:hover .gallery-card-overlay,
    .gallery-card:focus-within .gallery-card-overlay,
    .gallery-card.is-selected .gallery-card-overlay {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }
    .gallery-overlay-button {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.12);
      color: #fff;
      border-radius: 999px;
      min-height: 34px;
      min-width: 112px;
      padding: 0 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .gallery-overlay-button--primary {
      background: rgba(247, 181, 114, 0.22);
      border-color: rgba(247, 181, 114, 0.45);
    }
    .gallery-overlay-button--danger {
      background: rgba(196, 74, 56, 0.2);
      border-color: rgba(196, 74, 56, 0.45);
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
    .detail-hero {
      display: grid;
      gap: 10px;
    }
    .detail-hero-frame {
      aspect-ratio: 1 / 1;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: #ece7e1;
    }
    .detail-hero-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .detail-hero-meta {
      display: grid;
      gap: 4px;
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
      content-visibility: auto;
      contain-intrinsic-size: 110px;
    }
    .candidate-row {
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    .candidate-row:hover {
      border-color: var(--border-strong);
      background: rgba(255,255,255,0.92);
      transform: translateY(-1px);
    }
    .candidate-row.is-selected {
      border-color: var(--accent);
      background: rgba(255,255,255,0.96);
      box-shadow: 0 0 0 1px rgba(184, 74, 38, 0.08);
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
      content-visibility: auto;
      contain-intrinsic-size: 84px;
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
    .log-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .activity-card {
      display: grid;
      grid-template-columns: 3px 36px minmax(0, 1fr) auto;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255,255,255,0.76);
      content-visibility: auto;
      contain-intrinsic-size: 88px;
    }
    .activity-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .activity-accent {
      align-self: stretch;
      border-radius: 999px;
      background: var(--border-strong);
    }
    .activity-accent-publish { background: #22c55e; }
    .activity-accent-reject { background: #ef4444; }
    .activity-accent-rollback { background: #f59e0b; }
    .activity-accent-unpublish { background: #6b7280; }
    .activity-accent-unstale { background: #3b82f6; }
    .activity-thumb {
      width: 36px;
      height: 36px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: #ece7e1;
    }
    .activity-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
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
      <p>Images first, bookkeeping second. This page steers the canonical portrait shown in the extension. Votes auto-pick the canonical image unless a manual override is active.</p>
    </header>

    <nav id="admin-tabs">
      <button class="tab-btn active" data-tab="overview">Home</button>
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

    <!-- ── browse (archive) ── -->
    <div class="panel" id="panel-archive" style="display:none;">
      <div class="section-head">
        <div>
          <h2>Gallery</h2>
          <p class="small">Canonical means the portrait shown in the extension. Votes pick it automatically unless you deliberately pin a manual override.</p>
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
                <option value="pinned">manual override</option>
                <option value="missing">missing canonical portrait</option>
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
              <input id="gallery-limit" type="number" min="1" max="120" value="60" />
            </label>
          </div>
          <div class="toggle-group">
            <button class="toggle-pill active" type="button" data-gallery-mode="live">Canonical</button>
            <button class="toggle-pill" type="button" data-gallery-mode="all">All candidates</button>
            <button class="toggle-pill" type="button" data-gallery-mode="side-by-side">Canonical vs votes</button>
          </div>
        </div>
        <div class="gallery-toolbar-row">
          <div class="small">Click a gene to inspect candidates. If a manual override exists, the compare view shows the current canonical portrait against the vote winner.</div>
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
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><button class="btn-flat" type="button" data-vision-sort="vision">Vision</button></th>
                  <th><button class="btn-flat" type="button" data-vision-sort="images">Images</button></th>
                  <th><button class="btn-flat" type="button" data-vision-sort="score">Avg vote</button></th>
                  <th><button class="btn-flat" type="button" data-vision-sort="rejection">Rejection rate</button></th>
                  <th><button class="btn-flat" type="button" data-vision-sort="live">Currently canonical</button></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="vision-stats-list"></tbody>
            </table>
          </div>
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
      <div class="log-filters" style="margin-bottom: 12px;">
        <button class="toggle-pill active" type="button" data-log-filter="all">All actions</button>
        <button class="toggle-pill" type="button" data-log-filter="publish">Publish</button>
        <button class="toggle-pill" type="button" data-log-filter="reject">Reject</button>
        <button class="toggle-pill" type="button" data-log-filter="rollback">Rollback</button>
        <button class="toggle-pill" type="button" data-log-filter="unpublish">Unpublish</button>
        <button class="toggle-pill" type="button" data-log-filter="unstale">Unstale</button>
      </div>
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
        overviewSummary: null,
        overviewCoverage: null,
        overviewAttention: [],
        recentEvents: [],
        visionStats: [],
        blacklistedStyles: [],
        selectedGene: '',
        selectedGeneDetail: null,
        selectedCandidateSha: '',
        activeTab: 'overview',
        archiveLoaded: false,
        galleryMode: 'live',
        visionSort: { key: 'live', dir: 'desc' },
        activityActionFilter: 'all'
      };

      var els = {
        tabs: document.getElementById('admin-tabs'),
        panels: {
          overview: document.getElementById('panel-overview'),
          archive: document.getElementById('panel-archive'),
          styles: document.getElementById('panel-styles'),
          activity: document.getElementById('panel-activity')
        },
        overviewMetrics: document.getElementById('overview-metrics'),
        overviewCoverage: document.getElementById('overview-coverage'),
        attentionList: document.getElementById('attention-list'),
        overviewEvents: document.getElementById('overview-events'),
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

      function syncGalleryModeButtons() {
        document.querySelectorAll('[data-gallery-mode]').forEach(function (btn) {
          btn.classList.toggle('active', String(btn.getAttribute('data-gallery-mode') || 'live') === state.galleryMode);
        });
      }

      function activeModeLabel() {
        if (state.galleryMode === 'all') return 'all candidates';
        if (state.galleryMode === 'side-by-side') return 'canonical vs votes';
        return 'canonical only';
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
        if (asset.is_current) out.push('<span class="flag flag-current">canonical</span>');
        if (asset.is_vote_leader) out.push('<span class="flag flag-leader">top voted</span>');
        if (asset.is_current && asset.admin_override) out.push('<span class="flag flag-override">manual override</span>');
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
        var token = String((els.token && els.token.value) || '').trim();
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

      function overviewEventMarkup(evt) {
        return [
          '<article class="overview-event">',
          '<div class="overview-thumb">',
          (evt.thumb_url ? '<img src="' + esc(evt.thumb_url) + '" alt="Portrait thumbnail" loading="lazy" width="40" height="40" />' : ''),
          '</div>',
          '<div>',
          '<strong>' + esc(evt.symbol || 'unknown') + '</strong>',
          '<div class="small">' + esc(evt.action || 'event') + (evt.reason ? ' · ' + esc(evt.reason) : '') + '</div>',
          '</div>',
          '<div class="event-meta">' + esc(evt.created_at || '') + '</div>',
          '</article>'
        ].join('');
      }

      function activityAccent(action) {
        var value = String(action || '').toLowerCase();
        if (value === 'publish') return 'activity-accent-publish';
        if (value === 'reject') return 'activity-accent-reject';
        if (value === 'rollback') return 'activity-accent-rollback';
        if (value === 'unpublish') return 'activity-accent-unpublish';
        if (value === 'unstale') return 'activity-accent-unstale';
        return '';
      }

      function eventMarkup(evt) {
        return [
          '<article class="activity-card">',
          '<div class="activity-accent ' + activityAccent(evt.action) + '"></div>',
          '<div class="activity-thumb">',
          (evt.thumb_url ? '<img src="' + esc(evt.thumb_url) + '" alt="Event thumbnail" loading="lazy" width="36" height="36" />' : ''),
          '</div>',
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
          if (state.activityActionFilter !== 'all' && String(evt.action || '').toLowerCase() !== state.activityActionFilter) return false;
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
          metricMarkup('Canonical set', summary.with_live, 'Genes with a canonical portrait set.'),
          metricMarkup('Broken canonical', summary.drift, 'Canonical portrait points at a missing or broken asset.'),
          metricMarkup('Missing', summary.missing, 'Genes with no usable portrait candidates.'),
          metricMarkup('Stale', summary.stale_assets, 'Old images waiting for cleanup.'),
          metricMarkup('Legacy', summary.legacy_assets, 'Leftovers from older sync generations.')
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
            return attentionMarkup(item.symbol + ' -- broken canonical', 'The canonical portrait points at a missing or broken asset.', 'Browse', item.symbol);
          }
          if (item.kind === 'missing') {
            return attentionMarkup(item.symbol + ' -- no canonical portrait', 'No usable candidate exists yet, so the extension has nothing canonical to show.', 'Look', item.symbol);
          }
          if (item.kind === 'override') {
            return attentionMarkup(item.symbol + ' -- manual override', 'Votes are not auto-picking the canonical portrait until you clear the override.', 'Look', item.symbol);
          }
          if (item.kind === 'stale') {
            return attentionMarkup(item.symbol + ' -- stale images', String(item.stale_assets || 0) + ' old images hanging around.', 'Clean up', item.symbol);
          }
          return '';
        }).filter(Boolean);
        if (!notes.length) notes.push('<article class="list-row"><div><strong>Nothing needs attention.</strong><div class="small">Use Gallery or Log for a deeper look.</div></div><div></div></article>');
        els.attentionList.innerHTML = notes.join('');

        els.overviewEvents.innerHTML = (state.recentEvents || []).slice(0, 12).map(overviewEventMarkup).join('') || '<article class="list-row"><div><strong>No recent activity.</strong></div><div></div></article>';
        renderActivityFeed();
      }

      async function refreshOverview() {
        try {
          var results = await Promise.all([
            apiJson('/overview?event_limit=80', { method: 'GET' }),
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

      async function refreshDerivedAdminViews() {
        await refreshOverview();
        if (state.visionStats.length) {
          await refreshVisionStats();
        }
      }

      function renderVisionStats() {
        var sortKey = state.visionSort.key;
        var sortDir = state.visionSort.dir === 'asc' ? 1 : -1;
        var rows = (state.visionStats || []).slice().sort(function (left, right) {
          function label(row) {
            return String(row.artist_name || row.artist_tag || row.vision_id || '');
          }
          if (sortKey === 'vision') return label(left).localeCompare(label(right)) * sortDir;
          if (sortKey === 'images') return (Number(left.image_count || 0) - Number(right.image_count || 0)) * sortDir;
          if (sortKey === 'score') return (Number(left.avg_vote || 0) - Number(right.avg_vote || 0)) * sortDir;
          if (sortKey === 'rejection') return (Number(left.rejection_rate || 0) - Number(right.rejection_rate || 0)) * sortDir;
          return (Number(left.live_count || 0) - Number(right.live_count || 0)) * sortDir;
        });
        els.visionStatsList.innerHTML = rows.length ? rows.map(function (row) {
          return [
            '<tr>',
            '<td><strong>' + esc(row.artist_name || row.artist_tag || row.vision_id || 'Unknown vision') + '</strong><div class="small">' + esc(row.artist_tag || row.vision_id || '') + '</div></td>',
            '<td>' + esc(String(row.image_count || 0)) + '</td>',
            '<td>' + esc(String(Math.round((Number(row.avg_vote || 0) * 100) ) / 100)) + '</td>',
            '<td>' + esc(String(Math.round((Number(row.rejection_rate || 0) * 1000)) / 10)) + '%</td>',
            '<td>' + esc(String(row.live_count || 0)) + '</td>',
            '<td>' + (row.blacklisted ? '<span class="small">Blacklisted</span>' : '<button class="btn-flat" type="button" data-blacklist-tag="' + esc(row.artist_tag || '') + '" data-blacklist-name="' + esc(row.artist_name || '') + '">Blacklist</button>') + '</td>',
            '</tr>'
          ].join('');
        }).join('') : '<tr><td colspan="6">No vision stats yet.</td></tr>';

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

      function dedupeGalleryRows(rows) {
        var seen = new Set();
        return (Array.isArray(rows) ? rows : []).filter(function (row) {
          var symbol = String((row && row.gene_symbol) || '');
          if (!symbol || seen.has(symbol)) return false;
          seen.add(symbol);
          return true;
        });
      }

      function detailEventMarkup(evt) {
        return [
          '<article class="event-row">',
          '<div class="event-thumb">',
          (evt.thumb_url ? '<img src="' + esc(evt.thumb_url) + '" alt="Event thumbnail" loading="lazy" width="64" height="64" />' : ''),
          '</div>',
          '<div class="event-meta-block">',
          '<strong>' + esc(evt.action || 'event') + '</strong>',
          '<div class="small">' + esc(evt.reason || 'No note recorded.') + '</div>',
          '<div class="small mono">' + esc(evt.created_at || '') + '</div>',
          '</div>',
          '</article>'
        ].join('');
      }

      function pickDetailCandidate(detail) {
        var candidates = Array.isArray(detail && detail.candidates) ? detail.candidates : [];
        if (!candidates.length) return null;
        var preferredSha = String(state.selectedCandidateSha || '').toLowerCase();
        if (preferredSha) {
          var preferred = candidates.find(function (candidate) {
            return String(candidate.asset_sha256 || '').toLowerCase() === preferredSha;
          });
          if (preferred) return preferred;
        }
        var live = candidates.find(function (candidate) {
          return Boolean(candidate && candidate.is_live);
        });
        return live || candidates[0] || null;
      }

      function galleryOverlayButton(label, action, symbol, sha, tone) {
        var classes = ['gallery-overlay-button'];
        if (tone === 'primary') classes.push('gallery-overlay-button--primary');
        if (tone === 'danger') classes.push('gallery-overlay-button--danger');
        return '<button class="' + classes.join(' ') + '" type="button" data-card-action="' + esc(action) + '" data-symbol="' + esc(symbol || '') + '" data-sha="' + esc(sha || '') + '">' + esc(label) + '</button>';
      }

      function renderLiveCard(a) {
        var imageUrl = a.live_thumb_url || a.leader_thumb_url || a.live_medium_url || a.leader_medium_url || '';
        var badges = [];
        if (a.live_sha) badges.push('<span class="badge-pill badge-live">Canonical</span>');
        if (a.admin_override) badges.push('<span class="badge-pill badge-pinned">Manual override</span>');
        if (a.leader_sha && a.leader_sha !== a.live_sha) badges.push('<span class="badge-pill badge-pinned">Votes differ</span>');
        if (a.has_mismatch) badges.push('<span class="badge-pill badge-mismatch">Mismatch</span>');
        if (a.missing) badges.push('<span class="badge-pill badge-missing">No canonical portrait</span>');
        if (a.has_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>');
        var actions = [];
        if (a.leader_sha && a.leader_sha !== a.live_sha) {
          actions.push(galleryOverlayButton('Set vote winner', 'publish', a.gene_symbol, a.leader_sha, 'primary'));
        }
        if (a.live_sha) {
          actions.push(galleryOverlayButton('Reject', 'reject', a.gene_symbol, a.live_sha, 'danger'));
        }
        return [
          '<article class="gallery-card' + (state.selectedGene === String(a.gene_symbol || '') ? ' is-selected' : '') + '" role="button" tabindex="0" data-gene-symbol="' + esc(a.gene_symbol || '') + '">',
          '<div class="gallery-media">',
          (imageUrl ? '<img src="' + esc(imageUrl) + '" alt="Portrait for ' + esc(a.gene_symbol || '') + '" loading="lazy" width="160" height="160" />' : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No portrait</div>'),
          '</div>',
          '<div class="gallery-card-meta">',
          '<div class="gallery-title">' + esc(a.gene_symbol || '') + '</div>',
          '<div class="gallery-subtitle">' + esc((a.candidate_count || 0) + ' candidates · ' + (a.live_vision_id || a.leader_vision_id || 'no vision')) + '</div>',
          '<div class="badge-row">' + badges.join('') + '</div>',
          '</div>',
          (actions.length ? '<div class="gallery-card-overlay">' + actions.join('') + '</div>' : ''),
          '</article>'
        ].join('');
      }

      function renderCandidateCard(a) {
        var badges = [statusPill(a.status)];
        if (a.is_live) badges.push('<span class="badge-pill badge-live">Canonical</span>');
        if (a.admin_override) badges.push('<span class="badge-pill badge-pinned">Manual override</span>');
        if (a.is_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>');
        if (a.is_legacy) badges.push('<span class="badge-pill badge-missing">Legacy</span>');
        var actions = [galleryOverlayButton('Review', 'open', a.gene_symbol, '')];
        actions.push(galleryOverlayButton('Copy SHA', 'copy', a.gene_symbol, a.asset_sha256));
        if (!a.is_live) actions.push(galleryOverlayButton('Make canonical', 'publish', a.gene_symbol, a.asset_sha256, 'primary'));
        actions.push(galleryOverlayButton('Reject', 'reject', a.gene_symbol, a.asset_sha256, 'danger'));
        return [
          '<article class="gallery-card' + (state.selectedGene === String(a.gene_symbol || '') ? ' is-selected' : '') + '" role="button" tabindex="0" data-gene-symbol="' + esc(a.gene_symbol || '') + '">',
          '<div class="gallery-media">',
          (a.thumb_url ? '<img src="' + esc(a.thumb_url) + '" alt="Candidate portrait for ' + esc(a.gene_symbol || '') + '" loading="lazy" width="160" height="160" />' : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No portrait</div>'),
          '</div>',
          '<div class="gallery-card-meta">',
          '<div class="gallery-title">' + esc(a.gene_symbol || '') + '</div>',
          '<div class="gallery-subtitle">' + esc((a.artist_name || a.artist_tag || a.vision_id || 'Unknown vision') + ' · score ' + String(a.image_score || 0)) + '</div>',
          '<div class="badge-row">' + badges.join('') + '</div>',
          '</div>',
          '<div class="gallery-card-overlay">' + actions.join('') + '</div>',
          '</article>'
        ].join('');
      }

      function renderCompareCard(a) {
        var badges = [];
        if (a.live_sha) badges.push('<span class="badge-pill badge-live">Canonical</span>');
        if (a.admin_override) badges.push('<span class="badge-pill badge-pinned">Manual override</span>');
        if (a.leader_sha && a.leader_sha !== a.live_sha) badges.push('<span class="badge-pill badge-pinned">Votes differ</span>');
        if (a.has_mismatch) badges.push('<span class="badge-pill badge-mismatch">Mismatch</span>');
        if (a.missing) badges.push('<span class="badge-pill badge-missing">No canonical portrait</span>');
        var actions = [];
        if (a.leader_sha && a.leader_sha !== a.live_sha) actions.push(galleryOverlayButton('Set vote winner', 'publish', a.gene_symbol, a.leader_sha, 'primary'));
        if (a.live_sha) actions.push(galleryOverlayButton('Reject', 'reject', a.gene_symbol, a.live_sha, 'danger'));
        return [
          '<article class="gallery-card' + (state.selectedGene === String(a.gene_symbol || '') ? ' is-selected' : '') + '" role="button" tabindex="0" data-gene-symbol="' + esc(a.gene_symbol || '') + '">',
          '<div class="gallery-media">',
          '<div class="gallery-media-split">',
          '<div class="gallery-media-panel">',
          '<div class="gallery-media-image">',
          (a.live_thumb_url ? '<img src="' + esc(a.live_thumb_url) + '" alt="Canonical portrait for ' + esc(a.gene_symbol || '') + '" loading="lazy" width="160" height="160" />' : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No canonical portrait</div>'),
          '</div>',
          '<div class="gallery-media-label">Canonical</div>',
          '</div>',
          '<div class="gallery-media-panel">',
          '<div class="gallery-media-image">',
          (a.leader_thumb_url ? '<img src="' + esc(a.leader_thumb_url) + '" alt="Vote winner for ' + esc(a.gene_symbol || '') + '" loading="lazy" width="160" height="160" />' : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No vote winner</div>'),
          '</div>',
          '<div class="gallery-media-label">Vote winner</div>',
          '</div>',
          '</div>',
          '</div>',
          '<div class="gallery-card-meta">',
          '<div class="gallery-title">' + esc(a.gene_symbol || '') + '</div>',
          '<div class="gallery-subtitle">' + esc((a.live_vision_id || 'no canonical') + ' vs ' + (a.leader_vision_id || 'no vote winner')) + '</div>',
          '<div class="badge-row">' + badges.join('') + '</div>',
          '</div>',
          (actions.length ? '<div class="gallery-card-overlay">' + actions.join('') + '</div>' : ''),
          '</article>'
        ].join('');
      }

      function renderGeneDetail() {
        var detail = state.selectedGeneDetail;
        if (!detail) {
          els.detail.innerHTML = [
            '<div class="detail-kicker">Gene review</div>',
            '<div class="detail-title">Pick a gene</div>',
            '<div class="detail-copy">Click any gene to inspect candidates. The canonical portrait is what the extension shows; votes auto-pick it unless a manual override is active.</div>'
          ].join('');
          return;
        }

        var headerBadges = [];
        if (detail.live_sha) headerBadges.push('<span class="badge-pill badge-live">Canonical portrait set</span>');
        if (detail.admin_override) headerBadges.push('<span class="badge-pill badge-pinned">Manual override</span>');

        var candidates = Array.isArray(detail.candidates) ? detail.candidates : [];
        var recentEvents = Array.isArray(detail.recent_events) ? detail.recent_events : [];
        var heroCandidate = pickDetailCandidate(detail);
        state.selectedCandidateSha = heroCandidate ? String(heroCandidate.asset_sha256 || '') : '';

        els.detail.innerHTML = [
          '<div class="detail-kicker">Gene review</div>',
          (heroCandidate ? [
            '<div class="detail-hero">',
            '<div class="detail-hero-frame">',
            (heroCandidate.medium_url ? '<img src="' + esc(heroCandidate.medium_url) + '" alt="Selected portrait for ' + esc(detail.gene_symbol || '') + '" loading="lazy" width="320" height="320" />' : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No preview</div>'),
            '</div>',
            '<div class="detail-hero-meta">',
            '<strong>' + esc(heroCandidate.artist_name || heroCandidate.artist_tag || heroCandidate.vision_id || 'Unknown vision') + '</strong>',
            '<div class="small">score ' + esc(String(heroCandidate.vote_score || 0)) + ' · +' + esc(String(heroCandidate.image_upvotes || 0)) + ' / -' + esc(String(heroCandidate.image_downvotes || 0)) + '</div>',
            '<div class="small mono">' + esc(shortSha(heroCandidate.asset_sha256 || '')) + '</div>',
            '</div>',
            '</div>'
          ].join('') : ''),
          '<div class="detail-title">' + esc(detail.gene_symbol || '') + '</div>',
          (detail.full_name ? '<div class="small">' + esc(detail.full_name) + '</div>' : ''),
          '<div class="badge-row">' + headerBadges.join('') + '</div>',
          '<div class="detail-copy">' + esc(detail.manifestation || 'No manifestation note yet.') + '</div>',
          '<div class="small">' + esc(detail.admin_override ? 'Manual override is active. Clear it to let votes pick the canonical portrait again.' : 'Votes automatically keep the canonical portrait synced to the top eligible candidate.') + '</div>',
          '<div class="candidate-actions">',
          '<button class="btn-flat" data-detail-action="rollback" data-symbol="' + esc(detail.gene_symbol || '') + '">Roll back</button>',
          '<button class="btn-flat" data-detail-action="unpublish" data-symbol="' + esc(detail.gene_symbol || '') + '">Unpublish</button>',
          (detail.admin_override ? '<button class="btn-flat" data-detail-action="clear-override" data-symbol="' + esc(detail.gene_symbol || '') + '">Clear override</button>' : ''),
          '</div>',
          '<div class="detail-kicker">Candidates</div>',
          '<div class="candidate-list">',
          (candidates.length ? candidates.map(function (candidate) {
            var badges = [statusPill(candidate.status)];
            if (candidate.is_live) badges.push('<span class="badge-pill badge-live">Canonical</span>');
            if (candidate.is_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>');
            if (candidate.is_legacy) badges.push('<span class="badge-pill badge-missing">Legacy</span>');
            return [
              '<article class="candidate-row' + (heroCandidate && String(heroCandidate.asset_sha256 || '') === String(candidate.asset_sha256 || '') ? ' is-selected' : '') + '" data-candidate-sha="' + esc(candidate.asset_sha256 || '') + '">',
              '<div class="candidate-thumb">',
              (candidate.thumb_url ? '<img src="' + esc(candidate.thumb_url) + '" alt="Candidate portrait" loading="lazy" width="64" height="64" />' : ''),
              '</div>',
              '<div class="candidate-meta">',
              '<div><strong>' + esc(candidate.artist_name || candidate.artist_tag || candidate.vision_id || 'Unknown vision') + '</strong></div>',
              '<div class="small">score ' + esc(String(candidate.vote_score || 0)) + ' · +' + esc(String(candidate.image_upvotes || 0)) + ' / -' + esc(String(candidate.image_downvotes || 0)) + '</div>',
              '<div class="small mono">' + esc(shortSha(candidate.asset_sha256 || '')) + '</div>',
              '<div class="badge-row">' + badges.join('') + '</div>',
              '<div class="candidate-actions">',
              '<button class="btn-flat" data-detail-action="copy" data-symbol="' + esc(detail.gene_symbol || '') + '" data-sha="' + esc(candidate.asset_sha256 || '') + '">Copy SHA</button>',
              (!candidate.is_live ? '<button class="btn-primary" data-detail-action="publish" data-symbol="' + esc(detail.gene_symbol || '') + '" data-sha="' + esc(candidate.asset_sha256 || '') + '">Make canonical</button>' : ''),
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
        state.selectedCandidateSha = '';
        els.detail.innerHTML = [
          '<div class="detail-kicker">Gene review</div>',
          '<div class="detail-title">' + esc(safeSymbol) + '</div>',
          '<div class="detail-copy">Loading candidate images, canonical state, and recent events…</div>'
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
          if (state.galleryMode === 'all') return renderCandidateCard(a);
          if (state.galleryMode === 'side-by-side') return renderCompareCard(a);
          return renderLiveCard(a);
        }).join('');
      }

      async function refreshAssets() {
        try {
          els.refresh.disabled = true;
          els.meta.textContent = 'Loading...';
          var status = encodeURIComponent(String(els.status.value || 'all').toLowerCase());
          var sort = encodeURIComponent(String(els.stale.value || 'name').toLowerCase());
          var limit = Math.max(1, Math.min(120, Number.parseInt(els.limit.value || '60', 10) || 60));
          var symbol = encodeURIComponent(String(els.search.value || '').trim().toUpperCase());
          var path = '/gallery?page=1&filter=' + status + '&sort=' + sort + '&limit=' + limit + '&mode=' + encodeURIComponent(state.galleryMode);
          if (symbol) path += '&query=' + symbol;
          var data = await apiJson(path, { method: 'GET' });
          state.galleryMode = String(data.mode || state.galleryMode || 'live');
          syncGalleryModeButtons();
          state.assets = state.galleryMode === 'all' ? (Array.isArray(data.rows) ? data.rows : []) : dedupeGalleryRows(data.rows);
          state.archiveLoaded = true;
          els.meta.innerHTML = [
            '<span>' + state.assets.length + (state.galleryMode === 'all' ? ' cards shown' : ' genes shown') + '</span>',
            '<span>total ' + esc(String(data.total || state.assets.length)) + '</span>',
            '<span>filter ' + esc(String(els.status.value || 'all')) + '</span>',
            '<span>sort ' + esc(String(els.stale.value || 'name')) + '</span>',
            '<span>mode ' + esc(activeModeLabel()) + '</span>'
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
          if (!window.confirm('Make this the canonical portrait for ' + symbol + '? This creates a manual override until you clear it.')) return;
          var publishBody = { symbol: symbol, asset_sha256: sha };
          if (reason) publishBody.reason = reason;
          setLog(await runMutation('/publish', publishBody));
          await refreshAssets();
          await refreshDerivedAdminViews();
          return;
        }

        if (action === 'clear-override') {
          if (!window.confirm('Clear the manual override for ' + symbol + ' and let votes pick the canonical portrait?')) return;
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
          els.body.addEventListener('click', async function (ev) {
            var actionBtn = ev.target.closest('[data-card-action]');
            if (actionBtn) {
              ev.stopPropagation();
              var action = String(actionBtn.getAttribute('data-card-action') || '');
              var symbol = String(actionBtn.getAttribute('data-symbol') || '');
              var sha = String(actionBtn.getAttribute('data-sha') || '');
              try {
                actionBtn.disabled = true;
                if (action === 'open') {
                  await refreshGeneDetail(symbol);
                } else {
                  await handleTableAction(action, symbol, sha);
                  if (symbol) await refreshGeneDetail(symbol);
                }
              } catch (err) {
                setLog({ error: String(err.message || err), details: err.response || null });
              } finally {
                actionBtn.disabled = false;
              }
              return;
            }

            var card = ev.target.closest('[data-gene-symbol]');
            if (!card) return;
            refreshGeneDetail(String(card.getAttribute('data-gene-symbol') || '')).catch(function (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            });
          });

          els.body.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            var card = ev.target.closest('[data-gene-symbol]');
            if (!card) return;
            ev.preventDefault();
            refreshGeneDetail(String(card.getAttribute('data-gene-symbol') || '')).catch(function (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            });
          });
        }

        document.body.addEventListener('click', function (ev) {
          var modeBtn = ev.target.closest('[data-gallery-mode]');
          if (modeBtn) {
            var nextMode = String(modeBtn.getAttribute('data-gallery-mode') || 'live');
            if (nextMode !== state.galleryMode) {
              state.galleryMode = nextMode;
              syncGalleryModeButtons();
              refreshAssets();
            }
            return;
          }

          var sortBtn = ev.target.closest('[data-vision-sort]');
          if (sortBtn) {
            var key = String(sortBtn.getAttribute('data-vision-sort') || 'live');
            if (state.visionSort.key === key) {
              state.visionSort.dir = state.visionSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
              state.visionSort = { key: key, dir: key === 'vision' ? 'asc' : 'desc' };
            }
            renderVisionStats();
            return;
          }

          var logFilterBtn = ev.target.closest('[data-log-filter]');
          if (logFilterBtn) {
            state.activityActionFilter = String(logFilterBtn.getAttribute('data-log-filter') || 'all');
            document.querySelectorAll('[data-log-filter]').forEach(function (btn) {
              btn.classList.toggle('active', String(btn.getAttribute('data-log-filter') || 'all') === state.activityActionFilter);
            });
            renderActivityFeed();
            return;
          }

          var blacklistBtn = ev.target.closest('[data-blacklist-tag]');
          if (blacklistBtn && els.styleTag) {
            els.styleTag.value = String(blacklistBtn.getAttribute('data-blacklist-tag') || '');
            els.styleName.value = String(blacklistBtn.getAttribute('data-blacklist-name') || '');
            setActiveTab('styles');
          }
        });

        if (els.detail) {
          els.detail.addEventListener('click', async function (ev) {
            var candidateCard = ev.target.closest('[data-candidate-sha]');
            if (candidateCard && !ev.target.closest('[data-detail-action]')) {
              state.selectedCandidateSha = String(candidateCard.getAttribute('data-candidate-sha') || '');
              renderGeneDetail();
              return;
            }
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
        syncGalleryModeButtons();
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
