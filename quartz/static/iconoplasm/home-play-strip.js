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

// One action follows the first find. `action` is
//   { kind: "link", note, label, href }  a store page, in a new tab;
//   { kind: "open", note, label }        `onOpen` shows the install steps;
//   { kind: "login", note, label, href } this browser has no install path.
function actionMarkup(action) {
  const note = action.note || ""
  const [lead, rest] = note.startsWith("Want more cards? ")
    ? ["Want more cards?", note.slice("Want more cards? ".length)]
    : ["", note]
  const noteHtml =
    '<p class="icono-install-note">' +
    (lead ? "<b>" + esc(lead) + "</b> " : "") +
    esc(rest) +
    "</p>"
  const button =
    action.kind === "open"
      ? '<button type="button" class="icono-button icono-button--primary icono-install-link" data-icono-play-open>' +
        esc(action.label) +
        "</button>"
      : '<a class="icono-button icono-button--primary icono-install-link" href="' +
        esc(action.href) +
        '"' +
        (action.kind === "link" ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        esc(action.label) +
        "</a>"
  return '<div class="icono-play-next" data-icono-play-next hidden>' + noteHtml + button + "</div>"
}

// genes: [{ symbol, name, color, portraitUrl }] in HOME_PLAY_SYMBOLS order.
// cardMarkup(gene): the site's image-only card for the raised card.
// onCardMounted(element): marks the card's portrait loaded once it is.
// onFind(symbol): stores the find and returns the reader's total so far.
// onOpen(): shows the install steps under the strip.
export function mountHomePlayStrip(container, options) {
  const doc = container.ownerDocument
  const win = doc.defaultView
  const genes = new Map(options.genes.map((gene) => [gene.symbol, gene]))
  const hover = !!(win.matchMedia && win.matchMedia("(hover: hover)").matches)

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
  const slots = HOME_PLAY_SYMBOLS.map(
    (symbol) =>
      '<span class="icono-play-slot" data-icono-play-slot="' +
      symbol +
      '"><span class="icono-play-slot-inner">' +
      '<span class="icono-play-slot-face icono-play-slot-back">' +
      back +
      "</span>" +
      '<span class="icono-play-slot-face icono-play-slot-front"><img alt="" decoding="async"></span>' +
      "</span></span>",
  ).join("")

  const root = doc.createElement("div")
  root.className = "icono-play"
  root.setAttribute("data-icono-home-play", "")
  root.innerHTML =
    '<section class="icono-card icono-guest-login-card icono-play-card">' +
    '<div class="icono-home-auth-title icono-guest-login-card-title" role="heading" aria-level="2" aria-live="polite" data-icono-play-title>' +
    (hover ? "Hover" : "Tap") +
    " any gene symbol</div>" +
    '<blockquote class="icono-play-quote"><p><strong>' +
    esc(QUOTE_LEAD) +
    "</strong> " +
    quote +
    '</p><span class="icono-play-source">— <a href="' +
    HOME_PLAY_ESSAY_URL +
    '">' +
    esc(ESSAY_TITLE) +
    "</a></span></blockquote>" +
    '<div class="icono-play-slots" aria-hidden="true">' +
    slots +
    "</div>" +
    actionMarkup(options.action) +
    "</section>"
  container.insertBefore(root, container.firstChild)

  const card = root.querySelector(".icono-play-card")
  const title = root.querySelector("[data-icono-play-title]")
  const next = root.querySelector("[data-icono-play-next]")
  const openButton = root.querySelector("[data-icono-play-open]")
  // Once the install steps are open under the strip, the button has done its job.
  let stepsOpen = false
  if (openButton) {
    openButton.addEventListener("click", () => {
      stepsOpen = true
      next.hidden = true
      options.onOpen()
    })
  }

  // The raised card hangs from the page body, so no box on the page clips
  // it. It exists only while it is up, so it never outlives the Archive.
  let raised = null
  let current = ""
  let hideTimer = 0
  let removeTimer = 0
  const found = new Set()

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
    raised.style.inlineSize = ""
    let width = raised.offsetWidth
    let height = raised.offsetHeight || (width * 4) / 3
    const word = pill.getBoundingClientRect()
    const strip = card.getBoundingClientRect()
    const gap = 18
    const viewportWidth = doc.documentElement.clientWidth
    // Above the strip in the word's column, the way the add-on puts its card
    // above the word: over the word itself it would cover the counter as the
    // counter changes. Without room above, beside the strip level with the
    // word. On a phone the Archive header above the strip is a little
    // shorter than the card, so the card shrinks to fit above, down to three
    // quarters of its size, rather than cover the strip's own button.
    // Failing all three, below the word, where the counter stays in sight,
    // or above it when below would leave the screen.
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
    const roomAbove = strip.top - 12 - 8
    if (height > roomAbove && !side && roomAbove >= height * 0.75) {
      // The border adds to the size set here, so take off what it adds.
      const target = Math.floor((width * roomAbove) / height)
      raised.style.inlineSize = target + "px"
      raised.style.inlineSize = 2 * target - raised.offsetWidth + "px"
      width = raised.offsetWidth
      height = raised.offsetHeight
    }
    const column = Math.max(
      8,
      Math.min(viewportWidth - width - 8, word.left + word.width / 2 - width / 2),
    )
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
      top =
        word.bottom + 10 + height <= win.innerHeight - 8 || word.top - height - 10 < 8
          ? word.bottom + 10
          : word.top - height - 10
    }
    raised.style.transformOrigin = origin
    raised.style.left = left + win.scrollX + "px"
    raised.style.top = top + win.scrollY + "px"
  }

  // Anything above the strip that changes height after the tap moves the
  // strip, and the card settles its own height after it mounts. While the
  // card is up, it is placed again whenever the page, the strip or the card
  // resizes.
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
    if (!stepsOpen) next.hidden = false
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
