export const ICONOPLASM_ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Admin</title>
  <link rel="stylesheet" href="/static/iconoplasm/admin.css?v=__ICONOPLASM_ADMIN_ASSET_VERSION__" />
</head>
<body>
  <div class="page">
    <header>
      <h1>Iconoplasm Admin</h1>
      <p>Blots first, bookkeeping second. This page steers the canonical blot shown in the extension. Votes auto-pick the canonical blot unless a manual override is active.</p>
    </header>

    <nav id="admin-tabs" aria-label="Admin sections" role="tablist">
      <button class="tab-btn active" id="admin-tab-overview" role="tab" aria-selected="true" aria-controls="panel-overview" tabindex="0" data-tab="overview">Home</button>
      <button class="tab-btn" id="admin-tab-factory" role="tab" aria-selected="false" aria-controls="panel-factory" tabindex="-1" data-tab="factory">Factory</button>
      <button class="tab-btn" id="admin-tab-costs" role="tab" aria-selected="false" aria-controls="panel-costs" tabindex="-1" data-tab="costs">Observability</button>
      <button class="tab-btn" id="admin-tab-requests" role="tab" aria-selected="false" aria-controls="panel-requests" tabindex="-1" data-tab="requests">Requests</button>
      <button class="tab-btn" id="admin-tab-prompts" role="tab" aria-selected="false" aria-controls="panel-prompts" tabindex="-1" data-tab="prompts">Prompts</button>
      <button class="tab-btn" id="admin-tab-extension" role="tab" aria-selected="false" aria-controls="panel-extension" tabindex="-1" data-tab="extension">Recognition</button>
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

    <div class="panel" id="panel-factory" role="tabpanel" aria-labelledby="admin-tab-factory" hidden>
      <section class="factory-console" aria-labelledby="factory-heading">
        <div class="section-head factory-console__head">
          <div>
            <p class="factory-kicker">Future jobs</p>
            <h2 id="factory-heading">Choose the active factory recipe</h2>
            <p class="small">Letters are immutable Pipelines. Numbers are immutable Visions. Changing this pointer never rewrites queued jobs or existing candidates.</p>
          </div>
          <output id="factory-active-code" class="factory-code" aria-live="polite">A1</output>
        </div>
        <div class="factory-selector-grid">
          <label>Pipeline
            <select id="factory-pipeline"></select>
          </label>
          <label>Vision
            <select id="factory-vision"></select>
          </label>
        </div>
        <div id="factory-recipe-detail" class="factory-recipe-detail"></div>
        <div class="controls factory-actions">
          <button type="button" id="factory-save">Activate for future jobs</button>
          <button type="button" id="factory-refresh">Reload</button>
          <span id="factory-status" class="small" role="status"></span>
        </div>
      </section>
      <section class="diagnostic-console" aria-labelledby="diagnostic-heading">
        <div class="section-head diagnostic-console__head">
          <div>
            <p class="factory-kicker">Controlled comparison</p>
            <h2 id="diagnostic-heading">Diagnostic Matrix</h2>
            <p class="small">Hold one gene constant, cross selected factory lines with selected emulsions, and inspect every result here. The run snapshots all choices before it enters the workstation queue.</p>
          </div>
          <output id="diagnostic-cell-count" class="diagnostic-cell-count" aria-live="polite">25 cells</output>
        </div>
        <div class="diagnostic-builder">
          <label class="diagnostic-gene-field">Gene
            <input id="diagnostic-gene" type="text" value="FMR1" autocomplete="off" spellcheck="false" maxlength="24" />
          </label>
          <fieldset class="diagnostic-pipelines">
            <legend>Factory lines</legend>
            <div id="diagnostic-pipeline-options" class="diagnostic-option-grid"></div>
          </fieldset>
          <div class="diagnostic-emulsions">
            <span class="diagnostic-label">Emulsions</span>
            <div class="diagnostic-emulsion-entry">
              <input id="diagnostic-emulsion-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Emulsion code" />
              <button type="button" id="diagnostic-emulsion-add" class="secondary">Add</button>
            </div>
            <div id="diagnostic-emulsion-chips" class="diagnostic-emulsion-chips" aria-live="polite"></div>
          </div>
          <label>Prompt body
            <select id="diagnostic-prompt-mode">
              <option value="taggerizer_prompt" selected>Tags</option>
              <option value="prose_prompt">Full manifestation</option>
            </select>
          </label>
        </div>
        <div class="controls diagnostic-actions">
          <button type="button" id="diagnostic-run">Run diagnostic matrix</button>
          <button type="button" id="diagnostic-download" class="secondary" disabled>Download PNG</button>
          <button type="button" id="diagnostic-refresh" class="secondary">Reload latest</button>
          <span id="diagnostic-status" class="small" role="status"></span>
        </div>
        <div id="diagnostic-progress" class="diagnostic-progress" hidden></div>
        <figure id="diagnostic-figure" class="diagnostic-figure" hidden>
          <div class="diagnostic-figure__title-row">
            <figcaption id="diagnostic-caption"></figcaption>
            <span id="diagnostic-run-code" class="mono"></span>
          </div>
          <div id="diagnostic-matrix" class="diagnostic-matrix"></div>
          <p id="diagnostic-legend" class="diagnostic-legend"></p>
        </figure>
      </section>
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

    <!-- -- recognition policy -- -->
    <div class="panel" id="panel-extension" role="tabpanel" aria-labelledby="admin-tab-extension" hidden>
      <section class="recognition-workspace" aria-labelledby="recognition-heading">
        <header class="recognition-head">
          <div>
            <p class="recognition-kicker">Text recognition</p>
            <h2 id="recognition-heading">Recognition rules</h2>
            <p class="recognition-intro">Control the labels Iconoplasm recognizes on pages. Alias mappings send a label to one canonical gene; the blocklist suppresses ambiguous aliases.</p>
          </div>
        </header>

        <div class="recognition-tabs" role="tablist" aria-label="Recognition rule sections">
          <button class="recognition-tab active" id="recognition-tab-aliases" type="button" role="tab" aria-selected="true" aria-controls="recognition-panel-aliases" tabindex="0" data-recognition-section="aliases">Alias mappings <span class="recognition-tab-count" id="publication-alias-tab-count" aria-hidden="true">—</span></button>
          <button class="recognition-tab" id="recognition-tab-blocklist" type="button" role="tab" aria-selected="false" aria-controls="recognition-panel-blocklist" tabindex="-1" data-recognition-section="blocklist">Blocklist <span class="recognition-tab-count" id="extension-blocklist-tab-count" aria-hidden="true">—</span></button>
        </div>

        <div class="recognition-panel active" id="recognition-panel-aliases" role="tabpanel" aria-labelledby="recognition-tab-aliases">
          <section class="publication-alias-workspace" aria-labelledby="publication-alias-heading">
            <div class="recognition-section-head">
              <div>
                <h3 id="publication-alias-heading">Alias mappings</h3>
                <p class="small">Add exact labels found in papers and on web pages when the published catalog does not already recognize them.</p>
              </div>
              <button type="button" id="publication-alias-refresh">Refresh aliases</button>
            </div>

            <div class="recognition-ledger" aria-label="Alias publication details">
              <div>
                <span class="recognition-ledger-label">Curated aliases</span>
                <strong id="publication-alias-count">—</strong>
              </div>
              <div>
                <span class="recognition-ledger-label">Generated corrections</span>
                <strong id="publication-alias-removal-count">—</strong>
              </div>
              <div>
                <span class="recognition-ledger-label">Revision</span>
                <strong class="mono" id="publication-alias-revision">—</strong>
              </div>
              <div>
                <span class="recognition-ledger-label">Publication</span>
                <strong class="recognition-sync" id="publication-alias-sync" data-sync="unknown">Not loaded</strong>
              </div>
            </div>

            <div class="recognition-editor">
              <div class="recognition-command-rail">
                <form class="publication-alias-composer" id="publication-alias-form" novalidate>
              <div class="publication-alias-fields">
                <label for="publication-alias-input">Alias
                  <input id="publication-alias-input" type="text" maxlength="64" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="publication-alias-input-help" placeholder="IL8" disabled />
                </label>
                <div class="publication-alias-gene-field">
                  <label for="publication-alias-gene-query">Gene</label>
                  <div class="publication-alias-combobox">
                    <input id="publication-alias-gene-query" type="text" spellcheck="false" autocomplete="off" autocapitalize="characters" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="publication-alias-gene-results" aria-describedby="publication-alias-gene-help" placeholder="Search symbol or gene name" disabled />
                    <ul class="publication-alias-gene-results" id="publication-alias-gene-results" role="listbox" aria-label="Canonical gene matches" hidden></ul>
                  </div>
                  <span class="small" id="publication-alias-gene-help">Type at least two characters, then choose a published canonical gene.</span>
                  <span class="sr-only" id="publication-alias-gene-status" role="status" aria-live="polite"></span>
                </div>
              </div>
              <p class="small" id="publication-alias-input-help">Enter the page label as readers see it. Case is preserved; repeated whitespace and dash variants are normalized. Adding only changes this draft.</p>
              <div class="publication-alias-target-preview" id="publication-alias-target-preview" role="status" aria-live="polite" hidden></div>
              <div class="publication-alias-conflict" id="publication-alias-conflict" role="alert" hidden></div>
              <div class="publication-alias-composer-actions">
                <span class="publication-alias-editing" id="publication-alias-editing" hidden></span>
                <button type="button" id="publication-alias-cancel-edit" hidden>Cancel edit</button>
                <button class="btn-primary" type="submit" id="publication-alias-add" disabled>Add mapping to draft</button>
              </div>
                </form>

                <div class="recognition-actions">
                  <div class="recognition-status" id="publication-alias-status" role="status" aria-live="polite"></div>
                  <button class="btn-primary publication-alias-publish" type="button" id="publication-alias-publish" disabled>Publish alias changes</button>
                </div>
              </div>

              <section class="recognition-draft-pane" aria-labelledby="publication-alias-draft-heading">
                <div class="publication-alias-list-head">
                  <div>
                    <h4 id="publication-alias-draft-heading">Publication draft</h4>
                    <p class="small">Each row maps one exact alias to one canonical gene. Generated corrections are preserved unchanged.</p>
                  </div>
                  <label class="publication-alias-filter" for="publication-alias-filter">Filter mappings
                    <input id="publication-alias-filter" type="search" autocomplete="off" placeholder="Alias or gene symbol" disabled />
                  </label>
                  <span class="recognition-dirty" id="publication-alias-dirty" data-dirty="false">Saved policy</span>
                </div>

                <ul class="publication-alias-mappings" id="publication-alias-mappings" aria-label="Curated alias publication draft" aria-live="polite"></ul>
              </section>
            </div>
          </section>
        </div>

        <div class="recognition-panel" id="recognition-panel-blocklist" role="tabpanel" aria-labelledby="recognition-tab-blocklist" hidden>
          <section class="extension-blocklist-workspace" aria-labelledby="extension-blocklist-heading">
            <div class="extension-blocklist-head">
              <div>
                <h3 id="extension-blocklist-heading">Shared text blocklist</h3>
                <p class="extension-blocklist-intro">Suppress aliases that are too ambiguous to recognize safely across arbitrary pages.</p>
              </div>
              <button type="button" id="extension-blocklist-refresh">Refresh policy</button>
            </div>

            <div class="extension-blocklist-ledger" aria-label="Shared blocklist publication details">
              <div>
                <span class="extension-blocklist-ledger-label">Shared terms</span>
                <strong id="extension-blocklist-count">—</strong>
              </div>
              <div>
                <span class="extension-blocklist-ledger-label">Revision</span>
                <strong class="mono" id="extension-blocklist-revision">—</strong>
              </div>
              <div>
                <span class="extension-blocklist-ledger-label">Updated</span>
                <strong id="extension-blocklist-updated">Not loaded</strong>
              </div>
              <div>
                <span class="extension-blocklist-ledger-label">Publication</span>
                <strong class="extension-blocklist-sync" id="extension-blocklist-sync" data-sync="unknown">Not loaded</strong>
              </div>
            </div>

            <div class="recognition-editor">
              <div class="recognition-command-rail">
                <div class="extension-blocklist-composer">
                  <label for="extension-blocklist-input">Add terms to this draft</label>
                  <div class="extension-blocklist-input-row">
                    <textarea id="extension-blocklist-input" rows="3" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-describedby="extension-blocklist-input-help" placeholder="Paste terms separated by commas, spaces, or new lines" disabled></textarea>
                    <button class="btn-primary" type="button" id="extension-blocklist-add" disabled>Add to draft</button>
                  </div>
                  <p class="small" id="extension-blocklist-input-help">Use an existing non-canonical catalog alias, or protect a larger phrase that contains a recognized gene label (for example, APC/C). A protected phrase suppresses every gene highlight inside it while the same gene still highlights elsewhere. Terms are normalized to uppercase. Adding only changes the draft; nothing reaches extensions until you publish.</p>
                  <details class="extension-blocklist-details">
                    <summary>How publishing works</summary>
                    <p class="small">The 76 packaged terms are only the first-run and offline fallback. A loaded policy replaces the complete shared list for every protocol-capable extension.</p>
                  </details>
                </div>

                <div class="extension-blocklist-actions">
                  <div class="extension-blocklist-status" id="extension-blocklist-status" role="status" aria-live="polite"></div>
                  <button class="btn-primary extension-blocklist-publish" type="button" id="extension-blocklist-publish" disabled>Publish shared terms</button>
                </div>
              </div>

              <section class="recognition-draft-pane" aria-labelledby="extension-blocklist-draft-heading">
                <div class="extension-blocklist-draft-head">
                  <div>
                    <h4 id="extension-blocklist-draft-heading">Publication draft</h4>
                    <p class="small">This draft replaces the full shared list. Remove a term here to unblock it for everyone on the next publish.</p>
                  </div>
                  <span class="extension-blocklist-dirty" id="extension-blocklist-dirty" data-dirty="false">Saved policy</span>
                </div>

                <ul class="extension-blocklist-terms" id="extension-blocklist-terms" aria-label="Shared blocklist draft terms" aria-live="polite"></ul>
              </section>
            </div>
          </section>
        </div>
      </section>
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
          <div class="controls controls--wide">
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
        <div class="controls controls--spaced-top">
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
      <div class="log-filters log-filters--spaced-bottom">
        <button class="toggle-pill active" type="button" data-log-filter="all">All actions</button>
        <button class="toggle-pill" type="button" data-log-filter="publish">Publish</button>
        <button class="toggle-pill" type="button" data-log-filter="reject">Reject</button>
        <button class="toggle-pill" type="button" data-log-filter="rollback">Rollback</button>
        <button class="toggle-pill" type="button" data-log-filter="unpublish">Unpublish</button>
        <button class="toggle-pill" type="button" data-log-filter="unstale">Unstale</button>
      </div>
      <div class="controls controls--spaced-bottom">
        <label>Filter log
          <input id="activity-filter" type="text" placeholder="publish, reject, TP53..." />
        </label>
      </div>
      <div class="activity-feed" id="activity-list"></div>
    </div>

    <pre class="log" id="action-log">No actions yet.</pre>
  </div>

  <script src="/static/iconoplasm/admin.js?v=__ICONOPLASM_ADMIN_ASSET_VERSION__" defer></script>
</body>
</html>
`
