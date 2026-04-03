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
    .vision-sidebar-column {
      align-content: start;
    }
    .vision-workbench {
      position: sticky;
      top: 124px;
    }
    .vision-workbench .controls {
      grid-template-columns: 1fr;
    }
    .vision-table-row.is-selected {
      background: color-mix(in srgb, var(--accent-light) 58%, white);
    }
    .vision-open-btn {
      display: grid;
      gap: 2px;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .vision-open-btn strong {
      font-size: 13px;
      color: var(--text);
    }
    .vision-open-btn .small {
      color: var(--muted);
    }
    .vision-preview-cell {
      min-width: 280px;
    }
    .vision-emulsion-cell {
      min-width: 132px;
    }
    .vision-emulsion-stack {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-height: 24px;
      align-items: center;
    }
    .vision-emulsion-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      padding: 3px 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.82);
      color: var(--muted);
      font-size: 11px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .vision-preview-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 58px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .vision-preview-button {
      --thumb-ratio: 1;
      position: relative;
      flex: 0 0 auto;
      width: clamp(42px, calc(56px * var(--thumb-ratio)), 108px);
      height: 56px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #f6f2ed;
      overflow: hidden;
      padding: 0;
      cursor: pointer;
    }
    .vision-preview-button:hover {
      border-color: var(--border-strong);
      transform: translateY(-1px);
    }
    .vision-preview-button.is-active {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px rgba(184, 74, 38, 0.08);
    }
    .vision-preview-button img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      background: #fbf8f3;
    }
    .vision-preview-gene {
      position: absolute;
      left: 4px;
      right: 4px;
      bottom: 4px;
      border-radius: 999px;
      background: rgba(26, 26, 26, 0.7);
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      padding: 2px 6px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vision-preview-more {
      flex: 0 0 auto;
      min-width: 48px;
      min-height: 56px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--border-strong);
      border-radius: 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      background: rgba(255,255,255,0.7);
    }
    .vision-preview-empty {
      color: var(--muted);
      font-size: 12px;
    }
    .vision-cleanup-panel {
      display: grid;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255,255,255,0.82);
      backdrop-filter: blur(12px);
    }
    .vision-quick-actions {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255,255,255,0.76);
    }
    .vision-quick-context {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .vision-dashboard-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .vision-gene-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
    }
    .vision-gene-link:hover {
      color: var(--accent);
    }
    .vision-cleanup-panel .detail-title {
      font-size: 22px;
    }
    .vision-panel-header {
      display: grid;
      gap: 8px;
    }
    .vision-panel-frame {
      display: grid;
      place-items: center;
      min-height: 260px;
      max-height: 420px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #fbf8f3;
      overflow: hidden;
    }
    .vision-panel-frame img {
      max-width: 100%;
      max-height: 392px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
    }
    .vision-panel-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .vision-panel-nav .pager-status {
      min-width: 0;
      flex: 1 1 auto;
    }
    .vision-panel-meta {
      display: grid;
      gap: 4px;
    }
    .vision-stat-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .vision-stat-card {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(255,255,255,0.72);
    }
    .vision-stat-card strong {
      font-size: 18px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .vision-stat-card span {
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .vision-panel-actions,
    .vision-artist-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .vision-panel-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .vision-panel-strip .vision-preview-button {
      height: 64px;
      width: clamp(48px, calc(64px * var(--thumb-ratio)), 128px);
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
      .vision-workbench {
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
    .sort-btn {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      width: 100%;
      color: var(--muted);
      font-weight: 600;
      border-radius: 999px;
    }
    .sort-btn:hover { color: var(--text); }
    .sort-btn.is-active {
      color: var(--accent);
      background: var(--accent-light);
      border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
    }
    .sort-btn::after {
      content: 'sort';
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--faint);
    }
    .sort-btn[data-sort-dir='asc']::after { content: 'asc'; color: var(--accent); }
    .sort-btn[data-sort-dir='desc']::after { content: 'desc'; color: var(--accent); }

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
    .table-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .table-toolbar .stats {
      padding: 0;
      min-width: 0;
    }
    .table-pager {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    .table-pager label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .table-pager select { min-width: 76px; }
    .pager-group {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pager-status {
      min-width: 110px;
      text-align: center;
      color: var(--muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
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
          <div class="actions">
            <button class="btn-flat" type="button" id="assets-unstale-visible" disabled>Restore stale in view</button>
            <button class="btn-primary" id="assets-refresh">Refresh</button>
          </div>
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
          <div class="table-toolbar">
            <div class="stats" id="vision-stats-meta">Open this tab to load the scorecard.</div>
            <div class="table-pager">
              <label>Rows
                <select id="vision-page-size">
                  <option value="25">25</option>
                  <option value="50" selected>50</option>
                  <option value="100">100</option>
                  <option value="250">250</option>
                </select>
              </label>
              <div class="pager-group">
                <button type="button" id="vision-page-first">First</button>
                <button type="button" id="vision-page-prev">Prev</button>
                <span class="pager-status mono" id="vision-page-label">Page 1 of 1</span>
                <button type="button" id="vision-page-next">Next</button>
                <button type="button" id="vision-page-last">Last</button>
              </div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><button class="btn-flat sort-btn" type="button" data-vision-sort="vision">Vision</button></th>
                  <th>Examples</th>
                  <th>Emulsion ID</th>
                  <th><button class="btn-flat sort-btn" type="button" data-vision-sort="images">Images</button></th>
                  <th><button class="btn-flat sort-btn" type="button" data-vision-sort="score">Avg vote</button></th>
                  <th><button class="btn-flat sort-btn" type="button" data-vision-sort="rejection">Rejection rate</button></th>
                  <th><button class="btn-flat sort-btn" type="button" data-vision-sort="live">Currently canonical</button></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="vision-stats-list"></tbody>
            </table>
          </div>
        </section>
        <div class="stack vision-sidebar-column">
          <section class="stack vision-workbench">
            <div class="section-head">
              <div>
                <h2>Vision detail</h2>
                <p class="small" id="vision-cleanup-summary">Click a row or thumbnail to inspect this artist. Admin submits removals through the public artist-tag form.</p>
              </div>
            </div>
            <div class="vision-cleanup-panel" id="vision-cleanup-panel"></div>
            <div class="vision-quick-actions">
              <div class="detail-kicker">Monitoring</div>
              <div class="vision-quick-context" id="vision-quick-context">This tab is for style-level blocklisting. Use gene review if only one image is bad.</div>
              <div class="vision-dashboard-actions">
                <button class="btn-flat" type="button" id="vision-open-current-gene" disabled>Open current gene</button>
                <button class="btn-flat" type="button" id="vision-copy-current-tag" disabled>Copy artist tag</button>
              </div>
            </div>
          </section>
          <section class="stack">
            <h2>Artist-tag queue</h2>
            <div class="list" id="styles-pending"></div>
          </section>
          <section class="stack">
            <h2>Applied blocklist</h2>
            <div class="list" id="styles-notes"></div>
          </section>
        </div>
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
      var ADMIN_READ_TIMEOUT_MS = 12000;
      var ADMIN_WRITE_TIMEOUT_MS = 30000;
      var state = {
        assets: [],
        overviewSummary: null,
        overviewCoverage: null,
        overviewAttention: [],
        recentEvents: [],
        visionStats: [],
        visionPreviewMap: {},
        loadingVisionPreviewIds: {},
        blacklistedStyles: [],
        pendingBlacklistSubmissions: [],
        visionPage: 1,
        visionPageSize: 50,
        selectedVisionId: '',
        selectedVisionDetail: null,
        selectedVisionAssetSha: '',
        visionDetailCache: {},
        warmingVisionDetailIds: {},
        preloadedImageUrls: {},
        visionPreviewRequestId: 0,
        visionDetailRequestId: 0,
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
        visionStatsList: document.getElementById('vision-stats-list'),
        visionStatsMeta: document.getElementById('vision-stats-meta'),
        visionCleanupPanel: document.getElementById('vision-cleanup-panel'),
        visionCleanupSummary: document.getElementById('vision-cleanup-summary'),
        visionQuickContext: document.getElementById('vision-quick-context'),
        visionOpenCurrentGene: document.getElementById('vision-open-current-gene'),
        visionCopyCurrentTag: document.getElementById('vision-copy-current-tag'),
        stylesPending: document.getElementById('styles-pending'),
        visionPageSize: document.getElementById('vision-page-size'),
        visionPageLabel: document.getElementById('vision-page-label'),
        visionPageFirst: document.getElementById('vision-page-first'),
        visionPagePrev: document.getElementById('vision-page-prev'),
        visionPageNext: document.getElementById('vision-page-next'),
        visionPageLast: document.getElementById('vision-page-last'),
        stylesNotes: document.getElementById('styles-notes'),
        activityFilter: document.getElementById('activity-filter'),
        activityList: document.getElementById('activity-list'),
        status: document.getElementById('gallery-filter'),
        stale: document.getElementById('gallery-sort'),
        limit: document.getElementById('gallery-limit'),
        search: document.getElementById('gallery-search'),
        token: document.getElementById('admin-token'),
        unstaleVisible: document.getElementById('assets-unstale-visible'),
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

      // Terminology rule: "canonical" is the portrait shown in the extension.
      // Votes auto-pick the canonical portrait unless admin_override is active.
      // Keep this language consistent in the admin even though legacy route/state
      // names still use "live" internally.

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

      function requestTimeoutError(path, timeoutMs) {
        var err = new Error('Request timed out after ' + String(Math.round(timeoutMs / 1000)) + 's');
        err.code = 'TIMEOUT';
        err.response = {
          error: 'Request timed out',
          path: path,
          timeout_ms: timeoutMs
        };
        return err;
      }

      function requestErrorMessage(err, fallback) {
        if (err && err.code === 'TIMEOUT') return String(err.message || fallback || 'Request timed out.');
        if (err && err.response && err.response.error) return String(err.response.error);
        if (err && err.message) return String(err.message);
        return String(fallback || err || 'Request failed');
      }

      function inlineFailureMarkup(title, message) {
        return [
          '<div class="gallery-empty">',
          '<strong>' + esc(title || 'Request failed') + '</strong>',
          '<div class="small">' + esc(message || 'Please try again.') + '</div>',
          '</div>'
        ].join('');
      }

      function tableFailureMarkup(title, message, colspan) {
        return [
          '<tr>',
          '<td colspan="' + esc(String(colspan || 1)) + '">',
          inlineFailureMarkup(title, message),
          '</td>',
          '</tr>'
        ].join('');
      }

      async function apiJson(path, options) {
        var opts = options || {};
        var method = String(opts.method || 'GET').toUpperCase();
        var timeoutMs = Number(opts.timeoutMs || (method === 'GET' ? ADMIN_READ_TIMEOUT_MS : ADMIN_WRITE_TIMEOUT_MS));
        var headers = Object.assign({}, opts.headers || {}, authHeaders());
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timeoutId = null;
        if (controller && timeoutMs > 0) {
          timeoutId = window.setTimeout(function () {
            controller.abort();
          }, timeoutMs);
        }
        try {
          var requestOptions = Object.assign({}, opts, {
            headers: headers,
            credentials: 'include'
          });
          if (controller) requestOptions.signal = controller.signal;
          var resp = await fetch(API_BASE + path, requestOptions);
          var text = await resp.text();
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
          if (!resp.ok) {
            var err = new Error('HTTP ' + resp.status);
            err.response = data;
            throw err;
          }
          return data;
        } catch (err) {
          if (controller && controller.signal && controller.signal.aborted) {
            throw requestTimeoutError(path, timeoutMs);
          }
          throw err;
        } finally {
          if (timeoutId != null) window.clearTimeout(timeoutId);
        }
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
          var message = requestErrorMessage(err, 'Overview load failed.');
          els.overviewMetrics.innerHTML = inlineFailureMarkup('Overview failed fast', message);
          els.overviewCoverage.innerHTML = inlineFailureMarkup('Coverage failed fast', message);
          els.attentionList.innerHTML = '<article class="list-row"><div><strong>Admin overview failed.</strong><div class="small">' + esc(message) + '</div></div><div></div></article>';
          els.overviewEvents.innerHTML = '<article class="list-row"><div><strong>Recent activity unavailable.</strong><div class="small">' + esc(message) + '</div></div><div></div></article>';
          setLog({ error: 'Overview load failed', details: err.response || message });
        }
      }

      async function refreshDerivedAdminViews() {
        await refreshOverview();
        if (state.visionStats.length) {
          await refreshVisionStats();
        }
      }

      function clampVisionPage(page, totalPages) {
        var cleaned = Number.parseInt(String(page || '1'), 10) || 1;
        var maxPage = Math.max(1, Number(totalPages || 1));
        if (cleaned < 1) return 1;
        if (cleaned > maxPage) return maxPage;
        return cleaned;
      }

      function setVisionPage(page) {
        var pageSize = Math.max(1, Number.parseInt(String(state.visionPageSize || 50), 10) || 50);
        var totalPages = Math.max(1, Math.ceil((state.visionStats || []).length / pageSize));
        state.visionPage = clampVisionPage(page, totalPages);
      }

      function updateVisionSortButtons() {
        document.querySelectorAll('[data-vision-sort]').forEach(function (btn) {
          var key = String(btn.getAttribute('data-vision-sort') || '');
          var active = state.visionSort.key === key;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('data-sort-dir', active ? state.visionSort.dir : '');
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }

      function formatCompactNumber(value) {
        var num = Number(value || 0);
        if (!Number.isFinite(num)) return '0';
        return num.toLocaleString('en-US');
      }

      function isEditableTarget(target) {
        if (!target || !(target instanceof Element)) return false;
        var tag = String(target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return true;
        return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
      }

      function preloadImage(url) {
        var safeUrl = String(url || '').trim();
        if (!safeUrl || state.preloadedImageUrls[safeUrl]) return;
        state.preloadedImageUrls[safeUrl] = true;
        try {
          var img = new Image();
          img.decoding = 'async';
          img.src = safeUrl;
        } catch {}
      }

      function preloadVisionAssets(assets) {
        (Array.isArray(assets) ? assets : []).forEach(function (asset) {
          if (!asset) return;
          preloadImage(asset.medium_url || asset.thumb_url || asset.hero_url || '');
        });
      }

      function normalizeVisionId(value) {
        return String(value || '').trim();
      }

      function visionDetailLimitForRow(row) {
        var imageCount = Number(row && row.image_count || 0);
        if (!Number.isFinite(imageCount) || imageCount <= 0) return 60;
        return Math.max(24, Math.min(240, Math.round(imageCount)));
      }

      function sortedVisionRows() {
        var sortKey = state.visionSort.key;
        var sortDir = state.visionSort.dir === 'asc' ? 1 : -1;
        return (state.visionStats || []).slice().sort(function (left, right) {
          function label(row) {
            return String(row.artist_name || row.artist_tag || row.vision_id || '');
          }
          if (sortKey === 'vision') return label(left).localeCompare(label(right)) * sortDir;
          if (sortKey === 'images') return (Number(left.image_count || 0) - Number(right.image_count || 0)) * sortDir;
          if (sortKey === 'score') return (Number(left.avg_vote || 0) - Number(right.avg_vote || 0)) * sortDir;
          if (sortKey === 'rejection') return (Number(left.rejection_rate || 0) - Number(right.rejection_rate || 0)) * sortDir;
          var byLive = (Number(left.live_count || 0) - Number(right.live_count || 0)) * sortDir;
          if (byLive) return byLive;
          return label(left).localeCompare(label(right)) * sortDir;
        });
      }

      function visibleVisionRows() {
        var rows = sortedVisionRows();
        var pageSize = Math.max(1, Number.parseInt(String(state.visionPageSize || 50), 10) || 50);
        var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        state.visionPage = clampVisionPage(state.visionPage, totalPages);
        var start = (state.visionPage - 1) * pageSize;
        return rows.slice(start, start + pageSize);
      }

      function previewAspectRatio(asset) {
        var ratio = Number(asset && asset.aspect_ratio);
        if (Number.isFinite(ratio) && ratio > 0) return Math.max(0.55, Math.min(2.2, ratio));
        var width = Number(asset && asset.width);
        var height = Number(asset && asset.height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          return Math.max(0.55, Math.min(2.2, width / height));
        }
        return 1;
      }

      function findSelectedVisionAsset(detail) {
        var assets = Array.isArray(detail && detail.assets) ? detail.assets : [];
        if (!assets.length) return null;
        var preferredSha = String(state.selectedVisionAssetSha || '').toLowerCase();
        if (preferredSha) {
          var selected = assets.find(function (asset) {
            return String(asset.asset_sha256 || '').toLowerCase() === preferredSha;
          });
          if (selected) return selected;
        }
        return assets[0] || null;
      }

      function currentVisionAssetIndex(detail) {
        var assets = Array.isArray(detail && detail.assets) ? detail.assets : [];
        if (!assets.length) return 0;
        var selected = findSelectedVisionAsset(detail);
        var index = selected ? assets.findIndex(function (asset) {
          return asset.asset_sha256 === selected.asset_sha256;
        }) : 0;
        return index >= 0 ? index : 0;
      }

      function mergeVisionAssets(previewAssets, detailAssets) {
        var bySha = {};
        var merged = [];
        (Array.isArray(previewAssets) ? previewAssets : []).concat(Array.isArray(detailAssets) ? detailAssets : []).forEach(function (asset) {
          var sha = String(asset && asset.asset_sha256 || '').toLowerCase();
          if (!sha) return;
          if (!bySha[sha]) {
            bySha[sha] = Object.assign({}, asset);
            merged.push(bySha[sha]);
          } else {
            Object.assign(bySha[sha], asset);
          }
        });
        return merged;
      }

      function writeVisionDetailCache(visionId, detail) {
        var cleanedVisionId = normalizeVisionId(visionId);
        if (!cleanedVisionId || !detail || !detail.vision) return null;
        var mergedDetail = {
          vision: Object.assign({}, detail.vision),
          assets: mergeVisionAssets(state.visionPreviewMap[cleanedVisionId] || [], detail.assets || [])
        };
        state.visionDetailCache[cleanedVisionId] = {
          vision: Object.assign({}, mergedDetail.vision),
          assets: mergedDetail.assets.map(function (asset) {
            return Object.assign({}, asset);
          })
        };
        preloadVisionAssets(mergedDetail.assets);
        return mergedDetail;
      }

      function nearbyVisionRows(anchorVisionId, radius) {
        var rows = visibleVisionRows();
        if (!rows.length) return [];
        var cleanedVisionId = normalizeVisionId(anchorVisionId);
        var index = rows.findIndex(function (row) {
          return normalizeVisionId(row && row.vision_id) === cleanedVisionId;
        });
        if (index < 0) index = 0;
        var windowRadius = Math.max(0, Number.parseInt(String(radius || 0), 10) || 0);
        var start = Math.max(0, index - windowRadius);
        var end = Math.min(rows.length, index + windowRadius + 1);
        return rows.slice(start, end);
      }

      async function warmVisionDetail(visionId, row) {
        var cleanedVisionId = normalizeVisionId(visionId);
        if (!cleanedVisionId) return;
        if (state.visionDetailCache[cleanedVisionId]) {
          preloadVisionAssets(state.visionDetailCache[cleanedVisionId].assets || []);
          return;
        }
        if (state.warmingVisionDetailIds[cleanedVisionId]) return;
        state.warmingVisionDetailIds[cleanedVisionId] = true;
        try {
          var limit = visionDetailLimitForRow(row);
          var data = await apiJson('/votes/vision-detail?vision_id=' + encodeURIComponent(cleanedVisionId) + '&limit=' + encodeURIComponent(String(limit)), { method: 'GET' });
          if (data && data.detail) {
            writeVisionDetailCache(cleanedVisionId, data.detail);
          }
        } catch (err) {
        } finally {
          delete state.warmingVisionDetailIds[cleanedVisionId];
        }
      }

      function warmVisionNeighborhood(anchorVisionId) {
        nearbyVisionRows(anchorVisionId, 10).forEach(function (row) {
          warmVisionDetail(row.vision_id, row);
        });
      }

      function visionArtistId(value) {
        var artistId = String(value && (value.artist_id || value.emulsion_id) || '').trim();
        if (artistId) return artistId;
        return '';
      }

      function seedVisionDetailFromPreview(row, assetSha) {
        if (!row || !row.vision_id) return false;
        var previewAssets = state.visionPreviewMap[row.vision_id] || [];
        if (!previewAssets.length) return false;
        state.selectedVisionDetail = {
          vision: Object.assign({}, row),
          assets: mergeVisionAssets(previewAssets, [])
        };
        state.selectedVisionAssetSha = String(assetSha || state.selectedVisionAssetSha || previewAssets[0].asset_sha256 || '');
        renderVisionCleanupPanel();
        preloadVisionAssets(previewAssets);
        warmVisionNeighborhood(row.vision_id);
        return true;
      }

      function preloadVisionNeighbors(detail) {
        var assets = Array.isArray(detail && detail.assets) ? detail.assets : [];
        if (!assets.length) return;
        var currentIndex = currentVisionAssetIndex(detail);
        [currentIndex, currentIndex - 1, currentIndex + 1].forEach(function (index) {
          if (index < 0 || index >= assets.length) return;
          var asset = assets[index];
          preloadImage(asset && (asset.medium_url || asset.hero_url || asset.thumb_url));
        });
      }

      function setSelectedVisionAsset(assetSha) {
        var cleaned = String(assetSha || '').trim();
        if (!cleaned || !state.selectedVisionDetail) return;
        state.selectedVisionAssetSha = cleaned;
        renderVisionCleanupPanel();
        renderVisionStats();
        preloadVisionNeighbors(state.selectedVisionDetail);
      }

      function navigateSelectedVisionAsset(delta) {
        var detail = state.selectedVisionDetail;
        var assets = Array.isArray(detail && detail.assets) ? detail.assets : [];
        if (assets.length <= 1) return;
        var currentIndex = currentVisionAssetIndex(detail);
        var nextIndex = (currentIndex + delta + assets.length) % assets.length;
        setSelectedVisionAsset(assets[nextIndex].asset_sha256 || '');
      }

      function selectRelativeVision(delta) {
        var rows = visibleVisionRows();
        if (!rows.length) return;
        var currentId = String(state.selectedVisionId || '');
        var currentIndex = rows.findIndex(function (row) {
          return String(row.vision_id || '') === currentId;
        });
        if (currentIndex < 0) currentIndex = 0;
        var nextIndex = currentIndex + delta;
        if (nextIndex < 0 || nextIndex >= rows.length) return;
        var nextRow = rows[nextIndex];
        var previewAssets = state.visionPreviewMap[nextRow.vision_id] || [];
        var assetIndex = currentVisionAssetIndex(state.selectedVisionDetail);
        var nextAsset = previewAssets[Math.min(assetIndex, Math.max(0, previewAssets.length - 1))] || previewAssets[0] || null;
        refreshVisionDetail(nextRow.vision_id, { assetSha: nextAsset ? nextAsset.asset_sha256 : undefined }).catch(function (err) {
          setLog({ error: 'Vision detail failed', details: err.response || requestErrorMessage(err, 'Vision detail failed.') });
        });
      }

      function currentVisionContext() {
        var detail = state.selectedVisionDetail;
        var vision = detail && detail.vision ? detail.vision : null;
        var asset = findSelectedVisionAsset(detail);
        return { vision: vision, asset: asset };
      }

      function visionRowById(visionId) {
        var cleanedVisionId = String(visionId || '').trim();
        if (!cleanedVisionId) return null;
        return (state.visionStats || []).find(function (row) {
          return String(row && row.vision_id || '') === cleanedVisionId;
        }) || null;
      }

      function renderVisionQuickActions() {
        var context = currentVisionContext();
        var vision = context.vision;
        var asset = context.asset;
        if (els.visionQuickContext) {
          els.visionQuickContext.innerHTML = vision
            ? [
                '<strong>' + esc(vision.artist_name || vision.artist_tag || vision.vision_id || 'Selected artist') + '</strong>',
                '<span class="small mono">' + esc(vision.artist_tag || vision.vision_id || '') + '</span>',
                (asset && asset.gene_symbol ? '<span class="small">Current gene: ' + esc(asset.gene_symbol) + '</span>' : ''),
                '<span class="small">Use the public artist-tag form to block this style across the site. Use gene review for one-off image cleanup.</span>'
              ].filter(Boolean).join(' · ')
            : 'Select an artist to inspect details. This tab is for style-level blocklisting. Use gene review when only one image is bad.';
        }
        if (els.visionOpenCurrentGene) {
          els.visionOpenCurrentGene.disabled = !(asset && asset.gene_symbol);
          els.visionOpenCurrentGene.textContent = asset && asset.gene_symbol ? ('Open ' + asset.gene_symbol) : 'Open current gene';
        }
        if (els.visionCopyCurrentTag) {
          els.visionCopyCurrentTag.disabled = !(vision && (vision.artist_tag || vision.vision_id));
          els.visionCopyCurrentTag.textContent = vision && (vision.artist_tag || vision.vision_id) ? 'Copy artist tag' : 'Copy artist tag';
        }
      }

      async function openVisionGene(symbol) {
        var detailSymbol = String(symbol || '').trim();
        if (!detailSymbol) return;
        els.status.value = 'all';
        els.stale.value = 'name';
        els.search.value = detailSymbol;
        setActiveTab('archive');
        refreshAssets();
        refreshGeneDetail(detailSymbol).catch(function (err) {
          setLog({ error: 'Gene detail failed', details: err.response || requestErrorMessage(err, 'Gene detail failed.') });
        });
      }

      function renderVisionPreviewButton(visionId, asset, active) {
        if (!asset || !asset.thumb_url) return '';
        var label = String(asset.gene_symbol || 'gene');
        var titleParts = [label];
        if (asset.artist_name || asset.artist_tag) titleParts.push(String(asset.artist_name || asset.artist_tag));
        if (asset.status) titleParts.push(String(asset.status));
        return [
          '<button class="vision-preview-button' + (active ? ' is-active' : '') + '"',
          ' type="button"',
          ' style="--thumb-ratio:' + esc(String(previewAspectRatio(asset))) + '"',
          ' data-vision-open="' + esc(visionId || '') + '"',
          ' data-vision-asset="' + esc(asset.asset_sha256 || '') + '"',
          ' title="' + esc(titleParts.join(' · ')) + '">',
          '<img src="' + esc(asset.thumb_url) + '" alt="' + esc(label + ' preview') + '" loading="eager" />',
          '<span class="vision-preview-gene">' + esc(label) + '</span>',
          '</button>'
        ].join('');
      }

      function renderVisionPreviewCell(row) {
        var visionId = String(row && row.vision_id || '');
        var assets = state.visionPreviewMap[visionId] || [];
        var loading = Boolean(state.loadingVisionPreviewIds[visionId]);
        if (!assets.length) {
          return '<div class="vision-preview-empty">' + esc(loading ? 'Loading examples…' : 'Examples appear here.') + '</div>';
        }
        var html = assets.map(function (asset) {
          return renderVisionPreviewButton(visionId, asset, state.selectedVisionAssetSha === asset.asset_sha256 && state.selectedVisionId === visionId);
        }).join('');
        var moreCount = Math.max(0, Number(row.image_count || 0) - assets.length);
        if (moreCount > 0) {
          html += '<button class="vision-preview-more" type="button" data-vision-open="' + esc(visionId) + '">+' + esc(String(moreCount)) + '</button>';
        }
        return '<div class="vision-preview-strip">' + html + '</div>';
      }

      function renderVisionEmulsionCell(row) {
        var id = visionArtistId(row);
        if (!id) return '<div class="vision-preview-empty">—</div>';
        return '<div class="vision-emulsion-stack"><span class="vision-emulsion-chip mono">' + esc(id) + '</span></div>';
      }

      function renderVisionCleanupPanel() {
        if (!els.visionCleanupPanel) return;
        var detail = state.selectedVisionDetail;
        if (!detail || !detail.vision) {
          if (els.visionCleanupSummary) {
            els.visionCleanupSummary.textContent = 'Click a row or thumbnail to inspect this artist.';
          }
          els.visionCleanupPanel.innerHTML = [
            '<div class="detail-kicker">Artist workbench</div>',
            '<div class="detail-title">Pick a vision</div>',
            '<div class="detail-copy">The scorecard can now open straight into this side panel. Pick a row to compare that artist across genes, scrub left and right, and run quick actions without leaving the table.</div>'
          ].join('');
          renderVisionQuickActions();
          return;
        }

        var vision = detail.vision;
        var assets = Array.isArray(detail.assets) ? detail.assets : [];
        var selectedAsset = findSelectedVisionAsset(detail);
        state.selectedVisionAssetSha = selectedAsset ? String(selectedAsset.asset_sha256 || '') : '';
        preloadVisionNeighbors(detail);

        var currentIndex = currentVisionAssetIndex(detail);
        var selectedBadges = [];
        if (vision.blacklisted) selectedBadges.push('<span class="badge-pill badge-mismatch">Blacklisted</span>');
        if (selectedAsset && selectedAsset.is_current) selectedBadges.push('<span class="badge-pill badge-live">Canonical</span>');
        if (selectedAsset && selectedAsset.status === 'rejected') selectedBadges.push('<span class="badge-pill badge-missing">Rejected</span>');
        if (selectedAsset && selectedAsset.is_stale) selectedBadges.push('<span class="badge-pill badge-stale">Stale</span>');

        if (els.visionCleanupSummary) {
          els.visionCleanupSummary.textContent = String(vision.artist_name || vision.artist_tag || vision.vision_id || 'Selected vision');
        }

        els.visionCleanupPanel.innerHTML = [
          '<div class="detail-kicker">Artist workbench</div>',
          '<div class="vision-panel-header">',
          '<div class="detail-title">' + esc(vision.artist_name || vision.artist_tag || vision.vision_id || 'Unknown vision') + '</div>',
          '<div class="small mono">' + esc(vision.artist_tag || vision.vision_id || '') + '</div>',
          '<div class="badge-row">' + selectedBadges.join('') + '</div>',
          '</div>',
          '<div class="vision-panel-frame">',
          (selectedAsset && selectedAsset.medium_url
            ? '<img src="' + esc(selectedAsset.medium_url) + '" alt="Selected artist example" loading="eager" fetchpriority="high" />'
            : '<div class="gallery-empty" style="min-height:100%; border:0; border-radius:0; padding:12px;">No preview available</div>'),
          '</div>',
          '<div class="vision-panel-nav">',
          '<button type="button" data-vision-nav="prev"' + (assets.length <= 1 ? ' disabled' : '') + '>Prev</button>',
          '<span class="pager-status mono">' + esc(assets.length ? ('Image ' + (currentIndex + 1) + ' of ' + assets.length) : 'No images') + '</span>',
          '<button type="button" data-vision-nav="next"' + (assets.length <= 1 ? ' disabled' : '') + '>Next</button>',
          '</div>',
          (selectedAsset ? [
            '<div class="vision-panel-meta">',
            '<div><button class="vision-gene-link" type="button" data-vision-detail-action="open-gene" data-symbol="' + esc(selectedAsset.gene_symbol || '') + '"><strong>' + esc(selectedAsset.gene_symbol || 'Unknown gene') + '</strong></button> · ' + esc(selectedAsset.status || 'draft') + '</div>',
            '<div class="small">score ' + esc(String(selectedAsset.score || 0)) + ' · +' + esc(String(selectedAsset.upvotes || 0)) + ' / -' + esc(String(selectedAsset.downvotes || 0)) + ' · ' + esc(String(selectedAsset.width || '?')) + '×' + esc(String(selectedAsset.height || '?')) + '</div>',
            (visionArtistId(vision) ? '<div class="small mono">Emulsion ' + esc(visionArtistId(vision)) + '</div>' : ''),
            '<div class="small mono">' + esc(shortSha(selectedAsset.asset_sha256 || '')) + '</div>',
            '</div>',
            '<div class="vision-panel-actions">',
            '<button class="btn-flat" type="button" data-vision-detail-action="copy" data-sha="' + esc(selectedAsset.asset_sha256 || '') + '">Copy SHA</button>',
            '<button class="btn-flat" type="button" data-vision-detail-action="open-gene" data-symbol="' + esc(selectedAsset.gene_symbol || '') + '">Open gene review</button>',
            (!selectedAsset.is_current && selectedAsset.status !== 'rejected'
              ? '<button class="btn-primary" type="button" data-vision-detail-action="publish" data-symbol="' + esc(selectedAsset.gene_symbol || '') + '" data-sha="' + esc(selectedAsset.asset_sha256 || '') + '">Make canonical</button>'
              : ''),
            (selectedAsset.status !== 'rejected'
              ? '<button class="btn-danger" type="button" data-vision-detail-action="reject" data-symbol="' + esc(selectedAsset.gene_symbol || '') + '" data-sha="' + esc(selectedAsset.asset_sha256 || '') + '">Reject image</button>'
              : ''),
            (selectedAsset.is_stale
              ? '<button type="button" data-vision-detail-action="unstale" data-symbol="' + esc(selectedAsset.gene_symbol || '') + '" data-sha="' + esc(selectedAsset.asset_sha256 || '') + '">Restore image</button>'
              : ''),
            '</div>'
          ].join('') : ''),
          '<div class="vision-stat-grid">',
          '<article class="vision-stat-card"><span>Images</span><strong>' + esc(formatCompactNumber(vision.image_count || 0)) + '</strong></article>',
          '<article class="vision-stat-card"><span>Canonical now</span><strong>' + esc(formatCompactNumber(vision.live_count || 0)) + '</strong></article>',
          '<article class="vision-stat-card"><span>Avg vote</span><strong>' + esc(String(Math.round((Number(vision.avg_vote || 0) * 100)) / 100)) + '</strong></article>',
          '<article class="vision-stat-card"><span>Rejected</span><strong>' + esc(String(Math.round((Number(vision.rejection_rate || 0) * 1000)) / 10)) + '%</strong></article>',
          '</div>',
          (vision.blacklist_reason ? '<div class="small">Blacklist note: ' + esc(vision.blacklist_reason) + '</div>' : ''),
          '<div class="detail-kicker">This artist across genes</div>',
          '<div class="vision-panel-strip">' + assets.map(function (asset) {
            return renderVisionPreviewButton(vision.vision_id, asset, selectedAsset && selectedAsset.asset_sha256 === asset.asset_sha256);
          }).join('') + '</div>',
          '<div class="vision-artist-actions">',
          '<button class="btn-flat" type="button" data-vision-artist-action="copy-tag">Copy artist tag</button>',
          '<button class="btn-flat" type="button" data-vision-artist-action="open-current-gene"' + (selectedAsset && selectedAsset.gene_symbol ? '' : ' disabled') + '>Open gene page</button>',
          '</div>'
        ].join('');
        renderVisionQuickActions();
      }

      function renderStylesPendingList() {
        if (!els.stylesPending) return;
        var pendingRows = (state.pendingBlacklistSubmissions || []).map(function (row) {
          return [
            '<article class="list-row">',
            '<div>',
            '<strong>' + esc(row.artist_name_input || row.normalized_input || 'Unknown submission') + '</strong>',
            '<div class="small mono">Artist tag request from /artist-styles</div>',
            '<div class="small">Queued by ' + esc(row.requested_by || 'unknown') + (row.source ? ' · ' + esc(row.source) : '') + '</div>',
            '</div>',
            '<div class="event-meta">' + esc(row.requested_at || '') + '</div>',
            '</article>'
          ].join('');
        });

        els.stylesPending.innerHTML = pendingRows.length
          ? pendingRows.join('')
          : '<article class="list-row"><div><strong>No artist-tag requests waiting.</strong><div class="small">New requests from /artist-styles stay here until workstation sync applies them to the site blocklist.</div></div><div></div></article>';
      }

      function renderStylesNotesList() {
        if (!els.stylesNotes) return;
        var logRows = (state.blacklistedStyles || []).map(function (row) {
          var showTagLine = row.artist_tag && row.artist_name && String(row.artist_tag).toLowerCase() !== String(row.artist_name).toLowerCase();
          return [
            '<article class="list-row">',
            '<div>',
            '<strong>' + esc(row.artist_name || row.artist_tag || 'Unknown source') + '</strong>',
            (row.artist_tag ? '<div class="small mono">' + esc(showTagLine ? row.artist_tag : 'Artist tag ' + row.artist_tag) + '</div>' : ''),
            '<div class="small">' + esc(row.reason || 'No reason recorded.') + '</div>',
            '</div>',
            '<div class="event-meta">' + esc(row.updated_at || row.created_at || '') + '</div>',
            '</article>'
          ].join('');
        });

        els.stylesNotes.innerHTML = logRows.length
          ? logRows.join('')
          : '<article class="list-row"><div><strong>No artist styles are blocklisted yet.</strong><div class="small">Once workstation sync applies a request from /artist-styles, the site blocklist entry will show up here.</div></div><div></div></article>';
      }

      async function ensureVisibleVisionPreviews(rows) {
        var pageRows = Array.isArray(rows) ? rows : [];
        var missingVisionIds = pageRows
          .map(function (row) { return String(row && row.vision_id || ''); })
          .filter(function (visionId) {
            return visionId && !state.visionPreviewMap[visionId] && !state.loadingVisionPreviewIds[visionId];
          });
        if (!missingVisionIds.length) return;
        missingVisionIds.forEach(function (visionId) {
          state.loadingVisionPreviewIds[visionId] = true;
        });
        renderVisionStats();
        var requestId = ++state.visionPreviewRequestId;
        try {
          var data = await apiJson('/votes/vision-previews?vision_ids=' + encodeURIComponent(missingVisionIds.join(',')) + '&limit=6', { method: 'GET' });
          if (requestId !== state.visionPreviewRequestId) return;
          (Array.isArray(data && data.rows) ? data.rows : []).forEach(function (row) {
            var visionId = String(row && row.vision_id || '');
            if (!visionId) return;
            state.visionPreviewMap[visionId] = Array.isArray(row.assets) ? row.assets : [];
            preloadVisionAssets(state.visionPreviewMap[visionId]);
          });
          pageRows.slice(0, 10).forEach(function (row) {
            warmVisionDetail(row.vision_id, row);
          });
        } catch (err) {
          setLog({ error: 'Vision preview load failed', details: err.response || requestErrorMessage(err, 'Preview load failed.') });
        } finally {
          missingVisionIds.forEach(function (visionId) {
            delete state.loadingVisionPreviewIds[visionId];
          });
          renderVisionStats();
        }
      }

      async function refreshVisionDetail(visionId, options) {
        var opts = options || {};
        var cleanedVisionId = String(visionId || '').trim();
        if (!cleanedVisionId) return;
        var currentRow = (state.visionStats || []).find(function (row) {
          return String(row && row.vision_id || '') === cleanedVisionId;
        }) || null;
        state.selectedVisionId = cleanedVisionId;
        renderVisionStats();
        if (opts.assetSha) state.selectedVisionAssetSha = String(opts.assetSha || '');
        if (!opts.keepDetail) {
          var cached = state.visionDetailCache[cleanedVisionId] || null;
          if (cached) {
            state.selectedVisionDetail = {
              vision: Object.assign({}, cached.vision),
              assets: mergeVisionAssets(state.visionPreviewMap[cleanedVisionId] || [], cached.assets || [])
            };
            renderVisionCleanupPanel();
          } else if (!seedVisionDetailFromPreview(currentRow, opts.assetSha)) {
            state.selectedVisionDetail = null;
            renderVisionCleanupPanel();
          }
        }
        warmVisionNeighborhood(cleanedVisionId);
        var requestId = ++state.visionDetailRequestId;
        try {
          var data = await apiJson('/votes/vision-detail?vision_id=' + encodeURIComponent(cleanedVisionId) + '&limit=' + encodeURIComponent(String(visionDetailLimitForRow(currentRow))), { method: 'GET' });
          if (requestId !== state.visionDetailRequestId) return;
          state.selectedVisionDetail = data && data.detail ? writeVisionDetailCache(cleanedVisionId, data.detail) : null;
          if (!opts.assetSha) {
            var selectedAsset = findSelectedVisionAsset(state.selectedVisionDetail);
            state.selectedVisionAssetSha = selectedAsset ? String(selectedAsset.asset_sha256 || '') : '';
          }
          renderVisionCleanupPanel();
        } catch (err) {
          if (requestId !== state.visionDetailRequestId) return;
          state.selectedVisionDetail = null;
          renderVisionStats();
          if (els.visionCleanupSummary) els.visionCleanupSummary.textContent = 'Vision detail unavailable.';
          els.visionCleanupPanel.innerHTML = inlineFailureMarkup('Vision detail failed fast', requestErrorMessage(err, 'Could not load this artist.'));
          renderVisionQuickActions();
          setLog({ error: 'Vision detail failed', details: err.response || requestErrorMessage(err, 'Vision detail failed.') });
        }
      }

      function renderVisionStats() {
        var sortKey = state.visionSort.key;
        var rows = sortedVisionRows();
        var pageSize = Math.max(1, Number.parseInt(String(state.visionPageSize || 50), 10) || 50);
        var totalRows = rows.length;
        var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
        state.visionPage = clampVisionPage(state.visionPage, totalPages);
        var start = (state.visionPage - 1) * pageSize;
        var end = Math.min(totalRows, start + pageSize);
        var pageRows = rows.slice(start, end);

        updateVisionSortButtons();
        if (els.visionStatsMeta) {
          els.visionStatsMeta.innerHTML = totalRows
            ? [
                '<span>showing ' + esc(String(start + 1)) + '-' + esc(String(end)) + '</span>',
                '<span>of ' + esc(String(totalRows)) + ' visions</span>',
                '<span>sorted by ' + esc(String(sortKey)) + ' ' + esc(String(state.visionSort.dir)) + '</span>'
              ].join(' &middot; ')
            : 'No vision stats yet.';
        }
        if (els.visionPageLabel) {
          els.visionPageLabel.textContent = 'Page ' + state.visionPage + ' of ' + totalPages;
        }
        if (els.visionPageSize) els.visionPageSize.value = String(pageSize);
        if (els.visionPageFirst) els.visionPageFirst.disabled = state.visionPage <= 1;
        if (els.visionPagePrev) els.visionPagePrev.disabled = state.visionPage <= 1;
        if (els.visionPageNext) els.visionPageNext.disabled = state.visionPage >= totalPages;
        if (els.visionPageLast) els.visionPageLast.disabled = state.visionPage >= totalPages;

        els.visionStatsList.innerHTML = pageRows.length ? pageRows.map(function (row) {
          var isSelected = String(state.selectedVisionId || '') === String(row.vision_id || '');
          return [
            '<tr class="vision-table-row' + (isSelected ? ' is-selected' : '') + '">',
            '<td><button class="vision-open-btn" type="button" data-vision-open="' + esc(row.vision_id || '') + '"><strong>' + esc(row.artist_name || row.artist_tag || row.vision_id || 'Unknown vision') + '</strong><span class="small">' + esc(row.artist_tag || row.vision_id || '') + '</span></button></td>',
            '<td class="vision-preview-cell">' + renderVisionPreviewCell(row) + '</td>',
            '<td class="vision-emulsion-cell">' + renderVisionEmulsionCell(row) + '</td>',
            '<td>' + esc(String(row.image_count || 0)) + '</td>',
            '<td>' + esc(String(Math.round((Number(row.avg_vote || 0) * 100) ) / 100)) + '</td>',
            '<td>' + esc(String(Math.round((Number(row.rejection_rate || 0) * 1000)) / 10)) + '%</td>',
            '<td>' + esc(String(row.live_count || 0)) + '</td>',
            '<td><div class="actions"><button class="btn-flat" type="button" data-vision-open="' + esc(row.vision_id || '') + '">Open panel</button>' + (row.blacklisted ? '<span class="small">Blacklisted</span>' : '<span class="small">Use public form</span>') + '</div></td>',
            '</tr>'
          ].join('');
        }).join('') : '<tr><td colspan="8">No vision stats yet.</td></tr>';

        ensureVisibleVisionPreviews(pageRows).catch(function (err) {
          setLog({ error: 'Preview hydration failed', details: err.response || requestErrorMessage(err, 'Preview hydration failed.') });
        });

        renderStylesPendingList();
        renderStylesNotesList();
      }

      async function refreshVisionStats() {
        try {
          if (els.visionStatsList) {
            els.visionStatsList.innerHTML = tableFailureMarkup('Loading vision scorecard…', 'Waiting for the admin read-model endpoints to answer.', 8);
          }
          var results = await Promise.all([
            apiJson('/votes/vision-stats', { method: 'GET' }),
            apiJson('/artist-blacklist-submissions/pending?limit=100', { method: 'GET' })
          ]);
          var data = results[0] || {};
          var pendingData = results[1] || {};
          state.visionStats = Array.isArray(data.rows) ? data.rows : [];
          state.visionPreviewMap = {};
          state.visionDetailCache = {};
          state.warmingVisionDetailIds = {};
          state.preloadedImageUrls = {};
          state.loadingVisionPreviewIds = {};
          state.blacklistedStyles = Array.isArray(data.blacklisted) ? data.blacklisted : [];
          state.pendingBlacklistSubmissions = Array.isArray(pendingData.requests) ? pendingData.requests : [];
          state.visionPage = 1;
          renderVisionStats();
        } catch (err) {
          var message = requestErrorMessage(err, 'Vision stats failed.');
          if (els.visionStatsList) {
            els.visionStatsList.innerHTML = tableFailureMarkup('Vision scorecard failed fast', message, 8);
          }
          if (els.visionStatsMeta) {
            els.visionStatsMeta.innerHTML = '<span style="color: var(--danger)">Vision stats unavailable.</span>';
          }
          if (els.stylesNotes) {
            els.stylesNotes.innerHTML = '<article class="list-row"><div><strong>Vision stats unavailable.</strong><div class="small">' + esc(message) + '</div></div><div></div></article>';
          }
          if (els.stylesPending) {
            els.stylesPending.innerHTML = '<article class="list-row"><div><strong>Submission queue unavailable.</strong><div class="small">' + esc(message) + '</div></div><div></div></article>';
          }
          setLog({ error: 'Vision stats failed', details: err.response || message });
        }
      }

      function filteredAssets() {
        return state.assets.slice();
      }

      function batchUnstaleSymbolsForVisibleSlice() {
        var seen = new Set();
        filteredAssets().forEach(function (row) {
          var symbol = String((row && row.gene_symbol) || '').trim().toUpperCase();
          if (!symbol) return;
          // This button intentionally acts on the current visible slice so the
          // admin can narrow the target with the existing search/filter controls
          // and then apply one batch restore without guessing what else will move.
          var rowHasStale = Number((row && row.stale_count) || 0) > 0 || Boolean(row && (row.has_stale || row.is_stale));
          if (rowHasStale) seen.add(symbol);
        });
        return Array.from(seen);
      }

      function syncVisibleBatchActions() {
        if (!els.unstaleVisible) return;
        var symbols = batchUnstaleSymbolsForVisibleSlice();
        var count = symbols.length;
        els.unstaleVisible.disabled = count === 0;
        els.unstaleVisible.textContent = count ? ('Restore stale in view (' + count + ')') : 'Restore stale in view';
        els.unstaleVisible.title = count
          ? 'Restore stale status for every visible gene in the current gallery slice.'
          : 'No visible genes in this slice have stale status to restore.';
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
          syncVisibleBatchActions();
          return;
        }
        els.body.innerHTML = assets.map(function (a) {
          if (state.galleryMode === 'all') return renderCandidateCard(a);
          if (state.galleryMode === 'side-by-side') return renderCompareCard(a);
          return renderLiveCard(a);
        }).join('');
        syncVisibleBatchActions();
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

      async function handleVisibleBatchUnstale() {
        var symbols = batchUnstaleSymbolsForVisibleSlice();
        if (!symbols.length) throw new Error('No visible stale genes to restore.');
        var query = String((els.search && els.search.value) || '').trim().toUpperCase();
        var prompt = query
          ? 'Restore stale manifestations for ' + symbols.length + ' visible genes matching "' + query + '"?'
          : 'Restore stale manifestations for ' + symbols.length + ' visible genes in the current gallery slice?';
        if (!window.confirm(prompt)) return;
        var body = { symbols: symbols };
        var reason = reasonOrUndefined();
        if (reason) body.reason = reason;
        setLog(await runMutation('/unstale-batch', body));
        await refreshAssets();
        await refreshDerivedAdminViews();
        if (state.selectedGene && symbols.indexOf(String(state.selectedGene || '').toUpperCase()) !== -1) {
          await refreshGeneDetail(state.selectedGene);
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

        document.body.addEventListener('click', async function (ev) {
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

        document.body.addEventListener('click', async function (ev) {
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

          var visionOpenBtn = ev.target.closest('[data-vision-open]');
          if (visionOpenBtn) {
            var visionId = String(visionOpenBtn.getAttribute('data-vision-open') || '');
            var assetSha = String(visionOpenBtn.getAttribute('data-vision-asset') || '');
            refreshVisionDetail(visionId, { assetSha: assetSha || undefined }).catch(function (err) {
              setLog({ error: 'Vision detail failed', details: err.response || requestErrorMessage(err, 'Vision detail failed.') });
            });
            return;
          }

          var visionNavBtn = ev.target.closest('[data-vision-nav]');
          if (visionNavBtn) {
            var delta = String(visionNavBtn.getAttribute('data-vision-nav') || '') === 'prev' ? -1 : 1;
            navigateSelectedVisionAsset(delta);
            return;
          }

          var visionArtistActionBtn = ev.target.closest('[data-vision-artist-action]');
          if (visionArtistActionBtn) {
            var artistAction = String(visionArtistActionBtn.getAttribute('data-vision-artist-action') || '');
            var context = currentVisionContext();
            if (artistAction === 'copy-tag') {
              await navigator.clipboard.writeText(String((context.vision && (context.vision.artist_tag || context.vision.vision_id)) || ''));
              setLog('Copied artist tag for ' + String((context.vision && (context.vision.artist_name || context.vision.artist_tag || context.vision.vision_id)) || 'selected artist'));
            } else if (artistAction === 'open-current-gene') {
              await openVisionGene(context.asset && context.asset.gene_symbol);
            }
            return;
          }

          var visionDetailActionBtn = ev.target.closest('[data-vision-detail-action]');
          if (visionDetailActionBtn) {
            var detailAction = String(visionDetailActionBtn.getAttribute('data-vision-detail-action') || '');
            var detailSymbol = String(visionDetailActionBtn.getAttribute('data-symbol') || '');
            var detailSha = String(visionDetailActionBtn.getAttribute('data-sha') || '');
            try {
              visionDetailActionBtn.disabled = true;
              if (detailAction === 'open-gene') {
                await openVisionGene(detailSymbol);
              } else {
                await handleTableAction(detailAction, detailSymbol, detailSha);
                if (state.selectedVisionId) {
                  await refreshVisionDetail(state.selectedVisionId, { assetSha: detailSha || state.selectedVisionAssetSha, keepDetail: true });
                }
              }
            } catch (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            } finally {
              visionDetailActionBtn.disabled = false;
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
            state.visionPage = 1;
            renderVisionStats();
            return;
          }

          if (ev.target.closest('#vision-page-first')) {
            setVisionPage(1);
            renderVisionStats();
            return;
          }

          if (ev.target.closest('#vision-page-prev')) {
            setVisionPage(state.visionPage - 1);
            renderVisionStats();
            return;
          }

          if (ev.target.closest('#vision-page-next')) {
            setVisionPage(state.visionPage + 1);
            renderVisionStats();
            return;
          }

          if (ev.target.closest('#vision-page-last')) {
            setVisionPage(Math.max(1, Math.ceil((state.visionStats || []).length / Math.max(1, state.visionPageSize || 50))));
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

        });

        document.addEventListener('keydown', function (ev) {
          if (state.activeTab !== 'styles') return;
          if (isEditableTarget(ev.target)) return;
          if (!state.selectedVisionId) return;
          if (ev.key === 'ArrowLeft') {
            ev.preventDefault();
            navigateSelectedVisionAsset(-1);
            return;
          }
          if (ev.key === 'ArrowRight') {
            ev.preventDefault();
            navigateSelectedVisionAsset(1);
            return;
          }
          if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            selectRelativeVision(-1);
            return;
          }
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            selectRelativeVision(1);
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

        if (els.visionOpenCurrentGene) {
          els.visionOpenCurrentGene.addEventListener('click', function () {
            var context = currentVisionContext();
            openVisionGene(context.asset && context.asset.gene_symbol);
          });
        }

        if (els.visionCopyCurrentTag) {
          els.visionCopyCurrentTag.addEventListener('click', async function () {
            var context = currentVisionContext();
            var artistTag = String((context.vision && (context.vision.artist_tag || context.vision.vision_id)) || '').trim();
            if (!artistTag) return;
            await navigator.clipboard.writeText(artistTag);
            setLog('Copied artist tag: ' + artistTag);
          });
        }

        if (els.unstaleVisible) {
          els.unstaleVisible.addEventListener('click', async function () {
            try {
              els.unstaleVisible.disabled = true;
              await handleVisibleBatchUnstale();
            } catch (err) {
              setLog({ error: String(err.message || err), details: err.response || null });
            } finally {
              syncVisibleBatchActions();
            }
          });
        }
      }

      function init() {
        setActiveTab('overview');
        syncGalleryModeButtons();
        els.visionStatsList.innerHTML = '<tr><td colspan="8">Open this tab to load the scorecard.</td></tr>';
        if (els.visionStatsMeta) els.visionStatsMeta.textContent = 'Open this tab to load the scorecard.';
        renderVisionCleanupPanel();
        renderVisionQuickActions();
        if (els.stylesPending) {
          els.stylesPending.innerHTML = '<article class="list-row"><div><strong>No artist-tag requests waiting.</strong><div class="small">Open the tab to load requests from /artist-styles.</div></div><div></div></article>';
        }
        els.stylesNotes.innerHTML = '<article class="list-row"><div><strong>No artist styles are blocklisted yet.</strong><div class="small">Open the tab to load the current site blocklist.</div></div><div></div></article>';
        syncVisibleBatchActions();
        els.refresh.addEventListener('click', function () {
          refreshAssets();
        });
        els.status.addEventListener('change', refreshAssets);
        els.stale.addEventListener('change', refreshAssets);
        els.limit.addEventListener('change', refreshAssets);
        els.search.addEventListener('input', refreshAssets);
        if (els.visionPageSize) {
          els.visionPageSize.addEventListener('change', function () {
            state.visionPageSize = Math.max(1, Number.parseInt(String(els.visionPageSize.value || '50'), 10) || 50);
            state.visionPage = 1;
            renderVisionStats();
          });
        }
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
