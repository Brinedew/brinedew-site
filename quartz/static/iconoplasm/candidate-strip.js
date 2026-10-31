// B-1095: a gene's other candidates sit in one sideways strip, so the page is
// the same height at 3 candidates or 300 and the comments stay a screen away
// (TP53's two-column grid was 16,035 px tall with 71 candidates). Embla
// Carousel, the engine behind shadcn/ui's Carousel, moves the track; its wheel
// plugin turns sideways trackpad swipes into strip movement.
//
// Keys, with focus anywhere in the strip: Left and Right move one frame and
// bring it to the middle, Up approves and Down rejects the frame in focus, Home and End jump to the
// ends, Enter opens the frame in the viewer (the frame is a button).
//
// Until Embla loads, the strip is a plain native scroller (CSS), so every
// frame stays reachable even if the module never arrives.
//
// B-1101: the strip is the Overview tab's slice of the candidates. In the
// Candidates tab Embla stands down and the same frames lay out as a full grid;
// back in Overview it picks up at the frame the reader left.

var emblaModulePromise = null

function loadEmbla() {
  if (emblaModulePromise) return emblaModulePromise
  emblaModulePromise = import("./vendor/embla-carousel.esm.js?v=65f261a0a6db41ee").catch(
    function (error) {
      emblaModulePromise = null
      throw error
    },
  )
  return emblaModulePromise
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
}

// A frame is any child of the track: candidate cards on a gene page, the
// example site windows on the home page.
function frames(track) {
  return Array.prototype.slice.call(track.children)
}

function frameOf(track, node) {
  while (node && node.parentElement !== track) node = node.parentElement
  return node || null
}

function isTypingTarget(node) {
  if (!node || !node.closest) return false
  return !!node.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], form",
  )
}

// A tile's More menu is a popover: it floats in the top layer but stays inside
// the frame in the DOM, so its drags and keys would otherwise reach the strip.
function isMenuTarget(node) {
  return !!(node && node.closest && node.closest("[popover]"))
}

// "Soft rise" (Takayu motion reference): blur and transparency resolve together
// over 900 ms, easeOutSine, the way a print comes up in the developer tray.
function developImages(track) {
  var images = track.querySelectorAll(".icono-candidate-media img")
  for (var i = 0; i < images.length; i += 1) {
    var img = images[i]
    if (img.hasAttribute("data-icono-developing")) continue
    img.setAttribute("data-icono-developing", "")
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add("is-developed")
      continue
    }
    var done = function () {
      this.classList.add("is-developed")
    }
    img.addEventListener("load", done, { once: true })
    img.addEventListener("error", done, { once: true })
  }
}

