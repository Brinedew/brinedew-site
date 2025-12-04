
(function () {
  const TUTORIAL_VERSION = '1.0';
  const STORAGE_KEY = 'geneguessr_tutorial';
  const OPEN_DELAY_MS = 500;
  
  // Session-level flag to prevent re-opening after user dismissal
  let closedThisSession = false;
  
  const STEP_CONTENT = [
    {
      title: 'Step 1 - Welcome to GeneGuessr!',
      body: [
        { img: 1, text: 'This is a protein. Can you figure out which gene made it?' },
        { img: 2, text: 'All hints are hidden at the start, but they will reveal as you play' },
        { img: 3, text: 'Take a guess and type it into the search bar' }
      ]
    },
    {
      title: 'Step 2 - Feedback cards',
      body: [
        { img: 4, text: 'Each of your guesses will appear as a feedback card' },
        { img: 5, text: 'The feedback bar shows how close you got' },
        { img: 6, text: 'Look for highlighted properties - they match your target' }
      ]
    },
    {
      title: 'Step 3 - Hints',
      body: [
        { img: 7, text: 'Tap a hint bar to reveal info' },
        { img: 8, text: 'Each guess gives you +1 hint' },
        { img: 9, text: "You've got 10 total guesses - feel free to experiment" }
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
    return file ? `/static/geneguessr/tutorial/${file}` : null;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('GeneGuessrTutorial: unable to read storage', err);
      return {};
    }
  }

  function writeState(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('GeneGuessrTutorial: unable to persist storage', err);
    }
  }

  function markSeen(options = {}) {
    const state = readState();
    state.tutorialSeen = true;
    state.tutorialVersion = TUTORIAL_VERSION;
    state.tutorialSeenAt = Date.now();
    state.skipFuture = Boolean(options.skipFuture);
    writeState(state);
  }

  function shouldShowTutorial() {
    const state = readState();
    if (state.skipFuture) {
      return false;
    }
    if (!state.tutorialSeen) {
      return true;
    }
    return state.tutorialVersion !== TUTORIAL_VERSION;
  }

  function buildList(items) {
    const list = document.createElement('ul');
    list.className = 'pg-tutorial-list';
    items.forEach((item) => {
      const li = document.createElement('li');
      
      // Add placeholder image above the text
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
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'pg-tutorial-img-fallback';
        fallback.textContent = 'Illustration unavailable';
        imgWrapper.appendChild(fallback);
      }
      li.appendChild(imgWrapper);
      
      // Add the text
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

  function createOverlay() {
    const overlay = document.createElement('div');
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

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'pg-tutorial-skip';
    skip.textContent = 'Skip';
    card.appendChild(skip);

    const status = document.createElement('div');
    status.className = 'pg-tutorial-status';
    status.setAttribute('aria-live', 'polite');
    card.appendChild(status);

    const content = document.createElement('div');
    content.className = 'pg-tutorial-content';
    content.id = 'pg-tutorial-title';
    card.appendChild(content);

    const nav = document.createElement('div');
    nav.className = 'pg-tutorial-nav';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'pg-tutorial-nav-btn pg-tutorial-back';
    backBtn.appendChild(buildArrowIcon('left'));
    nav.appendChild(backBtn);

    const dots = document.createElement('div');
    dots.className = 'pg-tutorial-dots';
    nav.appendChild(dots);

    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className = 'pg-tutorial-nav-btn pg-tutorial-forward';
    forwardBtn.appendChild(buildArrowIcon('right'));
    nav.appendChild(forwardBtn);

    card.appendChild(nav);

    const footer = document.createElement('div');
    footer.className = 'pg-tutorial-footer';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'pg-tutorial-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'pg-tutorial-hide';
    checkboxLabel.appendChild(checkbox);
    const checkboxText = document.createElement('span');
    checkboxText.textContent = 'Do not show again';
    checkboxLabel.appendChild(checkboxText);
    footer.appendChild(checkboxLabel);

    card.appendChild(footer);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return {
      overlay,
      content,
      dots,
      status,
      backBtn,
      forwardBtn,
      skipBtn: skip,
      hideCheckbox: checkbox
    };
  }

  const Tutorial = {
    overlay: null,
    contentEl: null,
    dotsEl: null,
    statusEl: null,
    backBtn: null,
    forwardBtn: null,
    skipBtn: null,
    hideCheckbox: null,
    stepIndex: 0,
    init() {
      if (this.overlay) {
        return;
      }
      const elements = createOverlay();
      this.overlay = elements.overlay;
      this.contentEl = elements.content;
      this.dotsEl = elements.dots;
      this.statusEl = elements.status;
      this.backBtn = elements.backBtn;
      this.forwardBtn = elements.forwardBtn;
      this.skipBtn = elements.skipBtn;
      this.hideCheckbox = elements.hideCheckbox;
      this.backBtn.addEventListener('click', () => this.prev());
      this.forwardBtn.addEventListener('click', () => {
        if (this.stepIndex === STEP_CONTENT.length - 1) {
          this.finish();
        } else {
          this.next();
        }
      });
      this.skipBtn.addEventListener('click', () => this.close());
      document.addEventListener('keydown', (event) => this.handleKeydown(event));
      this.renderStep(0);
    },
    handleKeydown(event) {
      if (!this.isOpen()) {
        return;
      }
      if (event.key === 'ArrowRight') {
        this.forwardBtn.click();
        event.preventDefault();
      } else if (event.key === 'ArrowLeft') {
        this.prev();
        event.preventDefault();
      } else if (event.key === 'Escape') {
        this.close();
        event.preventDefault();
      }
    },
    isOpen() {
      return this.overlay && this.overlay.classList.contains('is-visible');
    },
    lockBackground(enabled) {
      document.documentElement.classList.toggle('pg-tutorial-locked', enabled);
      document.body.classList.toggle('pg-tutorial-locked', enabled);
    },
    open() {
      if (!this.overlay) {
        this.init();
      }
      this.overlay.classList.add('is-visible');
      this.overlay.setAttribute('aria-hidden', 'false');
      this.lockBackground(true);
      const skip = this.overlay.querySelector('.pg-tutorial-skip');
      if (skip) {
        skip.focus();
      }
    },
    close(markComplete = false) {
      if (!this.overlay) {
        return;
      }
      this.overlay.classList.remove('is-visible');
      this.overlay.setAttribute('aria-hidden', 'true');
      this.lockBackground(false);
      const skipFuture = Boolean(this.hideCheckbox && this.hideCheckbox.checked);
      if (markComplete || skipFuture) {
        markSeen({ skipFuture });
      }
      // Mark as closed this session to prevent re-opening on theme toggle
      closedThisSession = true;
    },
    finish() {
      this.close(true);
    },
    renderStep(index) {
      if (!this.overlay) {
        this.init();
      }
      this.stepIndex = Math.max(0, Math.min(STEP_CONTENT.length - 1, index));
      if (this.statusEl) {
        this.statusEl.textContent = `Step ${this.stepIndex + 1} of ${STEP_CONTENT.length}`;
      }
      if (this.contentEl) {
        this.contentEl.innerHTML = '';
        const step = STEP_CONTENT[this.stepIndex];
        const title = document.createElement('h2');
        title.textContent = step.title;
        this.contentEl.appendChild(title);
        this.contentEl.appendChild(buildList(step.body));
      }
      this.renderDots();
      this.updateNavState();
    },
    renderDots() {
      if (!this.dotsEl) {
        return;
      }
      this.dotsEl.innerHTML = '';
      STEP_CONTENT.forEach((_, idx) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'pg-tutorial-dot' + (idx === this.stepIndex ? ' is-active' : '');
        dot.setAttribute('aria-label', `Go to step ${idx + 1}`);
        dot.addEventListener('click', () => this.renderStep(idx));
        this.dotsEl.appendChild(dot);
      });
    },
    updateNavState() {
      if (this.backBtn) {
        this.backBtn.disabled = this.stepIndex === 0;
      }
      if (this.forwardBtn) {
        if (this.stepIndex === STEP_CONTENT.length - 1) {
          this.forwardBtn.textContent = 'Play';
          this.forwardBtn.classList.add('is-play');
        } else {
          this.forwardBtn.innerHTML = '';
          this.forwardBtn.appendChild(buildArrowIcon('right'));
          this.forwardBtn.classList.remove('is-play');
        }
      }
    },
    next() {
      if (this.stepIndex >= STEP_CONTENT.length - 1) {
        return;
      }
      this.renderStep(this.stepIndex + 1);
    },
    prev() {
      if (this.stepIndex <= 0) {
        return;
      }
      this.renderStep(this.stepIndex - 1);
    }
  };

  let booted = false;

  window.GeneGuessrTutorial = {
    boot() {
      Tutorial.init();
      if (booted) {
        return;
      }
      booted = true;
      // Only show tutorial if not already closed this session and should show
      if (!closedThisSession && shouldShowTutorial()) {
        setTimeout(() => Tutorial.open(), OPEN_DELAY_MS);
      }
    },
    open() {
      Tutorial.renderStep(0);
      Tutorial.open();
    },
    close() {
      Tutorial.close();
    },
    next() {
      Tutorial.next();
    },
    prev() {
      Tutorial.prev();
    },
    goToStep(index) {
      Tutorial.renderStep(index);
    },
    finish() {
      Tutorial.finish();
    }
  };

  // Auto-boot: initialize tutorial independently as soon as DOM is ready
  // This ensures the tutorial can appear even while the main app is still loading
  function autoBoot() {
    if (document.getElementById('geneguessr-root')) {
      window.GeneGuessrTutorial.boot();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot);
  } else {
    // DOM already loaded
    autoBoot();
  }
})();
