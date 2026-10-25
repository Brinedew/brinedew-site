// B-1173: a first-time visitor finds genes on the Archive before installing
// anything. The owner's essay lines sit over the fading card backs, with each
// gene symbol marked the way the add-on marks it on other websites. Resting
// the pointer on a symbol, focusing it or tapping it raises that gene's card,
// and the find counts the same moment.

// "Mnemonic portraits for 19,023 human genes", the oncogene-induced apoptosis
// lines, word for word.
export const HOME_PLAY_SYMBOLS = Object.freeze([
  "MYC",
  "HRAS",
  "MDM2",
  "BCL2",
  "TP53",
  "BAX",
  "BBC3",
])
export const HOME_PLAY_ESSAY_URL =
  "https://brinedew.bio/posts/Mnemonic-portraits-for-19023-human-genes"
const ESSAY_TITLE = "Mnemonic portraits for 19,023 human genes"
const QUOTE_LEAD = "Oncogene-induced apoptosis."
const QUOTE =
  "MYC, HRAS, MDM2, and BCL2 want to restart the mitotic cycle without consensus. " +
  "TP53, BAX, and BBC3 would rather collapse the world than let that happen."

// The first line of docs/getting-started.md, word for word: after a find, the
// strip says what it was a sample of.
export const HOME_PLAY_DOCS_LINE =
  "Iconoplasm is a browser extension that highlights all the gene names on any web page."

// The strip sits in a drawn browser window with the add-on's toolbar icon, the
// way Toucan draws its own demo. The icon is the card backs' emblem, already
// loaded for the slots below.
const TOOLBAR_ICON = "/static/iconoplasm/icons/icon-512.png"

// The add-on on two other sites: the store screenshots (iconoplasm-extension/
// store-assets/screenshot-2 and -1), cut to the cards' 7:9. They sit in the
// hidden after-find row, so they load only after a find. The files are cached
// as immutable: bump ?v= when a picture changes.
const SITES = [
  {
    src: "/static/iconoplasm/play/wikipedia-homeobox.webp?v=1",
    alt: "Wikipedia's Homeobox article with Iconoplasm installed",
    caption: "Wikipedia",
  },
  {
    src: "/static/iconoplasm/play/ucsc-rho.webp?v=1",
    alt: "The UCSC Genome Browser with Iconoplasm installed",
    caption: "UCSC Genome Browser",
  },
]

// The browser's mark on its install button, as Language Reactor puts Chrome's
// on its own. Chrome, Firefox and Brave are Simple Icons (CC0); Edge is
// Bootstrap Icons' browser-edge (MIT, (c) The Bootstrap Authors), because
// Simple Icons no longer carries Microsoft's marks.
const GLYPHS = {
  chrome: [
    "0 0 24 24",
    "M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z",
  ],
  firefox: [
    "0 0 24 24",
    "M8.824 7.287c.008 0 .004 0 0 0zm-2.8-1.4c.006 0 .003 0 0 0zm16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477-.091-.147-.184-.292-.273-.446a3.545 3.545 0 01-.13-.24 2.118 2.118 0 01-.172-.46.03.03 0 00-.027-.03.038.038 0 00-.021 0l-.006.001a.037.037 0 00-.01.005L15.624 0c-2.585 1.515-3.657 4.168-3.932 5.856a6.197 6.197 0 00-2.305.587.297.297 0 00-.147.37c.057.162.24.24.396.17a5.622 5.622 0 012.008-.523l.067-.005a5.847 5.847 0 011.957.222l.095.03a5.816 5.816 0 01.616.228c.08.036.16.073.238.112l.107.055a5.835 5.835 0 01.368.211 5.953 5.953 0 012.034 2.104c-.62-.437-1.733-.868-2.803-.681 4.183 2.09 3.06 9.292-2.737 9.02a5.164 5.164 0 01-1.513-.292 4.42 4.42 0 01-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806 0 0 .537-2 3.845-2 .357 0 1.38-.998 1.398-1.287-.005-.095-2.029-.9-2.817-1.677-.422-.416-.622-.616-.8-.767a3.47 3.47 0 00-.301-.227 5.388 5.388 0 01-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913-.006-.025-.343.176-.389.206-.406.29-.787.616-1.136.974-.397.403-.76.839-1.085 1.303a9.816 9.816 0 00-1.562 3.52c-.003.013-.11.487-.19 1.073-.013.09-.026.181-.037.272a7.8 7.8 0 00-.069.667l-.002.034-.023.387-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661.02-.149.035-.298.052-.448.232-1.994-.025-4.09-.753-5.844z",
  ],
  brave: [
    "0 0 24 24",
    "M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z",
  ],
  edge: [
    "0 0 16 16",
    "M9.482 9.341c-.069.062-.17.153-.17.309 0 .162.107.325.3.456.877.613 2.521.54 2.592.538h.002c.667 0 1.32-.18 1.894-.519A3.84 3.84 0 0 0 16 6.819c.018-1.316-.44-2.218-.666-2.664l-.04-.08C13.963 1.487 11.106 0 8 0A8 8 0 0 0 .473 5.29C1.488 4.048 3.183 3.262 5 3.262c2.83 0 5.01 1.885 5.01 4.797h-.004v.002c0 .338-.168.832-.487 1.244l.006-.006zM.01 7.753a8.14 8.14 0 0 0 .753 3.641 8 8 0 0 0 6.495 4.564 5 5 0 0 1-.785-.377h-.01l-.12-.075a5.5 5.5 0 0 1-1.56-1.463A5.543 5.543 0 0 1 6.81 5.8l.01-.004.025-.012c.208-.098.62-.292 1.167-.285q.194.001.384.033a4 4 0 0 0-.993-.698l-.01-.005C6.348 4.282 5.199 4.263 5 4.263c-2.44 0-4.824 1.634-4.99 3.49m10.263 7.912q.133-.04.265-.084-.153.047-.307.086zM10.228 15.667a5 5 0 0 0 .303-.086l.082-.025a8.02 8.02 0 0 0 4.162-3.3.25.25 0 0 0-.331-.35q-.322.168-.663.294a6.4 6.4 0 0 1-2.243.4c-2.957 0-5.532-2.031-5.532-4.644q.003-.203.046-.399a4.54 4.54 0 0 0-.46 5.898l.003.005c.315.441.707.821 1.158 1.121h.003l.144.09c.877.55 1.721 1.078 3.328.996",
  ],
}