function installStrip(section) {
  var viewport = section.querySelector("[data-icono-strip-viewport]")
  var track = viewport && viewport.firstElementChild
  if (!track) return
  var state = { api: null, loading: false, startSnap: 0, refresh: null }
  section._iconoCandidateStrip = state
  var nav = section.querySelector("[data-icono-strip-nav]")
  var prev = section.querySelector("[data-icono-strip-prev]")
  var next = section.querySelector("[data-icono-strip-next]")
  var progress = section.querySelector("[data-icono-strip-progress]")

  // The snap that shows this frame. With align "center" every frame has its
  // own snap except near the ends, where containScroll folds the frames that
  // can't be centred into the first or last snap.
  function snapOf(api, index) {
    var registry = api.internalEngine().slideRegistry
    for (var snap = 0; snap < registry.length; snap += 1) {
      if (registry[snap].indexOf(index) >= 0) return snap
    }
    return 0
  }

  // The focused frame always moves to the middle of the strip, so the reader's
  // eye stays put while the frames slide under it (owner, 2026-10-17: the
  // selected picture drifted to the edge, then the strip jumped a page).
  function focusFrame(index) {
    var list = frames(track)
    if (!list.length) return
    var clamped = Math.max(0, Math.min(list.length - 1, index))
    var target =
      list[clamped].querySelector(".icono-candidate-media-button") ||
      (list[clamped].matches("a[href], button") ? list[clamped] : null)
    if (!target) return
    target.focus({ preventScroll: true })
    var api = state.api
    if (!api) {
      list[clamped].scrollIntoView({ block: "nearest", inline: "center" })
      return
    }
    api.scrollTo(snapOf(api, clamped))
  }

  section.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (isTypingTarget(event.target) || isMenuTarget(event.target)) return
    var frame = frameOf(track, event.target)
    var list = frames(track)
    var index = frame ? list.indexOf(frame) : -1
    var key = event.key
    if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault()
      focusFrame(index < 0 ? 0 : index + (key === "ArrowRight" ? 1 : -1))
    } else if (key === "Home" || key === "End") {
      event.preventDefault()
      focusFrame(key === "Home" ? 0 : list.length - 1)
    } else if ((key === "ArrowUp" || key === "ArrowDown") && frame) {
      var vote = frame.querySelector(
        key === "ArrowUp" ? "[data-icono-vote-up]" : "[data-icono-vote-down]",
      )
      if (!vote || vote.disabled) return
      event.preventDefault()
      vote.click()
    }
  })

  section.addEventListener("click", function (event) {
    var vote = event.target.closest && event.target.closest(".icono-vote-btn")
    if (!vote || !section.contains(vote)) return
    vote.classList.remove("is-pressed")
    void vote.offsetWidth
    vote.classList.add("is-pressed")
  })

  // Prev and Next turn a page: the frame nearest the middle moves by as
  // many frames as the strip fits, so a reader with 71 frames isn't
  // clicking 71 times, and a drag that rested between frames still turns
  // a whole page.
  function page(direction) {
    var api = state.api
    if (!api) return
    var list = frames(track)
    if (!list.length) return
    var box = viewport.getBoundingClientRect()
    var middle = box.left + box.width / 2
    var nearest = 0
    var best = Infinity
    for (var i = 0; i < list.length; i += 1) {
      var rect = list[i].getBoundingClientRect()
      var distance = Math.abs(rect.left + rect.width / 2 - middle)
      if (distance < best) {
        best = distance
        nearest = i
      }
    }
    var step =
      list.length > 1
        ? list[1].getBoundingClientRect().left - list[0].getBoundingClientRect().left
        : box.width
    var perPage = Math.max(1, Math.floor(box.width / Math.max(1, step)))
    var to = Math.max(0, Math.min(list.length - 1, nearest + direction * perPage))
    api.scrollTo(snapOf(api, to))
  }
  if (prev)
    prev.addEventListener("click", function () {
      page(-1)
    })
  if (next)
    next.addEventListener("click", function () {
      page(1)
    })

  developImages(track)
  section.classList.add("is-strip-developing")

  function mount() {
    if (state.api || state.loading) return
    state.loading = true
    loadEmbla()
      .then(function (module) {
        state.loading = false
        if (!section.isConnected || !wantsCarousel(section)) return
        create(module)
      })
      .catch(function () {
        state.loading = false
        // The native scroller stays; nothing is lost but the arrows.
        if (nav) nav.hidden = true
      })
  }

  function unmount() {
    var api = state.api
    if (!api) return
    state.startSnap = api.selectedScrollSnap()
    state.api = null
    api.destroy()
    section.classList.remove("is-strip-ready")
    if (progress) progress.removeAttribute("style")
  }

  state.refresh = function () {
    if (wantsCarousel(section)) mount()
    else unmount()
  }
  state.refresh()

  function create(module) {
    var reduced = prefersReducedMotion()
    var api = module.EmblaCarousel(
      viewport,
      {
        // A drag rests where the reader lets go, with momentum, instead of
        // springing to the nearest page of frames (owner, 2026-10-17: "it
        // never really stays in the same place you dragged").
        dragFree: true,
        align: "center",
        containScroll: "trimSnaps",
        slidesToScroll: 1,
        // A frame counts as shown only when (almost) all of it is: the peeking
        // one is next, and the counter reads only whole frames.
        inViewThreshold: 0.95,
        duration: reduced ? 10 : 30,
        startIndex: state.startSnap,
        // Frames hold their own buttons and popovers; a drag that starts on a
        // text field or in a tile's menu must stay a text selection.
        watchDrag: function (_api, event) {
          return !isTypingTarget(event.target) && !isMenuTarget(event.target)
        },
      },
      [module.WheelGesturesPlugin()],
    )
    state.api = api
    section.classList.add("is-strip-ready")

    // Where the reader is shows in the progress line under the strip, not as
    // a "1-2 / 71" counter (owner, 2026-10-16: the counter is distracting).
    function sync() {
      if (prev) prev.disabled = !api.canScrollPrev()
      if (next) next.disabled = !api.canScrollNext()
      var still = !api.canScrollPrev() && !api.canScrollNext()
      if (nav) nav.hidden = still
      section.classList.toggle("is-strip-still", still)
      developImages(track)
    }

    // A scrollbar thumb, as wide as the share of the strip in view: a full-width
    // fill read as one more rule across the page.
    function syncProgress() {
      if (!progress) return
      var value = Math.max(0, Math.min(1, api.scrollProgress()))
      var slides = api.slideNodes()
      var last = slides[slides.length - 1]
      var length = last ? last.offsetLeft + last.offsetWidth - slides[0].offsetLeft : 0
      var shown = length > 0 ? api.rootNode().clientWidth / length : 1
      progress.style.setProperty("--strip-progress", String(value))
      progress.style.setProperty("--strip-thumb", Math.min(100, shown * 100).toFixed(2) + "%")
    }

    api.on("select", sync)
    api.on("slidesInView", sync)
    api.on("reInit", sync)
    api.on("reInit", syncProgress)
    api.on("scroll", syncProgress)
    api.on("resize", syncProgress)
    sync()
    syncProgress()
  }
}

// Embla measures the frames and wires dragging only on a shown strip, and the
// Candidates tab wants the grid, not the carousel.
function wantsCarousel(section) {
  if (section.closest('[data-icono-gene-selected="candidates"]')) return false
  return section.checkVisibility ? section.checkVisibility() : !!section.offsetParent
}

// Safe to call again: a strip already installed only re-checks whether it
// should be a carousel right now (after a tab switch).
export function installSwipeStrip(section) {
  if (!section) return
  var state = section._iconoCandidateStrip
  if (state) state.refresh()
  else installStrip(section)
}

export function installCandidateStrips(root) {
  if (!root || !root.querySelectorAll) return
  var sections = root.querySelectorAll("[data-icono-candidate-strip]")
  for (var i = 0; i < sections.length; i += 1) installSwipeStrip(sections[i])
}
