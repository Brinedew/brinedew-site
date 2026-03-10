export const ICONOPLASM_ARTIST_STYLES_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iconoplasm Artist Styles</title>
  <style>
    :root {
      --bg: #0d1420;
      --surface: rgba(15, 25, 41, 0.92);
      --surface-2: #122033;
      --line: #28415d;
      --text: #ebf2fb;
      --muted: #a7b9d1;
      --accent: #6ad4b6;
      --accent-2: #8fb8ff;
      --danger: #f07070;
      --ok: #8fe3a2;
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      background:
        radial-gradient(circle at top left, rgba(111, 176, 255, 0.18), transparent 36%),
        radial-gradient(circle at top right, rgba(106, 212, 182, 0.16), transparent 28%),
        linear-gradient(180deg, #0b1119, #111a27 45%, #0d1420);
      min-height: 100vh;
    }

    .wrap {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 40px 0 56px;
    }

    .hero, .panel {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }

    .hero {
      padding: 28px;
      margin-bottom: 18px;
      position: relative;
      overflow: hidden;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto -80px -100px auto;
      width: 260px;
      height: 260px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(143, 184, 255, 0.28), transparent 70%);
      pointer-events: none;
    }

    h1, h2, p { margin: 0; }
    h1 {
      font-size: clamp(2rem, 5vw, 3.5rem);
      line-height: 0.98;
      letter-spacing: -0.04em;
      max-width: 10ch;
    }

    .lede {
      margin-top: 12px;
      color: var(--muted);
      font-size: 1.02rem;
      max-width: 62ch;
      line-height: 1.5;
    }

    .panel {
      padding: 18px;
    }

    .controls {
      display: grid;
      grid-template-columns: minmax(220px, 1.8fr) repeat(3, minmax(140px, 1fr));
      gap: 12px;
      align-items: end;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    input, button {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
    }

    button {
      cursor: pointer;
      background: linear-gradient(135deg, rgba(106, 212, 182, 0.2), rgba(143, 184, 255, 0.18));
    }

    button:hover { border-color: #456c96; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }

    .meta {
      margin-top: 14px;
      color: var(--muted);
      min-height: 1.4em;
    }

    .table-wrap {
      margin-top: 16px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(7, 13, 22, 0.66);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 860px;
    }

    th, td {
      padding: 12px;
      border-bottom: 1px solid rgba(40, 65, 93, 0.7);
      text-align: left;
      vertical-align: top;
      font-size: 0.95rem;
    }

    th {
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      background: rgba(17, 29, 46, 0.96);
      position: sticky;
      top: 0;
    }

    .tag {
      display: inline-flex;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid rgba(143, 184, 255, 0.32);
      background: rgba(143, 184, 255, 0.1);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.88rem;
    }

    .pill {
      display: inline-flex;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      font-size: 0.78rem;
    }

    .pill-ok { color: var(--ok); }
    .pill-danger { color: #ffb0b0; border-color: rgba(240, 112, 112, 0.35); }

    .counts {
      color: var(--muted);
      line-height: 1.5;
    }

    .row-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-danger {
      background: linear-gradient(135deg, rgba(240, 112, 112, 0.18), rgba(120, 20, 20, 0.2));
    }

    .log {
      margin-top: 18px;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(8, 13, 21, 0.78);
      color: #d8e4f4;
      min-height: 120px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 0.88rem;
    }

    @media (max-width: 860px) {
      .wrap { width: min(100% - 20px, 1180px); padding-top: 22px; }
      .hero, .panel { border-radius: 14px; }
      .controls { grid-template-columns: 1fr; }
      table { min-width: 0; }
      thead { display: none; }
      tbody, tr, td { display: block; width: 100%; }
      tr { border-bottom: 1px solid rgba(40, 65, 93, 0.7); }
      td { border-bottom: 0; padding-top: 8px; padding-bottom: 8px; }
      td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 0.7rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Artist style lookup</h1>
      <p class="lede">
        Search the Iconoplasm gallery by artist tag or artist name, see how many images use that style,
        and, if you are authorized, remove and blacklist that style for future syncs.
      </p>
    </section>

    <section class="panel">
      <div class="controls">
        <label>Artist tag or name
          <input id="query" type="text" placeholder="@kolshica or Kolshica" />
        </label>
        <label>Limit
          <input id="limit" type="number" min="1" max="100" value="40" />
        </label>
        <label>Admin token
          <input id="admin-token" type="password" placeholder="Only needed if no session cookie" />
        </label>
        <label>Removal reason
          <input id="reason" type="text" placeholder="Reason saved to audit log" />
        </label>
      </div>
      <div class="controls" style="grid-template-columns: repeat(2, minmax(160px, 220px)); margin-top: 12px;">
        <button id="search-btn">Search styles</button>
        <button id="refresh-btn">Refresh top styles</button>
      </div>
      <div class="meta" id="meta">Loading styles...</div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artist</th>
              <th>Counts</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="results"></tbody>
        </table>
      </div>

      <pre class="log" id="log">No actions yet.</pre>
    </section>
  </div>

  <script>
    (function () {
      var state = { rows: [] };
      var els = {
        query: document.getElementById('query'),
        limit: document.getElementById('limit'),
        token: document.getElementById('admin-token'),
        reason: document.getElementById('reason'),
        search: document.getElementById('search-btn'),
        refresh: document.getElementById('refresh-btn'),
        meta: document.getElementById('meta'),
        results: document.getElementById('results'),
        log: document.getElementById('log')
      };

      function esc(v) {
        return String(v == null ? '' : v)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function authHeaders() {
        var headers = {};
        var token = String(els.token.value || '').trim();
        if (token) headers['X-Iconoplasm-Admin-Token'] = token;
        return headers;
      }

      async function fetchJson(url, options) {
        var opts = options || {};
        var headers = Object.assign({}, opts.headers || {}, authHeaders());
        var resp = await fetch(url, Object.assign({}, opts, { headers: headers, credentials: 'include' }));
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

      function setLog(value) {
        els.log.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      }

      function countsText(row) {
        return [
          'total ' + Number(row.total_count || 0),
          'visible ' + Number(row.visible_count || 0),
          'live ' + Number(row.live_count || 0),
          'draft ' + Number(row.draft_count || 0),
          'rejected ' + Number(row.rejected_count || 0)
        ].join(' · ');
      }

      function statusCell(row) {
        var html = row.blacklisted
          ? '<span class="pill pill-danger">blacklisted</span>'
          : '<span class="pill pill-ok">active</span>';
        if (row.blacklist_reason) {
          html += '<div class="counts" style="margin-top:8px">' + esc(row.blacklist_reason) + '</div>';
        }
        if (row.blacklist_updated_at) {
          html += '<div class="counts">updated ' + esc(row.blacklist_updated_at) + '</div>';
        }
        return html;
      }

      function actionCell(row) {
        return [
          '<div class="row-actions">',
          '<button class="btn-danger" data-action="remove" data-tag="' + esc(row.artist_tag || '') + '" data-name="' + esc(row.artist_name || '') + '"' + (row.blacklisted ? ' disabled' : '') + '>Remove artist style</button>',
          '</div>'
        ].join('');
      }

      function render() {
        var rows = Array.isArray(state.rows) ? state.rows : [];
        if (!rows.length) {
          els.results.innerHTML = '<tr><td colspan="4">No matching artist styles found.</td></tr>';
          return;
        }
        els.results.innerHTML = rows.map(function (row) {
          return [
            '<tr>',
            '<td data-label="Artist">',
            '<div class="tag">' + esc(row.artist_tag || '-') + '</div>',
            row.artist_name ? '<div style="margin-top:8px">' + esc(row.artist_name) + '</div>' : '',
            '</td>',
            '<td class="counts" data-label="Counts">' + esc(countsText(row)) + '</td>',
            '<td data-label="Status">' + statusCell(row) + '</td>',
            '<td data-label="Actions">' + actionCell(row) + '</td>',
            '</tr>'
          ].join('');
        }).join('');
      }

      async function loadRows(forceTop) {
        var query = forceTop ? '' : String(els.query.value || '').trim();
        var limit = Math.max(1, Math.min(100, Number.parseInt(els.limit.value || '40', 10) || 40));
        els.meta.textContent = 'Loading...';
        var data = await fetchJson('/api/iconoplasm/artist-styles/search?q=' + encodeURIComponent(query) + '&limit=' + limit);
        state.rows = Array.isArray(data.rows) ? data.rows : [];
        els.meta.textContent = state.rows.length
          ? ('Showing ' + state.rows.length + ' style' + (state.rows.length === 1 ? '' : 's'))
          : 'No matching styles.';
        render();
      }

      async function removeStyle(tag, name) {
        var reason = String(els.reason.value || '').trim();
        var confirmText = 'Remove and blacklist ' + tag + ' from Iconoplasm?';
        if (!window.confirm(confirmText)) return;
        var body = { artist_tag: tag, artist_name: name || '' };
        if (reason) body.reason = reason;
        var result = await fetchJson('/api/iconoplasm/admin/artist-styles/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        setLog(result);
        await loadRows(false);
      }

      els.search.addEventListener('click', function () {
        loadRows(false).catch(function (err) {
          setLog({ error: String(err.message || err), details: err.response || null });
          els.meta.textContent = 'Search failed.';
        });
      });

      els.refresh.addEventListener('click', function () {
        loadRows(true).catch(function (err) {
          setLog({ error: String(err.message || err), details: err.response || null });
          els.meta.textContent = 'Refresh failed.';
        });
      });

      els.query.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        els.search.click();
      });

      els.results.addEventListener('click', function (ev) {
        var btn = ev.target.closest('button[data-action="remove"]');
        if (!btn) return;
        btn.disabled = true;
        removeStyle(String(btn.getAttribute('data-tag') || ''), String(btn.getAttribute('data-name') || ''))
          .catch(function (err) {
            setLog({ error: String(err.message || err), details: err.response || null });
          })
          .finally(function () {
            btn.disabled = false;
          });
      });

      loadRows(true).catch(function (err) {
        setLog({ error: String(err.message || err), details: err.response || null });
        els.meta.textContent = 'Initial load failed.';
      });
    })();
  </script>
</body>
</html>
`
