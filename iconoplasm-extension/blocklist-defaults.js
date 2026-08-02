// Default disambiguation blocklist — shared between content.js and popup.js.
// Data-driven: every entry BOTH (a) exists in the gene catalog as a symbol/alias
// AND (b) is a common English word that users probably don't want highlighted.
// Pruned 2026-05-09 from 99 entries to 76 alias-only catalog-verified entries.
//
// Users see these pre-populated in the Blocklist tab and can un-block any of them.
// Stored in chrome.storage as the "removed defaults" set so new defaults in future
// versions appear automatically unless the user already removed them.

// eslint-disable-next-line no-unused-vars
const ICONOPLASM_DEFAULT_BLOCKLIST = [
  // Additional gene symbols / aliases that are common English words
  "AMID", // alias of AIFM2
  "ARCH", // alias of ZBTB8OS
  "ARTS", // alias of SEPTIN4
  "BANK", // alias of BANK1
  "BASE", // alias of BPIFA4P
  "BEST", // alias of BEST1
  "BIKE", // alias of BMP2K
  "BITE", // alias of CEP70
  "BOMB", // alias of WWC2
  "CAGE", // alias of DDX53
  "CALL", // alias of CHL1
  "CART", // alias of CARTPT
  "CASH", // alias of CFLAR
  "CHIP", // alias of STUB1
  "CHOP", // alias of DDIT3
  "CLAN", // alias of NLRC4
  "CLAP", // alias of BCL10
  "CROP", // alias of LUC7L3
  "FACE", // alias of FANCE
  "FACT", // alias of SUPT16H
  "FAME", // alias of CCDC198
  "FAST", // alias of FASTK
  "FATE", // alias of FATE1
  "FEAT", // alias of METTL13
  "FELL", // alias of STAB2
  "FIND", // alias of DCSTAMP
  "FISH", // alias of SH3PXD2A
  "FLAP", // alias of ALOX5AP
  "FLIP", // alias of CFLAR
  "FLOWER", // alias of CACFD1
  "GALA", // alias of GLA
  "GOAT", // alias of MBOAT4
  "GRAB", // alias of RAB3IL1
  "GRIT", // alias of ARHGAP32
  "HEED", // alias of EED
  "HINT", // alias of HINT1
  "JERKY", // alias of JRK
  "LIME", // alias of LIME1
  "LORD", // alias of C1QTNF5
  "MAIL", // alias of NFKBIZ
  "MARK", // alias of MARK1
  "MARS", // alias of MARS1
  "MASS", // alias of FBN1
  "MEMO", // alias of MEMO1
  "NAIL", // alias of CD244
  "PACE", // alias of FURIN
  "POEM", // alias of NPNT
  "POKEMON", // alias of ZBTB7A
  "PREY", // alias of PYURF
  "RACE", // alias of AMACR
  "RAIN", // alias of RASIP1
  "RANK", // alias of TNFRSF11A
  "SAGE", // alias of SAGE1
  "SHIP", // alias of INPP5D
  "SHOT", // alias of SHOX2
  "SINK", // alias of TRIB3
  "SLAM", // alias of SLAMF1
  "SNAP", // alias of SNAP25
  "SOUL", // alias of HEBP2
  "SPAR", // alias of SPAAR
  "SPATIAL", // alias of TBATA
  "STEP", // alias of PTPN5
  "STOP", // alias of MAP6
  "STUD", // alias of TBPL1
  "TAPE", // alias of CC2D1A
  "TASK", // alias of KCNK3
  "TAUT", // alias of SLC6A6
  "TIED", // alias of ITGBL1
  "TRIM", // alias of TRAT1
  "TUBE", // alias of TUBE1
  "TYPE", // alias of SGCG
  "WARP", // alias of VWA1
  "WAVE", // alias of WASF1
  "WIRE", // alias of WIPF2
  "WISH", // alias of NCKIPSD
  "STAT", // alias of SOAT1
]
