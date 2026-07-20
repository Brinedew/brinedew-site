export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Admin</title>
  <link rel="stylesheet" href="/static/iconoplasm/admin.css" />
</head>
<body>
  <div class="page">
    <header>
      <h1>Iconoplasm Admin</h1>
      <p>Blots first, bookkeeping second. This page steers the canonical blot shown in the extension. Votes auto-pick the canonical blot unless a manual override is active.</p>
    </header>

    <nav id="admin-tabs" aria-label="Admin sections" role="tablist">
      <button class="tab-btn active" id="admin-tab-overview" role="tab" aria-selected="true" aria-controls="panel-overview" tabindex="0" data-tab="overview">Home</button>
      <button class="tab-btn" id="admin-tab-costs" role="tab" aria-selected="false" aria-controls="panel-costs" tabindex="-1" data-tab="costs">Observability</button>
      <button class="tab-btn" id="admin-tab-requests" role="tab" aria-selected="false" aria-controls="panel-requests" tabindex="-1" data-tab="requests">Requests</button>
      <button class="tab-btn" id="admin-tab-prompts" role="tab" aria-selected="false" aria-controls="panel-prompts" tabindex="-1" data-tab="prompts">Prompts</button>
      <button class="tab-btn" id="admin-tab-archive" role="tab" aria-selected="false" aria-controls="panel-archive" tabindex="-1" data-tab="archive">Gallery</button>
      <button class="tab-btn" id="admin-tab-styles" role="tab" aria-selected="false" aria-controls="panel-styles" tabindex="-1" data-tab="styles">Visions</button>
      <button class="tab-btn" id="admin-tab-activity" role="tab" aria-selected="false" aria-controls="panel-activity" tabindex="-1" data-tab="activity">Log</button>
    </nav>

    <!-- ── overview ── -->
    <div class="panel active" id="panel-overview" role="tabpanel" aria-labelledby="admin-tab-overview">
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

    <div class="panel" id="panel-costs" role="tabpanel" aria-labelledby="admin-tab-costs" hidden>
      <div class="cost-layout">
        <section class="cost-hero">
          <div class="cost-toolbar">
            <div>
              <div class="cost-kicker">Iconoplasm observability</div>
              <h2>Cloudflare snapshot, baked out of band</h2>
              <p class="small">This tab auto-refreshes on deploy and on the hourly snapshot job. It is a baked capacity-and-signals view, not a live request probe.</p>
            </div>
            <div class="cost-toolbar-actions">
              <button type="button" id="cost-refresh">Reload snapshot</button>
              <span class="cost-toolbar-note" id="cost-updated-at">Not loaded yet.</span>
            </div>
          </div>
          <div class="cost-context-strip" id="cost-context-strip"></div>
          <div class="cost-metric-grid" id="cost-metrics"></div>
        </section>

        <section class="cost-cockpit" aria-label="Cloudflare free-plan cockpit">
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head">
              <h2>Snapshot trust</h2>
              <span>Freshness, publication, and intentional gaps</span>
            </div>
            <div class="cost-chart" id="cost-snapshot-trust-chart"></div>
            <div class="cost-detail-grid" id="cost-snapshot-trust-details"></div>
          </article>
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head">
              <h2>D1 read ceiling</h2>
              <span id="cost-trend-meta">Waiting for data…</span>
            </div>
            <div class="cost-chart" id="cost-read-trend"></div>
          </article>
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head"><h2>D1 write ceiling</h2></div>
            <div class="cost-chart" id="cost-d1-write-adaptive-chart"></div>
          </article>
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head"><h2>Worker mutation ceiling</h2></div>
            <div class="cost-chart" id="cost-worker-limiter-chart"></div>
          </article>
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head"><h2>Durable Object ceiling</h2></div>
            <div class="cost-chart" id="cost-do-traffic-chart"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>Workers request ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-d1-query-volume-chart"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>KV read ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-d1-response-bytes-chart"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>KV write ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-d1-latency-chart"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>KV delete ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-d1-storage-chart"></div>
          </article>
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head"><h2>KV list ceiling</h2></div>
            <div class="cost-chart" id="cost-do-activity-mix-chart"></div>
          </article>
          <article class="cost-instrument cost-instrument--wide">
            <div class="cost-instrument-head"><h2>Queue operation ceiling</h2></div>
            <div class="cost-chart" id="cost-product-small-multiples"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>D1 storage ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-limit-ratio-heatmap"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>Pages Functions ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-sensor-coverage-matrix"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>Workers observability ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-overage-magnitude-plot"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>R2 Class B ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-daily-burn-calendar"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>KV storage ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-queue-backlog-chart"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>R2 storage ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-headroom-slope-chart"></div>
          </article>
          <article class="cost-instrument">
            <div class="cost-instrument-head"><h2>R2 Class A ceiling</h2></div>
            <div class="cost-chart cost-chart--compact" id="cost-snapshot-integrity-chart"></div>
          </article>
        </section>

        <section class="cost-card">
          <div class="cost-card-head">
            <div>
              <h2>Cloudflare drilldown</h2>
            </div>
          </div>
          <div id="cost-top-routes"></div>
        </section>
      </div>
    </div>

    <!-- ── requests ── -->
    <div class="panel" id="panel-requests" role="tabpanel" aria-labelledby="admin-tab-requests" hidden>
      <div class="section-head">
        <div>
          <h2>Generation requests</h2>
          <p class="small">A request log for debugging individual new-blot and edit-blot queue entries. Summary lanes are useful for fulfillment, but this list keeps every request visible.</p>
        </div>
        <button class="btn-primary" type="button" id="requests-refresh">Refresh</button>
      </div>
      <div class="request-toolbar">
        <div class="request-toolbar-row">
          <label>Search
            <input id="requests-search" type="search" placeholder="Gene, requester, emulsion, prompt, SHA..." />
          </label>
          <label>Kind
            <select id="requests-kind">
              <option value="all" selected>All request kinds</option>
              <option value="new_candidate">New blot</option>
              <option value="edit_image">Edit blot</option>
            </select>
          </label>
          <label>Mode
            <select id="requests-mode">
              <option value="all" selected>All modes</option>
              <option value="specific">Specific emulsion</option>
              <option value="random">Random default</option>
            </select>
          </label>
          <label>Status
            <select id="requests-status">
              <option value="all" selected>All statuses</option>
              <option value="open">Open</option>
              <option value="delivery_pending">Delivery pending</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>History limit
            <input id="requests-limit" type="number" min="1" max="500" value="200" />
          </label>
        </div>
        <div class="request-summary-strip" id="requests-summary"></div>
        <div class="table-pager" aria-label="Request history pagination">
          <label>Rows per page
            <select id="requests-page-size">
              <option value="12">12</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
          <div class="pager-group">
            <button type="button" id="requests-page-first">First</button>
            <button type="button" id="requests-page-prev">Prev</button>
            <span class="pager-status mono" id="requests-page-label">Page 1 of 1</span>
            <button type="button" id="requests-page-next">Next</button>
            <button type="button" id="requests-page-last">Last</button>
          </div>
        </div>
      </div>
      <div class="request-log-layout">
        <div class="request-table-wrap">
          <table class="request-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Created</th>
                <th>Gene</th>
                <th>Kind</th>
                <th>Mode / emulsion</th>
                <th>Requester</th>
                <th>Source</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody id="requests-list"></tbody>
          </table>
        </div>
        <aside class="request-detail-panel" id="requests-detail" tabindex="-1">
          <div class="detail-kicker">Request detail</div>
          <div class="detail-title">Pick a request</div>
          <div class="detail-copy">Click a row to inspect IDs, source asset, emulsion, prompt, and fulfillment fields.</div>
        </aside>
      </div>
    </div>

    <!-- -- prompts -- -->
    <div class="panel" id="panel-prompts" role="tabpanel" aria-labelledby="admin-tab-prompts" hidden>
      <div class="section-head">
        <div>
          <h2>Image edit prompts</h2>
          <p class="small">Each edit-blot checkbox has its own saved prompt template. Saving here changes future edits only; existing jobs keep their recorded prompt.</p>
        </div>
        <button class="btn-primary" type="button" id="prompts-refresh">Refresh</button>
      </div>
      <section class="prompt-editor prompt-prefix-editor" id="prompt-prefix-editor">
        <div>
          <div class="detail-kicker">Always-on prompt</div>
          <h2>Shared prefix</h2>
          <p class="small" id="prompt-prefix-description">This prefix is prepended once to every edit-blot prompt. It is not tied to a checkbox.</p>
        </div>
        <label>Shared prefix
          <textarea id="prompt-prefix-text" maxlength="2400" spellcheck="true" disabled></textarea>
        </label>
        <div>
          <h3>Default prefix</h3>
          <div class="prompt-default" id="prompt-prefix-default"></div>
        </div>
        <div class="actions">
          <button class="btn-primary" type="button" data-prompt-prefix-save disabled>Save prefix</button>
        </div>
      </section>
      <section class="prompt-editor prompt-suffix-editor" id="prompt-suffix-editor">
        <div>
          <div class="detail-kicker">Always-on prompt</div>
          <h2>Shared suffix</h2>
          <p class="small" id="prompt-suffix-description">This suffix is appended once to every edit-blot prompt. It is not tied to a checkbox.</p>
        </div>
        <label>Shared suffix
          <textarea id="prompt-suffix-text" maxlength="2400" spellcheck="true" disabled></textarea>
        </label>
        <div>
          <h3>Default suffix</h3>
          <div class="prompt-default" id="prompt-suffix-default"></div>
        </div>
        <div class="actions">
          <button class="btn-primary" type="button" data-prompt-suffix-save disabled>Save suffix</button>
        </div>
      </section>
      <div class="prompt-layout">
        <section class="stack">
          <div class="prompt-list" id="prompt-template-list"></div>
        </section>
        <section class="prompt-editor" id="prompt-template-editor">
          <div>
            <div class="detail-kicker">Selected prompt</div>
            <h2 id="prompt-template-heading">Pick a prompt</h2>
            <p class="small" id="prompt-template-description">Open this tab to load the editable image edit prompt templates.</p>
          </div>
          <label>Prompt template
            <textarea id="prompt-template-text" maxlength="2400" spellcheck="true" disabled></textarea>
          </label>
          <div class="prompt-token-strip" aria-label="Supported template tokens">
            <code>{value}</code>
            <code>{kg}</code>
            <code>{years}</code>
            <code>{hex}</code>
            <code>{styles}</code>
          </div>
          <div>
            <h3>Default</h3>
            <div class="prompt-default" id="prompt-template-default"></div>
          </div>
          <div class="actions">
            <button class="btn-primary" type="button" data-prompt-save disabled>Save prompt</button>
          </div>
          <div class="prompt-status" id="prompt-template-status" role="status"></div>
        </section>
      </div>
    </div>

    <!-- ── browse (archive) ── -->
    <div class="panel" id="panel-archive" role="tabpanel" aria-labelledby="admin-tab-archive" hidden>
      <div class="section-head">
        <div>
          <h2>Gallery</h2>
          <p class="small">Canonical means the blot shown in the extension. Votes pick it automatically unless you deliberately pin a manual override.</p>
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
                <option value="all" selected>all blots</option>
                <option value="mismatch">has mismatch</option>
                <option value="pinned">manual override</option>
                <option value="missing">missing canonical blot</option>
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
          <div class="small">Click a gene to inspect candidates. If a manual override exists, the compare view shows the current canonical blot against the vote winner.</div>
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
    <div class="panel" id="panel-styles" role="tabpanel" aria-labelledby="admin-tab-styles" hidden>
      <div class="split">
        <section class="stack">
          <h2>Vision scorecard</h2>
          <p class="small">Which sources are helping, which ones are making a mess, and which are already blacklisted.</p>
          <div class="table-toolbar">
            <div class="stats" id="vision-stats-meta">Open this tab to load the scorecard.</div>
            <div class="table-pager">
              <label>Rows
                <select id="vision-page-size">
                  <option value="8">8</option>
                  <option value="12" selected>12</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
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
    <div class="panel" id="panel-activity" role="tabpanel" aria-labelledby="admin-tab-activity" hidden>
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

  <script src="/static/iconoplasm/admin.js" defer></script>
</body>
</html>
`
