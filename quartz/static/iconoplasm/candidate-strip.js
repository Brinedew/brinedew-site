// B-1095: a gene's other candidates sit in one sideways strip, so the page is
// the same height at 3 candidates or 300 (TP53's two-column grid was 16,035 px
// tall with 71 candidates). Embla Carousel, the engine behind shadcn/ui's
// Carousel, moves the track; its wheel plugin turns sideways trackpad swipes
// into strip movement.
//
// The same strip drives the home tutorial's site windows and a clan's member
// reel. A strip whose frames are not all in the page yet passes `hasMore` and
// `loadMore`: the Next arrow then fetches the next page when the press would
// land on the last loaded frame. `mountHidden` sets the strip up even before
// it is scrolled into view; `nativePaging` keeps the arrows working while
// Embla is still loading or if it never arrives.
//
// Keys, with focus anywhere in the strip: Left and Right move one frame and
// bring it to the middle, Up approves and Down rejects the frame in focus (the
// candidate strip), Home and End jump to the ends, Enter opens the frame in the
// viewer (the frame is a button or link).
//
// Until Embla loads, the strip is a plain native scroller (CSS), so every frame
// stays reachable even if the module never arrives.
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

// A frame is any child of the track: candidate cards on a gene page, a clan's
// member tiles, the example site windows on the home page.
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

function installStrip(section, options) {
  var opts = options || {}
  var viewport = section.querySelector("[data-icono-strip-viewport]")
  var track = viewport && viewport.firstElementChild
  if (!track) return
  var state = {
    api: null,
    loading: false,
    startSnap: 0,
    refresh: null,
    loadingMore: null,
  }
  section._iconoCandidateStrip = state
  var nav = section.querySelector("[data-icono-strip-nav]")
  var prev = section.querySelector("[data-icono-strip-prev]")
  var next = section.querySelector("[data-icono-strip-next]")
  var progress = section.querySelector("[data-icono-strip-progress]")

  function moreAvailable() {
    return typeof opts.hasMore === "function" && !!opts.hasMore()
  }

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
    var frame = list[clamped]
    var target =
      frame.querySelector(".icono-candidate-media-button") ||
      (frame.matches("a[href], button") ? frame : frame.querySelector("a[href], button"))
    if (!target) return
    target.focus({ preventScroll: true })
    var api = state.api
    if (!api) {
      frame.scrollIntoView({ block: "nearest", inline: "center" })
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

  function nativeProgress() {
    if (!progress) return
    var max = Math.max(0, track.scrollWidth - viewport.clientWidth)
    var value = max > 0 ? viewport.scrollLeft / max : 0
    var shown =
      track.scrollWidth > 0 ? Math.min(100, (viewport.clientWidth / track.scrollWidth) * 100) : 100
    progress.style.setProperty("--strip-progress", String(value))
    progress.style.setProperty("--strip-thumb", shown.toFixed(2) + "%")
  }

  // Without Embla the strip is still a native scroller. Keep the arrows and
  // the progress honest there, including "more pages exist but the loaded
  // frames already fit".
  function nativeSync() {
    var more = moreAvailable()
    var canPrev = viewport.scrollLeft > 1
    var canNext = viewport.scrollLeft + viewport.clientWidth < track.scrollWidth - 1
    if (prev) prev.disabled = !canPrev
    if (next) next.disabled = !(canNext || more)
    var still = !canPrev && !canNext && !more
    if (nav) nav.hidden = still
    section.classList.toggle("is-strip-still", still)
    nativeProgress()
  }
  state.sync = nativeSync
  state.syncProgress = nativeProgress

  function requestMore() {
    if (!opts.loadMore || !moreAvailable()) return Promise.resolve(false)
    if (state.loadingMore) return state.loadingMore
    var before = frames(track).length
    state.loadingMore = Promise.resolve()
      .then(opts.loadMore)
      .then(function (loaded) {
        if (loaded) {
          var firstNew = frames(track)[before]
          if (state.api) {
            // Re-measure before finding the first new frame's snap: the snap
            // list changes when the track grows.
            state.api.reInit()
            if (firstNew) state.api.scrollTo(snapOf(state.api, before))
            if (state.sync) state.sync()
            if (state.syncProgress) state.syncProgress()
          } else {
            if (firstNew) firstNew.scrollIntoView({ block: "nearest", inline: "center" })
            nativeSync()
          }
        }
        return !!loaded
      })
      .catch(function () {
        return false
      })
      .finally(function () {
        state.loadingMore = null
      })
    return state.loadingMore
  }

  // Prev and Next turn a page: the frame nearest the middle moves by as
  // many frames as the strip fits, so a reader with 71 frames isn't
  // clicking 71 times, and a drag that rested between frames still turns
  // a whole page. At the end of a short strip the next page is fetched.
  function page(direction) {
    var api = state.api
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
    // The next page is fetched only when this press would land on the last
    // loaded frame. A reader who swipes instead keeps the loaded frames; the
    // arrow is already at the end of that row.
    if (direction > 0 && moreAvailable() && to >= list.length - 1) {
      requestMore()
      return
    }
    if (!api) {
      var target = list[to]
      if (target)
        target.scrollIntoView({
          block: "nearest",
          inline: "center",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        })
      return
    }
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

  if (opts.nativePaging) {
    viewport.addEventListener(
      "scroll",
      function () {
        if (!state.api) nativeSync()
      },
      { passive: true },
    )
    nativeSync()
  }

  developImages(track)
  section.classList.add("is-strip-developing")

  function mount() {
    if (state.api || state.loading) return
    state.loading = true
    loadEmbla()
      .then(function (module) {
        state.loading = false
        if (!section.isConnected || !wantsCarousel(section, opts)) return
        create(module)
      })
      .catch(function () {
        state.loading = false
        // The native scroller stays. For a strip that fetches more frames the
        // arrows keep working; otherwise they would be decoration.
        if (opts.nativePaging) {
          section.setAttribute("data-icono-strip-fallback", "true")
          nativeSync()
        } else if (nav) nav.hidden = true
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
    if (wantsCarousel(section, opts)) mount()
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
      var more = moreAvailable()
      if (prev) prev.disabled = !api.canScrollPrev()
      if (next) next.disabled = !(api.canScrollNext() || more)
      var still = !api.canScrollPrev() && !api.canScrollNext() && !more
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

    state.sync = sync
    state.syncProgress = syncProgress
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
// Candidates tab wants the grid, not the carousel. A strip that mounts hidden
// (clan members) is measured even before it scrolls into view.
function wantsCarousel(section, opts) {
  if (section.closest('[data-icono-gene-selected="candidates"]')) return false
  if (opts && opts.mountHidden) return true
  return section.checkVisibility ? section.checkVisibility() : !!section.offsetParent
}

// Safe to call again: a strip already installed only re-checks whether it
// should be a carousel right now (after a tab switch).
export function installSwipeStrip(section, options) {
  if (!section) return
  var state = section._iconoCandidateStrip
  if (state) state.refresh()
  else installStrip(section, options)
}

export function installCandidateStrips(root) {
  if (!root || !root.querySelectorAll) return
  var sections = root.querySelectorAll("[data-icono-candidate-strip]")
  for (var i = 0; i < sections.length; i += 1) installSwipeStrip(sections[i])
}
