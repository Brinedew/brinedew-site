(function () {
  const STEPS_KEY = 'gg_tut';
  const OPEN_DELAY_MS = 500;

  function getAssetVersion() {
    try {
      const current = document.currentScript;
      const src = current && (current.getAttribute('src') || current.src);
      if (src) return new URL(src, window.location.href).searchParams.get('v');
    } catch (err) {
      // ignore
    }

    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i] && scripts[i].src;
        if (!src) continue;
        if (!src.includes('/static/geneguessr/tutorial.js')) continue;
        return new URL(src, window.location.href).searchParams.get('v');
      }
    } catch (err) {
      // ignore
    }

    return null;
  }

  const ASSET_VERSION = getAssetVersion();

  function withAssetVersion(url) {
    if (!ASSET_VERSION) return url;
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}v=${encodeURIComponent(ASSET_VERSION)}`;
  }
  
  // Bitmask: 0b001 = step 1, 0b010 = step 2, 0b100 = step 3
  function getSeenMask() {
    return (localStorage.getItem(STEPS_KEY) | 0) & 0b111;
  }
  
  function markStepSeen(step) {
    const bit = 1 << (step - 1);
    const current = getSeenMask();
    localStorage.setItem(STEPS_KEY, current | bit);
  }
  
  function hasSeenStep(step) {
    const bit = 1 << (step - 1);
    return Boolean(getSeenMask() & bit);
  }
  
  const STEP_CONTENT = [
    {
      title: 'Welcome to GeneGuessr!',
      body: [
        { img: 1, text: 'This is the protein of the day. \n Can you figure out which gene made it?' },
        { img: 2, text: 'You will see spoiler bars that cover valuable hints. \n Tap the spoiler bar to reveal a hint underneath.' },
        { img: 3, text: 'Look up your favorite gene with the search bar. \n Submit it as your first guess.' }
      ]
    },
    {
      title: 'Feedback cards',
      body: [
        { img: 4, text: 'Each of your guesses will appear as a feedback card.' },
        { img: 5, text: 'The feedback bar percentage shows how close you got.' },
        { img: 6, text: 'Look for highlighted properties. \n They match your target.' }
      ]
    },
    { 
      title: 'Revealing hints',
      body: [
        { img: 7, text: 'It costs 1 hint to remove a spoiler bar. \n You get +1 hint for each guess.' },
        { img: 8, text: 'When hints are too obvious, the bar stays locked. \n Just try unlocking another one.' },
        { img: 9, text: "You get to make 10 guesses before the game ends. \n Feel free to experiment!" }
      ]
    }
  ];

  const ILLUSTRATION_FILES = {
    1: '1.png',
    2: '2.png',
    3: '3.png',
    4: '4.png',
    5: '5.png',
    6: '6.png',
    7: '7.png',
    8: '8.png',
    9: '9.png'
  };

  function resolveIllustrationPath(slot) {
    const file = ILLUSTRATION_FILES[slot];
    return file ? withAssetVersion(`/static/geneguessr/tutorial/${file}`) : null;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function buildList(items) {
    const list = document.createElement('ul');
    list.className = 'pg-tutorial-list';
    items.forEach((item) => {
      const li = document.createElement('li');
      
      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'pg-tutorial-img-wrapper';
      const imgPath = resolveIllustrationPath(item.img);
      if (imgPath) {
        const img = document.createElement('img');
        img.src = imgPath;
        img.alt = `Tutorial illustration ${item.img}`;
        img.className = 'pg-tutorial-img';
        img.loading = 'lazy';
        imgWrapper.appendChild(img);
      }
      li.appendChild(imgWrapper);
      
      const textSpan = document.createElement('span');
      textSpan.className = 'pg-tutorial-item-text';
      textSpan.textContent = item.text;
      li.appendChild(textSpan);
      
      list.appendChild(li);
    });
    return list;
  }

  function buildArrowIcon(direction) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    const polyline = document.createElementNS(SVG_NS, 'polyline');
    if (direction === 'left') {
      polyline.setAttribute('points', '14 6 8 12 14 18');
    } else {
      polyline.setAttribute('points', '10 6 16 12 10 18');
    }
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'currentColor');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);
    return svg;
  }

  // DOM elements - created once
  let overlay = null;
  let contentEl = null;
  let dotsEl = null;
  let statusEl = null;
  let backBtn = null;
  let forwardBtn = null;
  let skipBtn = null;
  let footerEl = null;
  
  // State
  let stepIndex = 0;
  let contextualMode = false;
  let onCloseCallback = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'pg-tutorial-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'pg-tutorial-backdrop';
    overlay.appendChild(backdrop);

    const card = document.createElement('div');
    card.className = 'pg-tutorial-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'pg-tutorial-title');

    skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'pg-tutorial-skip';
    skipBtn.textContent = 'Skip';
    card.appendChild(skipBtn);

    statusEl = document.createElement('div');
    statusEl.className = 'pg-tutorial-status';
    statusEl.setAttribute('aria-live', 'polite');
    card.appendChild(statusEl);

    contentEl = document.createElement('div');
    contentEl.className = 'pg-tutorial-content';
    contentEl.id = 'pg-tutorial-title';
    card.appendChild(contentEl);

    const nav = document.createElement('div');
    nav.className = 'pg-tutorial-nav';

    backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'pg-tutorial-nav-btn pg-tutorial-back';
    backBtn.appendChild(buildArrowIcon('left'));
    nav.appendChild(backBtn);

    dotsEl = document.createElement('div');
    dotsEl.className = 'pg-tutorial-dots';
    nav.appendChild(dotsEl);

    forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className = 'pg-tutorial-nav-btn pg-tutorial-forward';
    forwardBtn.appendChild(buildArrowIcon('right'));
    nav.appendChild(forwardBtn);

    card.appendChild(nav);

    // Intentionally no footer/checkbox. The tutorial already uses localStorage progress tracking.

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    
    // Event listeners
    backBtn.addEventListener('click', prev);
    forwardBtn.addEventListener('click', () => {
      if (stepIndex === STEP_CONTENT.length - 1 || contextualMode) {
        finish();
      } else {
        next();
      }
    });
    skipBtn.addEventListener('click', close);
    document.addEventListener('keydown', handleKeydown);
  }

  function handleKeydown(event) {
    if (!isOpen()) return;
    if (event.key === 'ArrowRight') {
      forwardBtn.click();
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && !contextualMode) {
      prev();
      event.preventDefault();
    } else if (event.key === 'Escape') {
      close();
      event.preventDefault();
    }
  }

  function isOpen() {
    return overlay && overlay.classList.contains('is-visible');
  }

  function lockBackground(enabled) {
    document.documentElement.classList.toggle('pg-tutorial-locked', enabled);
    document.body.classList.toggle('pg-tutorial-locked', enabled);
  }

  function open(options = {}) {
    if (!overlay) createOverlay();
    if (isOpen()) return;
    
    contextualMode = Boolean(options.contextual);
    onCloseCallback = options.onClose || null;
    const step = options.step != null ? options.step : 0;
    
    // Toggle UI elements based on mode
    statusEl.style.display = contextualMode ? 'none' : '';
    dotsEl.style.display = contextualMode ? 'none' : '';
    backBtn.style.display = contextualMode ? 'none' : '';
    if (footerEl) footerEl.style.display = contextualMode ? 'none' : '';
    skipBtn.style.display = contextualMode ? 'none' : '';
    
    renderStep(step);
    
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    lockBackground(true);
    
    if (contextualMode) {
      forwardBtn.focus();
    } else if (skipBtn) {
      skipBtn.focus();
    }
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
    lockBackground(false);
    
    if (onCloseCallback) {
      onCloseCallback();
      onCloseCallback = null;
    }
  }

  function finish() {
    // In full mode, mark all steps seen
    if (!contextualMode) {
      localStorage.setItem(STEPS_KEY, 0b111);
    }
    close();
  }

  function renderStep(index) {
    if (!overlay) createOverlay();
    stepIndex = Math.max(0, Math.min(STEP_CONTENT.length - 1, index));
    
    if (statusEl && !contextualMode) {
      statusEl.textContent = `Step ${stepIndex + 1} of ${STEP_CONTENT.length}`;
    }
    
    if (contentEl) {
      contentEl.innerHTML = '';
      const step = STEP_CONTENT[stepIndex];
      const title = document.createElement('h2');
      title.textContent = step.title;
      contentEl.appendChild(title);
      contentEl.appendChild(buildList(step.body));
    }
    
    if (!contextualMode) {
      renderDots();
    }
    updateNavState();
  }

  function renderDots() {
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    STEP_CONTENT.forEach((_, idx) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'pg-tutorial-dot' + (idx === stepIndex ? ' is-active' : '');
      dot.setAttribute('aria-label', `Go to step ${idx + 1}`);
      dot.addEventListener('click', () => renderStep(idx));
      dotsEl.appendChild(dot);
    });
  }

  function updateNavState() {
    if (backBtn && !contextualMode) {
      backBtn.disabled = stepIndex === 0;
    }
    if (forwardBtn) {
      const isLastStep = stepIndex === STEP_CONTENT.length - 1;
      if (isLastStep || contextualMode) {
        forwardBtn.textContent = 'Got it';
        forwardBtn.classList.add('is-play');
      } else {
        forwardBtn.innerHTML = '';
        forwardBtn.appendChild(buildArrowIcon('right'));
        forwardBtn.classList.remove('is-play');
      }
    }
  }

  function next() {
    if (stepIndex >= STEP_CONTENT.length - 1) return;
    renderStep(stepIndex + 1);
  }

  function prev() {
    if (stepIndex <= 0) return;
    renderStep(stepIndex - 1);
  }

  // Public API
  window.GeneGuessrTutorial = {
    isOpen,
    
    // Full tutorial (from ? button)
    openFull() {
      open({ contextual: false, step: 0 });
    },
    
    // Contextual single-step tutorial
    maybeShowStep(step) {
      if (hasSeenStep(step)) return;
      if (isOpen()) return;
      
      open({
        step: step - 1, // convert 1-indexed to 0-indexed
        contextual: true,
        onClose: () => markStepSeen(step)
      });
    },
    
    // Boot: show step 1 if not seen
    boot() {
      if (!overlay) createOverlay();
      if (!hasSeenStep(1)) {
        setTimeout(() => {
          window.GeneGuessrTutorial.maybeShowStep(1);
        }, OPEN_DELAY_MS);
      }
    },
    
    // Legacy API compatibility
    open() { this.openFull(); },
    close() { close(); },
    next() { next(); },
    prev() { prev(); },
    goToStep(index) { renderStep(index); },
    finish() { finish(); }
  };

  // Auto-boot on DOM ready
  function autoBoot() {
    if (document.getElementById('geneguessr-root')) {
      window.GeneGuessrTutorial.boot();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot);
  } else {
    autoBoot();
  }
})();
