// B-1095: a gene's other candidates sit in one sideways strip, so the page is
// the same height at 3 candidates or 300 and the comments stay a screen away
// (TP53's two-column grid was 16,035 px tall with 71 candidates). Embla
// Carousel, the engine behind shadcn/ui's Carousel, moves the track; its wheel
// plugin turns sideways trackpad swipes into strip movement.
//
// Keys, with focus anywhere in the strip: Left and Right move one frame,
// Up approves and Down rejects the frame in focus, Home and End jump to the
// ends, Enter opens the frame in the viewer (the frame is a button).
//
// Until Embla loads, the strip is a plain native scroller (CSS), so every
// frame stays reachable even if the module never arrives.

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

function frames(track) {
  return Array.prototype.slice.call(track.querySelectorAll(":scope > .icono-candidate-card"))
}

function frameOf(node) {
  return node && node.closest ? node.closest(".icono-candidate-card") : null
}

function isTypingTarget(node) {
  if (!node || !node.closest) return false
  return !!node.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], form",
  )
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
  if (section._iconoCandidateStrip) return
  var viewport = section.querySelector("[data-icono-strip-viewport]")
  var track = viewport && viewport.querySelector(".icono-candidate-grid")
  if (!track) return
  var state = { api: null }
  section._iconoCandidateStrip = state
  var nav = section.querySelector("[data-icono-strip-nav]")
  var prev = section.querySelector("[data-icono-strip-prev]")
  var next = section.querySelector("[data-icono-strip-next]")
  var position = section.querySelector("[data-icono-strip-position]")
  var progress = section.querySelector("[data-icono-strip-progress]")

  function focusFrame(index) {
    var list = frames(track)
    if (!list.length) return
    var clamped = Math.max(0, Math.min(list.length - 1, index))
    var target = list[clamped].querySelector(".icono-candidate-media-button")
    if (!target) return
    target.focus({ preventScroll: true })
    var api = state.api
    if (!api) {
      list[clamped].scrollIntoView({ block: "nearest", inline: "nearest" })
      return
    }
    if (api.slidesInView().indexOf(clamped) >= 0) return
    // Embla scrolls by snap, and with slidesToScroll "auto" one snap holds a
    // page of frames; its slide registry says which snap holds this frame.
    var registry = api.internalEngine().slideRegistry
    for (var snap = 0; snap < registry.length; snap += 1) {
      if (registry[snap].indexOf(clamped) >= 0) {
        api.scrollTo(snap)
        return
      }
    }
  }

  section.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (isTypingTarget(event.target)) return
    var frame = frameOf(event.target)
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

  developImages(track)
  section.classList.add("is-strip-developing")

  loadEmbla()
    .then(function (module) {
      if (!section.isConnected) return
      var reduced = prefersReducedMotion()
      var api = module.EmblaCarousel(
        viewport,
        {
          align: "start",
          containScroll: "trimSnaps",
          slidesToScroll: "auto",
          skipSnaps: true,
          // A frame counts as shown only when (almost) all of it is: the peeking
          // one is next, and the counter reads only whole frames.
          inViewThreshold: 0.95,
          duration: reduced ? 10 : 30,
          // Frames hold their own buttons and popovers; a drag that starts on a
          // text field or the copy form must stay a text selection.
          watchDrag: function (_api, event) {
            return !isTypingTarget(event.target)
          },
        },
        [module.WheelGesturesPlugin()],
      )
      state.api = api
      section.classList.add("is-strip-ready")

      function sync() {
        var total = api.slideNodes().length
        var inView = api
          .slidesInView()
          .slice()
          .sort(function (a, b) {
            return a - b
          })
        var first = inView.length ? inView[0] + 1 : 1
        var last = inView.length ? inView[inView.length - 1] + 1 : first
        if (position) {
          position.textContent = (first === last ? first : first + "–" + last) + " / " + total
        }
        if (prev) prev.disabled = !api.canScrollPrev()
        if (next) next.disabled = !api.canScrollNext()
        if (nav) nav.hidden = !api.canScrollPrev() && !api.canScrollNext()
        developImages(track)
      }

      function syncProgress() {
        if (!progress) return
        var value = Math.max(0, Math.min(1, api.scrollProgress()))
        progress.style.transform = "scaleX(" + value + ")"
      }

      if (prev)
        prev.addEventListener("click", function () {
          api.scrollPrev()
        })
      if (next)
        next.addEventListener("click", function () {
          api.scrollNext()
        })
      api.on("select", sync)
      api.on("slidesInView", sync)
      api.on("reInit", sync)
      api.on("reInit", syncProgress)
      api.on("scroll", syncProgress)
      sync()
      syncProgress()
    })
    .catch(function () {
      // The native scroller stays; nothing is lost but the arrows.
      if (nav) nav.hidden = true
    })
}

export function installCandidateStrips(root) {
  if (!root || !root.querySelectorAll) return
  var sections = root.querySelectorAll("[data-icono-candidate-strip]")
  for (var i = 0; i < sections.length; i += 1) installStrip(sections[i])
}