// The add-on's ink rule for a filled pill (textColors in
// iconoplasm-extension/content.js): APCA contrast, and white ink has to beat
// dark ink by 15 points.
export const HOME_PLAY_APCA = Object.freeze({
  darkInk: [24, 22, 20],
  lightInk: [249, 247, 242],
  deltaYMin: 0.0005,
  minContrast: 0.1,
  contrastOffset: 0.027,
  scale: 1.14,
  blackThreshold: 0.022,
  blackClampExp: 1.414,
  whiteWinMargin: 15,
})

function parseHex(hex) {
  const raw = String(hex || "")
    .trim()
    .replace(/^#/, "")
  const full = raw.length === 3 ? raw.replace(/./g, (ch) => ch + ch) : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}

function apcaContrast(text, background) {
  const a = HOME_PLAY_APCA
  const luminance = (rgb) =>
    0.2126729 * Math.pow(rgb[0] / 255, 2.4) +
    0.7151522 * Math.pow(rgb[1] / 255, 2.4) +
    0.072175 * Math.pow(rgb[2] / 255, 2.4)
  const clamp = (y) =>
    y >= a.blackThreshold ? y : y + Math.pow(a.blackThreshold - y, a.blackClampExp)
  const textY = clamp(luminance(text))
  const backgroundY = clamp(luminance(background))
  if (Math.abs(backgroundY - textY) < a.deltaYMin) return 0
  const sapc =
    backgroundY > textY
      ? (Math.pow(backgroundY, 0.56) - Math.pow(textY, 0.57)) * a.scale
      : (Math.pow(backgroundY, 0.65) - Math.pow(textY, 0.62)) * a.scale
  if (Math.abs(sapc) < a.minContrast) return 0
  return 100 * (sapc > 0 ? sapc - a.contrastOffset : sapc + a.contrastOffset)
}

// "light" or "dark": the ink that the add-on would print on this gene's pill.
export function homePlayPillInk(hex) {
  const background = parseHex(hex) || parseHex("#6B6B78")
  const dark = Math.abs(apcaContrast(HOME_PLAY_APCA.darkInk, background))
  const light = Math.abs(apcaContrast(HOME_PLAY_APCA.lightInk, background))
  return light >= dark + HOME_PLAY_APCA.whiteWinMargin ? "light" : "dark"
}

function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  )
}

function glyphMarkup(name) {
  const glyph = GLYPHS[name]
  if (!glyph) return ""
  return (
    '<svg class="icono-play-glyph" viewBox="' +
    glyph[0] +
    '" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="' +
    glyph[1] +
    '"/></svg>'
  )
}

