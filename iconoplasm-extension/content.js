// Iconoplasm content script -- scans page text for gene symbols, wraps them,
// and shows horizontal hover infoboxes with portrait + gene color border.
// Canonical extension root now lives in D:\Coding\Website\iconoplasm-extension.

;(function () {
  "use strict"

  const IconoCardShared = globalThis.IconoplasmCardShared
  const IconoContentMatcher = globalThis.IconoplasmContentMatcher
  const IconoVisibilityScheduler = globalThis.IconoplasmVisibilityScheduler
  if (!IconoCardShared) {
    console.error(
      "[Iconoplasm] shared card runtime missing: load generated/shared-card-runtime.js first",
    )
    return
  }
  if (!IconoContentMatcher) {
    console.error("[Iconoplasm] content matcher missing: load content-matcher.js first")
    return
  }

  // -- Placeholder color for genes without color data ----------------
  const PLACEHOLDER_COLOR = "#6B6B78"
  const HIGHLIGHT_MODE_KEY = "iconoplasm_highlight_mode"
  const TOOLTIP_THEME_KEY = "iconoplasm_tooltip_theme"
  const CARD_VARIANT_KEY = "iconoplasm_card_variant"
  const ICONOPLASM_API_BASE = IconoCardShared.resolveApiBase("https://iconoplasm.brinedew.bio")
  const ICONOPLASM_GENE_BATCH_URL = ICONOPLASM_API_BASE + "/api/public/v1/genes/batch"
  const ICONOPLASM_DISCOVERY_ENCOUNTER_URL =
    ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/encounter"
  const LIT_ARCHIVAL_FRAME_URL = chrome.runtime.getURL("lit-archival-frame.html")
  const LIT_ARCHIVAL_FRAME_ORIGIN = new URL(LIT_ARCHIVAL_FRAME_URL).origin
  const LIT_ARCHIVAL_FRAME_SOURCE = "iconoplasm-lit-archival-frame"
  const LIT_ARCHIVAL_RENDER_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_RENDER"
  const LIT_ARCHIVAL_PREWARM_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_PREWARM"
  const LIT_ARCHIVAL_READY_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_READY"
  const LIT_ARCHIVAL_OPEN_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_OPEN"
  const LIT_ARCHIVAL_AUTH_REQUIRED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_AUTH_REQUIRED"
  const DEFAULT_PORTRAIT_DIMENSIONS = Object.freeze({ width: 768, height: 1024 })
  const DISCOVERY_HOVER_DWELL_MS = 900
  const DISCOVERY_SYMBOL_COOLDOWN_MS = 30 * 1000
  const escapeHtml = IconoCardShared.escapeHtml
  let roughEllipseSerial = 0

  function extensionApiFetch(input, init = {}) {
    const url = typeof input === "string" ? input : String((input && input.url) || "")
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "ICONOPLASM_API_FETCH",
            url,
            method: String(init.method || "GET").toUpperCase(),
            headers: init.headers && typeof init.headers === "object" ? init.headers : {},
            body: typeof init.body === "string" ? init.body : undefined,
            credentials: init.credentials === "include" ? "include" : "same-origin",
          },
          (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || "Extension API fetch failed"))
              return
            }
            if (!result || typeof result !== "object") {
              reject(new Error("Extension API fetch returned no response"))
              return
            }
            const payload = result && typeof result === "object" ? result : {}
            const rawText = String(payload.text || "")
            resolve({
              ok: Boolean(payload.ok),
              status: Number(payload.status || 0),
              text: () => Promise.resolve(rawText),
              json: () => Promise.resolve(rawText ? JSON.parse(rawText) : null),
            })
          },
        )
      } catch (err) {
        reject(err)
      }
    })
  }

  // -- Luminance + text color helpers --------------------------------
  function hexLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }

  // Returns { primary, muted } text colors for a given hex background
  function textColors(hex) {
    const lum = hexLuminance(hex)
    const darkContrast = (lum + 0.05) / 0.05
    const lightContrast = 1.05 / (lum + 0.05)
    if (darkContrast >= lightContrast) {
      return {
        primary: "rgb(24, 22, 20)",
        muted: "rgba(24, 22, 20, 0.82)",
        separator: "rgba(24, 22, 20, 0.16)",
      }
    }
    return {
      primary: "rgb(249, 247, 242)",
      muted: "rgba(249, 247, 242, 0.86)",
      separator: "rgba(249, 247, 242, 0.16)",
    }
  }

  function normalizeHighlightMode(raw) {
    const value = String(raw || "")
      .trim()
      .toLowerCase()
    if (value === "pill") return "pill"
    if (value === "ellipse") return "ellipse"
    return "underline"
  }

  function normalizeTooltipTheme(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase() === "dark"
      ? "dark"
      : "light"
  }

  function normalizeCardVariant(raw) {
    return IconoCardShared.normalizeCardVariant(raw)
  }

  async function loadHighlightMode() {
    try {
      const result = await chrome.storage.local.get([HIGHLIGHT_MODE_KEY])
      highlightMode = normalizeHighlightMode(result[HIGHLIGHT_MODE_KEY])
    } catch (_) {
      highlightMode = "underline"
    }
  }

  async function loadTooltipTheme() {
    try {
      const result = await chrome.storage.local.get([TOOLTIP_THEME_KEY])
      tooltipTheme = normalizeTooltipTheme(result[TOOLTIP_THEME_KEY])
    } catch (_) {
      tooltipTheme = "light"
    }
  }

  async function loadCardVariant() {
    try {
      const result = await chrome.storage.local.get([CARD_VARIANT_KEY])
      cardVariant = normalizeCardVariant(result[CARD_VARIANT_KEY])
    } catch (_) {
      cardVariant = "simple"
    }
  }

  function isArchivalCardVariant() {
    return cardVariant === "lit-archival"
  }

  function isImageOnlyCardVariant() {
    return cardVariant === "image-only"
  }

  // Fence: only Lit-owned variants go through the iframe. The simple tooltip stays native DOM so
  // fast hover metadata does not pay an iframe/runtime tax, while the printed layouts remain
  // isolated from arbitrary page CSS.
  function usesTooltipFrameRenderer() {
    return cardVariant === "lit-archival" || cardVariant === "image-only"
  }

  function applyTooltipTheme() {
    if (!tooltip) return
    tooltip.classList.toggle("iconoplasm-tooltip--dark", tooltipTheme === "dark")
    tooltip.classList.toggle("iconoplasm-tooltip--light", tooltipTheme !== "dark")
    tooltip.classList.toggle("iconoplasm-tooltip--variant-lab-label", isArchivalCardVariant())
    tooltip.classList.toggle("iconoplasm-tooltip--variant-image-only", isImageOnlyCardVariant())
    tooltip.classList.toggle("iconoplasm-tooltip--frame-card", usesTooltipFrameRenderer())
  }

  function buildHighlightRoughLoopSvg() {
    roughEllipseSerial += 1
    const loopSeed = 9001 + roughEllipseSerial * 97
    return (
      '<svg class="iconoplasm-gene-rough-loop" data-icono-rough-loop="true" data-icono-rough-preset="inline-gene" data-icono-rough-seed="' +
      String(loopSeed) +
      '" viewBox="0 0 132 34" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M 8 18 C 8 10, 21 5, 65 5 C 108 5, 124 10, 124 17 C 124 24, 108 29, 66 29 C 22 29, 8 24, 8 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M 12 21 C 15 13, 29 10, 66 10 C 101 10, 114 12, 119 17" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-dasharray="2.5 4"/>' +
      "</svg>"
    )
  }

  function ensureHighlightTextWrapper(el) {
    if (!el) return null
    let copy = el.querySelector(".iconoplasm-gene-copy")
    if (copy) return copy
    const text = String((el.dataset && el.dataset.geneLabel) || el.textContent || "")
    el.textContent = ""
    copy = document.createElement("span")
    copy.className = "iconoplasm-gene-copy"
    copy.setAttribute("data-icono-rough-copy", "true")
    copy.textContent = text
    el.appendChild(copy)
    return copy
  }

  function syncEllipseLoop(el, enabled) {
    if (!el) return
    ensureHighlightTextWrapper(el)
    const existing = el.querySelector(".iconoplasm-gene-rough-loop")
    if (!enabled) {
      if (existing) existing.remove()
      return
    }
    if (!existing) {
      el.insertAdjacentHTML("beforeend", buildHighlightRoughLoopSvg())
    }
    if (IconoCardShared && typeof IconoCardShared.hydrateRoughLoops === "function") {
      IconoCardShared.hydrateRoughLoops(el, true)
    }
  }

  function applyHighlightStyle(el, symbol, color) {
    if (!el) return
    const tc = textColors(color || PLACEHOLDER_COLOR)
    ensureHighlightTextWrapper(el)
    el.dataset.gene = symbol
    el.style.setProperty("--iconoplasm-gene-color", color || PLACEHOLDER_COLOR)
    el.style.setProperty("--iconoplasm-gene-fg", tc.primary)
    el.style.setProperty("--iconoplasm-gene-muted-separator", tc.separator)
    el.classList.toggle("iconoplasm-gene--pill", highlightMode === "pill")
    el.classList.toggle("iconoplasm-gene--ellipse", highlightMode === "ellipse")
    el.classList.toggle("iconoplasm-gene--underline", highlightMode === "underline")
    syncEllipseLoop(el, highlightMode === "ellipse")
  }

  function refreshHighlightStyles(root = document) {
    const scope = root && root.querySelectorAll ? root : document
    const genes = scope.querySelectorAll(".iconoplasm-gene")
    for (const el of genes) {
      const symbol = el.dataset ? el.dataset.gene : ""
      const gene = symbol ? geneMap && geneMap[symbol] : null
      const color = gene && gene.c ? gene.c : PLACEHOLDER_COLOR
      applyHighlightStyle(el, symbol, color)
    }
  }

  // -- Disambiguation blocklist --------------------------------------
  // Gene symbols that are common English words. Only symbols <= 4 chars
  // are checked; longer symbols are safe.
  const BLOCKLIST = new Set([
    "A",
    "AS",
    "AT",
    "BE",
    "BY",
    "DO",
    "GO",
    "HE",
    "IF",
    "IN",
    "IS",
    "IT",
    "ME",
    "MY",
    "NO",
    "OF",
    "ON",
    "OR",
    "SO",
    "TO",
    "UP",
    "US",
    "WE",
    "ACE",
    "ADD",
    "AGE",
    "AIM",
    "AIR",
    "ALL",
    "AND",
    "ANY",
    "ARC",
    "ARE",
    "ARM",
    "ART",
    "ASH",
    "BAD",
    "BAG",
    "BAN",
    "BAR",
    "BAS",
    "BAT",
    "BED",
    "BIG",
    "BIT",
    "BOX",
    "BOY",
    "BUD",
    "BUS",
    "BUT",
    "BUY",
    "CAB",
    "CAN",
    "CAP",
    "CAR",
    "CAT",
    "COP",
    "CRY",
    "CUP",
    "CUT",
    "DAD",
    "DAM",
    "DAY",
    "DID",
    "DIG",
    "DIP",
    "DOC",
    "DOG",
    "DOT",
    "DRY",
    "DUE",
    "DUG",
    "EAR",
    "EAT",
    "END",
    "ERA",
    "EVE",
    "EYE",
    "FAN",
    "FAR",
    "FAT",
    "FAX",
    "FED",
    "FEW",
    "FIG",
    "FIN",
    "FIT",
    "FIX",
    "FLY",
    "FOR",
    "FOX",
    "FUN",
    "FUR",
    "GAP",
    "GAS",
    "GET",
    "GOD",
    "GOT",
    "GUM",
    "GUN",
    "GUT",
    "GUY",
    "HAD",
    "HAM",
    "HAS",
    "HAT",
    "HER",
    "HID",
    "HIM",
    "HIP",
    "HIS",
    "HIT",
    "HOG",
    "HOP",
    "HOT",
    "HOW",
    "HUB",
    "HUG",
    "ICE",
    "ILL",
    "INK",
    "INN",
    "ION",
    "ITS",
    "JAM",
    "JAR",
    "JAW",
    "JET",
    "JOB",
    "JOG",
    "JOY",
    "JUG",
    "KEY",
    "KID",
    "KIT",
    "LAB",
    "LAP",
    "LAW",
    "LAY",
    "LED",
    "LEG",
    "LET",
    "LID",
    "LIE",
    "LIP",
    "LIT",
    "LOG",
    "LOT",
    "LOW",
    "MAD",
    "MAN",
    "MAP",
    "MAT",
    "MAY",
    "MEN",
    "MET",
    "MID",
    "MIX",
    "MOB",
    "MOM",
    "MOP",
    "MUD",
    "MUG",
    "NAP",
    "NET",
    "NEW",
    "NIT",
    "NOR",
    "NOT",
    "NOW",
    "NUN",
    "NUT",
    "OAK",
    "OAR",
    "OAT",
    "ODD",
    "OFF",
    "OIL",
    "OLD",
    "ONE",
    "OUR",
    "OUT",
    "OWE",
    "OWL",
    "OWN",
    "PAD",
    "PAN",
    "PAT",
    "PAW",
    "PAY",
    "PEA",
    "PEN",
    "PET",
    "PIE",
    "PIG",
    "PIN",
    "PIT",
    "POD",
    "POP",
    "POT",
    "PRO",
    "PUB",
    "PUN",
    "PUP",
    "PUT",
    "RAG",
    "RAN",
    "RAP",
    "RAT",
    "RAW",
    "RAY",
    "RED",
    "REF",
    "RIB",
    "RID",
    "RIG",
    "RIM",
    "RIP",
    "ROB",
    "ROD",
    "ROT",
    "ROW",
    "RUB",
    "RUG",
    "RUN",
    "RUT",
    "SAD",
    "SAP",
    "SAT",
    "SAW",
    "SAY",
    "SEA",
    "SET",
    "SEW",
    "SHE",
    "SHY",
    "SIN",
    "SIP",
    "SIS",
    "SIT",
    "SIX",
    "SKI",
    "SKY",
    "SLY",
    "SOB",
    "SOD",
    "SON",
    "SOP",
    "SOT",
    "SOW",
    "SOY",
    "SPA",
    "SPY",
    "STY",
    "SUB",
    "SUM",
    "SUN",
    "TAB",
    "TAG",
    "TAN",
    "TAP",
    "TAR",
    "TAX",
    "TEA",
    "TEN",
    "THE",
    "TIE",
    "TIN",
    "TIP",
    "TOE",
    "TON",
    "TOO",
    "TOP",
    "TOW",
    "TOY",
    "TUB",
    "TUG",
    "TWO",
    "URN",
    "USE",
    "VAN",
    "VAT",
    "VET",
    "VIA",
    "VOW",
    "WAR",
    "WAS",
    "WAX",
    "WAY",
    "WEB",
    "WED",
    "WET",
    "WHO",
    "WHY",
    "WIG",
    "WIN",
    "WIT",
    "WOE",
    "WOK",
    "WON",
    "WOO",
    "WOW",
    "YAM",
    "YAP",
    "YAW",
    "YEA",
    "YES",
    "YET",
    "YEW",
    "YOU",
    "ZAP",
    "ZEN",
    "ZIP",
    "ZOO",
    // 4-letter common words
    "ACHE",
    "AGED",
    "ALSO",
    "AMID",
    "ARCH",
    "AREA",
    "ARMY",
    "ARTS",
    "AWAY",
    "BACK",
    "BAIT",
    "BAKE",
    "BALL",
    "BAND",
    "BANG",
    "BANK",
    "BARE",
    "BARN",
    "BASE",
    "BATH",
    "BEAM",
    "BEAN",
    "BEAR",
    "BEAT",
    "BEEF",
    "BEEN",
    "BELL",
    "BELT",
    "BEND",
    "BENT",
    "BEST",
    "BIAS",
    "BIKE",
    "BILL",
    "BIND",
    "BIRD",
    "BITE",
    "BLADE",
    "BLOW",
    "BLUE",
    "BLUR",
    "BOAT",
    "BODY",
    "BOLD",
    "BOLT",
    "BOMB",
    "BOND",
    "BONE",
    "BOOK",
    "BOOT",
    "BORE",
    "BORN",
    "BOSS",
    "BOTH",
    "BOWL",
    "BRED",
    "BREW",
    "BUCK",
    "BULK",
    "BULL",
    "BUMP",
    "BURN",
    "BURY",
    "BUSY",
    "BUZZ",
    "CAFE",
    "CAGE",
    "CAKE",
    "CALL",
    "CALM",
    "CAME",
    "CAMP",
    "CAPE",
    "CARD",
    "CARE",
    "CART",
    "CASE",
    "CASH",
    "CAST",
    "CAVE",
    "CELL",
    "CHAT",
    "CHIP",
    "CHOP",
    "CITE",
    "CITY",
    "CLAD",
    "CLAM",
    "CLAN",
    "CLAP",
    "CLAY",
    "CLIP",
    "CLUB",
    "CLUE",
    "COAL",
    "COAT",
    "CODE",
    "COIL",
    "COIN",
    "COLD",
    "COME",
    "COOK",
    "COOL",
    "COPE",
    "COPY",
    "CORD",
    "CORE",
    "CORK",
    "CORN",
    "COST",
    "COUP",
    "CREW",
    "CROP",
    "CROSS",
    "CURE",
    "CURL",
    "CUTE",
    "DARE",
    "DARK",
    "DASH",
    "DATA",
    "DATE",
    "DAWN",
    "DEAD",
    "DEAF",
    "DEAL",
    "DEAR",
    "DEBT",
    "DECK",
    "DEED",
    "DEEM",
    "DEEP",
    "DEER",
    "DEMO",
    "DENY",
    "DESK",
    "DIAL",
    "DICE",
    "DIET",
    "DIRT",
    "DISC",
    "DISH",
    "DISK",
    "DOCK",
    "DOES",
    "DOME",
    "DONE",
    "DOOM",
    "DOOR",
    "DOSE",
    "DOWN",
    "DRAG",
    "DRAW",
    "DREW",
    "DROP",
    "DRUM",
    "DUAL",
    "DUDE",
    "DUEL",
    "DULL",
    "DUMB",
    "DUMP",
    "DUNE",
    "DUSK",
    "DUST",
    "DUTY",
    "EACH",
    "EARN",
    "EASE",
    "EAST",
    "EASY",
    "ECHO",
    "EDGE",
    "EDIT",
    "ELSE",
    "EMIT",
    "EPIC",
    "EVEN",
    "EVER",
    "EVIL",
    "EXAM",
    "EXEC",
    "EXIT",
    "FACE",
    "FACT",
    "FADE",
    "FAIL",
    "FAIR",
    "FAKE",
    "FALL",
    "FAME",
    "FANS",
    "FARE",
    "FARM",
    "FAST",
    "FATE",
    "FEAR",
    "FEAT",
    "FEED",
    "FEEL",
    "FEET",
    "FELL",
    "FELT",
    "FILE",
    "FILL",
    "FILM",
    "FINAL",
    "FIND",
    "FINE",
    "FIRE",
    "FIRM",
    "FISH",
    "FIST",
    "FIVE",
    "FLAG",
    "FLAP",
    "FLAT",
    "FLAW",
    "FLED",
    "FLEW",
    "FLIP",
    "FLOW",
    "FOAM",
    "FOES",
    "FOLD",
    "FOLK",
    "FOND",
    "FONT",
    "FOOD",
    "FOOL",
    "FOOT",
    "FORD",
    "MENU",
    "MERE",
    "FORM",
    "FORT",
    "FOUL",
    "FOUR",
    "FREE",
    "FROM",
    "FUEL",
    "FULL",
    "FUND",
    "FURY",
    "FUSE",
    "FUSS",
    "GAIN",
    "GALA",
    "GALE",
    "GAME",
    "GANG",
    "GARB",
    "GATE",
    "GAVE",
    "GAZE",
    "GEAR",
    "GENE",
    "GIFT",
    "GLAD",
    "GLOW",
    "GLUE",
    "GOAT",
    "GOES",
    "GOLD",
    "GOLF",
    "GONE",
    "GOOD",
    "GRAB",
    "GRAM",
    "GRAY",
    "GREW",
    "GREY",
    "GRID",
    "GRIM",
    "GRIN",
    "GRIP",
    "GRIT",
    "GROW",
    "GULF",
    "GURU",
    "GUST",
    "GUYS",
    "HACK",
    "HAIL",
    "HAIR",
    "HALE",
    "HALF",
    "HALL",
    "HALT",
    "HAND",
    "HANG",
    "HARD",
    "HARM",
    "HARP",
    "HASH",
    "HATE",
    "HAVE",
    "HAUL",
    "HAZE",
    "HEAD",
    "HEAL",
    "HEAP",
    "HEAR",
    "HEAT",
    "HEED",
    "HEEL",
    "HELD",
    "HELL",
    "HELP",
    "HERB",
    "HERE",
    "HERO",
    "HIGH",
    "HIKE",
    "HILL",
    "HINT",
    "HIRE",
    "HOLD",
    "HOLE",
    "HOME",
    "HOOD",
    "HOOK",
    "HOPE",
    "HORN",
    "HOST",
    "HOUR",
    "HUGE",
    "HULL",
    "HUNG",
    "HUNT",
    "HURT",
    "HUSH",
    "HYMN",
    "ICON",
    "IDEA",
    "IDLE",
    "INCH",
    "INFO",
    "INTO",
    "IRON",
    "ITEM",
    "JACK",
    "JAIL",
    "JAZZ",
    "JEAN",
    "JEST",
    "JOBS",
    "JOIN",
    "JOKE",
    "JUMP",
    "JURY",
    "JUST",
    "KEEN",
    "KEEP",
    "KEPT",
    "KICK",
    "KIDS",
    "KILL",
    "KIND",
    "KING",
    "KISS",
    "KNOT",
    "KNOW",
    "LACE",
    "LACK",
    "LAID",
    "LAKE",
    "LAMB",
    "LAME",
    "LAMP",
    "LAND",
    "LANE",
    "LAPS",
    "LAST",
    "LATE",
    "LAWN",
    "LEAD",
    "LEAF",
    "LEAK",
    "LEAN",
    "LEAP",
    "LEFT",
    "LEND",
    "LENS",
    "LESS",
    "LIED",
    "LIEU",
    "LIFE",
    "LIFT",
    "LIKE",
    "LIMB",
    "LIME",
    "LIMP",
    "LINE",
    "LINK",
    "LION",
    "LIST",
    "LIVE",
    "LOAD",
    "LOAN",
    "LOCK",
    "LOFT",
    "LOGO",
    "LONG",
    "LOOK",
    "LOOP",
    "LORD",
    "LOSE",
    "LOSS",
    "LOST",
    "LOTS",
    "LOUD",
    "LOVE",
    "LUCK",
    "LUMP",
    "LUNG",
    "LURE",
    "LUSH",
    "MADE",
    "MAIL",
    "MAIN",
    "MAKE",
    "MALE",
    "MALL",
    "MALT",
    "MANE",
    "MANY",
    "MARK",
    "MARS",
    "MASH",
    "MASK",
    "MASS",
    "MAST",
    "MATE",
    "MATH",
    "MAZE",
    "MEAL",
    "MEAN",
    "MEAT",
    "MEET",
    "MELT",
    "MEMO",
    "MEND",
    "MESH",
    "MESS",
    "MILD",
    "MILE",
    "MILK",
    "MILL",
    "MIND",
    "MINE",
    "MINT",
    "MISS",
    "MODE",
    "MOLD",
    "MOOD",
    "MOON",
    "MORE",
    "MOSS",
    "MOST",
    "MOTH",
    "MOVE",
    "MUCH",
    "MUSE",
    "MUST",
    "MUTE",
    "MYTH",
    "NAIL",
    "NAME",
    "NAVY",
    "NEAR",
    "NEAT",
    "NECK",
    "NEED",
    "NEST",
    "NEWS",
    "NEXT",
    "NICE",
    "NINE",
    "NODE",
    "NONE",
    "NOON",
    "NORM",
    "NOSE",
    "NOTE",
    "NOUN",
    "NUDE",
    "OATH",
    "OBEY",
    "ODDS",
    "OKAY",
    "ONCE",
    "ONLY",
    "ONTO",
    "OPEN",
    "OPTS",
    "ORAL",
    "OURS",
    "OUST",
    "OVEN",
    "OVER",
    "PACE",
    "PACK",
    "PAGE",
    "PAID",
    "PAIL",
    "PAIN",
    "PAIR",
    "PALE",
    "PALM",
    "PANE",
    "PARA",
    "PARK",
    "PART",
    "PASS",
    "PAST",
    "PATH",
    "PEAK",
    "PEAR",
    "PEEL",
    "PEER",
    "PEST",
    "PICK",
    "PIER",
    "PILE",
    "PINE",
    "PINK",
    "PIPE",
    "PITY",
    "PLAN",
    "PLAY",
    "PLEA",
    "PLOT",
    "PLOY",
    "PLUG",
    "PLUM",
    "PLUS",
    "POEM",
    "POET",
    "POLL",
    "POLO",
    "POND",
    "POOL",
    "POOR",
    "POPE",
    "PORK",
    "PORT",
    "POSE",
    "POST",
    "POUR",
    "PRAY",
    "PREY",
    "PROP",
    "PULL",
    "PULP",
    "PUMP",
    "PURE",
    "PUSH",
    "QUIT",
    "QUIZ",
    "RACE",
    "RACK",
    "RAGE",
    "RAID",
    "RAIL",
    "RAIN",
    "RARE",
    "RANK",
    "RASH",
    "RATE",
    "READ",
    "REAL",
    "REAR",
    "REEF",
    "REIN",
    "RELY",
    "RENT",
    "REST",
    "RICH",
    "RIDE",
    "RIFT",
    "RING",
    "RIOT",
    "RIPE",
    "RISE",
    "RISK",
    "ROAD",
    "ROAM",
    "ROCK",
    "RODE",
    "ROLE",
    "ROLL",
    "ROOF",
    "ROOM",
    "ROOT",
    "ROPE",
    "ROSE",
    "RUDE",
    "RUIN",
    "RULE",
    "RUSH",
    "RUST",
    "SAFE",
    "SAGE",
    "SAID",
    "SAKE",
    "SALE",
    "SALT",
    "SAME",
    "SAND",
    "SANE",
    "SANG",
    "SANK",
    "SAVE",
    "SCAN",
    "SEAL",
    "SEED",
    "SEEK",
    "SEEM",
    "SEEN",
    "SELF",
    "SELL",
    "SEND",
    "SENT",
    "SHIP",
    "SHOE",
    "SHOP",
    "SHOT",
    "SHOW",
    "SHUT",
    "SICK",
    "SIDE",
    "SIGH",
    "SIGN",
    "SILK",
    "SING",
    "SINK",
    "SITE",
    "SIZE",
    "SKIN",
    "SKIP",
    "SLAM",
    "SLAP",
    "SLEW",
    "SLID",
    "SLIM",
    "SLIP",
    "SLOT",
    "SLOW",
    "SNAP",
    "SNOW",
    "SOAK",
    "SOAP",
    "SOAR",
    "SOCK",
    "SOFT",
    "SOIL",
    "SOLD",
    "SOLE",
    "SOME",
    "SONG",
    "SOON",
    "SORE",
    "SORT",
    "SOUL",
    "SOUR",
    "SPAN",
    "SPAR",
    "SPEC",
    "SPED",
    "SPIN",
    "SPIT",
    "SPOT",
    "STAR",
    "STAY",
    "STEM",
    "STEP",
    "STEW",
    "STIR",
    "STOP",
    "STUB",
    "STUD",
    "SUCH",
    "SUIT",
    "SUNG",
    "SUNK",
    "SURE",
    "SURF",
    "SWAP",
    "SWIM",
    "TABS",
    "TAIL",
    "TAKE",
    "TALE",
    "TALK",
    "TALL",
    "TAME",
    "TANK",
    "TAPE",
    "TASK",
    "TAUT",
    "TEAM",
    "TEAR",
    "TELL",
    "TEND",
    "TENT",
    "TERM",
    "TEST",
    "TEXT",
    "THAN",
    "THAT",
    "THEM",
    "THEN",
    "THEY",
    "THIN",
    "THIS",
    "THUS",
    "TICK",
    "TIDE",
    "TIDY",
    "TIED",
    "TIER",
    "TILE",
    "TILL",
    "TILT",
    "TIME",
    "TINY",
    "TIRE",
    "TOAD",
    "TOE",
    "TOLD",
    "TOLL",
    "TOMB",
    "TONE",
    "TOOK",
    "TOOL",
    "TOPS",
    "TORE",
    "TORN",
    "TOSS",
    "TOUR",
    "TOWN",
    "TRAP",
    "TRAY",
    "TREE",
    "TREK",
    "TRIM",
    "TRIP",
    "TROT",
    "TRUE",
    "TUBE",
    "TUCK",
    "TUNE",
    "TURN",
    "TURF",
    "TWIN",
    "TYPE",
    "UGLY",
    "UNDO",
    "UNIT",
    "UNTO",
    "UPON",
    "URGE",
    "USED",
    "USER",
    "VAIN",
    "VALE",
    "VARY",
    "VAST",
    "VEIL",
    "VEIN",
    "VENT",
    "VERB",
    "VERY",
    "VEST",
    "VETO",
    "VIEW",
    "VINE",
    "VOID",
    "VOLT",
    "VOTE",
    "WADE",
    "WAGE",
    "WAIT",
    "WAKE",
    "WALK",
    "WALL",
    "WAND",
    "WANT",
    "WARD",
    "WARM",
    "WARN",
    "WARP",
    "WARY",
    "WASH",
    "VAST",
    "WAVE",
    "WAYS",
    "WEAK",
    "WEAR",
    "WEED",
    "WEEK",
    "WELL",
    "WENT",
    "WERE",
    "WEST",
    "WHAT",
    "WHEN",
    "WHOM",
    "WIDE",
    "WIFE",
    "WILD",
    "WILL",
    "WILT",
    "WIND",
    "WINE",
    "WING",
    "WIPE",
    "WIRE",
    "WISE",
    "WISH",
    "WITH",
    "WOKE",
    "WOLF",
    "WOMB",
    "WOOD",
    "WOOL",
    "WORD",
    "WORE",
    "WORK",
    "WORM",
    "WORN",
    "WRAP",
    "WRIT",
    "YARD",
    "YARN",
    "YEAR",
    "YELL",
    "YOUR",
    "ZEAL",
    "ZERO",
    "ZONE",
    "ZOOM",
    "AA",
    "AB",
    "AD",
    "AH",
    "AM",
    "AN",
    "AX",
  ])

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "CODE",
    "PRE",
    "NOSCRIPT",
    "IFRAME",
    "SVG",
    "MATH",
    "HEAD",
    "TITLE",
    "META",
    "LINK",
  ])

  // -- State ---------------------------------------------------------
  let geneMap = null // { SYMBOL: { c?, n?, u?, a?, pt?, ph? } }
  let geneMatcher = null
  let tooltip = null
  let authToast = null
  let portraitBaseUrl = ""
  let activeSymbol = null
  let hideTimer = null
  const discoveryTimerBySymbol = new Map()
  const discoveryCooldownUntilBySymbol = new Map()
  const discoveryInFlightSymbols = new Set()
  const discoveredPageSymbols = new Set()
  let portraitLoadToken = 0
  const portraitDataUrlCache = new Map()
  const portraitDataUrlPromiseCache = new Map()
  const portraitWarmQueue = []
  const queuedPortraitSrcs = new Set()
  let portraitWarmScheduled = false
  let portraitWarmDraining = false
  const geneDetailCache = new Map() // symbol -> gene payload or null
  const geneDetailPromiseCache = new Map() // symbol -> Promise<payload|null>
  const geneDetailWarmQueue = []
  const queuedGeneDetailSymbols = new Set()
  let geneDetailWarmScheduled = false
  let geneDetailWarmDraining = false
  let viewportWarmFrame = 0
  let visibilityScheduler = null
  const mutationScanRoots = new Set()
  let mutationScanScheduled = false
  let highlightMode = "underline"
  let tooltipTheme = "light"
  let cardVariant = "simple"
  let activeGeneSummary = null
  let litArchivalFrameRequestSerial = 0
  const warnedMissingTraitOrigins = new Set()
  // Fence: keep background detail batches small. Large batches made the hovered gene wait behind
  // bulk prewarm work, which is why "simple text loads seconds later" showed up in practice.
  const GENE_DETAIL_WARM_BATCH_SIZE = 8
  const PORTRAIT_WARM_BATCH_SIZE = 6
  const GENE_DETAIL_VISIBLE_LIMIT = 80
  const GENE_DETAIL_VIEWPORT_ABOVE_PX = 160
  const GENE_DETAIL_VIEWPORT_BELOW_PX = 960

  function buildGenePageUrl(symbol) {
    return "https://iconoplasm.brinedew.bio/gene/" + encodeURIComponent(symbol)
  }

  function openGenePage(symbol) {
    if (!symbol || !geneMap || !geneMap[symbol]) return
    window.open(buildGenePageUrl(symbol), "_blank", "noopener")
  }

  function showVoteLoginPopup() {
    if (!authToast) return
    authToast.textContent = "Log in on Iconoplasm to vote on portraits."
    authToast.classList.add("iconoplasm-auth-toast-visible")
    window.clearTimeout(Number(authToast.dataset.hideTimer || 0))
    const hideTimerId = window.setTimeout(() => {
      authToast.classList.remove("iconoplasm-auth-toast-visible")
      authToast.dataset.hideTimer = ""
    }, 2600)
    authToast.dataset.hideTimer = String(hideTimerId)
  }

  function cancelHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function scheduleHideTooltip(delayMs = 220) {
    cancelHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      hideTooltip()
    }, delayMs)
  }

  function clearPendingDiscovery(symbol = activeSymbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    const timerId = discoveryTimerBySymbol.get(normalizedSymbol)
    if (!timerId) return
    window.clearTimeout(timerId)
    discoveryTimerBySymbol.delete(normalizedSymbol)
  }

  function isDiscoveryCoolingDown(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return false
    const cooldownUntil = Number(discoveryCooldownUntilBySymbol.get(normalizedSymbol) || 0)
    if (cooldownUntil > Date.now()) return true
    discoveryCooldownUntilBySymbol.delete(normalizedSymbol)
    return false
  }

  function markDiscoveryCooldown(symbol, cooldownMs = DISCOVERY_SYMBOL_COOLDOWN_MS) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    discoveryCooldownUntilBySymbol.set(normalizedSymbol, Date.now() + cooldownMs)
  }

  async function postDiscoveryEncounter(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    if (discoveredPageSymbols.has(normalizedSymbol)) return
    if (discoveryInFlightSymbols.has(normalizedSymbol)) return
    if (isDiscoveryCoolingDown(normalizedSymbol)) return

    discoveryInFlightSymbols.add(normalizedSymbol)
    markDiscoveryCooldown(normalizedSymbol)
    try {
      const response = await extensionApiFetch(ICONOPLASM_DISCOVERY_ENCOUNTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: normalizedSymbol,
          source: "extension_hover",
          trigger: "hover_dwell",
          dwell_ms: DISCOVERY_HOVER_DWELL_MS,
        }),
        credentials: "include",
      })
      if (!response.ok) {
        console.warn(
          "[Iconoplasm] discovery encounter write failed for",
          normalizedSymbol,
          "with HTTP",
          response.status,
        )
        return
      }
      const payload = await response.json().catch(() => null)
      if (payload && payload.authenticated && payload.recorded) {
        discoveredPageSymbols.add(normalizedSymbol)
      }
    } catch (err) {
      console.error("[Iconoplasm] discovery encounter write error:", err)
    } finally {
      discoveryInFlightSymbols.delete(normalizedSymbol)
    }
  }

  function scheduleDiscoveryEncounter(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    if (discoveredPageSymbols.has(normalizedSymbol)) return
    if (discoveryInFlightSymbols.has(normalizedSymbol)) return
    if (isDiscoveryCoolingDown(normalizedSymbol)) return

    clearPendingDiscovery(normalizedSymbol)
    const timerId = window.setTimeout(() => {
      discoveryTimerBySymbol.delete(normalizedSymbol)
      if (activeSymbol !== normalizedSymbol) return
      if (!tooltip || !tooltip.classList.contains("iconoplasm-tooltip-visible")) return
      if (document.visibilityState === "hidden") return
      postDiscoveryEncounter(normalizedSymbol).catch(() => null)
    }, DISCOVERY_HOVER_DWELL_MS)
    discoveryTimerBySymbol.set(normalizedSymbol, timerId)
  }

  function resolvePortraitUrl(gene) {
    const key = gene.pt || gene.ph
    if (!key) return ""
    if (/^https?:\/\//i.test(key)) return key
    const normalizedKey = key.replace(/^\/+/, "")
    if (key.startsWith("/") || normalizedKey.startsWith("portraits/")) {
      return "https://iconoplasm.brinedew.bio/" + normalizedKey
    }
    if (portraitBaseUrl) {
      return portraitBaseUrl.replace(/\/+$/, "") + "/" + normalizedKey
    }
    return "https://iconoplasm.brinedew.bio/" + normalizedKey
  }

  function deferPortraitWarm(task) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => task(), { timeout: 800 })
      return
    }
    window.setTimeout(task, 80)
  }

  function deferGeneDetailWarm(task) {
    window.setTimeout(task, 0)
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  function shouldIgnoreMutationNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return true
    const el = /** @type {Element} */ (node)
    if (el.classList && el.classList.contains("iconoplasm-tooltip")) return true
    if (el.closest && el.closest(".iconoplasm-tooltip")) return true
    if (el.classList && el.classList.contains("iconoplasm-gene")) return true
    if (el.closest && el.closest(".iconoplasm-gene")) return true
    if (SKIP_TAGS.has(el.tagName)) return true
    return false
  }

  function scheduleMutationScan() {
    if (mutationScanScheduled) return
    mutationScanScheduled = true
    window.setTimeout(() => {
      mutationScanScheduled = false
      if (!mutationScanRoots.size) return

      const roots = Array.from(mutationScanRoots)
      mutationScanRoots.clear()
      let didWrapGenes = false
      for (const root of roots) {
        if (scanPage(root) > 0) {
          didWrapGenes = true
        }
      }
      if (didWrapGenes) {
        scheduleWarmVisiblePortraits()
        scheduleWarmVisibleGeneDetails()
      }
    }, 0)
  }

  function setPortraitFallback(
    portrait,
    portraitImg,
    portraitFallback,
    portraitStatus,
    statusText,
  ) {
    portraitImg.removeAttribute("src")
    portraitImg.style.display = "none"
    portrait.classList.add("iconoplasm-tooltip-portrait-missing")
    portraitFallback.style.display = "flex"
    portraitStatus.textContent = statusText
  }

  function applyPortraitImage(
    portrait,
    portraitImg,
    portraitFallback,
    portraitStatus,
    usableSrc,
    altText,
  ) {
    portraitImg.src = usableSrc
    portraitImg.alt = altText || ""
    portraitImg.style.display = "block"
    portrait.classList.remove("iconoplasm-tooltip-portrait-missing")
    portraitFallback.style.display = "none"
    portraitStatus.textContent = ""
  }

  function warmPortraitUrls(urls) {
    const seen = new Set()
    let added = false
    for (const rawUrl of Array.isArray(urls) ? urls : []) {
      const url = String(rawUrl || "").trim()
      if (!url || seen.has(url)) continue
      if (
        portraitDataUrlCache.has(url) ||
        portraitDataUrlPromiseCache.has(url) ||
        queuedPortraitSrcs.has(url)
      )
        continue
      seen.add(url)
      queuedPortraitSrcs.add(url)
      portraitWarmQueue.push(url)
      added = true
    }
    if (added) {
      drainPortraitWarmQueue().catch(() => null)
    }
  }

  async function drainPortraitWarmQueue() {
    if (portraitWarmDraining) return
    portraitWarmDraining = true
    try {
      while (portraitWarmQueue.length) {
        const batch = portraitWarmQueue.splice(0, PORTRAIT_WARM_BATCH_SIZE)
        for (const url of batch) queuedPortraitSrcs.delete(url)
        const usableSources = await Promise.all(
          batch.map((url) => getUsablePortraitSrc(url).catch(() => "")),
        )
        prewarmLitArchivalFramePortraitSrcs(usableSources)
        if (portraitWarmQueue.length) {
          await delay(20)
        }
      }
    } finally {
      portraitWarmDraining = false
    }
  }

  function scheduleWarmVisiblePortraits(limit = 24) {
    if (portraitWarmScheduled) return
    portraitWarmScheduled = true
    deferPortraitWarm(() => {
      portraitWarmScheduled = false
      if (!geneMap) return
      const urls = []
      const seenSymbols = new Set()
      const sourceSymbols =
        visibilityScheduler && visibilityScheduler.hasVisibleSymbols()
          ? collectObservedVisibleGeneSymbols(limit)
          : collectVisibleGeneSymbols(limit)
      for (const symbol of sourceSymbols) {
        if (!symbol || seenSymbols.has(symbol)) continue
        seenSymbols.add(symbol)
        const gene = geneMap[symbol]
        const portraitSrc = resolvePortraitUrl(gene)
        if (!portraitSrc) continue
        urls.push(portraitSrc)
        if (urls.length >= limit) break
      }
      warmPortraitUrls(urls)
    })
  }

  function collectVisibleGeneSymbols(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (!geneMap) return []
    const symbols = []
    const seenSymbols = new Set()
    const genes = document.querySelectorAll(".iconoplasm-gene")
    for (const geneEl of genes) {
      const rect = geneEl.getBoundingClientRect()
      if (rect.bottom < -GENE_DETAIL_VIEWPORT_ABOVE_PX) continue
      if (rect.top > window.innerHeight + GENE_DETAIL_VIEWPORT_BELOW_PX) continue
      const symbol = geneEl.dataset ? geneEl.dataset.gene : ""
      if (!symbol || seenSymbols.has(symbol)) continue
      seenSymbols.add(symbol)
      symbols.push(symbol)
      if (symbols.length >= limit) break
    }
    return symbols
  }

  function collectObservedVisibleGeneSymbols(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (!visibilityScheduler) return []
    return visibilityScheduler
      .getVisibleSymbols(limit)
      .filter((symbol) => geneMap && geneMap[symbol])
  }

  function ensureVisibilityObserver() {
    if (visibilityScheduler) return visibilityScheduler
    if (!IconoVisibilityScheduler) return null
    // Fence: warming should follow observer-driven visibility rather than repeated layout reads on
    // scroll/resize. The old getBoundingClientRect loop worked, but it turned visibility into a
    // hand-rolled scheduler with more main-thread tax than necessary.
    visibilityScheduler = IconoVisibilityScheduler.createVisibilityScheduler({
      abovePx: GENE_DETAIL_VIEWPORT_ABOVE_PX,
      belowPx: GENE_DETAIL_VIEWPORT_BELOW_PX,
      onVisibleChange: () => {
        scheduleWarmVisiblePortraits()
        scheduleWarmVisibleGeneDetails()
      },
    })
    return visibilityScheduler
  }

  function observeGeneElement(el) {
    if (!el || !el.dataset || !el.dataset.gene) return
    const scheduler = ensureVisibilityObserver()
    if (scheduler) scheduler.observe(el)
  }

  function collectNeighborGeneSymbols(targetEl, limit = GENE_DETAIL_WARM_BATCH_SIZE) {
    if (!targetEl) return []
    const genes = Array.from(document.querySelectorAll(".iconoplasm-gene"))
    const targetIndex = genes.indexOf(targetEl)
    if (targetIndex === -1) {
      const targetSymbol = targetEl.dataset ? targetEl.dataset.gene : ""
      return targetSymbol ? [targetSymbol] : []
    }

    const symbols = []
    const seenSymbols = new Set()
    const pushSymbol = (symbol) => {
      const normalized = String(symbol || "")
        .trim()
        .toUpperCase()
      if (!normalized || seenSymbols.has(normalized)) return
      seenSymbols.add(normalized)
      symbols.push(normalized)
    }

    pushSymbol(targetEl.dataset ? targetEl.dataset.gene : "")

    let left = targetIndex - 1
    let right = targetIndex + 1
    while (symbols.length < limit && (left >= 0 || right < genes.length)) {
      if (right < genes.length) {
        pushSymbol(genes[right].dataset ? genes[right].dataset.gene : "")
        right += 1
        if (symbols.length >= limit) break
      }
      if (left >= 0) {
        pushSymbol(genes[left].dataset ? genes[left].dataset.gene : "")
        left -= 1
      }
    }
    return symbols
  }

  function collectNeighborPortraitUrls(targetEl, limit = GENE_DETAIL_WARM_BATCH_SIZE) {
    if (!geneMap) return []
    const symbols = collectNeighborGeneSymbols(targetEl, limit)
    const urls = []
    const seenUrls = new Set()
    for (const symbol of symbols) {
      const gene = geneMap[symbol]
      const portraitSrc = resolvePortraitUrl(gene)
      if (!portraitSrc || seenUrls.has(portraitSrc)) continue
      seenUrls.add(portraitSrc)
      urls.push(portraitSrc)
    }
    return urls
  }

  async function fetchGeneDetailsBatch(symbols) {
    const uniqueSymbols = []
    const seenSymbols = new Set()
    for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || seenSymbols.has(symbol)) continue
      seenSymbols.add(symbol)
      uniqueSymbols.push(symbol)
    }

    const unresolvedSymbols = uniqueSymbols.filter(
      (symbol) => !geneDetailCache.has(symbol) && !geneDetailPromiseCache.has(symbol),
    )

    if (unresolvedSymbols.length) {
      const batchRequest = (async () => {
        try {
          const resp = await extensionApiFetch(ICONOPLASM_GENE_BATCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols: unresolvedSymbols }),
          })
          if (!resp.ok) {
            throw new Error("HTTP " + String(resp.status || 0))
          }
          const payload = (await resp.json()) || {}
          const genes = Array.isArray(payload.genes) ? payload.genes : []
          const resolvedMap = new Map()
          for (const record of genes) {
            const symbol = String((record && record.symbol) || "")
              .trim()
              .toUpperCase()
            if (!symbol) continue
            const safeRecord = record && typeof record === "object" ? record : null
            geneDetailCache.set(symbol, safeRecord)
            resolvedMap.set(symbol, safeRecord)
          }
          const missingSymbols = Array.isArray(payload.missing) ? payload.missing : []
          for (const rawMissing of missingSymbols) {
            const symbol = String(rawMissing || "")
              .trim()
              .toUpperCase()
            if (!symbol) continue
            geneDetailCache.set(symbol, null)
            resolvedMap.set(symbol, null)
          }
          for (const symbol of unresolvedSymbols) {
            if (!resolvedMap.has(symbol)) {
              geneDetailCache.set(symbol, null)
            }
          }
        } catch (err) {
          console.error("[Iconoplasm] extension gene detail batch fetch error:", err)
          for (const symbol of unresolvedSymbols) {
            geneDetailCache.set(symbol, null)
          }
        } finally {
          for (const symbol of unresolvedSymbols) {
            geneDetailPromiseCache.delete(symbol)
          }
        }
      })()

      for (const symbol of unresolvedSymbols) {
        geneDetailPromiseCache.set(
          symbol,
          batchRequest.then(() => geneDetailCache.get(symbol) || null),
        )
      }
    }

    const entries = await Promise.all(
      uniqueSymbols.map(async (symbol) => {
        if (geneDetailCache.has(symbol)) return [symbol, geneDetailCache.get(symbol) || null]
        if (geneDetailPromiseCache.has(symbol)) {
          return [symbol, await geneDetailPromiseCache.get(symbol)]
        }
        return [symbol, null]
      }),
    )
    return new Map(entries)
  }

  async function drainGeneDetailWarmQueue() {
    if (geneDetailWarmDraining) return
    geneDetailWarmDraining = true
    try {
      while (geneDetailWarmQueue.length) {
        const batch = geneDetailWarmQueue.splice(0, GENE_DETAIL_WARM_BATCH_SIZE)
        for (const symbol of batch) queuedGeneDetailSymbols.delete(symbol)
        await fetchGeneDetailsBatch(batch)
        if (geneDetailWarmQueue.length) {
          await delay(20)
        }
      }
    } finally {
      geneDetailWarmDraining = false
      if (geneDetailWarmQueue.length) {
        scheduleWarmVisibleGeneDetails()
      }
    }
  }

  function warmGeneDetails(symbols, limit = GENE_DETAIL_VISIBLE_LIMIT) {
    const uniqueSymbols = []
    const seen = new Set()
    for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || seen.has(symbol)) continue
      if (
        geneDetailCache.has(symbol) ||
        geneDetailPromiseCache.has(symbol) ||
        queuedGeneDetailSymbols.has(symbol)
      )
        continue
      seen.add(symbol)
      uniqueSymbols.push(symbol)
      if (uniqueSymbols.length >= limit) break
    }
    for (const symbol of uniqueSymbols) {
      queuedGeneDetailSymbols.add(symbol)
      geneDetailWarmQueue.push(symbol)
    }
    if (uniqueSymbols.length) {
      drainGeneDetailWarmQueue().catch(() => null)
    }
  }

  function scheduleWarmVisibleGeneDetails(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (geneDetailWarmScheduled) return
    geneDetailWarmScheduled = true
    deferGeneDetailWarm(() => {
      geneDetailWarmScheduled = false
      const sourceSymbols =
        visibilityScheduler && visibilityScheduler.hasVisibleSymbols()
          ? collectObservedVisibleGeneSymbols(limit)
          : collectVisibleGeneSymbols(limit)
      warmGeneDetails(sourceSymbols, limit)
    })
  }

  function scheduleViewportWarm() {
    if (viewportWarmFrame) return
    viewportWarmFrame = window.requestAnimationFrame(() => {
      viewportWarmFrame = 0
      scheduleWarmVisiblePortraits()
      scheduleWarmVisibleGeneDetails()
    })
  }

  async function getUsablePortraitSrc(portraitSrc) {
    if (!portraitSrc) return ""
    if (portraitDataUrlCache.has(portraitSrc)) {
      return portraitDataUrlCache.get(portraitSrc)
    }
    if (portraitDataUrlPromiseCache.has(portraitSrc)) {
      return portraitDataUrlPromiseCache.get(portraitSrc)
    }

    const request = (async () => {
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "GET_PORTRAIT_DATA_URL", url: portraitSrc },
            (result) => {
              if (chrome.runtime.lastError) {
                resolve(null)
                return
              }
              resolve(result)
            },
          )
        })

        const dataUrl = response && response.ok && response.dataUrl ? response.dataUrl : ""
        if (dataUrl) {
          portraitDataUrlCache.set(portraitSrc, dataUrl)
          return dataUrl
        }
      } catch (_) {
        // Fall back to the direct site URL below.
      } finally {
        portraitDataUrlPromiseCache.delete(portraitSrc)
      }

      return portraitSrc
    })()
    portraitDataUrlPromiseCache.set(portraitSrc, request)
    return request
  }

  async function loadTooltipPortrait({
    symbol,
    portrait,
    portraitImg,
    portraitFallback,
    portraitStatus,
    portraitSrc,
  }) {
    if (!portraitSrc) {
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait pending",
      )
      return
    }

    const loadToken = ++portraitLoadToken
    const cachedSrc = portraitDataUrlCache.get(portraitSrc)
    if (cachedSrc) {
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        cachedSrc,
        symbol + " portrait",
      )
      return
    }
    setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, "Loading portrait")

    const usableSrc = await getUsablePortraitSrc(portraitSrc)
    if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
    if (!usableSrc) {
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait unavailable",
      )
      return
    }
    if (usableSrc.startsWith("data:")) {
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        usableSrc,
        symbol + " portrait",
      )
      return
    }

    const img = new Image()
    img.onload = () => {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        usableSrc,
        symbol + " portrait",
      )
    }
    img.onerror = () => {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait unavailable",
      )
    }
    img.src = usableSrc
  }

  // -- Font injection ------------------------------------------------
  // Content scripts can't use relative URLs in CSS @font-face, so we
  // inject a <style> element with chrome.runtime.getURL paths.
  // The Paper-derived Iconoplasm label fonts are now self-hosted directly by
  // generated/shared-card-label.css using shared relative paths; keep this
  // injector limited to the extension's non-label baseline fonts so we don't
  // reintroduce per-surface font drift.
  function injectFonts() {
    const crimsonUrl = chrome.runtime.getURL("fonts/CrimsonPro-Variable.woff2")
    const xenonUrl = chrome.runtime.getURL("fonts/MonaspaceXenon-Var.woff2")
    const style = document.createElement("style")
    style.textContent = `
      @font-face {
        font-family: 'Crimson Pro';
        src: url('${crimsonUrl}') format('woff2');
        font-weight: 300 900;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: 'Monaspace Xenon Web';
        src: url('${xenonUrl}') format('woff2');
        font-weight: 200 800;
        font-style: normal;
        font-display: swap;
      }
    `
    document.head.appendChild(style)
  }

  // -- Init ----------------------------------------------------------
  async function init() {
    // Don't run on the Iconoplasm site itself -- it already shows gene
    // colors natively, and the extension just adds redundant underlines.
    if (window.location.hostname === "iconoplasm.brinedew.bio") return

    await Promise.all([loadHighlightMode(), loadTooltipTheme(), loadCardVariant()])

    const payload = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_GENE_DATA" }, resolve)
    })

    // Backward compatibility:
    // - old worker returned raw map
    // - new worker returns { genes, portraitBaseUrl }
    if (payload && payload.genes && typeof payload.genes === "object") {
      geneMap = payload.genes
      portraitBaseUrl = payload.portraitBaseUrl || ""
    } else {
      geneMap = payload
      portraitBaseUrl = ""
    }
    // Fence: candidate generation now lives in a dedicated matcher module. Keep content.js acting
    // as the page adapter that applies matches, not the place where lexical rules accrete forever.
    geneMatcher = IconoContentMatcher.createGeneMatcher(geneMap, { blocklist: BLOCKLIST })

    if (!geneMap || Object.keys(geneMap).length === 0) {
      console.log("[Iconoplasm] No gene data yet. Retrying in 5s.")
      setTimeout(init, 5000)
      return
    }

    console.log("[Iconoplasm] Loaded", Object.keys(geneMap).length, "genes. Scanning...")
    injectFonts()
    createTooltip()
    createAuthToast()
    scanPage(document.body)
    refreshHighlightStyles()
    scheduleWarmVisibleGeneDetails()
    scheduleWarmVisiblePortraits()
    if (!ensureVisibilityObserver()) {
      window.addEventListener("scroll", scheduleViewportWarm, { passive: true })
      window.addEventListener("resize", scheduleViewportWarm, { passive: true })
    }
    observeMutations()
  }

  // -- DOM scanning --------------------------------------------------
  function scanPage(root) {
    if (!root || typeof root.nodeType !== "number") return 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (parent.closest && parent.closest(".iconoplasm-tooltip")) return NodeFilter.FILTER_REJECT
        if (parent.classList && parent.classList.contains("iconoplasm-gene"))
          return NodeFilter.FILTER_REJECT
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    const textNodes = []
    while (walker.nextNode()) textNodes.push(walker.currentNode)
    let wrappedCount = 0
    for (const textNode of textNodes) {
      wrappedCount += processTextNode(textNode)
    }
    return wrappedCount
  }

  function processTextNode(textNode) {
    const text = textNode.textContent
    if (!text || !geneMatcher) return 0

    const matches = geneMatcher.findMatches(text)

    if (matches.length === 0) return 0

    const frag = document.createDocumentFragment()
    let cursor = 0

    for (const m of matches) {
      if (m.index > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, m.index)))
      }
      const span = document.createElement("span")
      span.className = "iconoplasm-gene"
      span.dataset.geneLabel = text.slice(m.index, m.index + m.length)
      const copy = document.createElement("span")
      copy.className = "iconoplasm-gene-copy"
      copy.setAttribute("data-icono-rough-copy", "true")
      copy.textContent = span.dataset.geneLabel
      span.appendChild(copy)

      const gene = geneMap[m.symbol]
      const color = gene.c || PLACEHOLDER_COLOR
      applyHighlightStyle(span, m.symbol, color)
      observeGeneElement(span)
      frag.appendChild(span)
      cursor = m.index + m.length
    }

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)))
    }

    textNode.parentNode.replaceChild(frag, textNode)
    return matches.length
  }

  // -- Mutation observer ---------------------------------------------
  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (shouldIgnoreMutationNode(node)) continue
          mutationScanRoots.add(node)
        }
      }
      scheduleMutationScan()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // -- Tooltip -------------------------------------------------------
  function createTooltip() {
    tooltip = document.createElement("div")
    tooltip.className = "iconoplasm-tooltip"
    tooltip.setAttribute("role", "tooltip")
    tooltip.innerHTML =
      '<div class="iconoplasm-tooltip-portrait">' +
      buildTooltipPortraitInnerHtml(null, null) +
      "</div>" +
      '<div class="iconoplasm-tooltip-body"></div>'
    document.body.appendChild(tooltip)
    applyTooltipTheme()

    document.addEventListener("mouseover", onMouseOver)
    document.addEventListener("mouseout", onMouseOut)
    window.addEventListener("message", onLitArchivalFrameMessage)
    tooltip.addEventListener("click", onTooltipClick)
    tooltip.addEventListener("keydown", onTooltipKeyDown)
    tooltip.addEventListener("mouseenter", cancelHideTimer)
    tooltip.addEventListener("mouseleave", onTooltipMouseLeave)
    tooltip.tabIndex = 0
  }

  function createAuthToast() {
    authToast = document.createElement("div")
    authToast.className = "iconoplasm-auth-toast"
    authToast.setAttribute("role", "status")
    authToast.setAttribute("aria-live", "polite")
    document.body.appendChild(authToast)
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    if (changes[HIGHLIGHT_MODE_KEY]) {
      highlightMode = normalizeHighlightMode(changes[HIGHLIGHT_MODE_KEY].newValue)
      refreshHighlightStyles()
    }
    if (changes[TOOLTIP_THEME_KEY]) {
      tooltipTheme = normalizeTooltipTheme(changes[TOOLTIP_THEME_KEY].newValue)
      applyTooltipTheme()
    }
    if (changes[CARD_VARIANT_KEY]) {
      cardVariant = normalizeCardVariant(changes[CARD_VARIANT_KEY].newValue)
      applyTooltipTheme()
      renderTooltipBody(
        activeGeneSummary,
        geneDetailCache.get(activeSymbol) || null,
        Boolean(activeSymbol),
      )
    }
  })

  function buildSimpleTooltipBodyHtml(summaryGene, geneDetail, loading) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const fullName = String((detail && detail.full_name) || summary.n || symbol).trim()
    const assetSha = String(((detail || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
    const voteHtml = assetSha
      ? IconoCardShared.voteBoxMarkup("", { variant: "brick", showScore: false })
      : ""
    let metaHtml = ""
    if (detail) {
      const rows = IconoCardShared.collectTooltipMetaRows(detail, {
        onMissingOrigins: (warnKey, payload) => {
          if (warnedMissingTraitOrigins.has(warnKey)) return
          warnedMissingTraitOrigins.add(warnKey)
          console.error(
            "[Iconoplasm] Missing aesthetics/politics origin metadata for tooltip:",
            warnKey,
            payload,
          )
        },
      })
      metaHtml = rows.length ? IconoCardShared.renderTooltipMetaRowsHtml(rows) : ""
    } else if (loading) {
      metaHtml = IconoCardShared.renderTooltipMetaSkeletonHtml()
    }

    return (
      '<div class="iconoplasm-tooltip-header">' +
      '<div class="icono-shared-card-header-row">' +
      '<div class="icono-shared-card-header-copy">' +
      '<div class="iconoplasm-tooltip-symbol">' +
      escapeHtml(symbol) +
      "</div>" +
      '<div class="iconoplasm-tooltip-name">' +
      escapeHtml(fullName || symbol) +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-vote-slot" data-icono-tooltip-vote-slot>' +
      voteHtml +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta' +
      (detail ? "" : " iconoplasm-tooltip-meta--loading") +
      '">' +
      metaHtml +
      "</div>"
    )
  }

  function archivalTooltipGeneModel(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    return detail || {
      symbol: summary.symbol || activeSymbol || "",
      full_name: summary.n || summary.symbol || activeSymbol || "",
      color: summary.c || PLACEHOLDER_COLOR,
      essence: {},
    }
  }

  function buildLitTooltipCardModel(summaryGene, geneDetail, portraitSrcOverride) {
    const geneModel = archivalTooltipGeneModel(summaryGene, geneDetail)
    const symbol = String(geneModel.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const assetSha = String(((geneDetail || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
    const portraitSrc =
      String(portraitSrcOverride || "").trim() || buildTooltipFramePortraitSrc(summaryGene, geneDetail)
    return IconoCardShared.resolveArchivalCardModel(geneModel, {
      mode: "brick",
      layoutVariant: isImageOnlyCardVariant() ? "image-only" : "lit-archival",
      mobileReview: false,
      portraitAlt: symbol ? symbol + " portrait" : "Gene portrait",
      portraitSrc,
      titleHref: symbol ? buildGenePageUrl(symbol) : "",
      voteHtml: assetSha
        ? !isImageOnlyCardVariant() &&
          IconoCardShared.voteBoxMarkup("", {
            variant: "label",
            showScore: false,
            showArrows: false,
          })
        : "",
    })
  }

  function buildTooltipFramePortraitSrc(summaryGene, geneDetail) {
    const detailPortrait = geneDetail && geneDetail.portrait ? geneDetail.portrait : null
    const detailUrl = String(
      (detailPortrait && (detailPortrait.medium_url || detailPortrait.hero_url || detailPortrait.thumb_url)) ||
        "",
    ).trim()
    if (detailUrl) return detailUrl
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    return resolvePortraitUrl(summary)
  }

  function buildTooltipFramePortraitDimensions(summaryGene, geneDetail) {
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    if (detail && IconoCardShared && typeof IconoCardShared.portraitDimensions === "function") {
      const dims = IconoCardShared.portraitDimensions(detail)
      if (dims && Number(dims.width) > 1 && Number(dims.height) > 1) return dims
    }
    // Fence: image-only and Lit archival cards need a stable first-paint aspect ratio. Falling
    // back to 1:1 during cold hover makes some genes look square until detail hydration lands,
    // which users perceive as a random crop/zoom jump rather than ordinary loading.
    return DEFAULT_PORTRAIT_DIMENSIONS
  }

  function buildLitArchivalTooltipVoteConfig(geneDetail) {
    if (isImageOnlyCardVariant()) return null
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || activeSymbol || "")
      .trim()
      .toUpperCase()
    const portrait = (detail || {}).portrait || {}
    const assetSha = String(portrait.asset_sha256 || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return null
    return {
      symbol,
      assetSha,
      visionId: String(portrait.vision_id || "").trim(),
      candidateImageId: Number(portrait.candidate_image_id || 0),
      apiBaseUrl: ICONOPLASM_API_BASE,
    }
  }

  function buildLitArchivalTooltipFrameHtml(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    return (
      '<div class="iconoplasm-tooltip-lit-frame-shell">' +
      '<iframe class="iconoplasm-tooltip-lit-frame" data-icono-frame-ready="false" src="' +
      escapeHtml(LIT_ARCHIVAL_FRAME_URL) +
      '" title="' +
      escapeHtml((symbol || "Gene") + " archival card") +
      '" scrolling="no" tabindex="-1"></iframe>' +
      "</div>"
    )
  }

  function postLitArchivalFramePayload(iframe, payload) {
    if (!iframe || !iframe.isConnected || !iframe.contentWindow) return
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") {
      iframe.__iconoPendingPayload = payload
      return
    }
    try {
      iframe.contentWindow.postMessage(payload, LIT_ARCHIVAL_FRAME_ORIGIN)
    } catch (err) {
      console.error("[Iconoplasm] failed to post archival frame payload:", err)
    }
  }

  function prewarmLitArchivalFramePortraitSrcs(sources) {
    if (!tooltip || !usesTooltipFrameRenderer()) return
    const iframe = tooltip.querySelector(".iconoplasm-tooltip-lit-frame")
    if (!iframe || !iframe.isConnected || !iframe.contentWindow) return
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") return
    const usableSources = Array.from(
      new Set(
        (Array.isArray(sources) ? sources : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    )
    if (!usableSources.length) return
    try {
      iframe.contentWindow.postMessage(
        {
          type: LIT_ARCHIVAL_PREWARM_MESSAGE,
          sources: usableSources,
        },
        LIT_ARCHIVAL_FRAME_ORIGIN,
      )
    } catch (err) {
      console.error("[Iconoplasm] failed to prewarm archival frame portraits:", err)
    }
  }

  function mountLitArchivalTooltipFrame(body, summaryGene, geneDetail) {
    const iframe = body.querySelector(".iconoplasm-tooltip-lit-frame")
    if (!iframe) return
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const directPortraitSrc = buildTooltipFramePortraitSrc(summaryGene, geneDetail)
    const warmedPortraitSrc = directPortraitSrc ? portraitDataUrlCache.get(directPortraitSrc) || "" : ""
    const payload = {
      type: LIT_ARCHIVAL_RENDER_MESSAGE,
      requestId: String(++litArchivalFrameRequestSerial),
      theme: tooltipTheme,
      cardVariant,
      symbol,
      pageUrl: symbol ? buildGenePageUrl(symbol) : "",
      loading: !detail,
      gene: detail || archivalTooltipGeneModel(summaryGene, null),
      portraitSrc: warmedPortraitSrc || directPortraitSrc,
      portraitDimensions: buildTooltipFramePortraitDimensions(summaryGene, geneDetail),
      model: buildLitTooltipCardModel(summaryGene, geneDetail, warmedPortraitSrc || directPortraitSrc),
      vote: buildLitArchivalTooltipVoteConfig(geneDetail),
    }
    if (warmedPortraitSrc) {
      // Fence: neighboring hovers only feel instant if the rendering iframe has already decoded
      // the warmed source. Caching bytes in the content script alone still leaves a paint-time
      // decode gap that users perceive as a blink.
      prewarmLitArchivalFramePortraitSrcs([warmedPortraitSrc])
    }
    postLitArchivalFramePayload(iframe, payload)
    if (!directPortraitSrc || warmedPortraitSrc) return
    getUsablePortraitSrc(directPortraitSrc)
      .then((usablePortraitSrc) => {
        if (!usablePortraitSrc) return
        if (!iframe.isConnected) return
        if (activeSymbol !== symbol) return
        const hydratedPayload = Object.assign({}, payload, {
          portraitSrc: usablePortraitSrc,
          model: buildLitTooltipCardModel(summaryGene, geneDetail, usablePortraitSrc),
        })
        prewarmLitArchivalFramePortraitSrcs([usablePortraitSrc])
        postLitArchivalFramePayload(iframe, hydratedPayload)
      })
      .catch(() => null)
  }

  function buildTooltipPortraitInnerHtml(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const model = detail || {
      symbol: summary.symbol || activeSymbol || "",
      color: summary.c || PLACEHOLDER_COLOR,
    }
    if (isArchivalCardVariant()) {
      return IconoCardShared.renderLabLabelSpecimenRailHtml(
        '<img class="iconoplasm-tooltip-portrait-img" alt="" />' +
          '<div class="iconoplasm-tooltip-portrait-fallback">' +
          '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
          '<div class="iconoplasm-tooltip-portrait-symbol"></div>' +
          "</div>",
        model,
      )
    }
    return (
      '<img class="iconoplasm-tooltip-portrait-img" alt="" />' +
      '<div class="iconoplasm-tooltip-portrait-fallback">' +
      '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
      '<div class="iconoplasm-tooltip-portrait-symbol"></div>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-portrait-fade"></div>'
    )
  }

  function renderTooltipBody(summaryGene, geneDetail, loading) {
    if (!tooltip) return
    const body = tooltip.querySelector(".iconoplasm-tooltip-body")
    if (!body) return
    if (usesTooltipFrameRenderer()) {
      // Fence: all maintained rich layouts are Lit-owned now. The removed legacy non-Lit vintage
      // card must not come back as a third tooltip branch or we will reintroduce spec drift.
      if (!body.querySelector(".iconoplasm-tooltip-lit-frame")) {
        body.innerHTML = buildLitArchivalTooltipFrameHtml(summaryGene, geneDetail)
      }
      mountLitArchivalTooltipFrame(body, summaryGene, geneDetail)
      return
    }
    body.innerHTML = buildSimpleTooltipBodyHtml(summaryGene, geneDetail, loading)
  }

  function wireRenderedTooltipVoteBox(geneDetail) {
    if (usesTooltipFrameRenderer()) return
    if (!tooltip || !geneDetail) return
    const box = tooltip.querySelector("[data-icono-vote-box]")
    if (!box) return
    const symbol = String((geneDetail && geneDetail.symbol) || activeSymbol || "")
      .trim()
      .toUpperCase()
    const portrait = (geneDetail || {}).portrait || {}
    const assetSha = String(portrait.asset_sha256 || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return
    IconoCardShared.wireVoteBox(box, {
      symbol,
      assetSha,
      visionId: String(portrait.vision_id || "").trim(),
      candidateImageId: Number(portrait.candidate_image_id || 0),
      apiBaseUrl: ICONOPLASM_API_BASE,
      fetchImpl: extensionApiFetch,
      onAuthRequired: showVoteLoginPopup,
      onError: (phase, err) => {
        console.error("[Iconoplasm] extension vote " + phase + " error:", err)
      },
    })
  }

  async function fetchGeneDetailForTooltip(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return null
    if (geneDetailCache.has(normalizedSymbol)) return geneDetailCache.get(normalizedSymbol)
    if (geneDetailPromiseCache.has(normalizedSymbol)) return geneDetailPromiseCache.get(normalizedSymbol)
    const responses = await fetchGeneDetailsBatch([normalizedSymbol])
    return responses.get(normalizedSymbol) || null
  }

  function onTooltipClick(e) {
    if (e && e.target && e.target.closest("[data-icono-vote-box]")) return
    openGenePage(activeSymbol)
  }

  function onTooltipKeyDown(e) {
    if (e.target && e.target.closest("[data-icono-vote-box]")) return
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    openGenePage(activeSymbol)
  }

  function onMouseOver(e) {
    const target = e.target.closest(".iconoplasm-gene")
    if (!target) return
    cancelHideTimer()

    const symbol = target.dataset.gene
    const gene = geneMap[symbol]
    if (!gene) return
    if (activeSymbol && activeSymbol !== symbol) {
      clearPendingDiscovery(activeSymbol)
    }
    activeSymbol = symbol
    activeGeneSummary = Object.assign({ symbol }, gene)
    // Fence: fetch the hovered gene before warming neighbors. Reversing this puts the hovered
    // symbol into the warm queue first, so the visible card waits on background work.
    const hoverGeneDetailPromise = geneDetailCache.has(symbol)
      ? Promise.resolve(geneDetailCache.get(symbol) || null)
      : fetchGeneDetailForTooltip(symbol)
    const neighborSymbols = collectNeighborGeneSymbols(target, GENE_DETAIL_WARM_BATCH_SIZE).filter(
      (neighborSymbol) => neighborSymbol !== symbol,
    )
    warmGeneDetails(neighborSymbols, GENE_DETAIL_WARM_BATCH_SIZE - 1)
    warmPortraitUrls(collectNeighborPortraitUrls(target, GENE_DETAIL_WARM_BATCH_SIZE))

    const color = gene.c || PLACEHOLDER_COLOR
    const usesFrameRenderer = usesTooltipFrameRenderer()

    // Fill tooltip content
    const portrait = tooltip.querySelector(".iconoplasm-tooltip-portrait")
    if (portrait && !usesFrameRenderer) {
      portrait.innerHTML = buildTooltipPortraitInnerHtml(activeGeneSummary, null)
    }
    const portraitImg = usesFrameRenderer
      ? null
      : tooltip.querySelector(".iconoplasm-tooltip-portrait-img")
    const fade = usesFrameRenderer ? null : tooltip.querySelector(".iconoplasm-tooltip-portrait-fade")
    const portraitFallback = usesFrameRenderer
      ? null
      : tooltip.querySelector(".iconoplasm-tooltip-portrait-fallback")
    const portraitStatus = usesFrameRenderer
      ? null
      : tooltip.querySelector(".iconoplasm-tooltip-portrait-status")
    const portraitSymbol = usesFrameRenderer
      ? null
      : tooltip.querySelector(".iconoplasm-tooltip-portrait-symbol")
    if (!usesFrameRenderer) {
      const portraitSrc = resolvePortraitUrl(gene)
      loadTooltipPortrait({
        symbol,
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        portraitSrc,
      })
      if (portraitSymbol) portraitSymbol.textContent = symbol
    }

    // Keep the reading surface neutral; gene color is an accent only.
    tooltip.style.backgroundColor = ""
    tooltip.style.setProperty("--iconoplasm-gene-color", color)
    if (fade) fade.style.background = ""
    if (portraitSymbol) portraitSymbol.style.color = ""

    const hoverSymbol = symbol
    if (geneDetailCache.has(symbol)) {
      const geneDetail = geneDetailCache.get(symbol)
      renderTooltipBody(activeGeneSummary, geneDetail, false)
      wireRenderedTooltipVoteBox(geneDetail)
    } else {
      // Reserve the metadata area immediately so the title block never jumps.
      renderTooltipBody(activeGeneSummary, null, true)
      hoverGeneDetailPromise.then((geneDetail) => {
        if (activeSymbol === hoverSymbol && geneDetail) {
          renderTooltipBody(activeGeneSummary, geneDetail, false)
          wireRenderedTooltipVoteBox(geneDetail)
        } else if (activeSymbol === hoverSymbol) {
          renderTooltipBody(activeGeneSummary, null, false)
        }
      })
    }

    // Position tooltip
    const rect = target.getBoundingClientRect()
    const tooltipWidth = tooltip.offsetWidth || 500
    const tooltipHeight = tooltip.offsetHeight || 248

    let left = rect.left + rect.width / 2 - tooltipWidth / 2
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8))

    const showBelow = rect.top < tooltipHeight + 16

    tooltip.style.left = left + window.scrollX + "px"
    if (showBelow) {
      tooltip.style.top = rect.bottom + window.scrollY + 8 + "px"
    } else {
      tooltip.style.top = rect.top + window.scrollY - tooltipHeight - 8 + "px"
    }

    tooltip.classList.add("iconoplasm-tooltip-visible")
    scheduleDiscoveryEncounter(symbol)
  }

  function onMouseOut(e) {
    const target = e.target.closest(".iconoplasm-gene")
    if (!target) return
    const related = e.relatedTarget
    if (related && (related.closest(".iconoplasm-tooltip") || related.closest(".iconoplasm-gene")))
      return
    clearPendingDiscovery(activeSymbol)
    scheduleHideTooltip()
  }

  function onTooltipMouseLeave(e) {
    const related = e.relatedTarget
    if (related && (related.closest(".iconoplasm-tooltip") || related.closest(".iconoplasm-gene")))
      return
    clearPendingDiscovery(activeSymbol)
    scheduleHideTooltip()
  }

  function onLitArchivalFrameMessage(event) {
    const data = event && event.data && typeof event.data === "object" ? event.data : null
    if (!data || data.source !== LIT_ARCHIVAL_FRAME_SOURCE) return
    const iframe = tooltip ? tooltip.querySelector(".iconoplasm-tooltip-lit-frame") : null
    if (!iframe || event.source !== iframe.contentWindow) return
    if (data.type === LIT_ARCHIVAL_READY_MESSAGE) {
      iframe.dataset.iconoFrameReady = "true"
      if (iframe.__iconoPendingPayload) {
        const pendingPayload = iframe.__iconoPendingPayload
        iframe.__iconoPendingPayload = null
        postLitArchivalFramePayload(iframe, pendingPayload)
      }
      return
    }
    if (data.type === LIT_ARCHIVAL_OPEN_MESSAGE) {
      openGenePage(String(data.symbol || activeSymbol || "").trim().toUpperCase())
      return
    }
    if (data.type === LIT_ARCHIVAL_AUTH_REQUIRED_MESSAGE) {
      showVoteLoginPopup()
    }
  }

  function hideTooltip() {
    cancelHideTimer()
    clearPendingDiscovery(activeSymbol)
    activeSymbol = null
    activeGeneSummary = null
    portraitLoadToken += 1
    tooltip.classList.remove("iconoplasm-tooltip-visible")
  }

  // -- Go ------------------------------------------------------------
  init()
})()
