// Iconoplasm content script -- scans page text for gene symbols, wraps them,
// and shows horizontal hover infoboxes with portrait + gene color border.
// Canonical extension root now lives in D:\Coding\Website\iconoplasm-extension.

(function () {
  'use strict';

  const IconoCardShared = globalThis.IconoplasmCardShared;
  if (!IconoCardShared) {
    console.error('[Iconoplasm] shared card runtime missing: load generated/shared-card-runtime.js first');
    return;
  }

  // -- Placeholder color for genes without color data ----------------
  const PLACEHOLDER_COLOR = '#6B6B78';
  const HIGHLIGHT_MODE_KEY = 'iconoplasm_highlight_mode';
  const TOOLTIP_THEME_KEY = 'iconoplasm_tooltip_theme';
  const CARD_VARIANT_KEY = 'iconoplasm_card_variant';
  const ICONOPLASM_API_BASE = IconoCardShared.resolveApiBase('https://iconoplasm.brinedew.bio');
  const escapeHtml = IconoCardShared.escapeHtml;

  function extensionApiFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : String((input && input.url) || '');
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'ICONOPLASM_API_FETCH',
            url,
            method: String(init.method || 'GET').toUpperCase(),
            headers: init.headers && typeof init.headers === 'object' ? init.headers : {},
            body: typeof init.body === 'string' ? init.body : undefined,
            credentials: init.credentials === 'include' ? 'include' : 'same-origin',
          },
          (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || 'Extension API fetch failed'));
              return;
            }
            if (!result || typeof result !== 'object') {
              reject(new Error('Extension API fetch returned no response'));
              return;
            }
            const payload = result && typeof result === 'object' ? result : {};
            const rawText = String(payload.text || '');
            resolve({
              ok: Boolean(payload.ok),
              status: Number(payload.status || 0),
              text: () => Promise.resolve(rawText),
              json: () => Promise.resolve(rawText ? JSON.parse(rawText) : null),
            });
          },
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  // -- Luminance + text color helpers --------------------------------
  function hexLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // Returns { primary, muted } text colors for a given hex background
  function textColors(hex) {
    const lum = hexLuminance(hex);
    const darkContrast = (lum + 0.05) / 0.05;
    const lightContrast = 1.05 / (lum + 0.05);
    if (darkContrast >= lightContrast) {
      return {
        primary: 'rgb(24, 22, 20)',
        muted: 'rgba(24, 22, 20, 0.82)',
        separator: 'rgba(24, 22, 20, 0.16)',
      };
    }
    return {
      primary: 'rgb(249, 247, 242)',
      muted: 'rgba(249, 247, 242, 0.86)',
      separator: 'rgba(249, 247, 242, 0.16)',
    };
  }

  function normalizeHighlightMode(raw) {
    return String(raw || '').trim().toLowerCase() === 'pill' ? 'pill' : 'underline';
  }

  function normalizeTooltipTheme(raw) {
    return String(raw || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
  }

  function normalizeCardVariant(raw) {
    return IconoCardShared.normalizeCardVariant(raw);
  }

  async function loadHighlightMode() {
    try {
      const result = await chrome.storage.local.get([HIGHLIGHT_MODE_KEY]);
      highlightMode = normalizeHighlightMode(result[HIGHLIGHT_MODE_KEY]);
    } catch (_) {
      highlightMode = 'underline';
    }
  }

  async function loadTooltipTheme() {
    try {
      const result = await chrome.storage.local.get([TOOLTIP_THEME_KEY]);
      tooltipTheme = normalizeTooltipTheme(result[TOOLTIP_THEME_KEY]);
    } catch (_) {
      tooltipTheme = 'light';
    }
  }

  async function loadCardVariant() {
    try {
      const result = await chrome.storage.local.get([CARD_VARIANT_KEY]);
      cardVariant = normalizeCardVariant(result[CARD_VARIANT_KEY]);
    } catch (_) {
      cardVariant = 'classic';
    }
  }

  function applyTooltipTheme() {
    if (!tooltip) return;
    tooltip.classList.toggle('iconoplasm-tooltip--dark', tooltipTheme === 'dark');
    tooltip.classList.toggle('iconoplasm-tooltip--light', tooltipTheme !== 'dark');
    tooltip.classList.toggle('iconoplasm-tooltip--variant-lab-label', cardVariant === 'lab-label');
  }

  function applyHighlightStyle(el, symbol, color) {
    if (!el) return;
    const tc = textColors(color || PLACEHOLDER_COLOR);
    el.dataset.gene = symbol;
    el.style.setProperty('--iconoplasm-gene-color', color || PLACEHOLDER_COLOR);
    el.style.setProperty('--iconoplasm-gene-fg', tc.primary);
    el.classList.toggle('iconoplasm-gene--pill', highlightMode === 'pill');
    el.classList.toggle('iconoplasm-gene--underline', highlightMode !== 'pill');
  }

  function refreshHighlightStyles(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    const genes = scope.querySelectorAll('.iconoplasm-gene');
    for (const el of genes) {
      const symbol = el.dataset ? el.dataset.gene : '';
      const gene = symbol ? geneMap && geneMap[symbol] : null;
      const color = gene && gene.c ? gene.c : PLACEHOLDER_COLOR;
      applyHighlightStyle(el, symbol, color);
    }
  }

  // -- Disambiguation blocklist --------------------------------------
  // Gene symbols that are common English words. Only symbols <= 4 chars
  // are checked; longer symbols are safe.
  const BLOCKLIST = new Set([
    'A', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'IF', 'IN', 'IS',
    'IT', 'ME', 'MY', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'US',
    'WE', 'ACE', 'ADD', 'AGE', 'AIM', 'AIR', 'ALL', 'AND', 'ANY', 'ARC',
    'ARE', 'ARM', 'ART', 'ASH', 'BAD', 'BAG', 'BAN', 'BAR', 'BAS', 'BAT',
    'BED', 'BIG', 'BIT', 'BOX', 'BOY', 'BUD', 'BUS', 'BUT', 'BUY', 'CAB',
    'CAN', 'CAP', 'CAR', 'CAT', 'COP', 'CRY', 'CUP', 'CUT', 'DAD', 'DAM',
    'DAY', 'DID', 'DIG', 'DIP', 'DOC', 'DOG', 'DOT', 'DRY', 'DUE', 'DUG',
    'EAR', 'EAT', 'END', 'ERA', 'EVE', 'EYE', 'FAN', 'FAR', 'FAT', 'FAX',
    'FED', 'FEW', 'FIG', 'FIN', 'FIT', 'FIX', 'FLY', 'FOR', 'FOX', 'FUN',
    'FUR', 'GAP', 'GAS', 'GET', 'GOD', 'GOT', 'GUM', 'GUN', 'GUT', 'GUY',
    'HAD', 'HAM', 'HAS', 'HAT', 'HER', 'HID', 'HIM', 'HIP', 'HIS', 'HIT',
    'HOG', 'HOP', 'HOT', 'HOW', 'HUB', 'HUG', 'ICE', 'ILL', 'INK', 'INN',
    'ION', 'ITS', 'JAM', 'JAR', 'JAW', 'JET', 'JOB', 'JOG', 'JOY', 'JUG',
    'KEY', 'KID', 'KIT', 'LAB', 'LAP', 'LAW', 'LAY', 'LED', 'LEG', 'LET',
    'LID', 'LIE', 'LIP', 'LIT', 'LOG', 'LOT', 'LOW', 'MAD', 'MAN', 'MAP',
    'MAT', 'MAY', 'MEN', 'MET', 'MID', 'MIX', 'MOB', 'MOM', 'MOP', 'MUD',
    'MUG', 'NAP', 'NET', 'NEW', 'NIT', 'NOR', 'NOT', 'NOW', 'NUN', 'NUT',
    'OAK', 'OAR', 'OAT', 'ODD', 'OFF', 'OIL', 'OLD', 'ONE', 'OUR', 'OUT',
    'OWE', 'OWL', 'OWN', 'PAD', 'PAN', 'PAT', 'PAW', 'PAY', 'PEA', 'PEN',
    'PET', 'PIE', 'PIG', 'PIN', 'PIT', 'POD', 'POP', 'POT', 'PRO', 'PUB',
    'PUN', 'PUP', 'PUT', 'RAG', 'RAN', 'RAP', 'RAT', 'RAW', 'RAY', 'RED',
    'REF', 'RIB', 'RID', 'RIG', 'RIM', 'RIP', 'ROB', 'ROD', 'ROT', 'ROW',
    'RUB', 'RUG', 'RUN', 'RUT', 'SAD', 'SAP', 'SAT', 'SAW', 'SAY', 'SEA',
    'SET', 'SEW', 'SHE', 'SHY', 'SIN', 'SIP', 'SIS', 'SIT', 'SIX', 'SKI',
    'SKY', 'SLY', 'SOB', 'SOD', 'SON', 'SOP', 'SOT', 'SOW', 'SOY', 'SPA',
    'SPY', 'STY', 'SUB', 'SUM', 'SUN', 'TAB', 'TAG', 'TAN', 'TAP', 'TAR',
    'TAX', 'TEA', 'TEN', 'THE', 'TIE', 'TIN', 'TIP', 'TOE', 'TON', 'TOO',
    'TOP', 'TOW', 'TOY', 'TUB', 'TUG', 'TWO', 'URN', 'USE', 'VAN', 'VAT',
    'VET', 'VIA', 'VOW', 'WAR', 'WAS', 'WAX', 'WAY', 'WEB', 'WED', 'WET',
    'WHO', 'WHY', 'WIG', 'WIN', 'WIT', 'WOE', 'WOK', 'WON', 'WOO', 'WOW',
    'YAM', 'YAP', 'YAW', 'YEA', 'YES', 'YET', 'YEW', 'YOU', 'ZAP', 'ZEN',
    'ZIP', 'ZOO',
    // 4-letter common words
    'ACHE', 'AGED', 'ALSO', 'AMID', 'ARCH', 'AREA', 'ARMY', 'ARTS', 'AWAY',
    'BACK', 'BAIT', 'BAKE', 'BALL', 'BAND', 'BANG', 'BANK', 'BARE', 'BARN',
    'BASE', 'BATH', 'BEAM', 'BEAN', 'BEAR', 'BEAT', 'BEEF', 'BEEN', 'BELL',
    'BELT', 'BEND', 'BENT', 'BEST', 'BIAS', 'BIKE', 'BILL', 'BIND', 'BIRD',
    'BITE', 'BLADE', 'BLOW', 'BLUE', 'BLUR', 'BOAT', 'BODY', 'BOLD', 'BOLT',
    'BOMB', 'BOND', 'BONE', 'BOOK', 'BOOT', 'BORE', 'BORN', 'BOSS', 'BOTH',
    'BOWL', 'BRED', 'BREW', 'BUCK', 'BULK', 'BULL', 'BUMP', 'BURN', 'BURY',
    'BUSY', 'BUZZ', 'CAFE', 'CAGE', 'CAKE', 'CALL', 'CALM', 'CAME', 'CAMP',
    'CAPE', 'CARD', 'CARE', 'CART', 'CASE', 'CASH', 'CAST', 'CAVE', 'CELL',
    'CHAT', 'CHIP', 'CHOP', 'CITE', 'CITY', 'CLAD', 'CLAM', 'CLAN', 'CLAP',
    'CLAY', 'CLIP', 'CLUB', 'CLUE', 'COAL', 'COAT', 'CODE', 'COIL', 'COIN',
    'COLD', 'COME', 'COOK', 'COOL', 'COPE', 'COPY', 'CORD', 'CORE', 'CORK',
    'CORN', 'COST', 'COUP', 'CREW', 'CROP', 'CROSS','CURE', 'CURL', 'CUTE',
    'DARE', 'DARK', 'DASH', 'DATA', 'DATE', 'DAWN', 'DEAD', 'DEAF', 'DEAL',
    'DEAR', 'DEBT', 'DECK', 'DEED', 'DEEM', 'DEEP', 'DEER', 'DEMO', 'DENY',
    'DESK', 'DIAL', 'DICE', 'DIET', 'DIRT', 'DISC', 'DISH', 'DISK', 'DOCK',
    'DOES', 'DOME', 'DONE', 'DOOM', 'DOOR', 'DOSE', 'DOWN', 'DRAG', 'DRAW',
    'DREW', 'DROP', 'DRUM', 'DUAL', 'DUDE', 'DUEL', 'DULL', 'DUMB', 'DUMP',
    'DUNE', 'DUSK', 'DUST', 'DUTY', 'EACH', 'EARN', 'EASE', 'EAST', 'EASY',
    'ECHO', 'EDGE', 'EDIT', 'ELSE', 'EMIT', 'EPIC', 'EVEN', 'EVER', 'EVIL',
    'EXAM', 'EXEC', 'EXIT', 'FACE', 'FACT', 'FADE', 'FAIL', 'FAIR', 'FAKE',
    'FALL', 'FAME', 'FANS', 'FARE', 'FARM', 'FAST', 'FATE', 'FEAR', 'FEAT',
    'FEED', 'FEEL', 'FEET', 'FELL', 'FELT', 'FILE', 'FILL', 'FILM', 'FINAL',
    'FIND', 'FINE', 'FIRE', 'FIRM', 'FISH', 'FIST', 'FIVE', 'FLAG', 'FLAP',
    'FLAT', 'FLAW', 'FLED', 'FLEW', 'FLIP', 'FLOW', 'FOAM', 'FOES', 'FOLD',
    'FOLK', 'FOND', 'FONT', 'FOOD', 'FOOL', 'FOOT', 'FORD', 'MENU', 'MERE',
    'FORM', 'FORT', 'FOUL', 'FOUR', 'FREE', 'FROM', 'FUEL', 'FULL', 'FUND',
    'FURY', 'FUSE', 'FUSS', 'GAIN', 'GALA', 'GALE', 'GAME', 'GANG', 'GARB',
    'GATE', 'GAVE', 'GAZE', 'GEAR', 'GENE', 'GIFT', 'GLAD', 'GLOW', 'GLUE',
    'GOAT', 'GOES', 'GOLD', 'GOLF', 'GONE', 'GOOD', 'GRAB', 'GRAM', 'GRAY',
    'GREW', 'GREY', 'GRID', 'GRIM', 'GRIN', 'GRIP', 'GRIT', 'GROW', 'GULF',
    'GURU', 'GUST', 'GUYS', 'HACK', 'HAIL', 'HAIR', 'HALE', 'HALF', 'HALL',
    'HALT', 'HAND', 'HANG', 'HARD', 'HARM', 'HARP', 'HASH', 'HATE', 'HAVE',
    'HAUL', 'HAZE', 'HEAD', 'HEAL', 'HEAP', 'HEAR', 'HEAT', 'HEED', 'HEEL',
    'HELD', 'HELL', 'HELP', 'HERB', 'HERE', 'HERO', 'HIGH', 'HIKE', 'HILL',
    'HINT', 'HIRE', 'HOLD', 'HOLE', 'HOME', 'HOOD', 'HOOK', 'HOPE', 'HORN',
    'HOST', 'HOUR', 'HUGE', 'HULL', 'HUNG', 'HUNT', 'HURT', 'HUSH', 'HYMN',
    'ICON', 'IDEA', 'IDLE', 'INCH', 'INFO', 'INTO', 'IRON', 'ITEM', 'JACK',
    'JAIL', 'JAZZ', 'JEAN', 'JEST', 'JOBS', 'JOIN', 'JOKE', 'JUMP', 'JURY',
    'JUST', 'KEEN', 'KEEP', 'KEPT', 'KICK', 'KIDS', 'KILL', 'KIND', 'KING',
    'KISS', 'KNOT', 'KNOW', 'LACE', 'LACK', 'LAID', 'LAKE', 'LAMB', 'LAME',
    'LAMP', 'LAND', 'LANE', 'LAPS', 'LAST', 'LATE', 'LAWN', 'LEAD', 'LEAF',
    'LEAK', 'LEAN', 'LEAP', 'LEFT', 'LEND', 'LENS', 'LESS', 'LIED', 'LIEU',
    'LIFE', 'LIFT', 'LIKE', 'LIMB', 'LIME', 'LIMP', 'LINE', 'LINK', 'LION',
    'LIST', 'LIVE', 'LOAD', 'LOAN', 'LOCK', 'LOFT', 'LOGO', 'LONG', 'LOOK',
    'LOOP', 'LORD', 'LOSE', 'LOSS', 'LOST', 'LOTS', 'LOUD', 'LOVE', 'LUCK',
    'LUMP', 'LUNG', 'LURE', 'LUSH', 'MADE', 'MAIL', 'MAIN', 'MAKE', 'MALE',
    'MALL', 'MALT', 'MANE', 'MANY', 'MARK', 'MARS', 'MASH', 'MASK', 'MASS',
    'MAST', 'MATE', 'MATH', 'MAZE', 'MEAL', 'MEAN', 'MEAT', 'MEET', 'MELT',
    'MEMO', 'MEND', 'MESH', 'MESS', 'MILD', 'MILE', 'MILK', 'MILL', 'MIND',
    'MINE', 'MINT', 'MISS', 'MODE', 'MOLD', 'MOOD', 'MOON', 'MORE', 'MOSS',
    'MOST', 'MOTH', 'MOVE', 'MUCH', 'MUSE', 'MUST', 'MUTE', 'MYTH', 'NAIL',
    'NAME', 'NAVY', 'NEAR', 'NEAT', 'NECK', 'NEED', 'NEST', 'NEWS', 'NEXT',
    'NICE', 'NINE', 'NODE', 'NONE', 'NOON', 'NORM', 'NOSE', 'NOTE', 'NOUN',
    'NUDE', 'OATH', 'OBEY', 'ODDS', 'OKAY', 'ONCE', 'ONLY', 'ONTO', 'OPEN',
    'OPTS', 'ORAL', 'OURS', 'OUST', 'OVEN', 'OVER', 'PACE', 'PACK', 'PAGE',
    'PAID', 'PAIL', 'PAIN', 'PAIR', 'PALE', 'PALM', 'PANE', 'PARA', 'PARK',
    'PART', 'PASS', 'PAST', 'PATH', 'PEAK', 'PEAR', 'PEEL', 'PEER', 'PEST',
    'PICK', 'PIER', 'PILE', 'PINE', 'PINK', 'PIPE', 'PITY', 'PLAN', 'PLAY',
    'PLEA', 'PLOT', 'PLOY', 'PLUG', 'PLUM', 'PLUS', 'POEM', 'POET', 'POLL',
    'POLO', 'POND', 'POOL', 'POOR', 'POPE', 'PORK', 'PORT', 'POSE', 'POST',
    'POUR', 'PRAY', 'PREY', 'PROP', 'PULL', 'PULP', 'PUMP', 'PURE', 'PUSH',
    'QUIT', 'QUIZ', 'RACE', 'RACK', 'RAGE', 'RAID', 'RAIL', 'RAIN', 'RARE',
    'RANK', 'RASH', 'RATE', 'READ', 'REAL', 'REAR', 'REEF', 'REIN', 'RELY',
    'RENT', 'REST', 'RICH', 'RIDE', 'RIFT', 'RING', 'RIOT', 'RIPE', 'RISE',
    'RISK', 'ROAD', 'ROAM', 'ROCK', 'RODE', 'ROLE', 'ROLL', 'ROOF', 'ROOM',
    'ROOT', 'ROPE', 'ROSE', 'RUDE', 'RUIN', 'RULE', 'RUSH', 'RUST', 'SAFE',
    'SAGE', 'SAID', 'SAKE', 'SALE', 'SALT', 'SAME', 'SAND', 'SANE', 'SANG',
    'SANK', 'SAVE', 'SCAN', 'SEAL', 'SEED', 'SEEK', 'SEEM', 'SEEN', 'SELF',
    'SELL', 'SEND', 'SENT', 'SHIP', 'SHOE', 'SHOP', 'SHOT', 'SHOW', 'SHUT',
    'SICK', 'SIDE', 'SIGH', 'SIGN', 'SILK', 'SING', 'SINK', 'SITE', 'SIZE',
    'SKIN', 'SKIP', 'SLAM', 'SLAP', 'SLEW', 'SLID', 'SLIM', 'SLIP', 'SLOT',
    'SLOW', 'SNAP', 'SNOW', 'SOAK', 'SOAP', 'SOAR', 'SOCK', 'SOFT', 'SOIL',
    'SOLD', 'SOLE', 'SOME', 'SONG', 'SOON', 'SORE', 'SORT', 'SOUL', 'SOUR',
    'SPAN', 'SPAR', 'SPEC', 'SPED', 'SPIN', 'SPIT', 'SPOT', 'STAR', 'STAY',
    'STEM', 'STEP', 'STEW', 'STIR', 'STOP', 'STUB', 'STUD', 'SUCH', 'SUIT',
    'SUNG', 'SUNK', 'SURE', 'SURF', 'SWAP', 'SWIM', 'TABS', 'TAIL', 'TAKE',
    'TALE', 'TALK', 'TALL', 'TAME', 'TANK', 'TAPE', 'TASK', 'TAUT', 'TEAM',
    'TEAR', 'TELL', 'TEND', 'TENT', 'TERM', 'TEST', 'TEXT', 'THAN', 'THAT',
    'THEM', 'THEN', 'THEY', 'THIN', 'THIS', 'THUS', 'TICK', 'TIDE', 'TIDY',
    'TIED', 'TIER', 'TILE', 'TILL', 'TILT', 'TIME', 'TINY', 'TIRE', 'TOAD',
    'TOE', 'TOLD', 'TOLL', 'TOMB', 'TONE', 'TOOK', 'TOOL', 'TOPS', 'TORE',
    'TORN', 'TOSS', 'TOUR', 'TOWN', 'TRAP', 'TRAY', 'TREE', 'TREK', 'TRIM',
    'TRIP', 'TROT', 'TRUE', 'TUBE', 'TUCK', 'TUNE', 'TURN', 'TURF', 'TWIN',
    'TYPE', 'UGLY', 'UNDO', 'UNIT', 'UNTO', 'UPON', 'URGE', 'USED', 'USER',
    'VAIN', 'VALE', 'VARY', 'VAST', 'VEIL', 'VEIN', 'VENT', 'VERB', 'VERY',
    'VEST', 'VETO', 'VIEW', 'VINE', 'VOID', 'VOLT', 'VOTE', 'WADE', 'WAGE',
    'WAIT', 'WAKE', 'WALK', 'WALL', 'WAND', 'WANT', 'WARD', 'WARM', 'WARN',
    'WARP', 'WARY', 'WASH', 'VAST', 'WAVE', 'WAYS', 'WEAK', 'WEAR', 'WEED',
    'WEEK', 'WELL', 'WENT', 'WERE', 'WEST', 'WHAT', 'WHEN', 'WHOM', 'WIDE',
    'WIFE', 'WILD', 'WILL', 'WILT', 'WIND', 'WINE', 'WING', 'WIPE', 'WIRE',
    'WISE', 'WISH', 'WITH', 'WOKE', 'WOLF', 'WOMB', 'WOOD', 'WOOL', 'WORD',
    'WORE', 'WORK', 'WORM', 'WORN', 'WRAP', 'WRIT', 'YARD', 'YARN', 'YEAR',
    'YELL', 'YOUR', 'ZEAL', 'ZERO', 'ZONE', 'ZOOM',
    'AA', 'AB', 'AD', 'AH', 'AM', 'AN', 'AX',
  ]);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE',
    'NOSCRIPT', 'IFRAME', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK'
  ]);

  // -- State ---------------------------------------------------------
  let geneMap = null;   // { SYMBOL: { c?, n?, u?, pt?, ph? } }
  let tooltip = null;
  let portraitBaseUrl = '';
  let activeSymbol = null;
  let hideTimer = null;
  let portraitLoadToken = 0;
  const portraitDataUrlCache = new Map();
  const warmedPortraitSrcs = new Set();
  let portraitWarmScheduled = false;
  const geneDetailCache = new Map(); // symbol -> gene payload or null
  const geneDetailPromiseCache = new Map(); // symbol -> Promise<payload|null>
  const geneDetailWarmQueue = [];
  const queuedGeneDetailSymbols = new Set();
  let geneDetailWarmScheduled = false;
  let geneDetailWarmDraining = false;
  let viewportWarmFrame = 0;
  let highlightMode = 'underline';
  let tooltipTheme = 'light';
  let cardVariant = 'classic';
  let activeGeneSummary = null;
  const warnedMissingTraitOrigins = new Set();
  const GENE_DETAIL_WARM_BATCH_SIZE = 20;
  const GENE_DETAIL_VISIBLE_LIMIT = 80;
  const GENE_DETAIL_VIEWPORT_ABOVE_PX = 160;
  const GENE_DETAIL_VIEWPORT_BELOW_PX = 960;

  function buildGenePageUrl(symbol) {
    return 'https://iconoplasm.brinedew.bio/gene/' + encodeURIComponent(symbol);
  }

  function openGenePage(symbol) {
    if (!symbol || !geneMap || !geneMap[symbol]) return;
    window.open(buildGenePageUrl(symbol), '_blank', 'noopener');
  }

  function showVoteLoginPopup() {
    window.alert('Please log in on Iconoplasm first to vote.');
  }

  function cancelHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHideTooltip(delayMs = 220) {
    cancelHideTimer();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideTooltip();
    }, delayMs);
  }

  function resolvePortraitUrl(gene) {
    const key = gene.pt || gene.ph;
    if (!key) return '';
    if (/^https?:\/\//i.test(key)) return key;
    if (key.startsWith('/')) return 'https://iconoplasm.brinedew.bio' + key;
    if (portraitBaseUrl) return portraitBaseUrl.replace(/\/+$/, '') + '/' + key.replace(/^\/+/, '');
    return 'https://iconoplasm.brinedew.bio/' + key.replace(/^\/+/, '');
  }

  function deferPortraitWarm(task) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => task(), { timeout: 800 });
      return;
    }
    window.setTimeout(task, 80);
  }

  function deferGeneDetailWarm(task) {
    window.setTimeout(task, 0);
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, statusText) {
    portraitImg.removeAttribute('src');
    portraitImg.style.display = 'none';
    portrait.classList.add('iconoplasm-tooltip-portrait-missing');
    portraitFallback.style.display = 'flex';
    portraitStatus.textContent = statusText;
  }

  function applyPortraitImage(portrait, portraitImg, portraitFallback, portraitStatus, usableSrc, altText) {
    portraitImg.src = usableSrc;
    portraitImg.alt = altText || '';
    portraitImg.style.display = 'block';
    portrait.classList.remove('iconoplasm-tooltip-portrait-missing');
    portraitFallback.style.display = 'none';
    portraitStatus.textContent = '';
  }

  function warmPortraitUrls(urls) {
    const uniqueUrls = Array.from(new Set(
      (Array.isArray(urls) ? urls : [])
        .map((url) => String(url || '').trim())
        .filter(Boolean),
    )).filter((url) => {
      if (portraitDataUrlCache.has(url) || warmedPortraitSrcs.has(url)) return false;
      warmedPortraitSrcs.add(url);
      return true;
    });
    if (!uniqueUrls.length) return;

    try {
      chrome.runtime.sendMessage({ type: 'WARM_PORTRAIT_DATA_URLS', urls: uniqueUrls }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      for (const url of uniqueUrls) {
        warmedPortraitSrcs.delete(url);
      }
    }
  }

  function scheduleWarmVisiblePortraits(limit = 24) {
    if (portraitWarmScheduled) return;
    portraitWarmScheduled = true;
    deferPortraitWarm(() => {
      portraitWarmScheduled = false;
      if (!geneMap) return;
      const urls = [];
      const seenSymbols = new Set();
      const genes = document.querySelectorAll('.iconoplasm-gene');
      for (const geneEl of genes) {
        const symbol = geneEl.dataset ? geneEl.dataset.gene : '';
        if (!symbol || seenSymbols.has(symbol)) continue;
        seenSymbols.add(symbol);
        const gene = geneMap[symbol];
        const portraitSrc = resolvePortraitUrl(gene);
        if (!portraitSrc) continue;
        urls.push(portraitSrc);
        if (urls.length >= limit) break;
      }
      warmPortraitUrls(urls);
    });
  }

  function collectVisibleGeneSymbols(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (!geneMap) return [];
    const symbols = [];
    const seenSymbols = new Set();
    const genes = document.querySelectorAll('.iconoplasm-gene');
    for (const geneEl of genes) {
      const rect = geneEl.getBoundingClientRect();
      if (rect.bottom < -GENE_DETAIL_VIEWPORT_ABOVE_PX) continue;
      if (rect.top > window.innerHeight + GENE_DETAIL_VIEWPORT_BELOW_PX) continue;
      const symbol = geneEl.dataset ? geneEl.dataset.gene : '';
      if (!symbol || seenSymbols.has(symbol)) continue;
      seenSymbols.add(symbol);
      symbols.push(symbol);
      if (symbols.length >= limit) break;
    }
    return symbols;
  }

  function collectNeighborGeneSymbols(targetEl, limit = GENE_DETAIL_WARM_BATCH_SIZE) {
    if (!targetEl) return [];
    const genes = Array.from(document.querySelectorAll('.iconoplasm-gene'));
    const targetIndex = genes.indexOf(targetEl);
    if (targetIndex === -1) {
      const targetSymbol = targetEl.dataset ? targetEl.dataset.gene : '';
      return targetSymbol ? [targetSymbol] : [];
    }

    const symbols = [];
    const seenSymbols = new Set();
    const pushSymbol = (symbol) => {
      const normalized = String(symbol || '').trim().toUpperCase();
      if (!normalized || seenSymbols.has(normalized)) return;
      seenSymbols.add(normalized);
      symbols.push(normalized);
    };

    pushSymbol(targetEl.dataset ? targetEl.dataset.gene : '');

    let left = targetIndex - 1;
    let right = targetIndex + 1;
    while (symbols.length < limit && (left >= 0 || right < genes.length)) {
      if (right < genes.length) {
        pushSymbol(genes[right].dataset ? genes[right].dataset.gene : '');
        right += 1;
        if (symbols.length >= limit) break;
      }
      if (left >= 0) {
        pushSymbol(genes[left].dataset ? genes[left].dataset.gene : '');
        left -= 1;
      }
    }
    return symbols;
  }

  async function drainGeneDetailWarmQueue() {
    if (geneDetailWarmDraining) return;
    geneDetailWarmDraining = true;
    try {
      while (geneDetailWarmQueue.length) {
        const batch = geneDetailWarmQueue.splice(0, GENE_DETAIL_WARM_BATCH_SIZE);
        for (const symbol of batch) queuedGeneDetailSymbols.delete(symbol);
        await Promise.all(batch.map((symbol) => fetchGeneDetailForTooltip(symbol).catch(() => null)));
        if (geneDetailWarmQueue.length) {
          await delay(20);
        }
      }
    } finally {
      geneDetailWarmDraining = false;
      if (geneDetailWarmQueue.length) {
        scheduleWarmVisibleGeneDetails();
      }
    }
  }

  function warmGeneDetails(symbols, limit = GENE_DETAIL_VISIBLE_LIMIT) {
    const uniqueSymbols = [];
    const seen = new Set();
    for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
      const symbol = String(rawSymbol || '').trim().toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      if (geneDetailCache.has(symbol) || geneDetailPromiseCache.has(symbol) || queuedGeneDetailSymbols.has(symbol)) continue;
      seen.add(symbol);
      uniqueSymbols.push(symbol);
      if (uniqueSymbols.length >= limit) break;
    }
    for (const symbol of uniqueSymbols) {
      queuedGeneDetailSymbols.add(symbol);
      geneDetailWarmQueue.push(symbol);
    }
    if (uniqueSymbols.length) {
      drainGeneDetailWarmQueue().catch(() => null);
    }
  }

  function scheduleWarmVisibleGeneDetails(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (geneDetailWarmScheduled) return;
    geneDetailWarmScheduled = true;
    deferGeneDetailWarm(() => {
      geneDetailWarmScheduled = false;
      warmGeneDetails(collectVisibleGeneSymbols(limit), limit);
    });
  }

  function scheduleViewportWarm() {
    if (viewportWarmFrame) return;
    viewportWarmFrame = window.requestAnimationFrame(() => {
      viewportWarmFrame = 0;
      scheduleWarmVisiblePortraits();
      scheduleWarmVisibleGeneDetails();
    });
  }

  async function getUsablePortraitSrc(portraitSrc) {
    if (!portraitSrc) return '';
    if (portraitDataUrlCache.has(portraitSrc)) {
      return portraitDataUrlCache.get(portraitSrc);
    }

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_PORTRAIT_DATA_URL', url: portraitSrc }, (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result);
        });
      });

      const dataUrl = response && response.ok && response.dataUrl ? response.dataUrl : '';
      if (dataUrl) {
        portraitDataUrlCache.set(portraitSrc, dataUrl);
        return dataUrl;
      }
    } catch (_) {
      // Fall back to the direct site URL below.
    }

    return portraitSrc;
  }

  async function loadTooltipPortrait({ symbol, portrait, portraitImg, portraitFallback, portraitStatus, portraitSrc }) {
    if (!portraitSrc) {
      setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, 'Portrait pending');
      return;
    }

    const loadToken = ++portraitLoadToken;
    const cachedSrc = portraitDataUrlCache.get(portraitSrc);
    if (cachedSrc) {
      applyPortraitImage(portrait, portraitImg, portraitFallback, portraitStatus, cachedSrc, symbol + ' portrait');
      return;
    }
    setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, 'Loading portrait');

    const usableSrc = await getUsablePortraitSrc(portraitSrc);
    if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return;
    if (!usableSrc) {
      setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, 'Portrait unavailable');
      return;
    }
    if (usableSrc.startsWith('data:')) {
      applyPortraitImage(portrait, portraitImg, portraitFallback, portraitStatus, usableSrc, symbol + ' portrait');
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return;
      applyPortraitImage(portrait, portraitImg, portraitFallback, portraitStatus, usableSrc, symbol + ' portrait');
    };
    img.onerror = () => {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return;
      setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, 'Portrait unavailable');
    };
    img.src = usableSrc;
  }

  // -- Font injection ------------------------------------------------
  // Content scripts can't use relative URLs in CSS @font-face, so we
  // inject a <style> element with chrome.runtime.getURL paths.
  function injectFonts() {
    const crimsonUrl = chrome.runtime.getURL('fonts/CrimsonPro-Variable.woff2');
    const xenonUrl = chrome.runtime.getURL('fonts/MonaspaceXenon-Var.woff2');
    const style = document.createElement('style');
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
    `;
    document.head.appendChild(style);
  }

  // -- Init ----------------------------------------------------------
  async function init() {
    // Don't run on the Iconoplasm site itself -- it already shows gene
    // colors natively, and the extension just adds redundant underlines.
    if (window.location.hostname === 'iconoplasm.brinedew.bio') return;

    await Promise.all([loadHighlightMode(), loadTooltipTheme(), loadCardVariant()]);

    const payload = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_GENE_DATA' }, resolve);
    });

    // Backward compatibility:
    // - old worker returned raw map
    // - new worker returns { genes, portraitBaseUrl }
    if (payload && payload.genes && typeof payload.genes === 'object') {
      geneMap = payload.genes;
      portraitBaseUrl = payload.portraitBaseUrl || '';
    } else {
      geneMap = payload;
      portraitBaseUrl = '';
    }

    if (!geneMap || Object.keys(geneMap).length === 0) {
      console.log('[Iconoplasm] No gene data yet. Retrying in 5s.');
      setTimeout(init, 5000);
      return;
    }

    console.log('[Iconoplasm] Loaded', Object.keys(geneMap).length, 'genes. Scanning...');
    injectFonts();
    createTooltip();
    scanPage(document.body);
    refreshHighlightStyles();
    scheduleWarmVisibleGeneDetails();
    scheduleWarmVisiblePortraits();
    window.addEventListener('scroll', scheduleViewportWarm, { passive: true });
    window.addEventListener('resize', scheduleViewportWarm, { passive: true });
    observeMutations();
  }

  // -- DOM scanning --------------------------------------------------
  function scanPage(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest('.iconoplasm-tooltip')) return NodeFilter.FILTER_REJECT;
        if (parent.classList && parent.classList.contains('iconoplasm-gene')) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) processTextNode(textNode);
  }

  function processTextNode(textNode) {
    const text = textNode.textContent;
    if (!text) return;

    const regex = /\b([A-Z][A-Z0-9](?:[A-Z0-9]*(?:-[A-Z0-9]+)*))\b/g;
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      const symbol = match[1];
      if (symbol.length <= 4 && BLOCKLIST.has(symbol)) continue;
      if (!geneMap[symbol]) continue;
      matches.push({ symbol, index: match.index, length: match[0].length });
    }

    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;

    for (const m of matches) {
      if (m.index > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      }
      const span = document.createElement('span');
      span.className = 'iconoplasm-gene';
      span.textContent = text.slice(m.index, m.index + m.length);

      const gene = geneMap[m.symbol];
      const color = gene.c || PLACEHOLDER_COLOR;
      applyHighlightStyle(span, m.symbol, color);
      frag.appendChild(span);
      cursor = m.index + m.length;
    }

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
  }

  // -- Mutation observer ---------------------------------------------
  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      let didScan = false;
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE &&
              !(node.classList && node.classList.contains('iconoplasm-tooltip'))) {
            scanPage(node);
            didScan = true;
          }
        }
      }
      if (didScan) {
        scheduleWarmVisiblePortraits();
        scheduleWarmVisibleGeneDetails();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // -- Tooltip -------------------------------------------------------
  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'iconoplasm-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.innerHTML =
      '<div class="iconoplasm-tooltip-portrait">' +
        buildTooltipPortraitInnerHtml(null, null) +
      '</div>' +
      '<div class="iconoplasm-tooltip-body"></div>';
    document.body.appendChild(tooltip);
    applyTooltipTheme();

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    tooltip.addEventListener('click', onTooltipClick);
    tooltip.addEventListener('keydown', onTooltipKeyDown);
    tooltip.addEventListener('mouseenter', cancelHideTimer);
    tooltip.addEventListener('mouseleave', onTooltipMouseLeave);
    tooltip.tabIndex = 0;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[HIGHLIGHT_MODE_KEY]) {
      highlightMode = normalizeHighlightMode(changes[HIGHLIGHT_MODE_KEY].newValue);
      refreshHighlightStyles();
    }
    if (changes[TOOLTIP_THEME_KEY]) {
      tooltipTheme = normalizeTooltipTheme(changes[TOOLTIP_THEME_KEY].newValue);
      applyTooltipTheme();
    }
    if (changes[CARD_VARIANT_KEY]) {
      cardVariant = normalizeCardVariant(changes[CARD_VARIANT_KEY].newValue);
      applyTooltipTheme();
      renderTooltipBody(activeGeneSummary, geneDetailCache.get(activeSymbol) || null, Boolean(activeSymbol));
    }
  });

  function buildClassicTooltipBodyHtml(summaryGene, geneDetail, loading) {
    const summary = summaryGene && typeof summaryGene === 'object' ? summaryGene : {};
    const detail = geneDetail && typeof geneDetail === 'object' ? geneDetail : null;
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || '').trim().toUpperCase();
    const fullName = String((detail && detail.full_name) || summary.n || symbol).trim();
    const assetSha = String((((detail || {}).portrait || {}).asset_sha256) || '').trim().toLowerCase();
    const voteHtml = assetSha
      ? IconoCardShared.voteBoxMarkup('', { variant: 'brick', showScore: false })
      : '';
    let metaHtml = '';
    if (detail) {
      const rows = IconoCardShared.collectTooltipMetaRows(detail, {
        onMissingOrigins: (warnKey, payload) => {
          if (warnedMissingTraitOrigins.has(warnKey)) return;
          warnedMissingTraitOrigins.add(warnKey);
          console.error('[Iconoplasm] Missing aesthetics/politics origin metadata for tooltip:', warnKey, payload);
        },
      });
      metaHtml = rows.length ? IconoCardShared.renderTooltipMetaRowsHtml(rows) : '';
    } else if (loading) {
      metaHtml = IconoCardShared.renderTooltipMetaSkeletonHtml();
    }

    return (
      '<div class="iconoplasm-tooltip-header">' +
        '<div class="icono-shared-card-header-row">' +
          '<div class="icono-shared-card-header-copy">' +
            '<div class="iconoplasm-tooltip-symbol">' + escapeHtml(symbol) + '</div>' +
            '<div class="iconoplasm-tooltip-name">' + escapeHtml(fullName || symbol) + '</div>' +
          '</div>' +
          '<div class="iconoplasm-tooltip-vote-slot" data-icono-tooltip-vote-slot>' +
            voteHtml +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="iconoplasm-tooltip-meta' + (detail ? '' : ' iconoplasm-tooltip-meta--loading') + '">' +
        metaHtml +
      '</div>'
    );
  }

  function buildLabLabelTooltipBodyHtml(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === 'object' ? summaryGene : {};
    const detail = geneDetail && typeof geneDetail === 'object' ? geneDetail : null;
    const model = detail || {
      symbol: summary.symbol || activeSymbol || '',
      full_name: summary.n || summary.symbol || activeSymbol || '',
      color: summary.c || PLACEHOLDER_COLOR,
      essence: {},
    };
    const assetSha = String((((detail || {}).portrait || {}).asset_sha256) || '').trim().toLowerCase();
    return IconoCardShared.renderLabLabelCardHtml(model, {
      voteHtml: assetSha ? IconoCardShared.voteBoxMarkup('', { variant: 'label', showScore: false }) : '',
    });
  }

  function buildTooltipPortraitInnerHtml(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === 'object' ? summaryGene : {};
    const detail = geneDetail && typeof geneDetail === 'object' ? geneDetail : null;
    const model = detail || {
      symbol: summary.symbol || activeSymbol || '',
      color: summary.c || PLACEHOLDER_COLOR,
    };
    if (cardVariant === 'lab-label') {
      return IconoCardShared.renderLabLabelSpecimenRailHtml(
        '<img class="iconoplasm-tooltip-portrait-img" alt="" />' +
          '<div class="iconoplasm-tooltip-portrait-fallback">' +
            '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
            '<div class="iconoplasm-tooltip-portrait-symbol"></div>' +
          '</div>',
        model,
      );
    }
    return (
      '<img class="iconoplasm-tooltip-portrait-img" alt="" />' +
      '<div class="iconoplasm-tooltip-portrait-fallback">' +
        '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
        '<div class="iconoplasm-tooltip-portrait-symbol"></div>' +
      '</div>' +
      '<div class="iconoplasm-tooltip-portrait-fade"></div>'
    );
  }

  function renderTooltipBody(summaryGene, geneDetail, loading) {
    if (!tooltip) return;
    const body = tooltip.querySelector('.iconoplasm-tooltip-body');
    if (!body) return;
    body.innerHTML =
      cardVariant === 'lab-label'
        ? buildLabLabelTooltipBodyHtml(summaryGene, geneDetail)
        : buildClassicTooltipBodyHtml(summaryGene, geneDetail, loading);
  }

  function wireRenderedTooltipVoteBox(geneDetail) {
    if (!tooltip || !geneDetail) return;
    const box = tooltip.querySelector('[data-icono-vote-box]');
    if (!box) return;
    const symbol = String((geneDetail && geneDetail.symbol) || activeSymbol || '').trim().toUpperCase();
    const assetSha = String((((geneDetail || {}).portrait || {}).asset_sha256) || '').trim().toLowerCase();
    if (!symbol || !assetSha) return;
    IconoCardShared.wireVoteBox(box, {
      symbol,
      assetSha,
      apiBaseUrl: ICONOPLASM_API_BASE,
      fetchImpl: extensionApiFetch,
      onAuthRequired: showVoteLoginPopup,
      onError: (phase, err) => {
        console.error('[Iconoplasm] extension vote ' + phase + ' error:', err);
      },
    });
  }

  async function fetchGeneDetailForTooltip(symbol) {
    if (geneDetailCache.has(symbol)) return geneDetailCache.get(symbol);
    if (geneDetailPromiseCache.has(symbol)) return geneDetailPromiseCache.get(symbol);
    const request = (async () => {
      try {
        const resp = await fetch(ICONOPLASM_API_BASE + '/api/gene/' + encodeURIComponent(symbol));
        if (!resp.ok) { geneDetailCache.set(symbol, null); return null; }
        const data = await resp.json();
        geneDetailCache.set(symbol, data || null);
        return data || null;
      } catch (err) {
        console.error('[Iconoplasm] extension gene detail fetch error:', err);
        geneDetailCache.set(symbol, null);
        return null;
      } finally {
        geneDetailPromiseCache.delete(symbol);
      }
    })();
    geneDetailPromiseCache.set(symbol, request);
    return request;
  }

  function onTooltipClick(e) {
    if (e && e.target && e.target.closest('[data-icono-vote-box]')) return;
    openGenePage(activeSymbol);
  }

  function onTooltipKeyDown(e) {
    if (e.target && e.target.closest('[data-icono-vote-box]')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openGenePage(activeSymbol);
  }

  function onMouseOver(e) {
    const target = e.target.closest('.iconoplasm-gene');
    if (!target) return;
    cancelHideTimer();

    const symbol = target.dataset.gene;
    const gene = geneMap[symbol];
    if (!gene) return;
    activeSymbol = symbol;
    activeGeneSummary = Object.assign({ symbol }, gene);
    warmGeneDetails(collectNeighborGeneSymbols(target, GENE_DETAIL_WARM_BATCH_SIZE), GENE_DETAIL_WARM_BATCH_SIZE);

    const color = gene.c || PLACEHOLDER_COLOR;

    // Fill tooltip content
    const portrait = tooltip.querySelector('.iconoplasm-tooltip-portrait');
    if (portrait) {
      portrait.innerHTML = buildTooltipPortraitInnerHtml(activeGeneSummary, null);
    }
    const portraitImg = tooltip.querySelector('.iconoplasm-tooltip-portrait-img');
    const fade = tooltip.querySelector('.iconoplasm-tooltip-portrait-fade');
    const portraitFallback = tooltip.querySelector('.iconoplasm-tooltip-portrait-fallback');
    const portraitStatus = tooltip.querySelector('.iconoplasm-tooltip-portrait-status');
    const portraitSymbol = tooltip.querySelector('.iconoplasm-tooltip-portrait-symbol');
    const portraitSrc = resolvePortraitUrl(gene);
    warmPortraitUrls([portraitSrc]);
    loadTooltipPortrait({ symbol, portrait, portraitImg, portraitFallback, portraitStatus, portraitSrc });
    portraitSymbol.textContent = symbol;

    // Keep the reading surface neutral; gene color is an accent only.
    tooltip.style.backgroundColor = '';
    tooltip.style.setProperty('--iconoplasm-gene-color', color);
    fade.style.background = '';
    portraitSymbol.style.color = '';

    const hoverSymbol = symbol;
    if (geneDetailCache.has(symbol)) {
      const geneDetail = geneDetailCache.get(symbol);
      renderTooltipBody(activeGeneSummary, geneDetail, false);
      wireRenderedTooltipVoteBox(geneDetail);
    } else {
      // Reserve the metadata area immediately so the title block never jumps.
      renderTooltipBody(activeGeneSummary, null, true);
      fetchGeneDetailForTooltip(symbol).then((geneDetail) => {
        if (activeSymbol === hoverSymbol && geneDetail) {
          renderTooltipBody(activeGeneSummary, geneDetail, false);
          wireRenderedTooltipVoteBox(geneDetail);
        } else if (activeSymbol === hoverSymbol) {
          renderTooltipBody(activeGeneSummary, null, false);
        }
      });
    }

    // Position tooltip
    const rect = target.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 500;
    const tooltipHeight = tooltip.offsetHeight || 248;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));

    const showBelow = rect.top < tooltipHeight + 16;

    tooltip.style.left = left + window.scrollX + 'px';
    if (showBelow) {
      tooltip.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    } else {
      tooltip.style.top = (rect.top + window.scrollY - tooltipHeight - 8) + 'px';
    }

    tooltip.classList.add('iconoplasm-tooltip-visible');
  }

  function onMouseOut(e) {
    const target = e.target.closest('.iconoplasm-gene');
    if (!target) return;
    const related = e.relatedTarget;
    if (related && (related.closest('.iconoplasm-tooltip') || related.closest('.iconoplasm-gene'))) return;
    scheduleHideTooltip();
  }

  function onTooltipMouseLeave(e) {
    const related = e.relatedTarget;
    if (related && (related.closest('.iconoplasm-tooltip') || related.closest('.iconoplasm-gene'))) return;
    scheduleHideTooltip();
  }

  function hideTooltip() {
    cancelHideTimer();
    activeSymbol = null;
    activeGeneSummary = null;
    portraitLoadToken += 1;
    tooltip.classList.remove('iconoplasm-tooltip-visible');
  }

  // -- Go ------------------------------------------------------------
  init();
})();