// What follows a find, at most one button. `action` is
//   { kind: "link", note, label, href, glyph?, sites? }  a store page or an
//     example page, in a new tab;
//   { kind: "open", note, label, glyph?, sites? }  the caller shows the
//     install steps when [data-icono-play-open] is pressed;
//   { kind: "none", note, sites? }  this browser has no install path.
// `sites` adds the add-on on Wikipedia and the UCSC Genome Browser, under the
// button: the sentence and its button read together, and the pictures prove
// it. The guest card on the Archive uses the same row.
export function homePlayActionMarkup(action) {
  let html = '<p class="icono-install-note">' + esc(action.note) + "</p>"
  const label = glyphMarkup(action.glyph) + "<span>" + esc(action.label) + "</span>"
  if (action.kind === "open") {
    html +=
      '<button type="button" class="icono-button icono-button--primary icono-install-link" data-icono-play-open>' +
      label +
      "</button>"
  } else if (action.kind === "link") {
    html +=
      '<a class="icono-button icono-button--primary icono-install-link" href="' +
      esc(action.href) +
      '" target="_blank" rel="noopener noreferrer">' +
      label +
      '<span aria-hidden="true">↗</span></a>'
  }
  if (action.sites) {
    html +=
      '<div class="icono-play-sites">' +
      SITES.map(
        (site) =>
          '<figure class="icono-play-site"><img src="' +
          esc(site.src) +
          '" alt="' +
          esc(site.alt) +
          '" width="560" height="720" loading="lazy" decoding="async"><figcaption>' +
          esc(site.caption) +
          "</figcaption></figure>",
      ).join("") +
      "</div>"
  }
  return html
}

