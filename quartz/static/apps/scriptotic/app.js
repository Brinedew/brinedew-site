(function () {
  const STATE = { inited: false, jobId: null, serverOk: false, controllers: [] };

  function $(sel, root=document) { return root.querySelector(sel); }
  function el(tag, props={}, ...kids) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const k of kids) n.append(k);
    return n;
  }
  function abortAll() { STATE.controllers.forEach(c => c.abort()); STATE.controllers = []; }

  function api(origin, path, opts={}) {
    const c = new AbortController(); STATE.controllers.push(c);
    return fetch(origin + path, { ...opts, signal: c.signal, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }});
  }

  function init(root) {
    if (!root || root.__scriptoticInited) return;
    root.__scriptoticInited = true;
    STATE.inited = true;

    const origin = root.dataset.apiOrigin || location.origin.replace(/\/$/, '');
    const pollServerMs = +(root.dataset.pollServerMs || 10000);
    const pollJobMs = +(root.dataset.pollJobMs || 3000);

    // UI
    const urlRow = el('div', { className: 'scr-row' },
      el('label', { className: 'scr-label', htmlFor: 'scr-url', innerText: 'YouTube URL' }),
      el('input', { id: 'scr-url', className: 'scr-input', placeholder: 'https://www.youtube.com/watch?v=…' })
    );

    const actions = el('div', { className: 'scr-actions' },
      el('button', { className: 'scr-btn', id: 'scr-start', innerText: 'Transcribe' }),
      el('button', { className: 'scr-btn', id: 'scr-cancel', innerText: 'Cancel', disabled: true }),
      el('span', { className: 'scr-meta', id: 'scr-server' }, 'Server: checking…')
    );

    const status = el('div', { className: 'scr-status warn', id: 'scr-status' }, 'Idle');
    const progress = el('div', { className: 'scr-progress' }, el('div'));
    const results = el('div', { className: 'scr-results', id: 'scr-results' });
    root.replaceChildren(urlRow, actions, status, progress, results);

    const ui = {
      url: $('#scr-url', root),
      start: $('#scr-start', root),
      cancel: $('#scr-cancel', root),
      server: $('#scr-server', root),
      status: $('#scr-status', root),
      bar: $('.scr-progress > div', root),
      results: $('#scr-results', root),
    };

    // server poller
    async function pollServerOnce() {
      try {
        const r = await api(origin, '/api/server-status', { cache: 'no-store' });
        const j = await r.json();
        STATE.serverOk = true;
        ui.server.textContent = `Server: ${j.status}`;
        ui.server.style.opacity = '1';
        ui.server.title = j.message || '';
        ui.server.className = 'scr-meta';
      } catch (e) {
        STATE.serverOk = false;
        ui.server.textContent = 'Server: offline';
        ui.server.style.opacity = '.7';
        ui.server.className = 'scr-meta';
      }
    }
    pollServerOnce();
    const serverTimer = setInterval(pollServerOnce, pollServerMs);

    function setStatus(txt, cls='warn') { ui.status.textContent = txt; ui.status.className = `scr-status ${cls}`; }
    function setProgress(p) { ui.bar.style.width = `${Math.max(0, Math.min(100, p))}%`; }

    // job polling
    let jobTimer = null;
    async function startJob() {
      if (!STATE.serverOk) await pollServerOnce();
      const url = ui.url.value.trim();
      if (!url) { setStatus('Enter a YouTube URL.', 'warn'); return; }
      abortAll(); // cancel prior
      setStatus('Submitting…', 'warn'); setProgress(0);
      ui.start.disabled = true; ui.cancel.disabled = false; ui.results.textContent = '';

      try {
        const r = await api(origin, '/api/transcribe', { method: 'POST', body: JSON.stringify({ url }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        STATE.jobId = j.job_id || j.id || j.jobId;
        setStatus(`Job submitted: ${STATE.jobId}`, 'ok');

        // poll
        jobTimer = setInterval(async () => {
          try {
            const s = await api(origin, `/api/job-status/${STATE.jobId}`, { cache: 'no-store' });
            const sj = await s.json();
            setStatus(`Status: ${sj.status}`, sj.status === 'error' ? 'err' : sj.status === 'done' ? 'ok' : 'warn');
            if (typeof sj.progress === 'number') setProgress(Math.round(sj.progress));
            if (sj.status === 'done' && sj.download_url) {
              clearInterval(jobTimer); ui.cancel.disabled = true; ui.start.disabled = false; setProgress(100);
              const a = el('a', { href: sj.download_url, innerText: 'Download transcript', className: 'scr-btn' });
              ui.results.replaceChildren(a);
            }
            if (sj.status === 'error') {
              clearInterval(jobTimer); ui.cancel.disabled = true; ui.start.disabled = false;
              ui.results.textContent = sj.message || 'Job failed.';
            }
          } catch {
            // transient failure; keep polling
          }
        }, pollJobMs);
      } catch (e) {
        setStatus('Submit failed. Check server and URL.', 'err');
        ui.start.disabled = false; ui.cancel.disabled = true;
      }
    }
    function cancelJob() {
      abortAll();
      if (jobTimer) clearInterval(jobTimer);
      ui.start.disabled = false; ui.cancel.disabled = true;
      setStatus('Canceled.', 'warn'); setProgress(0);
    }

    ui.start.addEventListener('click', startJob);
    ui.cancel.addEventListener('click', cancelJob);

    // cleanup on bfcache unloads
    window.addEventListener('pagehide', () => { clearInterval(serverTimer); if (jobTimer) clearInterval(jobTimer); abortAll(); });
  }

  // SPA-safe initializer: run now, and whenever the route swaps DOM
  function tryInit() {
    const host = document.getElementById('scriptotic-root');
    if (host) init(host);
  }
  tryInit();

  // Observe for SPA nav replacements
  const mo = new MutationObserver(() => tryInit());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();