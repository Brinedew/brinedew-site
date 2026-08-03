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

    [hidden] {
      display: none !important;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #ffffff;
      margin: 0;
      padding: 0;
      line-height: 1.6;
      overflow-x: hidden;
    }
    
    .container {
      display: flex;
      min-height: 100vh;
    }
    
    .left-panel {
      flex: 1;
      padding: 2rem;
      overflow-y: auto;
      max-height: 100vh;
    }
    
    .right-panel {
      width: 500px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: #1e293b;
      border-left: 1px solid #334155;
      padding: 2rem;
    }
    
    h1 {
      color: #ffffff;
      margin: 0;
      font-size: 1.5rem;
    }

    .admin-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }

    .admin-header-status {
      color: #94a3b8;
      font-size: 0.875rem;
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
      background: #f8f1e7;
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
      background: #110c0a;
      position: relative;
      overflow: hidden;
    }

    /* Match the public game's floating "Target" callout styling. */
    .pg-chain-callouts.pg-chain-callouts-3d {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      max-width: none;
      pointer-events: none;
      z-index: 5;
    }

    .pg-chain-callout {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.5rem;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 4px;
      font-size: 0.7rem;
      line-height: 1.2;
      backdrop-filter: blur(4px);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    /* 3D-positioned callout styling: no background, colored text */
    .pg-chain-callout.pg-chain-callout-3d {
      position: absolute;
      background: none !important;
      backdrop-filter: none !important;
      box-shadow: none !important;
      border: none !important;
      padding: 0;
      font-size: 0.85rem;
      font-weight: 700;
      text-shadow: none;
      transition: opacity 0.15s ease-out;
      pointer-events: auto;
      cursor: default;
      white-space: nowrap;
    }

    .pg-chain-callout-3d .pg-chain-label-gene {
      display: inline;
    }

    .pg-chain-callout-3d .pg-chain-label-full {
      display: none;
      margin-left: 0.25em;
      font-weight: 400;
      opacity: 0.9;
    }

    .pg-chain-callout-3d:hover .pg-chain-label-full {
      display: inline;
    }

    .pg-chain-callout-3d:hover .pg-chain-label-gene {
      display: none;
    }

    .pg-chain-callout.pg-chain-callout-3d.pg-chain-callout-target {
      font-size: 0.95rem;
    }

    .viewer-preview__canvas canvas {
      border-radius: 8px;
    }

    .viewer-mount {
      position: relative;
      width: 100%;
      height: 100%;
      background: inherit;
    }

    .viewer-mount > .msp-plugin {
      height: 100%;
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

    .protein-selector-wrapper {
      position: relative;
    }

    .protein-suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #0f172a;
      border: 1px solid #334155;
      border-top: none;
      border-radius: 0 0 4px 4px;
      max-height: 320px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
    }

    .protein-suggestions.show {
      display: block;
    }

    .protein-suggestion {
      padding: 0.75rem;
      cursor: pointer;
      border-bottom: 1px solid #1e293b;
      transition: background 0.15s;
    }

    .protein-suggestion:hover,
    .protein-suggestion.selected {
      background: #1e293b;
    }

    .protein-suggestion:last-child {
      border-bottom: none;
    }

    .protein-suggestion-title {
      font-weight: 600;
      color: #ffffff;
      font-size: 0.875rem;
      margin-bottom: 0.25rem;
    }

    .protein-suggestion-sub {
      font-size: 0.75rem;
      color: #ffffff;
      opacity: 0.7;
    }

    .protein-suggestion-uniprot {
      font-size: 0.7rem;
      color: #38bdf8;
      font-family: monospace;
      margin-top: 0.25rem;
    }

    /* Previously scheduled warning in autocomplete */
    .protein-suggestion.previously-scheduled {
      border-left: 3px solid #f59e0b;
    }

    .protein-suggestion-prev-date {
      font-size: 0.7rem;
      color: #f59e0b;
      margin-top: 0.25rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .protein-suggestion-prev-date::before {
      content: '!';
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      background: #f59e0b;
      color: #000;
      border-radius: 50%;
      font-size: 0.65rem;
      font-weight: bold;
    }

    /* Callout for selected protein that was previously scheduled */
    .duplicate-warning-callout {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid #f59e0b;
      border-radius: 4px;
      padding: 0.5rem 0.75rem;
      margin-top: 0.5rem;
      font-size: 0.8rem;
      color: #fbbf24;
      display: none;
    }

    .duplicate-warning-callout.show {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .duplicate-warning-callout .warning-icon {
      flex-shrink: 0;
      font-size: 1rem;
    }

    .duplicate-warning-callout .warning-text {
      flex: 1;
    }

    .duplicate-warning-callout .warning-dates {
      font-weight: 600;
      color: #fcd34d;
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

    /* Calendar Styles */
    .calendar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .calendar-month-tools {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.65rem;
      flex-wrap: wrap;
    }
    #current-month-label {
      margin: 0;
    }
    #btn-upload-month-images {
      padding: 0.4rem 0.75rem;
      font-size: 0.78rem;
      line-height: 1.2;
      white-space: nowrap;
    }
    .calendar-upload-message {
      min-height: 1.25rem;
      margin: -0.25rem 0 0.75rem;
    }
    @media (max-width: 780px) {
      .calendar-header {
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .calendar-month-tools {
        width: 100%;
        justify-content: flex-start;
        order: 3;
      }
    }
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.5rem;
      grid-auto-rows: minmax(80px, auto);
    }
    .calendar-day-header {
      text-align: center;
      font-weight: bold;
      padding: 0.5rem;
      color: #94a3b8;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .calendar-day {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      min-height: 80px;
      padding: 0.5rem;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .calendar-day:hover {
      border-color: #38bdf8;
      transform: translateY(-2px);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    .calendar-day.empty {
      background: transparent;
      border: none;
      cursor: default;
      box-shadow: none;
    }
    .calendar-day.today {
      border-color: #38bdf8;
      background: #1e293b;
    }
    .calendar-day.today .day-number {
      color: #38bdf8;
    }
    .calendar-day.selected {
      border-color: #38bdf8;
      box-shadow: 0 0 0 2px #38bdf8;
      z-index: 10;
    }
    
    /* Status Colors */
    .calendar-day.is-override {
      background: rgba(56, 189, 248, 0.1);
      border-color: rgba(56, 189, 248, 0.3);
    }
    .calendar-day.is-computed {
      background: rgba(148, 163, 184, 0.05);
    }
    .calendar-day.is-history {
      opacity: 0.7;
    }
    .calendar-day.missing-recap-image {
      border-color: #ef4444;
      box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.75);
    }
    .calendar-day.missing-recap-image.selected {
      box-shadow: 0 0 0 2px #38bdf8, inset 0 0 0 1px rgba(239, 68, 68, 0.8);
    }
    
    .day-number {
      font-weight: 600;
      font-size: 0.875rem;
      margin-bottom: 0.25rem;
      color: #94a3b8;
    }

    .day-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 0.25rem;
    }

    .day-symbol {
      font-weight: 700;
      font-size: 1rem;
      color: #f1f5f9;
    }
    
    .day-badge {
      font-size: 0.65rem;
      padding: 0.1rem 0.4rem;
      border-radius: 999px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .day-badge.override { background: #0ea5e9; color: white; }
    .day-badge.computed { background: #475569; color: #e2e8f0; }
    
    /* Inspector Panel Styles */
    .inspector-header {
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #334155;
    }
    .inspector-date {
      font-size: 1.5rem;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 0.25rem;
    }
    .inspector-meta {
      color: #94a3b8;
      font-size: 0.875rem;
    }
    
    .inspector-section {
      margin-bottom: 2rem;
    }
    .inspector-label {
      text-transform: uppercase;
      font-size: 0.75rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 0.5rem;
      letter-spacing: 0.05em;
    }
    
    .inspector-cards {
      background: #0f172a;
      border-radius: 6px;
      padding: 1rem;
      border: 1px solid #334155;
    }
    .schedule-table th,
    .schedule-table td {
      border: 1px solid #334155;
      padding: 0.5rem;
      vertical-align: top;
    }
    .schedule-table th {
      background: #0f172a;
      color: #e2e8f0;
      text-align: left;
      font-weight: 600;
    }
    .schedule-meta {
      color: #94a3b8;
      font-size: 0.8rem;
      margin-top: 0.15rem;
    }
    .schedule-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .cards-preview {
      margin-top: 1rem;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem;
      background: #0b1220;
    }
    .cards-preview h3 {
      margin-top: 0;
    }
    .cards-preview .section-block {
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid #334155;
    }
    .cards-preview .clue-section-title {
      margin: 0 0 0.35rem 0;
      font-weight: 600;
      color: #e2e8f0;
    }
    .cards-preview .clue-item {
      margin: 0.25rem 0;
      color: #cbd5e1;
      font-size: 0.9rem;
    }
    .cards-preview .clue-item .pill {
      display: inline-block;
      margin-right: 0.5rem;
      padding: 0.1rem 0.4rem;
      border: 1px solid #334155;
      border-radius: 999px;
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .cards-preview .redaction-line {
      display: inline;
      white-space: normal;
    }

    .cards-preview .redaction-word {
      display: inline-block;
      height: 0.9em;
      background: #334155;
      border-radius: 2px;
      margin: 0 0.25rem 0.15rem 0;
      vertical-align: middle;
      opacity: 0.9;
    }

    .cards-preview .redaction-space {
      display: inline-block;
      width: 0.35rem;
    }

      /* Guess statistics bar chart */
      .guess-stats-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
    .guess-stats-row {
      display: grid;
      grid-template-columns: 32px 1fr 100px;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }
    .guess-stats-count {
      font-weight: 600;
      color: #94a3b8;
      text-align: right;
    }
    .guess-stats-label {
      color: #e2e8f0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .guess-stats-bar {
      height: 8px;
      background: rgba(148,163,184,0.18);
      border-radius: 4px;
      overflow: hidden;
    }
      .guess-stats-bar-fill {
        height: 100%;
        background: rgba(56,189,248,0.65);
        border-radius: 4px;
      }

      /* Neighbor list (precomputed similarity) */
      .neighbors-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .neighbor-row {
        display: grid;
        grid-template-columns: 32px 1fr auto;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
      }
      .neighbor-rank {
        font-weight: 600;
        color: #94a3b8;
        text-align: right;
      }
      .neighbor-gene {
        color: #e2e8f0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .neighbor-meta {
        color: #94a3b8;
        font-size: 0.8rem;
        white-space: nowrap;
      }

      /* Guess analytics (range) */
      .guess-analytics-controls {
        display: flex;
        flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.75rem 0 0.5rem 0;
    }
    .guess-analytics-range {
      padding: 0.45rem 0.7rem;
      border: 1px solid #334155;
      border-radius: 10px;
      background: rgba(15,23,42,0.6);
      color: #cbd5e1;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .guess-analytics-range.is-active {
      border-color: rgba(56,189,248,0.75);
      background: rgba(56,189,248,0.12);
      color: #e2e8f0;
    }
    .guess-analytics-meta {
      color: #94a3b8;
      font-size: 0.85rem;
      margin: 0.25rem 0 0.75rem 0;
    }
    .guess-analytics-list {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      max-height: 520px;
      overflow: auto;
      padding-right: 0.25rem;
    }
    .guess-analytics-row {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) 54px 140px;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.875rem;
    }
    .guess-analytics-count {
      font-weight: 600;
      color: #94a3b8;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .guess-analytics-label {
      color: #e2e8f0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .guess-analytics-share {
      color: #94a3b8;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .guess-analytics-bar {
      height: 8px;
      background: rgba(148,163,184,0.18);
      border-radius: 4px;
      overflow: hidden;
    }
    .guess-analytics-bar-fill {
      height: 100%;
      background: rgba(56,189,248,0.65);
      border-radius: 4px;
    }

    .iconoplasm-cost-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }

    .iconoplasm-cost-actions {
      display: inline-flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: center;
    }

    .iconoplasm-cost-link {
      color: #7dd3fc;
      font-size: 0.875rem;
      text-decoration: none;
      font-weight: 600;
    }

    .iconoplasm-cost-link:hover {
      color: #bae6fd;
      text-decoration: underline;
    }

    .iconoplasm-cost-updated {
      color: #94a3b8;
      font-size: 0.8rem;
    }

    .iconoplasm-cost-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .iconoplasm-cost-metric {
      background: linear-gradient(180deg, rgba(17, 27, 47, 0.92), rgba(15, 23, 42, 0.92));
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 0.9rem;
      display: grid;
      gap: 0.35rem;
    }

    .iconoplasm-cost-metric-label {
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.7rem;
      font-weight: 700;
    }

    .iconoplasm-cost-metric-value {
      font-size: 1.7rem;
      font-weight: 700;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .iconoplasm-cost-metric-note {
      color: #cbd5e1;
      font-size: 0.82rem;
    }

    .iconoplasm-cost-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.9fr);
      gap: 1rem;
    }

    .iconoplasm-cost-card {
      background: #111b2f;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 1rem;
      display: grid;
      gap: 0.75rem;
    }

    .iconoplasm-cost-card-head {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: baseline;
      flex-wrap: wrap;
    }

    .iconoplasm-cost-card-head p {
      color: #94a3b8;
      font-size: 0.8rem;
    }

    .iconoplasm-cost-chart {
      min-height: 260px;
      border-radius: 10px;
      background: #0b1324;
      border: 1px solid #1f2a3d;
      padding: 0.5rem;
    }

    .iconoplasm-cost-chart svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .iconoplasm-cost-budget {
      display: grid;
      gap: 0.8rem;
    }

    .iconoplasm-cost-budget-row {
      display: grid;
      gap: 0.45rem;
    }

    .iconoplasm-cost-budget-meta {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      font-size: 0.8rem;
      color: #cbd5e1;
    }

    .iconoplasm-cost-budget-track {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(148, 163, 184, 0.16);
    }

    .iconoplasm-cost-budget-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #38bdf8, #0ea5e9);
    }

    .iconoplasm-cost-budget-fill.warn {
      background: linear-gradient(90deg, #f59e0b, #d97706);
    }

    .iconoplasm-cost-budget-fill.danger {
      background: linear-gradient(90deg, #fb7185, #ef4444);
    }

    .iconoplasm-cost-bars {
      display: grid;
      gap: 0.75rem;
    }

    .iconoplasm-cost-bar-row {
      display: grid;
      gap: 0.35rem;
    }

    .iconoplasm-cost-bar-head {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: baseline;
      font-size: 0.8rem;
      color: #cbd5e1;
    }

    .iconoplasm-cost-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.14);
      color: #e2e8f0;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .iconoplasm-cost-bar-track {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(148, 163, 184, 0.14);
    }

    .iconoplasm-cost-bar-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #38bdf8, #1d4ed8);
    }

    .iconoplasm-cost-table {
      width: 100%;
      border-collapse: collapse;
    }

    .iconoplasm-cost-table th,
    .iconoplasm-cost-table td {
      padding: 0.65rem 0;
      border-bottom: 1px solid #243249;
      text-align: left;
      vertical-align: top;
      font-size: 0.8rem;
    }

    .iconoplasm-cost-table th {
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.68rem;
    }

    .iconoplasm-cost-table td.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 980px) {
      .iconoplasm-cost-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="left-panel">
      <div class="admin-header">
        <h1>GeneGuessr Admin Panel</h1>
        <span class="admin-header-status" id="status-display">Loading...</span>
      </div>

    <!-- Calendar Section -->
    <div class="section">
      <h2>Calendar & Overrides</h2>
      <div class="calendar-header">
        <button id="prev-month">&lt; Prev</button>
        <div class="calendar-month-tools">
          <h3 id="current-month-label"></h3>
          <button type="button" id="btn-upload-month-images">Fill Displayed Month's Image Previews</button>
        </div>
        <button id="next-month">Next &gt;</button>
      </div>
      <div id="calendar-image-message" class="calendar-upload-message"></div>
      <div class="calendar-grid" id="calendar-grid">
        <!-- Days will be injected here -->
      </div>
    </div>

    <!-- Guess Analytics -->
    <div class="section" id="guess-analytics-section">
      <h2>Guess Analytics</h2>
      <p class="helper-text helper-text--title" style="margin-bottom: 0.25rem;">
        This shows the most guessed genes across the last week, month, or year. It only refreshes at most once per day, and only when you click a range.
      </p>
      <div class="guess-analytics-controls">
        <button type="button" class="guess-analytics-range" data-range="week">Last 7 days</button>
        <button type="button" class="guess-analytics-range" data-range="month">Last 30 days</button>
        <button type="button" class="guess-analytics-range" data-range="year">Last 365 days</button>
      </div>
      <div class="guess-analytics-meta" id="guess-analytics-meta">Not loaded yet.</div>
      <div id="guess-analytics-root">
        <p class="helper-text">Pick a range to load top 50 guesses.</p>
      </div>
    </div>

    <div class="section" id="iconoplasm-cost-section">
      <div class="iconoplasm-cost-toolbar">
        <div>
          <h2>Iconoplasm Ops</h2>
          <p class="helper-text helper-text--title" style="margin: 0.25rem 0 0;">
            Iconoplasm gets its own admin surface now. Open the dedicated page for the interactive cost graphs, gallery triage, vision review, and activity log instead of mixing that into the GeneGuessr admin tab.
          </p>
        </div>
        <div class="iconoplasm-cost-actions">
          <a class="iconoplasm-cost-link" href="/admin/iconoplasm#costs">Open Iconoplasm ops</a>
        </div>
      </div>
    </div>

    <!-- Graphics Options -->
    <div class="section">
      <h2>Graphics Options</h2>
      <p class="helper-text helper-text--title" style="margin-bottom: 1rem;">
        Configure 3D protein viewer rendering settings. Preview updates live in the right panel.
      </p>
      
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
        <p class="helper-text" style="margin-bottom: 1rem;">
          Adjust the individual key, fill, and rim lights below. Use the profile manager to save custom lighting sets.
        </p>
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
          <button type="submit">Preview in Admin</button>
          <button type="button" id="graphics-push-live" class="btn-primary">Push to Live Site</button>
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
    
    <div class="right-panel">
      <div class="inspector-header">
        <div class="inspector-date" id="inspector-date">Select a Date</div>
        <div class="inspector-meta" id="inspector-meta">Click a day on the calendar to inspect</div>
      </div>

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
          <div class="viewer-placeholder" id="graphics-preview-placeholder">Select a date to view protein</div>
          <div class="viewer-loading" id="graphics-preview-loading" hidden>Loading viewer...</div>
          <div class="viewer-error" id="graphics-preview-error" hidden></div>
          <div class="viewer-mount" id="graphics-preview-mount" aria-hidden="true"></div>
        </div>
      </div>

      <!-- Inspector Controls (Override Form) -->
      <div class="inspector-section" id="inspector-controls" style="display:none;">
        <div class="inspector-label">Daily Protein Selection</div>
        <form id="override-form">
          <input type="hidden" id="override-date">
          <div class="form-group">
            <div class="protein-selector-wrapper">
              <input type="text" id="override-uniprot" placeholder="Enter gene symbol (e.g. WEE1) to override" autocomplete="off">
              <div class="protein-suggestions" id="protein-suggestions"></div>
            </div>
            <div class="duplicate-warning-callout" id="duplicate-warning-callout">
              <span class="warning-icon">&#9888;</span>
              <span class="warning-text">This protein was previously scheduled on: <span class="warning-dates" id="duplicate-warning-dates"></span></span>
            </div>
          </div>
          <div class="form-actions" style="margin-top: 0.5rem;">
            <button type="submit" id="btn-save-override">Set Override</button>
            <button type="button" id="btn-delete-override" class="btn-delete" style="display: none;">Clear Override</button>
          </div>
        </form>
        <div id="override-message"></div>
        <div id="discord-image-warning"></div>
        <div class="form-actions" style="margin-top: 0.5rem;">
          <button type="button" id="btn-upload-day-image">Upload Selected Day Image</button>
          <button type="button" id="btn-repair-posted-recap">Update Posted Recap</button>
          <button type="button" id="btn-upload-year-images">Upload Next 365 Days</button>
        </div>
        <div id="discord-image-message"></div>
      </div>

      <!-- Cards / Details -->
      <div class="inspector-section" id="inspector-details" style="display:none;">
        <div class="inspector-label">Game Data</div>
        <div id="schedule-cards" class="inspector-cards"></div>
      </div>

        <!-- Aggregated guess stats (no per-user data) -->
        <div class="inspector-section" id="inspector-guess-stats" style="display:none;">
          <div class="inspector-label">Top Guesses</div>
          <div id="guess-stats" class="inspector-cards"></div>
        </div>

        <!-- Top-9 neighbors (precomputed similarity) -->
        <div class="inspector-section" id="inspector-neighbors" style="display:none;">
          <div class="inspector-label">Top-9 Neighbors</div>
          <div id="neighbors-list" class="inspector-cards"></div>
        </div>
      </div>
    </div>
    
    <script src="/static/geneguessr/molstar-shared.js?v=admin"></script>
    <script>
    const API_BASE = '';

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

    const ACCENT_COLOR_HEX = '#1b7269';
    const LIGHT_NEUTRAL_GRAY_HEX = '#ab9b8f';
    const DARK_NEUTRAL_GRAY_HEX = '#87776d';
    let currentGraphicsSettings = deepClone(DEFAULT_GRAPHICS_SETTINGS);
    let pendingGraphicsSettings = deepClone(DEFAULT_GRAPHICS_SETTINGS);
    let GRAPHICS_SETTINGS = deepClone(DEFAULT_GRAPHICS_SETTINGS);
    let previewViewer = null;
    let previewTheme = 'dark';
    let previewReady = false;
    let previewLoadToken = 0;
    let previewStructureChoice = null;
    const profileState = {
      builtInIds: new Set(BUILT_IN_PROFILES.map((p) => p.id)),
      profiles: deepClone(DEFAULT_GRAPHICS_SETTINGS.profileManager.profiles),
      activeId: DEFAULT_GRAPHICS_SETTINGS.profileManager.activeProfileId,
      selectedId: DEFAULT_GRAPHICS_SETTINGS.profileManager.activeProfileId
    };

    const viewerPreviewEl = document.getElementById('viewer-preview');
    const previewContainer = document.getElementById('graphics-preview');
    const previewMountEl = document.getElementById('graphics-preview-mount');
    const previewStatusEl = document.getElementById('viewer-preview-status');
    const previewPlaceholderEl = document.getElementById('graphics-preview-placeholder');
    const previewLoadingEl = document.getElementById('graphics-preview-loading');
    const previewErrorEl = document.getElementById('graphics-preview-error');

    // Inspector uses a hidden date field; set an initial ISO date value safely.
    {
      const overrideDateEl = document.getElementById('override-date');
      if (overrideDateEl) {
        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        overrideDateEl.value = yyyy + '-' + mm + '-' + dd;
      }
    }

    setupPreviewToggle();
    setupGraphicsForm();
    bindForms();
    setupProteinSelector();
    loadStatus();
    setupSchedule();
    initializePreview();

    let scheduleData = {};
    const recapImageExistsByDay = Object.create(null);
    let recapStatusRefreshInFlight = null;
    const recapStatusQueuedDays = new Set();
    const DISCORD_IMAGE_UPLOAD_DAYS = 365;
    const DEFAULT_SCHEDULE_FUTURE_DAYS = 120;
    let recapUploadRunning = false;
    let scheduleRefreshInFlight = null;

    // Override picker state: keep the UI gene-first, but keep the selected UniProt ID as the internal key.
    let overrideSelectedSuggestionUniprot = null;
    let overrideSelectedSuggestionGene = null;

    function setupSchedule() {
      // No controls needed anymore, auto-load on init
      loadSchedule({ futureDays: 120 });
      refreshRecapWarning().catch((err) => {
        console.error('Failed initial recap warning refresh:', err);
      });
    }

    function applyLocalOverride(date, uniprotId, symbolHint) {
      if (!date || !uniprotId) return;
      const existing = scheduleData[date] || {};
      const fallbackSymbol = String(symbolHint || uniprotId || '').trim();
      scheduleData[date] = {
        type: existing.type || 'upcoming',
        source: 'override',
        uniprot: uniprotId,
        symbol: existing.symbol || fallbackSymbol || uniprotId,
        fullName: existing.fullName || null,
        rejected: existing.rejected
      };
      renderCalendar(currentDate);
    }

    function clearLocalOverride(date) {
      if (!date) return;
      const existing = scheduleData[date];
      if (!existing) return;
      if (existing.type === 'history') {
        scheduleData[date] = {
          ...existing,
          source: 'actual'
        };
      } else {
        scheduleData[date] = {
          ...existing,
          source: 'computed'
        };
      }
      renderCalendar(currentDate);
    }

    function queueBackgroundScheduleRefresh(options = {}) {
      if (scheduleRefreshInFlight) return scheduleRefreshInFlight;
      const dateToReselect = options.date || selectedDate || document.getElementById('override-date')?.value || null;
      const futureDays = options.futureDays ?? DEFAULT_SCHEDULE_FUTURE_DAYS;

      scheduleRefreshInFlight = (async () => {
        await Promise.allSettled([
          loadStatus(),
          loadSchedule({ futureDays })
        ]);
        if (dateToReselect) {
          selectDate(dateToReselect);
        }
      })()
      .catch((err) => {
        console.error('Background schedule refresh failed:', err);
      })
      .finally(() => {
        scheduleRefreshInFlight = null;
      });

      return scheduleRefreshInFlight;
    }

    async function loadSchedule(options = {}) {
      try {
        const requestedFutureDays = Number(options.futureDays);
        const futureDays = Number.isFinite(requestedFutureDays)
          ? Math.max(0, Math.min(370, Math.floor(requestedFutureDays)))
          : DEFAULT_SCHEDULE_FUTURE_DAYS;
        const response = await fetch(API_BASE + '/api/admin/schedule?futureDays=' + futureDays, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load schedule');
        }
        
        // Process data into map
        scheduleData = {};
        
        // History
        (data.history || []).forEach(row => {
          scheduleData[row.date] = {
            type: 'history',
            source: row.source || 'actual',
            uniprot: row.uniprot_id,
            symbol: row.protein?.hgnc || row.uniprot_id,
            rejected: row.rejected_count
          };
        });
        
        // Upcoming
        (data.upcoming || []).forEach(row => {
          const isOverride = !!row.override_uniprot_id;
          const protein = isOverride
            ? (row.override_protein || { uniprot: row.override_uniprot_id })
            : row.computed;
          
          scheduleData[row.date] = {
            type: 'upcoming',
            source: isOverride ? 'override' : 'computed',
            uniprot: protein?.uniprot || row.override_uniprot_id,
            symbol: protein?.hgnc || protein?.uniprot || row.override_uniprot_id,
            fullName: protein?.full_name
          };
        });
        
        renderCalendar(currentDate);
        
        // If we have a selected date, refresh inspector
        if (selectedDate) {
          selectDate(selectedDate);
        }
      } catch (err) {
        console.error('Error loading schedule:', err);
      }
    }
    
    // Removed renderSchedule


    let cardsLoadToken = 0;
      
    async function loadCardsForDate(date) {
      const loadToken = ++cardsLoadToken;
      const cardsEl = document.getElementById('schedule-cards');
      if (!cardsEl) return;
      const neighborsSectionEl = document.getElementById('inspector-neighbors');
      const neighborsEl = document.getElementById('neighbors-list');
      cardsEl.style.display = 'block';
      cardsEl.innerHTML = '<p class="helper-text">Loading cards for ' + escapeHtml(date) + '...</p>';
      if (neighborsSectionEl && neighborsEl) {
        neighborsSectionEl.style.display = 'block';
        neighborsEl.innerHTML = '<p class="helper-text">Loading neighbors for ' + escapeHtml(date) + '...</p>';
      }
      try {
        const response = await fetch(API_BASE + '/api/admin/cards?date=' + encodeURIComponent(date), { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load cards');
        }
        if (loadToken !== cardsLoadToken) {
          return;
        }
        renderCardsPreview(cardsEl, data);
        if (neighborsSectionEl && neighborsEl) {
          renderNeighborsList(neighborsEl, data?.neighbors, data?.protein);
        }
      } catch (err) {
        if (loadToken !== cardsLoadToken) {
          return;
        }
        console.error('Error loading cards:', err);
        cardsEl.innerHTML = '<p class="helper-text error-text">Failed to load cards for ' + escapeHtml(date) + '</p>';
        if (neighborsSectionEl && neighborsEl) {
          neighborsEl.innerHTML = '<p class="helper-text error-text">Failed to load neighbors for ' + escapeHtml(date) + '</p>';
        }
      }
    }

    let guessStatsLoadToken = 0;

    async function loadGuessStatsForDate(date) {
      const loadToken = ++guessStatsLoadToken;
      const sectionEl = document.getElementById('inspector-guess-stats');
      const rootEl = document.getElementById('guess-stats');
      if (!sectionEl || !rootEl) return;

      sectionEl.style.display = 'block';
      rootEl.innerHTML = '<p class="helper-text">Loading guess stats for ' + escapeHtml(date) + '...</p>';

      try {
        const response = await fetch(API_BASE + '/api/admin/guess-stats?date=' + encodeURIComponent(date) + '&limit=25', { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load guess stats');
        }
        if (loadToken !== guessStatsLoadToken) {
          return;
        }
        renderGuessStats(rootEl, data);
      } catch (err) {
        if (loadToken !== guessStatsLoadToken) {
          return;
        }
        console.error('Error loading guess stats:', err);
        rootEl.innerHTML = '<p class="helper-text error-text">Failed to load guess stats for ' + escapeHtml(date) + '</p>';
      }
    }

      function renderGuessStats(rootEl, data) {
        const guesses = Array.isArray(data?.guesses) ? data.guesses : [];
        const total = Number(data?.totalGuesses) || 0;

      rootEl.innerHTML = '';

      const header = document.createElement('div');
      header.innerHTML =
        '<h3 style="margin-bottom: 0.25rem;">Top guesses</h3>' +
        '<div class="schedule-meta">' +
          escapeHtml(String(total)) + ' total guesses recorded' +
        '</div>';
      rootEl.appendChild(header);

      if (!guesses.length) {
        const empty = document.createElement('p');
        empty.className = 'helper-text';
        empty.textContent = 'No data recorded for this day yet.';
        rootEl.appendChild(empty);
        return;
      }

      const max = Math.max(...guesses.map((g) => Number(g?.count) || 0), 1);
      const list = document.createElement('div');
      list.className = 'guess-stats-list';

      guesses.forEach((g) => {
        const count = Number(g?.count) || 0;
        const label = g?.gene ? String(g.gene) : 'Unknown';
        const pct = Math.round((count / max) * 100);

        const row = document.createElement('div');
        row.className = 'guess-stats-row';
        row.innerHTML =
          '<span class="guess-stats-count">' + escapeHtml(String(count)) + '</span>' +
          '<span class="guess-stats-label">' + escapeHtml(label) + '</span>' +
          '<div class="guess-stats-bar">' +
            '<div class="guess-stats-bar-fill" style="width: ' + pct + '%;"></div>' +
          '</div>';
        list.appendChild(row);
      });

        rootEl.appendChild(list);
      }

      function renderNeighborsList(rootEl, neighbors, targetProtein) {
        const items = Array.isArray(neighbors) ? neighbors : [];
        const targetLabel = targetProtein?.hgnc || targetProtein?.gene || targetProtein?.uniprot || null;

        rootEl.innerHTML = '';

        const header = document.createElement('div');
        header.innerHTML =
          '<h3 style="margin-bottom: 0.25rem;">Top-9 neighbors</h3>' +
          '<div class="schedule-meta">' +
            (targetLabel ? ('Target: ' + escapeHtml(String(targetLabel)) + ' ') : '') +
            escapeHtml(String(items.length)) + ' listed' +
          '</div>';
        rootEl.appendChild(header);

        if (!items.length) {
          const empty = document.createElement('p');
          empty.className = 'helper-text';
          empty.textContent = 'No neighbors recorded for this target.';
          rootEl.appendChild(empty);
          return;
        }

        const list = document.createElement('div');
        list.className = 'neighbors-list';

        items.slice(0, 9).forEach((n, idx) => {
          const displayPct = 100 - (idx + 1);
          const gene =
            n?.gene != null ? String(n.gene)
              : (n?.hgnc != null ? String(n.hgnc)
                : (n?.symbol != null ? String(n.symbol) : 'Unknown'));

          const uniprot =
            n?.uniprot != null ? String(n.uniprot)
              : (n?.uniprot_id != null ? String(n.uniprot_id)
                : (n?.id != null ? String(n.id) : ''));

          const metric = Number(n?.metric);
          let metricText = '';
          if (Number.isFinite(metric)) {
            metricText = 'metric ' + metric.toFixed(3);
          }

          const rawScore =
            n?.score ?? n?.similarity ?? n?.blended ?? n?.pct ?? n?.percent ?? n?.value ?? null;
          let scoreText = '';
          const scoreNum = Number(rawScore);
          if (Number.isFinite(scoreNum)) {
            if (scoreNum >= 0 && scoreNum <= 1) {
              scoreText = String(Math.round(scoreNum * 100)) + '%';
            } else if (scoreNum >= 0 && scoreNum <= 100) {
              scoreText = String(Math.round(scoreNum)) + '%';
            } else {
              scoreText = String(scoreNum);
            }
          }

          const metaParts = [];
          if (uniprot) metaParts.push(uniprot);
          metaParts.push('display ' + String(displayPct) + '%');
          if (metricText) {
            metaParts.push(metricText);
          } else if (scoreText) {
            metaParts.push('score ' + scoreText);
          }
          const meta = metaParts.join('  ');

          const row = document.createElement('div');
          row.className = 'neighbor-row';
          row.innerHTML =
            '<span class="neighbor-rank">' + escapeHtml(String(idx + 1)) + '</span>' +
            '<span class="neighbor-gene">' + escapeHtml(gene) + '</span>' +
            '<span class="neighbor-meta">' + escapeHtml(meta) + '</span>';

          list.appendChild(row);
        });

        rootEl.appendChild(list);
      }

      let guessAnalyticsLoadToken = 0;
      let iconoplasmCostLoadToken = 0;

    function getUtcDayString() {
      return new Date().toISOString().slice(0, 10);
    }

    function buildGuessAnalyticsStorageKey(range, endDay) {
      return 'guessAnalytics:' + String(range) + ':' + String(endDay);
    }

    function setActiveGuessAnalyticsRange(range) {
      const buttons = document.querySelectorAll('.guess-analytics-range[data-range]');
      buttons.forEach((btn) => {
        const isActive = btn.getAttribute('data-range') === range;
        btn.classList.toggle('is-active', isActive);
      });
    }

    function renderGuessAnalytics(rootEl, payload) {
      const guesses = Array.isArray(payload?.guesses) ? payload.guesses : [];
      const total = Number(payload?.totalGuesses) || 0;
      const startDay = payload?.startDay || '';
      const endDay = payload?.endDay || '';

      rootEl.innerHTML = '';

      if (!guesses.length) {
        const empty = document.createElement('p');
        empty.className = 'helper-text';
        empty.textContent = 'No aggregated guesses found for this range yet.';
        rootEl.appendChild(empty);
        return;
      }

      const max = Math.max(...guesses.map((g) => Number(g?.count) || 0), 1);
      const list = document.createElement('div');
      list.className = 'guess-analytics-list';

      guesses.forEach((g) => {
        const count = Number(g?.count) || 0;
        const label = g?.gene ? String(g.gene) : (g?.uniprot ? String(g.uniprot) : 'Unknown');
        const share = total > 0 ? (count / total) : 0;
        const sharePct = Math.round(share * 1000) / 10; // 1 decimal
        const barPct = Math.round((count / max) * 100);

        const row = document.createElement('div');
        row.className = 'guess-analytics-row';
        row.innerHTML =
          '<span class="guess-analytics-count">' + escapeHtml(String(count)) + '</span>' +
          '<span class="guess-analytics-label" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>' +
          '<span class="guess-analytics-share">' + escapeHtml(String(sharePct)) + '%</span>' +
          '<div class="guess-analytics-bar">' +
            '<div class="guess-analytics-bar-fill" style="width: ' + barPct + '%;"></div>' +
          '</div>';
        list.appendChild(row);
      });

      rootEl.appendChild(list);

      const metaEl = document.getElementById('guess-analytics-meta');
      if (metaEl) {
        metaEl.textContent = startDay && endDay
          ? ('Range: ' + startDay + ' to ' + endDay + ' • ' + String(total) + ' guesses total')
          : (String(total) + ' guesses total');
      }
    }

    async function loadGuessAnalytics(range) {
      const loadToken = ++guessAnalyticsLoadToken;
      const rootEl = document.getElementById('guess-analytics-root');
      const metaEl = document.getElementById('guess-analytics-meta');
      if (!rootEl) return;

      const endDay = getUtcDayString();
      const storageKey = buildGuessAnalyticsStorageKey(range, endDay);

      setActiveGuessAnalyticsRange(range);

      try {
        const cachedRaw = localStorage.getItem(storageKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.endDay === endDay) {
            renderGuessAnalytics(rootEl, cached);
            if (metaEl && cached.generatedAt) {
              metaEl.textContent += ' • cached today';
            }
            return;
          }
        }
      } catch (err) {
        // Ignore cache parse errors and fall back to network
      }

      rootEl.innerHTML = '<p class="helper-text">Loading analytics...</p>';
      if (metaEl) {
        metaEl.textContent = 'Loading...';
      }

      try {
        const response = await fetch(API_BASE + '/api/admin/guess-analytics?range=' + encodeURIComponent(range), { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load guess analytics');
        }
        if (loadToken !== guessAnalyticsLoadToken) {
          return;
        }
        try {
          localStorage.setItem(storageKey, JSON.stringify(data));
        } catch (err) {
          // Ignore quota errors; still render
        }
        renderGuessAnalytics(rootEl, data);
      } catch (err) {
        if (loadToken !== guessAnalyticsLoadToken) {
          return;
        }
        console.error('Error loading guess analytics:', err);
        rootEl.innerHTML = '<p class="helper-text error-text">Failed to load guess analytics</p>';
        if (metaEl) {
          metaEl.textContent = err.message || 'Failed to load';
        }
      }
    }

    function initGuessAnalytics() {
      const buttons = document.querySelectorAll('.guess-analytics-range[data-range]');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const range = btn.getAttribute('data-range');
          if (range) {
            loadGuessAnalytics(range);
          }
        });
      });
    }

    function iconoplasmCostSafeNum(value) {
      const num = Number(value || 0);
      return Number.isFinite(num) ? num : 0;
    }

    function iconoplasmCostFormatCompact(value) {
      const num = iconoplasmCostSafeNum(value);
      try {
        if (Math.abs(num) >= 1000) {
          return new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: Math.abs(num) >= 1000000000 ? 1 : 0
          }).format(num);
        }
      } catch {}
      return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function iconoplasmCostLabel(value) {
      return String(value || 'unknown')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function iconoplasmCostAggregate(rows, key) {
      const map = Object.create(null);
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const group = String(row?.[key] || 'unknown');
        if (!map[group]) {
          map[group] = { key: group, rows_read: 0, rows_written: 0, request_count: 0, query_count: 0 };
        }
        map[group].rows_read += iconoplasmCostSafeNum(row?.rows_read);
        map[group].rows_written += iconoplasmCostSafeNum(row?.rows_written);
        map[group].request_count += iconoplasmCostSafeNum(row?.request_count);
        map[group].query_count += iconoplasmCostSafeNum(row?.query_count);
      });
      return Object.values(map).sort((a, b) => iconoplasmCostSafeNum(b.rows_read) - iconoplasmCostSafeNum(a.rows_read));
    }

    function iconoplasmCostFillTone(used, limit) {
      const safeLimit = iconoplasmCostSafeNum(limit);
      if (safeLimit <= 0) return '';
      const ratio = iconoplasmCostSafeNum(used) / safeLimit;
      if (ratio >= 0.85) return ' danger';
      if (ratio >= 0.6) return ' warn';
      return '';
    }

    function renderIconoplasmCostTrend(days, snapshot) {
      const rows = Array.isArray(days) ? days : [];
      const rootEl = document.getElementById('iconoplasm-cost-trend');
      if (!rootEl) return;
      if (!rows.length) {
        rootEl.innerHTML = '<p class="helper-text">No cycle usage recorded yet.</p>';
        return;
      }
      const width = 720;
      const height = 260;
      const padLeft = 46;
      const padRight = 18;
      const padTop = 18;
      const padBottom = 32;
      const usableWidth = width - padLeft - padRight;
      const usableHeight = height - padTop - padBottom;
      const smartLimit = iconoplasmCostSafeNum(snapshot?.rows_read_daily_smart_limit);
      const maxValue = Math.max(
        smartLimit,
        ...rows.map((row) => iconoplasmCostSafeNum(row?.rows_read)),
        1
      );
      const xStep = rows.length <= 1 ? 0 : (usableWidth / (rows.length - 1));
      const xAt = (index) => padLeft + (xStep * index);
      const yAt = (value) => padTop + usableHeight - ((iconoplasmCostSafeNum(value) / maxValue) * usableHeight);
      let area = '';
      let line = '';
      rows.forEach((row, index) => {
        const x = xAt(index);
        const y = yAt(row?.rows_read);
        area += (index === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
        line += (index === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
      });
      area += 'L' + xAt(rows.length - 1) + ' ' + (padTop + usableHeight) + ' ';
      area += 'L' + xAt(0) + ' ' + (padTop + usableHeight) + ' Z';
      const limitY = yAt(smartLimit);
      const dots = rows.map((row, index) => {
        const value = iconoplasmCostSafeNum(row?.rows_read);
        const label = String(row?.day_key || '');
        return '<circle cx="' + xAt(index) + '" cy="' + yAt(value) + '" r="3.5" fill="#38bdf8"><title>' + escapeHtml(label + ': ' + iconoplasmCostFormatCompact(value) + ' rows read') + '</title></circle>';
      }).join('');
      rootEl.innerHTML = [
        '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Iconoplasm rows read by day">',
        '<line x1="' + padLeft + '" y1="' + (padTop + usableHeight) + '" x2="' + (padLeft + usableWidth) + '" y2="' + (padTop + usableHeight) + '" stroke="#334155" stroke-width="1" />',
        '<line x1="' + padLeft + '" y1="' + limitY + '" x2="' + (padLeft + usableWidth) + '" y2="' + limitY + '" stroke="#f59e0b" stroke-width="2" stroke-dasharray="6 6" />',
        '<path d="' + area + '" fill="rgba(56,189,248,0.14)"></path>',
        '<path d="' + line + '" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
        dots,
        '<text x="' + padLeft + '" y="' + (height - 8) + '" font-size="11" fill="#94a3b8">' + escapeHtml(String(rows[0]?.day_key || '')) + '</text>',
        '<text x="' + (padLeft + usableWidth) + '" y="' + (height - 8) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + escapeHtml(String(rows[rows.length - 1]?.day_key || '')) + '</text>',
        '<text x="' + (padLeft + 6) + '" y="' + Math.max(14, limitY - 8) + '" font-size="11" fill="#fbbf24">Smart daily allowance ' + escapeHtml(iconoplasmCostFormatCompact(smartLimit)) + '</text>',
        '</svg>'
      ].join('');
    }

    function renderIconoplasmCostBars(rootId, rows, accent) {
      const rootEl = document.getElementById(rootId);
      if (!rootEl) return;
      const list = Array.isArray(rows) ? rows.slice(0, 8) : [];
      if (!list.length) {
        rootEl.innerHTML = '<p class="helper-text">No attributed usage recorded yet.</p>';
        return;
      }
      const maxRead = Math.max(...list.map((row) => iconoplasmCostSafeNum(row.rows_read)), 1);
      rootEl.innerHTML = list.map((row) => {
        const width = Math.max(6, Math.round((iconoplasmCostSafeNum(row.rows_read) / maxRead) * 100));
        return '' +
          '<div class="iconoplasm-cost-bar-row">' +
            '<div class="iconoplasm-cost-bar-head">' +
              '<span class="iconoplasm-cost-badge">' + escapeHtml(iconoplasmCostLabel(row.key)) + '</span>' +
              '<span>' + escapeHtml(iconoplasmCostFormatCompact(row.rows_read)) + ' reads · ' + escapeHtml(iconoplasmCostFormatCompact(row.request_count)) + ' req</span>' +
            '</div>' +
            '<div class="iconoplasm-cost-bar-track">' +
              '<div class="iconoplasm-cost-bar-fill" style="width:' + width + '%; background:' + escapeHtml(accent) + ';"></div>' +
            '</div>' +
          '</div>';
      }).join('');
    }

    function renderIconoplasmCostBudget(snapshot) {
      const rootEl = document.getElementById('iconoplasm-cost-budget');
      if (!rootEl) return;
      const rows = [
        {
          label: 'Rows read this cycle',
          used: iconoplasmCostSafeNum(snapshot?.cycle_rows_read),
          limit: iconoplasmCostSafeNum(snapshot?.rows_read_monthly_limit),
          remaining: iconoplasmCostSafeNum(snapshot?.rows_read_monthly_remaining)
        },
        {
          label: 'Rows written this cycle',
          used: iconoplasmCostSafeNum(snapshot?.cycle_rows_written),
          limit: iconoplasmCostSafeNum(snapshot?.rows_written_monthly_limit),
          remaining: iconoplasmCostSafeNum(snapshot?.rows_written_monthly_remaining)
        }
      ];
      rootEl.innerHTML = rows.map((row) => {
        const pct = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 1000) / 10) : 0;
        return '' +
          '<div class="iconoplasm-cost-budget-row">' +
            '<div class="iconoplasm-cost-budget-meta">' +
              '<strong>' + escapeHtml(row.label) + '</strong>' +
              '<span>' + escapeHtml(iconoplasmCostFormatCompact(row.used)) + ' / ' + escapeHtml(iconoplasmCostFormatCompact(row.limit)) + ' · ' + escapeHtml(iconoplasmCostFormatCompact(row.remaining)) + ' left</span>' +
            '</div>' +
            '<div class="iconoplasm-cost-budget-track">' +
              '<div class="iconoplasm-cost-budget-fill' + iconoplasmCostFillTone(row.used, row.limit) + '" style="width:' + pct + '%;"></div>' +
            '</div>' +
          '</div>';
      }).join('');
    }

    function renderIconoplasmCostRoutes(rows) {
      const rootEl = document.getElementById('iconoplasm-cost-routes');
      if (!rootEl) return;
      const list = Array.isArray(rows) ? rows.slice(0, 10) : [];
      if (!list.length) {
        rootEl.innerHTML = '<p class="helper-text">No route data yet.</p>';
        return;
      }
      rootEl.innerHTML = '' +
        '<table class="iconoplasm-cost-table">' +
          '<thead><tr><th>Route family</th><th class="num">Rows read</th><th class="num">Requests</th></tr></thead>' +
          '<tbody>' +
            list.map((row) => {
              return '' +
                '<tr>' +
                  '<td><strong>' + escapeHtml(iconoplasmCostLabel(row.key)) + '</strong><div class="schedule-meta">' + escapeHtml(iconoplasmCostFormatCompact(row.rows_written)) + ' writes</div></td>' +
                  '<td class="num">' + escapeHtml(iconoplasmCostFormatCompact(row.rows_read)) + '</td>' +
                  '<td class="num">' + escapeHtml(iconoplasmCostFormatCompact(row.request_count)) + '</td>' +
                '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>';
    }

    function renderIconoplasmCostMetrics(snapshot) {
      const rootEl = document.getElementById('iconoplasm-cost-metrics');
      if (!rootEl) return;
      const monthlyReadLimit = iconoplasmCostSafeNum(snapshot?.rows_read_monthly_limit);
      const monthlyReadRemaining = iconoplasmCostSafeNum(snapshot?.rows_read_monthly_remaining);
      const monthlyShareLeft = monthlyReadLimit > 0 ? (monthlyReadRemaining / monthlyReadLimit) : 0;
      const cards = [
        {
          label: 'Monthly read headroom',
          value: iconoplasmCostFormatCompact(monthlyReadRemaining),
          note: Math.round(monthlyShareLeft * 1000) / 10 + '% of the cycle budget still open.'
        },
        {
          label: 'Today so far',
          value: iconoplasmCostFormatCompact(snapshot?.rows_read),
          note: iconoplasmCostFormatCompact(snapshot?.request_count) + ' metered requests today.'
        },
        {
          label: 'Today smart allowance',
          value: iconoplasmCostFormatCompact(snapshot?.rows_read_daily_smart_limit),
          note: iconoplasmCostFormatCompact(snapshot?.rows_read_daily_remaining) + ' rows left before today closes.'
        },
        {
          label: 'Cycle requests',
          value: iconoplasmCostFormatCompact(snapshot?.cycle_request_count),
          note: iconoplasmCostFormatCompact(snapshot?.cycle_rows_written) + ' rows written this cycle.'
        }
      ];
      rootEl.innerHTML = cards.map((card) => {
        return '' +
          '<article class="iconoplasm-cost-metric">' +
            '<div class="iconoplasm-cost-metric-label">' + escapeHtml(card.label) + '</div>' +
            '<div class="iconoplasm-cost-metric-value">' + escapeHtml(card.value) + '</div>' +
            '<div class="iconoplasm-cost-metric-note">' + escapeHtml(card.note) + '</div>' +
          '</article>';
      }).join('');
    }

    function renderIconoplasmCostUsage(report) {
      const snapshot = report?.snapshot || {};
      const cycleDays = Array.isArray(report?.cycle_days) ? report.cycle_days : [];
      const cycleAttribution = Array.isArray(report?.cycle_attribution) ? report.cycle_attribution : [];
      renderIconoplasmCostMetrics(snapshot);
      renderIconoplasmCostTrend(cycleDays, snapshot);
      renderIconoplasmCostBudget(snapshot);
      renderIconoplasmCostBars('iconoplasm-cost-sources', iconoplasmCostAggregate(cycleAttribution, 'source_class'), 'linear-gradient(90deg, #38bdf8, #1d4ed8)');
      renderIconoplasmCostRoutes(iconoplasmCostAggregate(cycleAttribution, 'route_family'));
      const metaEl = document.getElementById('iconoplasm-cost-trend-meta');
      if (metaEl) {
        metaEl.textContent =
          'Cycle ' + String(snapshot?.cycle_key || 'unknown') +
          ' · ' + String(snapshot?.days_remaining_in_cycle || 0) +
          ' day(s) left · daily room expands when the month is under-spent and tightens when the month gets hot.';
      }
      const updatedEl = document.getElementById('iconoplasm-cost-updated');
      if (updatedEl) {
        updatedEl.textContent = snapshot?.updated_at
          ? ('Meter updated at ' + String(snapshot.updated_at))
          : 'Loaded current meter state.';
      }
    }

    function renderIconoplasmCostObservabilityNotice(payload) {
      const observability = payload?.observability || {};
      const dashboardSurfaces = Array.isArray(observability.dashboard_surfaces) ? observability.dashboard_surfaces : [];
      const graphqlDatasets = Array.isArray(observability.graphql_datasets) ? observability.graphql_datasets : [];
      const metricsEl = document.getElementById('iconoplasm-cost-metrics');
      if (metricsEl) {
        const cards = [
          {
            label: 'Source of truth',
            value: 'Cloudflare',
            note: payload?.message || 'The internal request-path usage report was intentionally retired.'
          },
          {
            label: 'Dashboards',
            value: String(dashboardSurfaces.length || 2),
            note: dashboardSurfaces.length
              ? dashboardSurfaces.join(' · ')
              : 'Use Cloudflare Durable Objects metrics and D1 metrics.'
          },
          {
            label: 'GraphQL datasets',
            value: String(graphqlDatasets.length || 4),
            note: graphqlDatasets.length
              ? graphqlDatasets.join(' · ')
              : 'Use the GraphQL analytics API for the live metrics datasets.'
          },
          {
            label: 'Admin state',
            value: 'Retired',
            note: 'This widget now points to Cloudflare-native observability instead of pretending to be the meter.'
          }
        ];
        metricsEl.innerHTML = cards.map((card) => {
          return '' +
            '<article class="iconoplasm-cost-metric">' +
              '<div class="iconoplasm-cost-metric-label">' + escapeHtml(card.label) + '</div>' +
              '<div class="iconoplasm-cost-metric-value">' + escapeHtml(card.value) + '</div>' +
              '<div class="iconoplasm-cost-metric-note">' + escapeHtml(card.note) + '</div>' +
            '</article>';
        }).join('');
      }

      const trendEl = document.getElementById('iconoplasm-cost-trend');
      if (trendEl) {
        trendEl.innerHTML = '' +
          '<div class="helper-text">' +
            '<strong>Live meter retired by design.</strong><br />' +
            'Use Cloudflare dashboard Durable Objects metrics, Cloudflare dashboard D1 metrics, or the GraphQL analytics API for live usage visibility.' +
          '</div>';
      }

      const budgetEl = document.getElementById('iconoplasm-cost-budget');
      if (budgetEl) {
        budgetEl.innerHTML = '<p class="helper-text">No local budget mirror lives here anymore. Cloudflare dashboards are the source of truth.</p>';
      }

      const sourcesEl = document.getElementById('iconoplasm-cost-sources');
      if (sourcesEl) {
        sourcesEl.innerHTML = '<p class="helper-text">The old request-path source split was intentionally removed with the internal usage report.</p>';
      }

      const routesEl = document.getElementById('iconoplasm-cost-routes');
      if (routesEl) {
        routesEl.innerHTML = '<p class="helper-text">Use Cloudflare-native observability when you need route-level investigation.</p>';
      }

      const metaEl = document.getElementById('iconoplasm-cost-trend-meta');
      if (metaEl) {
        metaEl.textContent = 'Live request-path D1 cost reporting was retired on purpose. Cloudflare Durable Objects and D1 analytics are now authoritative.';
      }

      const updatedEl = document.getElementById('iconoplasm-cost-updated');
      if (updatedEl) {
        updatedEl.textContent = 'Internal request-path meter retired. Cloudflare dashboards and GraphQL are the source of truth.';
      }
    }

    async function loadIconoplasmCostUsage() {
      const loadToken = ++iconoplasmCostLoadToken;
      const updatedEl = document.getElementById('iconoplasm-cost-updated');
      if (updatedEl) {
        updatedEl.textContent = 'Loading current Iconoplasm meter...';
      }
      try {
        const response = await fetch('/api/iconoplasm/admin/cost/usage', { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 410 && data?.code === 'ICONOPLASM_CLOUDFLARE_OBSERVABILITY_REQUIRED') {
            if (loadToken !== iconoplasmCostLoadToken) {
              return;
            }
            renderIconoplasmCostObservabilityNotice(data);
            return;
          }
          throw new Error(data?.error || 'Failed to load Iconoplasm cost usage');
        }
        if (loadToken !== iconoplasmCostLoadToken) {
          return;
        }
        renderIconoplasmCostUsage(data);
      } catch (err) {
        console.error('Error loading Iconoplasm cost usage:', err);
        const metricsEl = document.getElementById('iconoplasm-cost-metrics');
        if (metricsEl) {
          metricsEl.innerHTML = '<p class="helper-text error-text">Failed to load Iconoplasm cost usage</p>';
        }
        const trendEl = document.getElementById('iconoplasm-cost-trend');
        if (trendEl) {
          trendEl.innerHTML = '<p class="helper-text error-text">Trend unavailable</p>';
        }
        const updatedEl2 = document.getElementById('iconoplasm-cost-updated');
        if (updatedEl2) {
          updatedEl2.textContent = err.message || 'Failed to load Iconoplasm cost usage';
        }
      }
    }

    function initIconoplasmCostUsage() {
      const refreshBtn = document.getElementById('iconoplasm-cost-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          loadIconoplasmCostUsage();
        });
      }
      loadIconoplasmCostUsage();
    }

    function renderCardsPreview(rootEl, data) {
      const date = data?.date || '';
      const protein = data?.protein || {};
      const selection = data?.selection || {};
      const startSections = Array.isArray(data?.clue?.start) ? data.clue.start : [];
      const allSections = Array.isArray(data?.clue?.all) ? data.clue.all : [];
      const rejected = Array.isArray(selection?.rejected) ? selection.rejected : [];

      // Ensure card preview styles apply within the inspector container.
      rootEl.classList.add('cards-preview');

      const title = protein?.hgnc || protein?.gene || 'Unknown';

      rootEl.innerHTML = '';

      const header = document.createElement('div');
      header.innerHTML =
        '<h3 style="margin-bottom: 0.25rem;">Cards for ' + escapeHtml(date) + '</h3>' +
        '<div class="schedule-meta">' +
          '<span class="value-pill">' + escapeHtml(selection.source || '') + '</span> ' +
          escapeHtml(title) +
          (protein?.full_name ? ' &mdash; ' + escapeHtml(protein.full_name) : '') +
        '</div>';
      rootEl.appendChild(header);

      if (rejected.length) {
        const rej = document.createElement('div');
        rej.className = 'section-block';
        const lines = rejected.slice(0, 10).map((r) => {
          const gene = r?.gene || r?.hgnc || r?.symbol || r?.uniprot_id || 'Unknown';
          const reason = r?.reason || '';
          return '<div class="clue-item"><span class="pill">rejected</span>' + escapeHtml(gene) + ' <span class="schedule-meta">(' + escapeHtml(reason) + ')</span></div>';
        }).join('');
        rej.innerHTML = '<div class="clue-section-title">Rejections (first 10)</div>' + lines;
        rootEl.appendChild(rej);
      }

      // Only show unmasked clues - redaction bars aren't useful for admins
      rootEl.appendChild(renderSectionBlock('All clues', allSections, false));
    }

    function openOverrideForDate(date) {
      selectDate(date);
      // Scroll to calendar/form
      const anchor = document.getElementById('override-section');
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth' });
      }
    }

    function renderSectionBlock(title, sections, masked) {
      const block = document.createElement('div');
      block.className = 'section-block';
      const h = document.createElement('div');
      h.className = 'clue-section-title';
      h.textContent = title;
      block.appendChild(h);

      sections.forEach((section) => {
        const secTitle = document.createElement('div');
        secTitle.className = 'clue-section-title';
        secTitle.style.marginTop = '0.5rem';
        secTitle.textContent = section?.title || section?.label || section?.id || 'Section';
        block.appendChild(secTitle);

        (section?.items || []).forEach((item) => {
          const div = document.createElement('div');
          div.className = 'clue-item';
          const isHidden = masked && item?.id && item?.revealed === false;

          if (isHidden) {
            const pill = document.createElement('span');
            pill.className = 'pill';
            pill.textContent = 'locked';
            div.appendChild(pill);
            div.appendChild(document.createTextNode(' '));

            if (Array.isArray(item?.wordLengths) && item.wordLengths.length) {
              div.appendChild(renderRedactionLine(item.wordLengths));
            } else {
              div.appendChild(document.createTextNode(item?.placeholder || 'Hint locked'));
            }
          } else {
            const label = item?.label ? (item.label + ': ') : '';
            const text = (typeof item?.text === 'string' ? item.text : (typeof item?.fullText === 'string' ? item.fullText : String(item?.text ?? '')));
            div.textContent = label + text;
          }
          block.appendChild(div);
        });
      });
      return block;
    }

    function renderRedactionLine(wordLengths) {
      const line = document.createElement('span');
      line.className = 'redaction-line';

      // Render each word as a bar whose width scales with word length.
      wordLengths.forEach((len, idx) => {
        const w = document.createElement('span');
        w.className = 'redaction-word';
        const clamped = Math.max(1, Math.min(Number(len) || 1, 30));
        // Use "ch" so widths track font metrics.
        w.style.width = (clamped * 0.6) + 'ch';
        line.appendChild(w);
        if (idx !== wordLengths.length - 1) {
          const s = document.createElement('span');
          s.className = 'redaction-space';
          line.appendChild(s);
        }
      });

      return line;
    }

    function makeButton(text, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.addEventListener('click', onClick);
      return btn;
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function loadStatus() {
      try {
        const response = await fetch(API_BASE + '/api/admin/status', { credentials: 'include' });
        if (!response.ok) {
          throw new Error('Failed to load status');
        }
        const data = await response.json();
        // Keep status loading robust even if some optional panels are removed.
        displayStatus(data);
        displayOverrides(data.all_overrides);
        updateFlagCheckboxes(data.feature_flags || {});
        syncGraphicsSettings(data.graphics_settings);
      } catch (err) {
        console.error('Error loading status:', err);
        const statusEl = document.getElementById('status-display');
        if (statusEl) {
          statusEl.innerHTML = '<p class="helper-text error-text">Failed to load status</p>';
        }
      }
    }

    function bindForms() {
      const overrideForm = document.getElementById('override-form');
      if (overrideForm) {
        overrideForm.addEventListener('submit', handleOverrideSubmit);
      }

      const deleteBtn = document.getElementById('btn-delete-override');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          const date = document.getElementById('override-date')?.value;
          if (date) await deleteOverride(date);
        });
      }

      const flagsForm = document.getElementById('flags-form');
      if (flagsForm) {
        flagsForm.addEventListener('submit', handleFlagsSubmit);
      }

      const graphicsForm = document.getElementById('graphics-form');
      if (graphicsForm) {
        graphicsForm.addEventListener('submit', handleGraphicsSubmit);
      }

      const graphicsPushLive = document.getElementById('graphics-push-live');
      if (graphicsPushLive) {
        graphicsPushLive.addEventListener('click', pushGraphicsSettingsLive);
      }

      const graphicsReset = document.getElementById('graphics-reset');
      if (graphicsReset) {
        graphicsReset.addEventListener('click', () => {
        pendingGraphicsSettings = deepClone(DEFAULT_GRAPHICS_SETTINGS);
        syncProfileState(pendingGraphicsSettings.profileManager);
        applyGraphicsSettingsToForm(pendingGraphicsSettings);
        refreshPreview({ immediate: true });
        });
      }

      const graphicsRevert = document.getElementById('graphics-revert');
      if (graphicsRevert) {
        graphicsRevert.addEventListener('click', () => {
        pendingGraphicsSettings = deepClone(currentGraphicsSettings);
        syncProfileState(pendingGraphicsSettings.profileManager);
        applyGraphicsSettingsToForm(pendingGraphicsSettings);
        refreshPreview({ immediate: true });
        });
      }

      const uploadDayButton = document.getElementById('btn-upload-day-image');
      if (uploadDayButton) {
        uploadDayButton.addEventListener('click', uploadSelectedDayImage);
      }

      const repairPostedRecapButton = document.getElementById('btn-repair-posted-recap');
      if (repairPostedRecapButton) {
        repairPostedRecapButton.addEventListener('click', repairPostedRecap);
      }

      const uploadMonthButton = document.getElementById('btn-upload-month-images');
      if (uploadMonthButton) {
        uploadMonthButton.addEventListener('click', uploadDisplayedMonthImages);
      }

      const uploadYearButton = document.getElementById('btn-upload-year-images');
      if (uploadYearButton) {
        uploadYearButton.addEventListener('click', uploadNextYearImages);
      }

      const profileSelect = document.getElementById('profile-select');
      if (profileSelect) {
        profileSelect.addEventListener('change', (event) => {
        profileState.selectedId = event.target.value;
        hydrateProfileControls();
        });
      }

      const profileLoad = document.getElementById('profile-load');
      if (profileLoad) profileLoad.addEventListener('click', loadSelectedProfile);
      const profileSave = document.getElementById('profile-save');
      if (profileSave) profileSave.addEventListener('click', saveProfileFromCurrent);
      const profileDelete = document.getElementById('profile-delete');
      if (profileDelete) profileDelete.addEventListener('click', deleteSelectedProfile);
      const profileReset = document.getElementById('profile-reset');
      if (profileReset) profileReset.addEventListener('click', resetBuiltInProfiles);

      const occlusionQuality = document.getElementById('occlusion-quality');
      if (occlusionQuality) {
        occlusionQuality.addEventListener('change', (event) => {
        applyOcclusionPresetToFields(event.target.value);
        });
      }
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
        cameraFovValueEl.textContent = Number(cameraFov.value || 0).toFixed(0) + '°';
      }
      const exposureValueEl = document.getElementById('lighting-exposure-value');
      if (exposure && exposureValueEl) {
        exposureValueEl.textContent = Number(exposure.value || 0).toFixed(2);
      }
      LIGHT_IDS.forEach((id) => {
        const el = document.getElementById('light-' + id + '-intensity');
        const pill = document.getElementById('light-' + id + '-intensity-value');
        if (el && pill) {
          pill.textContent = Number(el.value || 0).toFixed(2);
        }
      });
    }

    async function resolveUniprotIdFromInput(raw) {
      const value = String(raw || '').trim();
      if (!value) return null;

      const upper = value.toUpperCase();

      // Suggestions write the UniProt accession into the input.
      // The /api/proteins endpoint may not search by accession, so accept
      // anything that looks like a UniProt accession directly and let the
      // server validate existence/authorization.
      const UNIPROT_ACCESSION_RE = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;
      if (UNIPROT_ACCESSION_RE.test(upper)) {
        return upper;
      }

      try {
        const response = await fetch(API_BASE + '/api/proteins?query=' + encodeURIComponent(value) + '&limit=6');
        if (!response.ok) {
          return null;
        }
        const matches = await response.json();
        const list = Array.isArray(matches) ? matches : [];
        const exactUniprot = list.find((p) => String(p?.uniprot || '').toUpperCase() === upper);
        if (exactUniprot?.uniprot) {
          return exactUniprot.uniprot;
        }

        const exactGeneMatches = list.filter((p) => {
          const gene = String(p?.hgnc || p?.gene || '').toUpperCase();
          return gene === upper;
        });
        if (exactGeneMatches.length === 1 && exactGeneMatches[0]?.uniprot) {
          return exactGeneMatches[0].uniprot;
        }

        // If the query is unambiguous, pick the single match.
        if (list.length === 1 && list[0]?.uniprot) {
          return list[0].uniprot;
        }
      } catch {
        return null;
      }

      return null;
    }

    async function handleOverrideSubmit(event) {
      event.preventDefault();
      const date = document.getElementById('override-date').value;
      const rawInput = document.getElementById('override-uniprot').value;
      try {
        const typed = String(rawInput || '').trim().toUpperCase();
        const resolvedUniprotId = (overrideSelectedSuggestionUniprot && (!overrideSelectedSuggestionGene || typed === overrideSelectedSuggestionGene))
          ? overrideSelectedSuggestionUniprot
          : await resolveUniprotIdFromInput(rawInput);
        if (!resolvedUniprotId) {
          throw new Error('Pick a protein from suggestions (or type a more specific gene/uniprot).');
        }
        const response = await fetch(API_BASE + '/api/admin/override-protein', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, uniprot_id: resolvedUniprotId })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to set override');
        }
        const optimisticSymbol = overrideSelectedSuggestionGene || typed || resolvedUniprotId;
        applyLocalOverride(date, resolvedUniprotId, optimisticSymbol);
        selectDate(date);
        showMessage('override-message', (data.message || 'Override updated') + ' (syncing details in background)', 'success');
        document.getElementById('override-uniprot').value = '';
        overrideSelectedSuggestionUniprot = null;
        overrideSelectedSuggestionGene = null;
        markRecapImageUnknown(date);
        // Refresh expensive schedule/status queries in background so override is instant in UI.
        queueBackgroundScheduleRefresh({ date });
        // Keep recap image in sync with override automatically.
        uploadOverrideDayImage(date).catch((err) => {
          console.error('Background recap image upload failed after override update:', err);
        });
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
      refreshPreview({ immediate: true });
      showMessage('graphics-message', 'Preview updated for this admin session. Click "Push to Live Site" to publish.', 'success');
    }

    async function pushGraphicsSettingsLive() {
      const payload = deepClone(pendingGraphicsSettings || collectGraphicsSettingsFromForm());
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
        pendingGraphicsSettings = deepClone(payload);
        GRAPHICS_SETTINGS = deepClone(payload);
        showMessage('graphics-message', data.message || 'Graphics settings pushed live', 'success');
      } catch (err) {
        console.error('Error pushing graphics settings live:', err);
        showMessage('graphics-message', err.message || 'Failed to push graphics settings live', 'error');
      }
    }
    function displayStatus(data) {
      const override = data.today.override ? 'Override set' : 'No override';
      const overrideCount = data.all_overrides.length;
      const statusText = data.today.date + ' | ' + override + ' | ' + overrideCount + ' active override' + (overrideCount === 1 ? '' : 's');
      document.getElementById('status-display').textContent = statusText;
    }

    function displayOverrides(overrides) {
      const listEl = document.getElementById('override-list');
      if (!listEl) {
        return;
      }
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
          // Look up gene symbol from scheduleData, fall back to showing gene if available
          const scheduled = scheduleData[override.date];
          const geneLabel = scheduled?.symbol || override.gene || override.hgnc || 'Unknown';
          proteinEl.textContent = geneLabel;
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
      const loadedName = profile.name || profile.id;
      showMessage('graphics-message', 'Loaded profile \"' + loadedName + '\"', 'success');
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
        id = id + '-custom';
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
      showMessage('graphics-message', 'Saved profile \"' + name + '\"', 'success');
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
      LIGHT_IDS.forEach((id, index) => {
        const lightList = safe.lighting && safe.lighting.lights;
        const lightInput = (Array.isArray(lightList) && (lightList.find((light) => light.id === id) || lightList[index])) || LIGHTING_PRESETS.studio.lights[index];
        document.getElementById('light-' + id + '-color').value = lightInput && lightInput.color ? lightInput.color : '#ffffff';
        document.getElementById('light-' + id + '-intensity').value = lightInput && lightInput.intensity !== undefined ? lightInput.intensity : 1;
        document.getElementById('light-' + id + '-inclination').value = lightInput && lightInput.inclination !== undefined ? lightInput.inclination : 160;
        document.getElementById('light-' + id + '-azimuth').value = lightInput && lightInput.azimuth !== undefined ? lightInput.azimuth : (index * 120);
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
            color: document.getElementById('light-' + id + '-color').value || '#ffffff',
            intensity: readNumber('light-' + id + '-intensity', 1),
            inclination: readNumber('light-' + id + '-inclination', 160),
            azimuth: readNumber('light-' + id + '-azimuth', 30)
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

    function clearPreviewMount() {
      if (previewMountEl) {
        previewMountEl.innerHTML = '';
      } else if (previewContainer) {
        const pluginNodes = previewContainer.querySelectorAll('.msp-plugin');
        pluginNodes.forEach((node) => node.remove());
      }
    }

    async function disposePreviewViewer(viewer) {
      if (!viewer) {
        return;
      }
      try {
        if (viewer.plugin && typeof viewer.plugin.clear === 'function') {
          await viewer.plugin.clear();
        }
      } catch (err) {
        console.warn('Admin preview: unable to clear viewer', err);
      }
      try {
        if (viewer.plugin && typeof viewer.plugin.dispose === 'function') {
          viewer.plugin.dispose();
        } else if (typeof viewer.destroy === 'function') {
          viewer.destroy();
        }
      } catch (err) {
        console.warn('Admin preview: unable to dispose viewer', err);
      }
    }

    async function destroyPreviewViewer() {
      previewReady = false;
      if (previewViewer) {
        await disposePreviewViewer(previewViewer);
        previewViewer = null;
      }
      clearPreviewMount();
    }

    // Check if a protein (by UniProt ID) was previously scheduled and return the date(s)
    function findPreviousScheduleDates(uniprotId) {
      if (!uniprotId || !scheduleData) return [];
      const targetId = String(uniprotId).toUpperCase();
      const dates = [];
      for (const [date, data] of Object.entries(scheduleData)) {
        if (data && String(data.uniprot || '').toUpperCase() === targetId) {
          // Exclude future dates (only care about history and past scheduled days)
          const dateObj = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (dateObj < today) {
            dates.push(date);
          }
        }
      }
      // Sort by date descending (most recent first)
      dates.sort((a, b) => b.localeCompare(a));
      return dates;
    }

    // Show or hide the duplicate warning callout
    function updateDuplicateWarning(uniprotId, geneName) {
      const callout = document.getElementById('duplicate-warning-callout');
      const datesEl = document.getElementById('duplicate-warning-dates');
      if (!callout || !datesEl) return;

      const prevDates = findPreviousScheduleDates(uniprotId);
      if (prevDates.length > 0) {
        // Format dates nicely
        const formatted = prevDates.slice(0, 3).map(d => {
          return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        });
        let text = formatted.join(', ');
        if (prevDates.length > 3) {
          text += ' (+' + (prevDates.length - 3) + ' more)';
        }
        datesEl.textContent = text;
        callout.classList.add('show');
      } else {
        callout.classList.remove('show');
      }
    }

    function setupProteinSelector() {
      // Autocomplete for the override input in the inspector.
      const inputEl = document.getElementById('override-uniprot');
      const suggestionsEl = document.getElementById('protein-suggestions');
      const duplicateCallout = document.getElementById('duplicate-warning-callout');
      if (!inputEl || !suggestionsEl) return;

      let pendingTimer = null;
      let activeSearchController = null;
      let activeSearchToken = 0;
      let lastMatches = [];

      let selectedIndex = -1;

      inputEl.addEventListener('input', (e) => {
        const raw = e.target.value || '';
        const query = raw.trim();

        overrideSelectedSuggestionUniprot = null;
        overrideSelectedSuggestionGene = null;
        // Hide duplicate warning when typing
        if (duplicateCallout) duplicateCallout.classList.remove('show');

        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }

        if (query.length < 1) {
          lastMatches = [];
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('show');
          return;
        }

        // Debounce so we don't fire a request per keystroke.
        pendingTimer = setTimeout(async () => {
          const token = ++activeSearchToken;
          if (activeSearchController) {
            try { activeSearchController.abort(); } catch {}
          }
          activeSearchController = new AbortController();

          try {
            const url = API_BASE + '/api/proteins?query=' + encodeURIComponent(query) + '&limit=12';
            const response = await fetch(url, { signal: activeSearchController.signal });
            if (!response.ok) {
              throw new Error('Search failed');
            }
            const matches = await response.json();
            if (token !== activeSearchToken) return;

            lastMatches = Array.isArray(matches) ? matches : [];

            if (lastMatches.length === 0) {
              suggestionsEl.innerHTML = '<div class="protein-suggestion"><div class="protein-suggestion-title">No matches found</div></div>';
              suggestionsEl.classList.add('show');
              selectedIndex = -1;
              return;
            }

            suggestionsEl.innerHTML = lastMatches.map((p, idx) => {
              const title = escapeHtml(p.full_name || '');
              const gene = escapeHtml(p.hgnc || p.gene || '');
              const fullName = escapeHtml(p.full_name || p.hgnc || p.gene || '');
              // Check if this protein was previously scheduled
              const prevDates = findPreviousScheduleDates(p.uniprot);
              const hasPrev = prevDates.length > 0;
              const prevDateStr = hasPrev ? new Date(prevDates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
              const prevExtra = prevDates.length > 1 ? ' (+' + (prevDates.length - 1) + ' more)' : '';
              return ''
                + '<div class="protein-suggestion' + (hasPrev ? ' previously-scheduled' : '') + '" data-uniprot="' + p.uniprot + '" data-index="' + idx + '" title="' + title + '">' 
                + '<div class="protein-suggestion-title">' + gene + '</div>'
                + '<div class="protein-suggestion-sub">' + fullName + '</div>'
                + (hasPrev ? '<div class="protein-suggestion-prev-date">Scheduled: ' + prevDateStr + prevExtra + '</div>' : '')
                + '</div>';
            }).join('');
            suggestionsEl.classList.add('show');
            selectedIndex = -1;

            suggestionsEl.querySelectorAll('.protein-suggestion').forEach((el) => {
              el.addEventListener('click', () => {
                const uniprot = el.dataset.uniprot;
                if (uniprot) {
                  const idx = Number(el.dataset.index);
                  const match = Number.isFinite(idx) ? lastMatches[idx] : null;
                  const gene = String(match?.hgnc || match?.gene || '').trim();
                  overrideSelectedSuggestionUniprot = uniprot;
                  overrideSelectedSuggestionGene = gene ? gene.toUpperCase() : null;
                  inputEl.value = gene || uniprot;
                  suggestionsEl.classList.remove('show');
                  loadProteinInPreview(uniprot);
                  // Show duplicate warning if previously scheduled
                  updateDuplicateWarning(uniprot, gene);
                }
              });
            });
          } catch (err) {
            if (token !== activeSearchToken) return;
            if (err && (err.name === 'AbortError' || String(err).includes('AbortError'))) return;
            suggestionsEl.innerHTML = '<div class="protein-suggestion"><div class="protein-suggestion-title">Search error</div></div>';
            suggestionsEl.classList.add('show');
          }
        }, 120);
      });

      inputEl.addEventListener('keydown', (e) => {
        const suggestions = suggestionsEl.querySelectorAll('.protein-suggestion');

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
          updateSelectedSuggestion(suggestions);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIndex = Math.max(selectedIndex - 1, -1);
          updateSelectedSuggestion(suggestions);
        } else if (e.key === 'Enter') {
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            e.preventDefault();
            const uniprot = suggestions[selectedIndex].dataset.uniprot;
            if (uniprot) {
              const idx = Number(suggestions[selectedIndex].dataset.index);
              const match = Number.isFinite(idx) ? lastMatches[idx] : null;
              const gene = String(match?.hgnc || match?.gene || '').trim();
              overrideSelectedSuggestionUniprot = uniprot;
              overrideSelectedSuggestionGene = gene ? gene.toUpperCase() : null;
              inputEl.value = gene || uniprot;
              suggestionsEl.classList.remove('show');
              loadProteinInPreview(uniprot);
              // Show duplicate warning if previously scheduled
              updateDuplicateWarning(uniprot, gene);
            }
          }
        } else if (e.key === 'Escape') {
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('show');
          selectedIndex = -1;
        }
      });

      function updateSelectedSuggestion(suggestions) {
        suggestions.forEach((el, idx) => {
          el.classList.toggle('selected', idx === selectedIndex);
        });
      }

      document.addEventListener('click', (e) => {
        if (!inputEl.contains(e.target) && !suggestionsEl.contains(e.target)) {
          suggestionsEl.classList.remove('show');
        }
      });
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }






    async function loadProteinInPreview(uniprot) {
      const loadToken = ++previewLoadToken;
      const pendingLabel = uniprot;
      previewStatusEl.textContent = 'Loading ' + pendingLabel + '...';
      previewLoadingEl.hidden = false;
      previewErrorEl.hidden = true;
      previewPlaceholderEl.hidden = true;

      // Always destroy the old viewer up front, before the API call.
      // This prevents WebGL context leaks when the API returns an error
      // (previously the old viewer survived because destroyPreviewViewer
      // was only called after a successful API response).
      await destroyPreviewViewer();

      // Track the viewer created during THIS call so we can dispose it
      // in the catch block if anything goes wrong after creation.
      let localViewer = null;

      try {
        // Fetch structure token, retry once on transient server errors
        let response, data;
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await fetch(API_BASE + '/api/structure-token?uniprot=' + encodeURIComponent(uniprot), {
            credentials: 'include'
          });
          data = await response.json();
          if (response.ok || response.status < 500) break;
          // Server error — wait briefly and retry once
          if (attempt === 0) {
            console.warn('Admin preview: structure-token returned ' + response.status + ' for ' + uniprot + ', retrying...');
            await new Promise(r => setTimeout(r, 1500));
            if (loadToken !== previewLoadToken) return { ok: false, reason: 'superseded' }; // bail if superseded
          }
        }

        // Handle "structure unavailable" (404) gracefully — not an error
        if (response.status === 404 || (!response.ok && data && data.error === 'Structure unavailable')) {
          if (loadToken !== previewLoadToken) return { ok: false, reason: 'superseded' };
          previewStructureChoice = null;
          previewReady = false;
          previewLoadingEl.hidden = true;
          previewErrorEl.hidden = true;
          previewPlaceholderEl.hidden = false;
          previewPlaceholderEl.textContent = 'No 3D structure available for ' + pendingLabel + '.';
          previewStatusEl.textContent = 'No structure';
          return { ok: false, reason: 'no_structure' };
        }

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load structure data');
        }

        // If a newer preview load started while this request was in flight, bail out
        // before we touch the existing viewer/UI.
        if (loadToken !== previewLoadToken) {
          return { ok: false, reason: 'superseded' };
        }

        // Check if structure is available
        if (!data.url) {
          previewStructureChoice = null;
          previewReady = false;
          previewLoadingEl.hidden = true;
          previewErrorEl.hidden = true;
          previewPlaceholderEl.hidden = false;
          previewPlaceholderEl.textContent = 'No 3D structure available for preview.';
          previewStatusEl.textContent = 'Preview unavailable';
          return { ok: false, reason: 'no_structure' };
        }

        const mountTarget = previewMountEl || previewContainer;
        if (!mountTarget) {
          throw new Error('Preview container unavailable');
        }

        if (!window.GeneguessrMolstar || !window.GeneguessrMolstar.initializeViewer) {
          throw new Error('Mol* shared initializer not available');
        }

        // Build minimal render options; canonical defaults/stylization live in molstar-shared.js
        const isBinary = data.format === 'bcif';
        const init = await window.GeneguessrMolstar.initializeViewer(mountTarget, {
          moleculeId: data.displayLabel || uniprot,
          customData: {
            url: data.url,
            format: isBinary ? 'cif' : (data.format || 'cif'),
            binary: isBinary
          }
        }, {
          apiBase: API_BASE,
          graphicsSettings: pendingGraphicsSettings,
          fetchGraphicsSettings: false,
          interactive: false,
          loadTimeoutMs: 60000,
        });

        const viewer = init.viewer;
        localViewer = viewer;

        // Store representation info for chain coloring
        const representation = {
          source: data.sourceLabel === 'PDB' ? 'pdb' : (data.sourceLabel === 'AlphaFold' ? 'alphafold' : 'swissmodel'),
          structureId: data.displayLabel,
          chainLabels: data.chainLabels
        };

        const result = await init.loadComplete;

        if (loadToken !== previewLoadToken) {
          await disposePreviewViewer(viewer);
          localViewer = null;
          return { ok: false, reason: 'superseded' };
        }

        if (!result || !result.ok) {
          // Dispose the viewer that was created but failed to load
          await disposePreviewViewer(viewer);
          clearPreviewMount();
          localViewer = null;
          throw new Error('Mol* loadComplete did not fire before timeout');
        }

        previewViewer = viewer;
        localViewer = null; // ownership transferred to previewViewer
        previewStructureChoice = representation;
        previewReady = true;
        previewLoadingEl.hidden = true;

        previewStatusEl.textContent = 'Showing ' + uniprot;
        refreshPreview({ immediate: true });
        applyPreviewChainColoring(viewer);
        if (window.GeneguessrMolstar?.setFloatingLabels && representation.chainLabels) {
          const mountRef = previewMountEl || previewContainer;
          window.GeneguessrMolstar.setFloatingLabels(viewer, mountRef, {
            mode: 'revealed name mode',
            chainLabels: representation.chainLabels
          });
        }
        return { ok: true };
      } catch (err) {
        // Dispose any viewer created during this call that wasn't
        // transferred to previewViewer — prevents WebGL context leaks.
        if (localViewer) {
          try { await disposePreviewViewer(localViewer); } catch (_) {}
          clearPreviewMount();
          localViewer = null;
        }
        if (loadToken === previewLoadToken) {
          console.error('Failed to load protein in preview:', err);
          previewLoadingEl.hidden = true;
          previewErrorEl.hidden = false;
          previewErrorEl.textContent = 'Failed to load ' + pendingLabel + ': ' + (err && err.message ? err.message : err);
          previewStatusEl.textContent = 'Error loading protein';
        } else {
          console.warn('Admin preview: ignored stale protein load', err);
        }
        return { ok: false, reason: 'load_failed', error: err };
      }
    }

    async function initializePreview() {
      if (!previewContainer) {
        return;
      }
      previewLoadingEl.hidden = true;
      previewErrorEl.hidden = true;
      previewPlaceholderEl.hidden = false;
      previewPlaceholderEl.textContent = 'Select a date to view protein';
      previewStatusEl.textContent = 'Select a date to preview';
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
        return previewTheme === 'dark' ? '#110c0a' : '#f8f1e7';
      }
      if (background.mode === 'dark') {
        return background.dark || '#110c0a';
      }
      if (background.mode === 'light') {
        return background.light || '#f8f1e7';
      }
      if (background.mode === 'custom') {
        return background.custom || '#110c0a';
      }
      return previewTheme === 'dark' ? (background.dark || '#110c0a') : (background.light || '#f8f1e7');
    }

    function parseColorString(value) {
      if (!value) {
        return null;
      }
      const match = value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
      if (!match) {
        return null;
      }
      return {
        r: Number.parseInt(match[1], 10),
        g: Number.parseInt(match[2], 10),
        b: Number.parseInt(match[3], 10)
      };
    }

    function resolveCssColorValue(value) {
      if (!value || !document || !document.body) {
        return null;
      }
      try {
        const probe = document.createElement('span');
        probe.style.position = 'absolute';
        probe.style.opacity = '0';
        probe.style.pointerEvents = 'none';
        probe.style.color = value;
        document.body.appendChild(probe);
        const computed = window.getComputedStyle(probe).color;
        probe.remove();
        return parseColorString(computed);
      } catch (err) {
        console.warn('Admin preview: unable to resolve CSS color', err);
        return null;
      }
    }

    function getAccentColorRgb() {
      return resolveCssColorValue('var(--accent)') || hexToRgb(ACCENT_COLOR_HEX) || { r: 27, g: 114, b: 105 };
    }

    function getNeutralChainColor() {
      const fallbackHex = previewTheme === 'dark' ? DARK_NEUTRAL_GRAY_HEX : LIGHT_NEUTRAL_GRAY_HEX;
      return resolveCssColorValue('var(--gray)') || hexToRgb(fallbackHex);
    }

    function buildChainHighlightData(representation, accentRgb) {
      if (!representation || !accentRgb) {
        return [];
      }
      const segments = Array.isArray(representation.chains) ? representation.chains : [];
      if (!segments || segments.length === 0) {
        return [];
      }
      const color = {
        r: Math.round(accentRgb.r || 0),
        g: Math.round(accentRgb.g || 0),
        b: Math.round(accentRgb.b || 0)
      };
      const data = [];
      segments.forEach((segment) => {
        if (!segment || !Array.isArray(segment.chains)) {
          return;
        }
        segment.chains.forEach((chainId) => {
          if (!chainId) {
            return;
          }
          data.push({
            auth_asym_id: chainId,
            start_residue_number: segment.start,
            end_residue_number: segment.end,
            color
          });
        });
      });
      return data;
    }

    function applyPreviewChainColoring(viewer) {
      if (!viewer || typeof viewer.visual?.select !== 'function' || !previewStructureChoice || (previewStructureChoice.source !== 'pdb' && previewStructureChoice.source !== 'swissmodel')) {
        return;
      }
      const structureId = previewStructureChoice.structureId || (previewStructureChoice.pdb && previewStructureChoice.pdb.id);
      if (!structureId) {
        return;
      }
      const highlightData = buildChainHighlightData(previewStructureChoice, getAccentColorRgb());
      if (!highlightData.length) {
        return;
      }
      const neutral = getNeutralChainColor() || { r: 128, g: 128, b: 128 };
      try {
        const result = viewer.visual.select({
          data: highlightData,
          nonSelectedColor: {
            r: Math.round(neutral.r || 0),
            g: Math.round(neutral.g || 0),
            b: Math.round(neutral.b || 0)
          },
          structureId
        });
        if (result && typeof result.catch === 'function') {
          result.catch((err) => console.warn('Admin preview: chain coloring failed', err));
        }
      } catch (err) {
        console.warn('Admin preview: chain coloring failed', err);
      }
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
      const safeType = type === 'success' ? 'success' : 'error';
      const safeMessage = escapeHtml(String(message));
      el.innerHTML = '<div class="message ' + safeType + '">' + safeMessage + '</div>';
      setTimeout(() => {
        if (el.innerHTML.indexOf(safeMessage) !== -1) {
          el.innerHTML = '';
        }
      }, 5000);
    }

    function setRecapImageMessage(message, type) {
      const el = document.getElementById('discord-image-message');
      if (!el) return;
      const safe = escapeHtml(String(message || ''));
      if (!safe) {
        el.innerHTML = '';
        return;
      }
      if (type === 'success' || type === 'error') {
        el.innerHTML = '<div class="message ' + type + '">' + safe + '</div>';
        return;
      }
      el.innerHTML = '<p class="helper-text">' + safe + '</p>';
    }

    function setCalendarImageMessage(message, type) {
      const el = document.getElementById('calendar-image-message');
      if (!el) return;
      const safe = escapeHtml(String(message || ''));
      if (!safe) {
        el.innerHTML = '';
        return;
      }
      if (type === 'success' || type === 'error') {
        el.innerHTML = '<div class="message ' + type + '">' + safe + '</div>';
        return;
      }
      el.innerHTML = '<p class="helper-text">' + safe + '</p>';
    }

    function setRecapWarningMessage(message, type) {
      const el = document.getElementById('discord-image-warning');
      if (!el) return;
      const safe = escapeHtml(String(message || ''));
      if (!safe) {
        el.innerHTML = '';
        return;
      }
      if (type === 'error') {
        el.innerHTML = '<div class="message error">' + safe + '</div>';
        return;
      }
      if (type === 'success') {
        el.innerHTML = '<div class="message success">' + safe + '</div>';
        return;
      }
      el.innerHTML = '<p class="helper-text">' + safe + '</p>';
    }

    function getUtcIsoDay(offsetDays) {
      const now = new Date();
      now.setUTCDate(now.getUTCDate() + Number(offsetDays || 0));
      return now.toISOString().slice(0, 10);
    }

    async function fetchRecapImageStatus(day) {
      const uniprot = scheduleData[day]?.uniprot;
      if (!uniprot) {
        throw new Error('No scheduled protein for ' + day);
      }
      const response = await fetch(
        API_BASE + '/api/admin/discord-recap-image?day=' + encodeURIComponent(day) + '&uniprot=' + encodeURIComponent(uniprot),
        {
        credentials: 'include'
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to check recap image status for ' + day);
      }
      return payload;
    }

    function setRecapImageKnownState(day, exists) {
      if (!day) return;
      recapImageExistsByDay[day] = !!exists;
      renderCalendar(currentDate);
    }

    function markRecapImageUnknown(day) {
      if (!day) return;
      delete recapImageExistsByDay[day];
      renderCalendar(currentDate);
    }

    async function refreshRecapStatusesForVisibleDays(visibleDays, options = {}) {
      const force = options.force === true;
      const normalizedDays = Array.from(
        new Set(
          (Array.isArray(visibleDays) ? visibleDays : [])
            .map((day) => String(day || '').trim())
            .filter((day) => /^\\d{4}-\\d{2}-\\d{2}$/.test(day))
            .filter((day) => !!scheduleData[day]?.uniprot)
        )
      );
      const daysToFetch = force
        ? normalizedDays
        : normalizedDays.filter((day) => recapImageExistsByDay[day] === undefined);

      if (daysToFetch.length === 0) {
        return;
      }

      if (recapStatusRefreshInFlight) {
        daysToFetch.forEach((day) => recapStatusQueuedDays.add(day));
        return recapStatusRefreshInFlight;
      }

      recapStatusRefreshInFlight = (async () => {
        let pendingDays = Array.from(new Set(daysToFetch));
        while (pendingDays.length > 0) {
          const imageIdentities = pendingDays.map((day) => day + '~' + scheduleData[day].uniprot);
          const response = await fetch(
            API_BASE + '/api/admin/discord-recap-images?images=' + encodeURIComponent(imageIdentities.join(',')),
            { credentials: 'include' }
          );
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error || 'Failed to load recap image statuses');
          }

          const byDay = payload?.days || {};
          let changed = false;
          pendingDays.forEach((day) => {
            const exists = !!byDay?.[day]?.exists;
            if (recapImageExistsByDay[day] !== exists) {
              recapImageExistsByDay[day] = exists;
              changed = true;
            }
          });

          if (changed) {
            renderCalendar(currentDate);
          }

          pendingDays = Array.from(recapStatusQueuedDays);
          recapStatusQueuedDays.clear();
        }
      })()
        .catch((err) => {
          console.error('Failed to refresh recap image status map:', err);
        })
        .finally(() => {
          recapStatusRefreshInFlight = null;
        });

      return recapStatusRefreshInFlight;
    }

    async function refreshRecapWarning() {
      const yesterday = getUtcIsoDay(-1);
      const today = getUtcIsoDay(0);
      try {
        const [yesterdayStatus, todayStatus] = await Promise.all([
          fetchRecapImageStatus(yesterday),
          fetchRecapImageStatus(today)
        ]);
        if (!yesterdayStatus?.exists) {
          setRecapWarningMessage(
            'Warning: Missing recap image for ' + yesterday + '. The 00:03 UTC recap post for that day will fail until you upload it.',
            'error'
          );
          return;
        }
        if (!todayStatus?.exists) {
          setRecapWarningMessage(
            'Heads up: Missing recap image for ' + today + '. Tomorrow\\'s 00:03 UTC recap post may fail if this day has puzzle data.',
            'info'
          );
          return;
        }
        setRecapWarningMessage('Recap image checks look good for yesterday and today (UTC).', 'success');
      } catch (err) {
        console.error('Failed to refresh recap warning:', err);
        setRecapWarningMessage('Could not verify recap-image coverage right now.', 'error');
      }
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function setRecapButtonsBusy(isBusy) {
      recapUploadRunning = !!isBusy;
      const monthBtn = document.getElementById('btn-upload-month-images');
      const dayBtn = document.getElementById('btn-upload-day-image');
      const yearBtn = document.getElementById('btn-upload-year-images');
      if (monthBtn) monthBtn.disabled = recapUploadRunning;
      if (dayBtn) dayBtn.disabled = recapUploadRunning;
      if (yearBtn) yearBtn.disabled = recapUploadRunning;
    }

    function getCanvasContentMetrics(canvas) {
      const sample = document.createElement('canvas');
      sample.width = 96;
      sample.height = 72;
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
      const data = ctx.getImageData(0, 0, sample.width, sample.height).data;

      // Mol* clears the canvas to a uniform background. Estimate that colour
      // from its four corners and count pixels that differ materially from it.
      // This detects rendered geometry regardless of light/dark theme; the old
      // brightness test incorrectly counted the dark background as content.
      const cornerOffsets = [
        0,
        (sample.width - 1) * 4,
        (sample.height - 1) * sample.width * 4,
        (sample.width * sample.height - 1) * 4
      ];
      const background = [0, 1, 2].map((channel) => {
        const values = cornerOffsets.map((offset) => data[offset + channel]).sort((a, b) => a - b);
        return Math.round((values[1] + values[2]) / 2);
      });
      let foregroundPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a <= 8) continue;
        const distanceSquared =
          Math.pow(r - background[0], 2) +
          Math.pow(g - background[1], 2) +
          Math.pow(b - background[2], 2);
        if (distanceSquared >= 625) foregroundPixels += 1;
      }
      return {
        foregroundPixels,
        foregroundRatio: foregroundPixels / (sample.width * sample.height),
        background
      };
    }

    function hasRenderedMolecule(metrics) {
      return !!metrics && metrics.foregroundPixels >= 28 && metrics.foregroundRatio >= 0.004;
    }

    async function waitForPreviewContent(timeoutMs) {
      const timeout = Number(timeoutMs || 90000);
      const start = Date.now();
      let consecutiveHealthyFrames = 0;
      let lastMetrics = null;
      while (Date.now() - start < timeout) {
        const canvas = previewMountEl ? previewMountEl.querySelector('canvas') : null;
        if (previewReady && canvas && canvas.width > 0 && canvas.height > 0) {
          lastMetrics = getCanvasContentMetrics(canvas);
          consecutiveHealthyFrames = hasRenderedMolecule(lastMetrics)
            ? consecutiveHealthyFrames + 1
            : 0;
          if (consecutiveHealthyFrames >= 3) {
            return { canvas, metrics: lastMetrics };
          }
        }
        await sleep(250);
      }
      const detail = lastMetrics
        ? ' (' + lastMetrics.foregroundPixels + ' foreground pixels, ratio ' + lastMetrics.foregroundRatio.toFixed(4) + ')'
        : '';
      throw new Error('Preview never produced stable molecule pixels' + detail);
    }

    async function capturePreviewImageBase64() {
      const { canvas } = await waitForPreviewContent(90000);
      const dataUrl = canvas.toDataURL('image/png');
      const marker = 'base64,';
      const idx = dataUrl.indexOf(marker);
      if (idx === -1) {
        throw new Error('Failed to encode preview image');
      }
      return dataUrl.slice(idx + marker.length);
    }

    async function uploadRecapImage(day, uniprot, imageBase64) {
      const response = await fetch(API_BASE + '/api/admin/discord-recap-image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, uniprot_id: uniprot, image_base64: imageBase64 })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to upload recap image');
      }
      return payload;
    }

    async function renderAndUploadDayImage(day, options) {
      const opts = options || {};
      const row = scheduleData[day];
      if (!row || !row.uniprot) {
        throw new Error('No scheduled protein for ' + day);
      }

      if (selectedDate !== day) {
        selectDate(day, { loadPreview: false });
      }

      let base64 = null;
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const loadResult = await loadProteinInPreview(row.uniprot);
        if (!loadResult?.ok) {
          if (loadResult?.reason === 'no_structure') {
            throw new Error('No structure available for ' + row.uniprot);
          }
          lastError = loadResult?.error || new Error('Preview load failed for ' + row.uniprot);
          continue;
        }
        try {
          base64 = await capturePreviewImageBase64();
          break;
        } catch (err) {
          lastError = err;
          console.warn('Recap image validation failed for ' + row.uniprot + ' on attempt ' + (attempt + 1), err);
        }
      }
      if (!base64) {
        throw lastError || new Error('Could not render recap image for ' + row.uniprot);
      }
      const uploaded = await uploadRecapImage(day, row.uniprot, base64);
      recapImageExistsByDay[day] = true;
      renderCalendar(currentDate);
      if (!opts.silent) {
        setRecapImageMessage('Uploaded recap image for ' + day + ' (' + row.symbol + ')', 'success');
      }
      refreshRecapWarning().catch((err) => {
        console.error('Failed to refresh recap warning after upload:', err);
      });
      return { uploaded, base64, uniprot: row.uniprot, symbol: row.symbol || row.uniprot };
    }

    async function uploadSelectedDayImage() {
      if (recapUploadRunning) {
        return;
      }
      const day = selectedDate || document.getElementById('override-date')?.value;
      if (!day) {
        setRecapImageMessage('Select a calendar day first.', 'error');
        return;
      }
      setRecapButtonsBusy(true);
      setRecapImageMessage('Rendering and uploading image for ' + day + '...', 'info');
      try {
        await renderAndUploadDayImage(day);
      } catch (err) {
        console.error('Failed to upload selected-day recap image:', err);
        setRecapImageKnownState(day, false);
        setRecapImageMessage(err?.message || 'Failed to upload selected-day image.', 'error');
      } finally {
        setRecapButtonsBusy(false);
      }
    }

    async function repairPostedRecap() {
      if (recapUploadRunning) {
        return;
      }
      const day = selectedDate || document.getElementById('override-date')?.value;
      if (!day) {
        setRecapImageMessage('Select a calendar day first.', 'error');
        return;
      }
      setRecapButtonsBusy(true);
      setRecapImageMessage('Rendering image and updating the posted recap for ' + day + '...', 'info');
      try {
        await renderAndUploadDayImage(day, { silent: true });
        const response = await fetch(API_BASE + '/api/admin/repair-posted-recap', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to update posted recap');
        }
        setRecapImageMessage('Updated posted recap for ' + day + '.', 'success');
      } catch (err) {
        console.error('Failed to update posted recap:', err);
        setRecapImageMessage(err?.message || 'Failed to update posted recap.', 'error');
      } finally {
        setRecapButtonsBusy(false);
      }
    }

    function getDisplayedMonthIsoDays(dateObj) {
      const target = dateObj || currentDate || new Date();
      const year = target.getFullYear();
      const month = target.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const days = [];
      for (let i = 1; i <= daysInMonth; i += 1) {
        days.push(
          year + '-' + String(month + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0')
        );
      }
      return days;
    }

    async function uploadDisplayedMonthImages() {
      if (recapUploadRunning) {
        return;
      }

      const monthLabel = document.getElementById('current-month-label')?.textContent || 'displayed month';
      const monthDays = getDisplayedMonthIsoDays(currentDate);

      setCalendarImageMessage('Checking missing image previews for ' + monthLabel + '...', 'info');
      try {
        await refreshRecapStatusesForVisibleDays(monthDays, { force: true });
      } catch (err) {
        console.error('Failed to refresh month recap statuses before upload:', err);
      }

      const days = monthDays
        .filter((day) => !!scheduleData[day]?.uniprot)
        .filter((day) => recapImageExistsByDay[day] !== true);

      if (days.length === 0) {
        setCalendarImageMessage('No missing previews in ' + monthLabel + '.', 'success');
        return;
      }

      const proceed = confirm(
        'Fill image previews for ' + monthLabel + '?\\n\\nMissing or unknown days: ' + days.length
      );
      if (!proceed) {
        setCalendarImageMessage('Month fill cancelled for ' + monthLabel + '.', 'info');
        return;
      }

      setRecapButtonsBusy(true);
      setCalendarImageMessage('Filling ' + days.length + ' day(s) for ' + monthLabel + '...', 'info');
      setRecapImageMessage('Month fill started for ' + monthLabel + '.', 'info');

      try {
        const imageByUniprot = new Map();
        let uploaded = 0;
        let failed = 0;
        let skipped = 0;

        for (let i = 0; i < days.length; i += 1) {
          const day = days[i];
          const row = scheduleData[day];
          const label = row?.symbol || row?.uniprot || day;
          setCalendarImageMessage(
            'Processing ' + (i + 1) + '/' + days.length + ' (' + day + ' • ' + label + ')',
            'info'
          );

          if (!row?.uniprot) {
            skipped += 1;
            continue;
          }

          try {
            let base64 = imageByUniprot.get(row.uniprot);
            if (!base64) {
              const rendered = await renderAndUploadDayImage(day, { silent: true, bulk: true });
              base64 = rendered.base64;
              imageByUniprot.set(row.uniprot, base64);
            } else {
              await uploadRecapImage(day, row.uniprot, base64);
              recapImageExistsByDay[day] = true;
            }
            uploaded += 1;
          } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            if (msg.toLowerCase().includes('no structure available')) {
              skipped += 1;
            } else {
              failed += 1;
            }
            setRecapImageKnownState(day, false);
            console.error('Month recap-image upload failed for ' + day + ':', err);
          }
        }

        renderCalendar(currentDate);
        refreshRecapWarning().catch((err) => {
          console.error('Failed to refresh recap warning after month fill:', err);
        });

        if (failed > 0) {
          setCalendarImageMessage(
            'Month fill finished with errors. Uploaded: ' + uploaded + ', failed: ' + failed + ', skipped: ' + skipped + '.',
            'error'
          );
        } else {
          setCalendarImageMessage(
            'Month fill complete. Uploaded: ' + uploaded + ', skipped: ' + skipped + '.',
            'success'
          );
        }
      } catch (err) {
        console.error('Failed month recap-image upload:', err);
        setCalendarImageMessage(err?.message || 'Failed month image fill.', 'error');
      } finally {
        setRecapButtonsBusy(false);
      }
    }

    async function uploadOverrideDayImage(day) {
      if (!day) return;

      // Wait for any active upload to finish, then run this override refresh.
      // This guarantees override-driven image updates are never dropped.
      let announcedWait = false;
      while (recapUploadRunning) {
        if (!announcedWait) {
          setRecapImageMessage(
            'Override saved. Waiting for the current upload to finish before refreshing ' + day + '...',
            'info'
          );
          announcedWait = true;
        }
        await sleep(250);
      }

      setRecapButtonsBusy(true);
      try {
        await renderAndUploadDayImage(day, { silent: true });
        setRecapImageMessage('Override saved and recap image refreshed for ' + day + '.', 'success');
      } catch (err) {
        console.error('Failed override recap-image refresh for ' + day + ':', err);
        setRecapImageKnownState(day, false);
        setRecapImageMessage(
          'Override saved, but recap image refresh failed for ' + day + '. Use "Upload Selected Day Image".',
          'error'
        );
      } finally {
        setRecapButtonsBusy(false);
      }
    }

    async function uploadNextYearImages() {
      if (recapUploadRunning) {
        return;
      }

      const proceed = confirm('Render and upload recap images for the next 365 days? This can take a while.');
      if (!proceed) return;

      setRecapButtonsBusy(true);
      setRecapImageMessage('Loading schedule for yearly upload...', 'info');

      try {
        await loadSchedule({ futureDays: DISCORD_IMAGE_UPLOAD_DAYS });
        const today = new Date().toISOString().slice(0, 10);
        const days = Object.keys(scheduleData)
          .filter((day) => day >= today && scheduleData[day]?.uniprot)
          .sort()
          .slice(0, DISCORD_IMAGE_UPLOAD_DAYS);

        if (days.length === 0) {
          throw new Error('No upcoming scheduled proteins to upload.');
        }

        const imageByUniprot = new Map();
        let uploaded = 0;
        let failed = 0;
        let skipped = 0;

        for (let i = 0; i < days.length; i += 1) {
          const day = days[i];
          const row = scheduleData[day];
          const label = row?.symbol || row?.uniprot || day;
          setRecapImageMessage(
            'Processing ' + (i + 1) + '/' + days.length + ' (' + day + ' • ' + label + ')',
            'info'
          );

          if (!row?.uniprot) {
            skipped += 1;
            continue;
          }

          try {
            let base64 = imageByUniprot.get(row.uniprot);
            if (!base64) {
              const rendered = await renderAndUploadDayImage(day, { silent: true, bulk: true });
              base64 = rendered.base64;
              imageByUniprot.set(row.uniprot, base64);
            } else {
              await uploadRecapImage(day, row.uniprot, base64);
              recapImageExistsByDay[day] = true;
            }
            uploaded += 1;
          } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            if (msg.toLowerCase().includes('no structure available')) {
              skipped += 1;
            } else {
              failed += 1;
            }
            console.error('Yearly recap-image upload failed for ' + day + ':', err);
          }
          await sleep(250);
        }

        renderCalendar(currentDate);
        refreshRecapWarning().catch((err) => {
          console.error('Failed to refresh recap warning after yearly upload:', err);
        });

        if (failed > 0) {
          setRecapImageMessage(
            'Yearly upload finished with errors. Uploaded: ' + uploaded + ', failed: ' + failed + ', skipped: ' + skipped,
            'error'
          );
        } else {
          setRecapImageMessage(
            'Yearly upload complete. Uploaded: ' + uploaded + ', skipped: ' + skipped + '.',
            'success'
          );
        }
      } catch (err) {
        console.error('Failed yearly recap-image upload:', err);
        setRecapImageMessage(err?.message || 'Failed yearly recap-image upload.', 'error');
      } finally {
        setRecapButtonsBusy(false);
      }
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
        clearLocalOverride(date);
        markRecapImageUnknown(date);
        if (selectedDate === date) {
          selectDate(date);
        }
        queueBackgroundScheduleRefresh({ date });
        uploadOverrideDayImage(date).catch((err) => {
          console.error('Background recap image upload failed after override removal:', err);
        });
      } catch (err) {
        console.error('Error deleting override:', err);
        showMessage('override-message', err.message || 'Failed to delete override', 'error');
      }
    };

    // Calendar Logic
    let currentDate = new Date();
    let currentOverrides = [];
    let selectedDate = null;

    function initCalendar() {
      renderCalendar(currentDate);
      
      document.getElementById('prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar(currentDate);
      });
      
      document.getElementById('next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar(currentDate);
      });
    }

    function renderCalendar(date) {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      // Monday-based: convert Sunday=0 to 6, Monday=1 to 0, etc.
      const startingDay = (firstDay.getDay() + 6) % 7;

      const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      document.getElementById('current-month-label').textContent = monthNames[month] + ' ' + year;

      const grid = document.getElementById('calendar-grid');
      grid.innerHTML = '';

      // Day headers (Monday-first)
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      dayNames.forEach(day => {
        const el = document.createElement('div');
        el.className = 'calendar-day-header';
        el.textContent = day;
        grid.appendChild(el);
      });

      // Empty slots before first day
      for (let i = 0; i < startingDay; i++) {
        const el = document.createElement('div');
        el.className = 'calendar-day empty';
        grid.appendChild(el);
      }
      
      // Days
      const todayStr = new Date().toISOString().split('T')[0];
      const visibleDays = [];
      
      for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0');
        visibleDays.push(dateStr);
        const el = document.createElement('div');
        el.className = 'calendar-day';
        
        const data = scheduleData[dateStr];
        
        if (dateStr === todayStr) el.classList.add('today');
        if (dateStr === selectedDate) el.classList.add('selected');
        
        if (data) {
          if (data.type === 'history') el.classList.add('is-history');
          if (data.source === 'override') el.classList.add('is-override');
          else if (data.source === 'computed') el.classList.add('is-computed');
          if (data.uniprot && recapImageExistsByDay[dateStr] === false) {
            el.classList.add('missing-recap-image');
          }
        }
        
        let content = '<div class="day-number">' + i + '</div>';
        content += '<div class="day-content">';
        
        if (data && data.symbol) {
          content += '<div class="day-symbol">' + escapeHtml(data.symbol) + '</div>';
          if (data.source === 'override') {
            content += '<div class="day-badge override">Override</div>';
          } else if (data.type === 'history') {
             // History doesn't need a badge usually, maybe just dim
          } else {
            content += '<div class="day-badge computed">Auto</div>';
          }
        }
        
        content += '</div>';
        el.innerHTML = content;
        
        el.addEventListener('click', () => selectDate(dateStr));
        grid.appendChild(el);
      }

      refreshRecapStatusesForVisibleDays(visibleDays).catch((err) => {
        console.error('Failed to refresh visible recap image statuses:', err);
      });
    }

      function selectDate(date, options) {
        const opts = options || {};
        selectedDate = date;
        renderCalendar(currentDate); // Re-render to show selection highlight
      
      const data = scheduleData[date];
      
      // Hide any duplicate warning from previous selection
      const duplicateCallout = document.getElementById('duplicate-warning-callout');
      if (duplicateCallout) duplicateCallout.classList.remove('show');
      
      // Update Inspector Header
      document.getElementById('inspector-date').textContent = new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      
      let metaText = 'No data for this date';
      if (data) {
        if (data.type === 'history') {
          metaText = 'Historical Record • Source: ' + data.source;
        } else {
          metaText = (data.source === 'override' ? 'Manual Override' : 'Computed Selection') + (data.fullName ? ' • ' + data.fullName : '');
        }
      }
      document.getElementById('inspector-meta').textContent = metaText;
      
        // Show sections
        document.getElementById('inspector-controls').style.display = 'block';
        document.getElementById('inspector-details').style.display = 'block';
        document.getElementById('inspector-guess-stats').style.display = 'block';
        document.getElementById('inspector-neighbors').style.display = 'block';
      
      // Update Form
      document.getElementById('override-date').value = date;
      const overrideId = (data && data.source === 'override') ? data.uniprot : '';
      const overrideLabel = (data && data.source === 'override') ? (data.symbol || '') : '';
      document.getElementById('override-uniprot').value = overrideLabel;

      if (overrideId) {
        overrideSelectedSuggestionUniprot = overrideId;
        overrideSelectedSuggestionGene = overrideLabel ? String(overrideLabel).trim().toUpperCase() : null;
      } else {
        overrideSelectedSuggestionUniprot = null;
        overrideSelectedSuggestionGene = null;
      }
      
      // Update buttons
      const deleteBtn = document.getElementById('btn-delete-override');
      const saveBtn = document.getElementById('btn-save-override');
      
      if (overrideId) {
        deleteBtn.style.display = 'inline-block';
        saveBtn.textContent = 'Update Override';
      } else {
        deleteBtn.style.display = 'none';
        saveBtn.textContent = 'Set Override';
      }
      
      // Load Preview
      const proteinToLoad = (data && data.uniprot) ? data.uniprot : null;
      if (proteinToLoad && opts.loadPreview !== false) {
        loadProteinInPreview(proteinToLoad);
      } else {
        // Clear preview if no protein
        document.getElementById('graphics-preview-placeholder').style.display = 'flex';
        document.getElementById('graphics-preview-placeholder').textContent = 'No protein scheduled for this date';
        document.getElementById('graphics-preview-mount').innerHTML = '';
      }
      
      // Load Cards
      loadCardsForDate(date);
      loadGuessStatsForDate(date);
    }
    
    // Initialize calendar
    initCalendar();
    initGuessAnalytics();
  </script>

</body>
</html>`