// A browser's title bar over the essay lines: the page's address and, at the
// right, the add-on's icon. Drawn, so screen readers skip it.
function windowBarMarkup() {
  return (
    '<div class="icono-play-bar" aria-hidden="true">' +
    '<span class="icono-play-dots"><i></i><i></i><i></i></span>' +
    '<span class="icono-play-address">' +
    esc(HOME_PLAY_ESSAY_URL.replace(/^https:\/\//, "")) +
    "</span>" +
    '<img class="icono-play-addon" src="' +
    TOOLBAR_ICON +
    '" alt="" width="22" height="22" decoding="async">' +
    "</div>"
  )
}

// genes: [{ symbol, name, color, portraitUrl }] in HOME_PLAY_SYMBOLS order.
// found: symbols this reader has found already. A returning reader sees the
//   strip as they left it: those cards turned over, the count in the title and
//   the next step open, with nothing animating.
// cardMarkup(gene): the site's image-only card for the raised card.
// onCardMounted(element): marks the card's portrait loaded once it is.
// onFind(symbol): stores the find and returns the reader's total so far.
// onOpen(): shows the install steps under the strip.
export function mountHomePlayStrip(container, options) {
  const doc = container.ownerDocument
  const win = doc.defaultView
  const genes = new Map(options.genes.map((gene) => [gene.symbol, gene]))
  const hover = !!(win.matchMedia && win.matchMedia("(hover: hover)").matches)
  const found = new Set((options.found || []).filter((symbol) => genes.has(symbol)))
  const foundTitle = () =>
    "You discovered " + found.size + (found.size === 1 ? " gene" : " genes") + " so far"

  let quote = esc(QUOTE)
  for (const symbol of HOME_PLAY_SYMBOLS) {
    const gene = genes.get(symbol)
    quote = quote.replace(
      new RegExp("\\b" + symbol + "\\b"),
      '<a class="icono-play-pill" href="/gene/' +
        encodeURIComponent(symbol) +
        '" data-icono-nav data-icono-play-symbol="' +
        symbol +
        '" data-ink="' +
        homePlayPillInk(gene.color) +
        '" aria-label="' +
        esc(symbol + " · " + gene.name) +
        '" style="--icono-play-gene:' +
        esc(gene.color) +
        '">' +
        symbol +
        "</a>",
    )
  }
  const back = options.reverseFaceHtml
  const slots = HOME_PLAY_SYMBOLS.map((symbol) => {
    const turned = found.has(symbol)
    return (
      '<span class="icono-play-slot' +
      (turned ? " is-found" : "") +
      '" data-icono-play-slot="' +
      symbol +
      '"><span class="icono-play-slot-inner">' +
      '<span class="icono-play-slot-face icono-play-slot-back">' +
      back +
      "</span>" +
      '<span class="icono-play-slot-face icono-play-slot-front"><img alt="" decoding="async"' +
      (turned ? ' src="' + esc(genes.get(symbol).portraitUrl) + '"' : "") +
      "></span>" +
      "</span></span>"
    )
  }).join("")

  const root = doc.createElement("div")
  root.className = "icono-play"
  root.setAttribute("data-icono-home-play", "")
  root.innerHTML =
    '<section class="icono-card icono-guest-login-card icono-play-card">' +
    '<div class="icono-home-auth-title icono-guest-login-card-title" role="heading" aria-level="2" aria-live="polite" data-icono-play-title>' +
    (found.size ? esc(foundTitle()) : (hover ? "Hover" : "Tap") + " any gene symbol") +
    "</div>" +
    '<div class="icono-play-window">' +
    windowBarMarkup() +
    '<blockquote class="icono-play-quote"><p><strong>' +
    esc(QUOTE_LEAD) +
    "</strong> " +
    quote +
    '</p><span class="icono-play-source">— <a href="' +
    HOME_PLAY_ESSAY_URL +
    '">' +
    esc(ESSAY_TITLE) +
    "</a></span></blockquote>" +
    "</div>" +
    '<div class="icono-play-slots" aria-hidden="true">' +
    slots +
    "</div>" +
    // The next step grows out of the strip after the first find, so the strip
    // never snaps open under the pointer. Its content is built at that moment:
    // the two pictures load only for a reader who has found something. A
    // returning reader gets it open from the start. While it is closed, it is
    // inert, so Tab skips it.
    '<div class="icono-play-reveal" data-icono-play-next' +
    (found.size ? " data-open" : " inert") +
    '><div class="icono-play-reveal-inner"></div></div>' +
    "</section>"
  container.insertBefore(root, container.firstChild)

  const card = root.querySelector(".icono-play-card")
  const title = root.querySelector("[data-icono-play-title]")
  const reveal = root.querySelector("[data-icono-play-next]")

  function fillNext() {
    const inner = reveal.firstElementChild
    inner.innerHTML =
      '<div class="icono-play-next">' + homePlayActionMarkup(options.action) + "</div>"
    const openButton = inner.querySelector("[data-icono-play-open]")
    // Once the install steps are open under the strip, the button has done its
    // job; the note and the two sites stay.
    if (openButton) {
      openButton.addEventListener("click", () => {
        openButton.remove()
        options.onOpen()
      })
    }
  }
  if (found.size) fillNext()

  function openNext() {
    if (reveal.hasAttribute("data-open")) return
    fillNext()
    reveal.removeAttribute("inert")
    // Reading the height settles the closed state first, so the row grows from
    // it instead of appearing at its full size.
    void reveal.offsetHeight
    reveal.setAttribute("data-open", "")
  }

  // The raised card hangs from the page body: the guest stage clips whatever
  // leaves it, and the card rises above the strip. It exists only while it is
  // up, so it never outlives the Archive.
  let raised = null
  let current = ""
  let hideTimer = 0
  let removeTimer = 0

  function warmPortraits() {
    for (const gene of genes.values()) {
      const img = new win.Image()
      img.decoding = "async"
      img.src = gene.portraitUrl
    }
  }
  if ("IntersectionObserver" in win) {
    const watcher = new win.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      watcher.disconnect()
      warmPortraits()
    })
    watcher.observe(card)
  } else {
    warmPortraits()
  }

  function place(pill) {
    const width = raised.offsetWidth
    const height = raised.offsetHeight || (width * 4) / 3
    const word = pill.getBoundingClientRect()
    const strip = card.getBoundingClientRect()
    const gap = 18
    const viewportWidth = doc.documentElement.clientWidth
    const column = Math.max(
      8,
      Math.min(viewportWidth - width - 8, word.left + word.width / 2 - width / 2),
    )
    // Above the strip in the word's column, the way the add-on puts its card
    // above the word: over the word itself it would cover the counter as the
    // counter changes. Without room above, beside the strip level with the
    // word; failing both, above or below the word.
    const rightHalf = word.left + word.width / 2 > strip.left + strip.width / 2
    const fitsRight = viewportWidth - strip.right - gap - 8 >= width
    const fitsLeft = strip.left - gap - 8 >= width
    const side = rightHalf
      ? fitsRight
        ? "right"
        : fitsLeft
          ? "left"
          : ""
      : fitsLeft
        ? "left"
        : fitsRight
          ? "right"
          : ""
    let left = column
    let top
    let origin = "50% 100%"
    if (strip.top - height - 12 >= 8) {
      top = strip.top - height - 12
    } else if (side) {
      left = side === "right" ? strip.right + gap : strip.left - gap - width
      top = Math.max(
        8,
        Math.min(win.innerHeight - height - 8, word.top + word.height / 2 - height / 2),
      )
      origin = side === "right" ? "0 50%" : "100% 50%"
    } else {
      top = word.top - height - 10 >= 8 ? word.top - height - 10 : word.bottom + 10
    }
    raised.style.transformOrigin = origin
    raised.style.left = left + win.scrollX + "px"
    raised.style.top = top + win.scrollY + "px"
  }

  // Lazy cards above the strip load after the tap and push the strip down,
  // and the card settles its own height after it mounts. While the card is
  // up, it is placed again whenever the page, the strip or the card resizes.
  let follower = null
  function follow(pill) {
    if (follower) follower.disconnect()
    follower = null
    place(pill)
    if (!("ResizeObserver" in win)) return
    follower = new win.ResizeObserver(() => {
      if (raised && current === pill.getAttribute("data-icono-play-symbol")) place(pill)
    })
    for (const element of [doc.body, card, raised]) follower.observe(element)
  }

  function onOutsidePointer(event) {
    if (event.target.closest(".icono-play-pill, .icono-play-raised")) return
    hide()
  }
  function onKey(event) {
    if (event.key === "Escape") hide()
  }

  function show(pill) {
    win.clearTimeout(hideTimer)
    win.clearTimeout(removeTimer)
    const symbol = pill.getAttribute("data-icono-play-symbol")
    const gene = genes.get(symbol)
    if (current !== symbol || !raised) {
      if (raised) raised.remove()
      const holder = doc.createElement("div")
      holder.innerHTML = options.cardMarkup(gene)
      raised = holder.firstElementChild
      raised.classList.add("icono-play-raised")
      // The symbol's own link names the gene and opens its page, so the
      // picture stays out of the tab order and the accessibility tree.
      raised.setAttribute("aria-hidden", "true")
      for (const link of raised.querySelectorAll("a")) link.tabIndex = -1
      raised.addEventListener("pointerenter", () => win.clearTimeout(hideTimer))
      raised.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") hide()
      })
      doc.body.append(raised)
      options.onCardMounted(raised)
      current = symbol
    }
    follow(pill)
    win.requestAnimationFrame(() => raised && raised.classList.add("is-up"))
    // While the card is up, a tap elsewhere, Escape or Back puts it away.
    doc.addEventListener("pointerdown", onOutsidePointer, true)
    doc.addEventListener("keydown", onKey)
    win.addEventListener("popstate", hide)
    discover(symbol)
  }

  function hide() {
    win.clearTimeout(hideTimer)
    doc.removeEventListener("pointerdown", onOutsidePointer, true)
    doc.removeEventListener("keydown", onKey)
    win.removeEventListener("popstate", hide)
    if (follower) follower.disconnect()
    follower = null
    current = ""
    if (!raised) return
    const leaving = raised
    leaving.classList.remove("is-up")
    removeTimer = win.setTimeout(() => {
      leaving.remove()
      if (raised === leaving) raised = null
    }, 120)
  }

  function discover(symbol) {
    if (found.has(symbol)) return
    found.add(symbol)
    const slot = root.querySelector('[data-icono-play-slot="' + symbol + '"]')
    slot.querySelector("img").src = genes.get(symbol).portraitUrl
    slot.classList.add("is-found")
    const total = Math.max(found.size, Number(options.onFind(symbol)) || 0)
    title.textContent = "You discovered " + total + (total === 1 ? " gene" : " genes") + " so far"
    openNext()
  }

  for (const pill of root.querySelectorAll(".icono-play-pill")) {
    pill.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") show(pill)
    })
    pill.addEventListener("pointerleave", (event) => {
      // Long enough for the pointer to travel from the word up onto the card.
      if (event.pointerType === "mouse") hideTimer = win.setTimeout(hide, 300)
    })
    // Keyboard focus only: a tap focuses the link too (Chrome on Android), and
    // that tap has to raise the card, not open the page.
    pill.addEventListener("focus", () => {
      if (pill.matches(":focus-visible")) show(pill)
    })
    // A tap raises the card; a second tap on the same symbol opens its page,
    // as a click or Enter does once the card is up. The site's own link
    // handler (data-icono-nav) does the opening, so the first tap stops here.
    pill.addEventListener("click", (event) => {
      if (current === pill.getAttribute("data-icono-play-symbol")) return
      event.preventDefault()
      event.stopPropagation()
      show(pill)
    })
  }
  root.addEventListener("focusout", (event) => {
    const to = event.relatedTarget
    if (!root.contains(to) && !(raised && raised.contains(to))) hide()
  })

  return root
}
