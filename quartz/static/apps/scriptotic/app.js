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
      el('input', { id: 'scr-url', className: 'scr-input', placeholder: 'https://www.youtube.com/watch?v=…', value: 'https://www.youtube.com/watch?v=Bbwp4PbWYzw' })
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
        STATE.serverOk = (j.status === 'ready');
        STATE.serverStatus = j.status; // Track full server state
        
        // Display server status with appropriate styling
        if (j.status === 'starting') {
          const eta = j.eta ? ` (≈${j.eta}s)` : '';
          ui.server.textContent = `Server: starting${eta}`;
          ui.server.style.opacity = '1';
          ui.server.className = 'scr-meta starting';
        } else if (j.status === 'ready') {
          ui.server.textContent = 'Server: ready';
          ui.server.style.opacity = '1';
          ui.server.className = 'scr-meta ready';
        } else {
          ui.server.textContent = `Server: ${j.status}`;
          ui.server.style.opacity = '1';
          ui.server.className = 'scr-meta';
        }
        
        ui.server.title = j.message || '';
      } catch (e) {
        STATE.serverOk = false;
        STATE.serverStatus = 'offline';
        ui.server.textContent = 'Server: offline';
        ui.server.style.opacity = '.7';
        ui.server.className = 'scr-meta offline';
      }
    }
    pollServerOnce();
    const serverTimer = setInterval(pollServerOnce, pollServerMs);

    function setStatus(txt, cls='warn') { ui.status.textContent = txt; ui.status.className = `scr-status ${cls}`; }
    function setProgress(p) { ui.bar.style.width = `${Math.max(0, Math.min(100, p))}%`; }

    // job polling
    let jobTimer = null;
    let startupRetryTimer = null;
    
    async function startJob() {
      await pollServerOnce(); // Get current server state
      const url = ui.url.value.trim();
      if (!url) { setStatus('Enter a YouTube URL.', 'warn'); return; }
      
      abortAll(); // cancel prior
      setStatus('Submitting…', 'warn'); setProgress(0);
      ui.start.disabled = true; ui.cancel.disabled = false; ui.results.textContent = '';

      try {
        const r = await api(origin, '/api/transcribe', { method: 'POST', body: JSON.stringify({ url }) });
        
        // Handle 202 response - backend is starting up
        if (r.status === 202) {
          const j = await r.json();
          setStatus(j.message || 'Starting service...', 'warn');
          
          // Start polling for when the service becomes ready
          const retryDelay = (j.retryAfter || 5) * 1000;
          startupRetryTimer = setTimeout(async () => {
            // Check if service is ready, then retry
            await pollServerOnce();
            if (STATE.serverStatus === 'ready') {
              setStatus('Service ready, submitting job...', 'warn');
              startJob(); // Retry the job submission
            } else if (STATE.serverStatus === 'starting') {
              startJob(); // Keep retrying while starting
            } else {
              setStatus('Service startup failed', 'err');
              ui.start.disabled = false; ui.cancel.disabled = true;
            }
          }, retryDelay);
          return;
        }
        
        // Handle successful job submission (200 response)
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        STATE.jobId = j.job_id || j.id || j.jobId;
        setStatus(`Job submitted: ${STATE.jobId}`, 'ok');

        // Start polling for job progress
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
      if (startupRetryTimer) clearTimeout(startupRetryTimer);
      ui.start.disabled = false; ui.cancel.disabled = true;
      setStatus('Canceled.', 'warn'); setProgress(0);
    }

    ui.start.addEventListener('click', startJob);
    ui.cancel.addEventListener('click', cancelJob);

    // cleanup on bfcache unloads
    window.addEventListener('pagehide', () => { 
      clearInterval(serverTimer); 
      if (jobTimer) clearInterval(jobTimer); 
      if (startupRetryTimer) clearTimeout(startupRetryTimer);
      abortAll(); 
    });
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