import { readIconoplasmSettings } from "../site-preferences.js?v=20260520stylecookie"
import {
  HOME_COLLECTION_ORDERS,
  normalizeDiscoveryEntries,
  normalizeHomeCollectionOrder,
} from "./discovery-collection.js?v=20260730-module-cache"
import {
  ICONOPLASM_DISCOVERY_DEFAULT_ORDER,
  ICONOPLASM_GALLERY_DEFAULT_ORDER,
} from "./home-orders.js?v=20260730-module-cache"
import { createRequestInbox } from "./request-inbox.js?v=20260901-signed-supervote-v2"
import { portraitDelivery } from "./portrait-delivery.js?v=0d14e5a87d1914bf"
import {
  createEmulsionFavoriteStore,
  normalizeEmulsionFamilyId,
} from "./emulsion-favorites.js?v=20260829-factory-family"
import { createCollectionFeedController } from "./collection-feed.js?v=20260730-module-cache"
import { buildIconoplasmCollectionVisibleUrl } from "./iconoplasm-collection-route-state.js?v=20260801-clean-visible-url"
import {
  createWebsiteGuestDiscoveryStore,
  WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
} from "./guest-discovery-store.js?v=20260730-module-cache"
import {
  buildLoginUrl,
  buildSharedUserPanelMarkup,
  COMMUNITY_URL,
  fetchAuthenticatedUser,
  hasSharedSessionPresenceHint,
  mountSidebarStack,
  wireSharedUserPanel,
} from "../shared/sidebar-shell.js?v=99d8a08f87cc8a9d"
import "./vendor/img-comparison-slider.js?v=20260516b517"
import { openVoteLoginDialog } from "./vote-login-dialog.js?v=20260829-favorite-action"
import { installIconoplasmLightbox } from "./lightbox.js?v=20260820-admin-matrix"
import {
  openCandidateDeleteDialog,
  removeCandidateFromPageState,
  showCandidateDeleteNotice,
} from "./candidate-delete-dialog.js?v=20260821-nonblocking-delete"
import { ICONOPLASM_ANIMA_EMULSION_SLOT_CONTRACT } from "./generated/anima-emulsion-slot-contract.js?v=20260822-immediate-picker"
import {
  registerDiagramWebMcp,
  renderDiagramStudio,
  unmountDiagramStudio,
} from "./diagram-studio.js?v=bf8285189184406b"

// ARCHITECTURE FENCE [IPD-008]: the domain cookies already carry Iconoplasm
// appearance settings. Loading the cross-subdomain bridge during anonymous
// startup would turn a static homepage into a metered Worker request.
var initialSharedSettingsPromise = Promise.resolve(readIconoplasmSettings())
;(function () {
  "use strict"

  var ICONO_ARCHIVE_RESTORE_SESSION_STORAGE_KEY = "iconoplasm.archiveRestoreSession.v1"

  function readOrCreateIconoArchiveRestoreSession() {
    var freshSession = Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
    try {
      var storedSession = window.sessionStorage.getItem(ICONO_ARCHIVE_RESTORE_SESSION_STORAGE_KEY)
      if (storedSession) return storedSession
      window.sessionStorage.setItem(ICONO_ARCHIVE_RESTORE_SESSION_STORAGE_KEY, freshSession)
    } catch (_iconoArchiveRestoreStorageError) {
      // Storage-disabled browsers still get correct same-document SPA Back behavior.
    }
    return freshSession
  }

  var ICONO_ARCHIVE_RESTORE_SESSION = readOrCreateIconoArchiveRestoreSession()
  if (window.history && "scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual"
  }

  var IconoCardShared = globalThis.IconoplasmCardShared
  if (!IconoCardShared) {
    throw new Error("[Iconoplasm] shared card runtime missing: load shared-card-runtime.js first")
  }

  /* ─── Constants ─── */
  var ROOT_ID = "iconoplasm-root"
  var DEBOUNCE_MS = 200
  var GALLERY_INITIAL_PAGE_SIZE = 4
  var GALLERY_DEFAULT_ORDER = ICONOPLASM_GALLERY_DEFAULT_ORDER
  var HOME_COLLECTION_PAGE_SIZE = 12
  var HOME_COLLECTION_MOBILE_PAGE_SIZE = 8
  var HOME_COLLECTION_INITIAL_PAGE_SIZE = 4
  var HOME_COLLECTION_DEFAULT_ORDER = ICONOPLASM_DISCOVERY_DEFAULT_ORDER
  var ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT = 19023
  var GUEST_STARTER_GENES = [
    {
      gene_symbol: "INS",
      first_discovered_at: "2026-01-03T00:00:00.000Z",
      last_encountered_at: "2026-01-03T00:00:00.000Z",
    },
    {
      gene_symbol: "RHO",
      first_discovered_at: "2026-01-02T00:00:00.000Z",
      last_encountered_at: "2026-01-02T00:00:00.000Z",
    },
    {
      gene_symbol: "PRL",
      first_discovered_at: "2026-01-01T00:00:00.000Z",
      last_encountered_at: "2026-01-01T00:00:00.000Z",
    },
    {
      gene_symbol: "CD4",
      first_discovered_at: "2025-12-31T00:00:00.000Z",
      last_encountered_at: "2025-12-31T00:00:00.000Z",
    },
  ]
  var GUEST_CONTINUATION_CARD_COUNT = 4
  var HOME_LAYOUT_DEFAULT = "bricks"
  var CARD_VARIANT_DEFAULT = "image-only"
  var HOME_SKELETON_CARD_COUNT = 4
  var ICONO_EXTENSION_PRESENCE_EVENT = "iconoplasm-extension-presence"
  var ICONO_EXTENSION_PRESENCE_PING_EVENT = "iconoplasm-extension-presence-ping"
  var ICONO_EXTENSION_RELEASE_METADATA_URL = "/static/iconoplasm/extension-release.json"
  var ICONO_REQUEST_TAB_STORAGE_KEY = "iconoplasm.new-candidate-tab"
  var ICONO_EXTENSION_FIREFOX_LISTING_URL =
    "https://addons.mozilla.org/en-US/firefox/addon/iconoplasm-gene-illustrations/"
  var ICONO_EXTENSION_EDGE_LISTING_URL =
    "https://microsoftedge.microsoft.com/addons/detail/ocfhohjhkflpmaiimgjfobdoogdfpmog"
  var PREFETCH_BATCH_SIZE = 20
  var PREFETCH_TRIGGER_OFFSET = 10
  var PREFETCH_DETAIL_CONCURRENCY = 4
  var ICONO_ARROW_LEFT =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style="width:14px;height:14px;vertical-align:-2px;margin-right:3px"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  // Icon set used by the candidate action rail. Kept inline as `currentColor` SVGs so the rail
  // can adopt cream/lab-label or default theming without a separate icon font load.
  // Source: B-467 (compact action rail for candidate blots) — replace earlier text buttons
  // ("Remove", "Copy to gene") with consistent circular icon controls.
  var ICONO_TRASH_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="M4.5 6h11M8.5 9.25v6M11.5 9.25v6M5.75 6 6.3 16.45a1.5 1.5 0 0 0 1.5 1.42h4.4a1.5 1.5 0 0 0 1.5-1.42L14.25 6M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var ICONO_BRANCH_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><circle cx="6" cy="4.75" r="1.5" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="15.25" r="1.5" stroke="currentColor" stroke-width="1.6"/><circle cx="14" cy="9" r="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M6 6.25v7.5M6 9.25a3 3 0 0 0 3 3h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
  var ICONO_SEND_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var ICONO_EDIT_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="m4.75 13.85-.6 2.5 2.5-.6 8.45-8.45a1.6 1.6 0 0 0 0-2.26l-.14-.14a1.6 1.6 0 0 0-2.26 0l-7.95 8.95Z" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/><path d="m11.8 5.8 2.4 2.4" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/></svg>'
  var ICONO_PLUS_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  var ICONO_STAR_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m10 2.9 2.15 4.35 4.8.7-3.47 3.38.82 4.77-4.3-2.26-4.3 2.26.82-4.77L3.05 7.95l4.8-.7L10 2.9Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  var portraitDetailCache = Object.create(null)
  var portraitDetailPromiseCache = Object.create(null)
  var geneCardArtifactCache = Object.create(null)
  var portraitImageCache = Object.create(null)
  var portraitImagePromiseCache = Object.create(null)
  var portraitRetainedImageCache = Object.create(null)
  var portraitRetainedImageOrder = []
  var geneRequestSummaryCache = Object.create(null)
  var imageEditProvidersCache = Object.create(null)
  var imageEditProvidersPromise = Object.create(null)
  var homeMasonryInstances = new Map()
  var activeGeneRenderId = 0
  var lastGenePageDiscoveryVisitKey = ""
  var websiteGuestDiscoveryMergePromise = null
  var websiteGuestDiscoveryMergeRemaining = WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE
  var currentUser = null
  var currentUserIsIconoAdmin = false
  var caretakerPanelPromise = null
  var masonryLibsPromise = null
  var hasResolvedAuthState = false
  var websiteGuestDiscoveries = createWebsiteGuestDiscoveryStore({
    storage: (function () {
      try {
        return window.localStorage
      } catch (_error) {
        return null
      }
    })(),
    maxEntries: WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  })
  var iconoSidebarState = {
    page: "home",
    homeLayout: HOME_LAYOUT_DEFAULT,
    total: 0,
    publishedTotal: 0,
    gene: null,
    caretaker: null,
  }
  var iconoInstallState = {
    panelOpen: false,
    installed: false,
    version: "",
    installTab: "",
    release: {
      version: "0.4.7",
      chromeDeveloperPackageUrl: "/static/iconoplasm/downloads/iconoplasm-extension-v0.4.7.zip",
      firefoxListingUrl: ICONO_EXTENSION_FIREFOX_LISTING_URL,
      edgeListingUrl: ICONO_EXTENSION_EDGE_LISTING_URL,
      edgeListingStatus: "live",
    },
    releaseLoaded: false,
  }

  /* ─── API helpers ─── */

  function apiBase() {
    var host = String(window.location.hostname || "").toLowerCase()
    if (host === "iconoplasm.brinedew.bio") return window.location.origin
    if (host === "staging.brinedew.bio") return window.location.origin
    if (host === "brinedew.bio" || host === "www.brinedew.bio")
      return "https://iconoplasm.brinedew.bio"
    return "https://iconoplasm.brinedew.bio"
  }

  var API = apiBase()

  function apiErrorMessage(payload, status) {
    var error = payload && payload.error
    if (typeof error === "string" && error.trim()) return error
    if (error && typeof error === "object") {
      if (typeof error.message === "string" && error.message.trim()) return error.message
      if (typeof error.code === "string" && error.code.trim())
        return error.code.replaceAll("_", " ")
    }
    if (payload && typeof payload.message === "string" && payload.message.trim()) {
      return payload.message
    }
    return "HTTP " + status
  }

  function fetchJSON(path, init) {
    var requestInit = init || {}
    return fetch(API + path, requestInit).then(function (r) {
      return r.text().then(function (raw) {
        var payload = null
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch (_err) {
            payload = null
          }
        }
        if (!r.ok) {
          var err = new Error(apiErrorMessage(payload, r.status))
          err.status = r.status
          err.payload = payload
          throw err
        }
        return payload
      })
    })
  }

  function fetchAuthedJSON(path, init) {
    var requestInit = Object.assign({}, init || {}, {
      credentials: "include",
    })
    return fetchJSON(path, requestInit)
  }

  function loadCaretakerPanel() {
    if (caretakerPanelPromise) return caretakerPanelPromise
    var stylesheets = [
      {
        id: "icono-caretaker-manifestations-styles",
        href: "/static/iconoplasm/caretaker-manifestations.css?v=20260905-caretaker-categories-v7",
      },
      {
        id: "icono-caretaker-supervote-styles",
        href: "/static/iconoplasm/caretaker-supervote.css?v=20260905-caretaker-seal-v3",
      },
    ]
    for (var i = 0; i < stylesheets.length; i += 1) {
      if (document.getElementById(stylesheets[i].id)) continue
      var stylesheet = document.createElement("link")
      stylesheet.id = stylesheets[i].id
      stylesheet.rel = "stylesheet"
      stylesheet.href = stylesheets[i].href
      document.head.appendChild(stylesheet)
    }
    caretakerPanelPromise = Promise.all([
      import("./caretaker-manifestations.js?v=20260906-caretaker-availability-v1"),
      import("./caretaker-supervote.js?v=20260905-caretaker-seal-v3"),
    ]).then(function (modules) {
      var supervoteControls = modules[1].createCaretakerSupervoteControls({
        fetchJSON: fetchAuthedJSON,
        escapeHtml: esc,
        onChanged: function (snapshot) {
          requestInbox.updateCaretakerSupervote(snapshot)
        },
      })
      var manifestationPanel = modules[0].createCaretakerManifestationPanel({
        fetchJSON: fetchAuthedJSON,
        escapeHtml: esc,
        loginUrl: voteLoginUrl(),
        onCanonicalChanged: function (symbol, expectation) {
          invalidateGeneDetail(symbol)
          return fetchGeneDetail(symbol, { forceFresh: true }).then(function (gene) {
            var route = getRoute()
            var content = document.getElementById("icono-gene-content")
            if (
              route.page !== "gene" ||
              normalizedSymbol(route.symbol) !== normalizedSymbol(symbol) ||
              !content
            ) {
              return
            }
            reconcilePublicManifestationSection(content, gene)
            var canonical = gene && gene.canonical_manifestation
            return !!(
              expectation &&
              String((canonical && canonical.manifestation_revision_id) || "") ===
                expectation.canonicalRevisionId &&
              (canonical?.public_page_visible === true) === expectation.publicPageVisible
            )
          })
        },
        onDossierChanged: function (detail) {
          var viewerIsCaretaker = detail.dossier?.viewer?.is_caretaker === true
          iconoSidebarState.caretaker = viewerIsCaretaker
            ? {
                symbol: detail.symbol,
                status: String(detail.dossier.assignment?.status || ""),
              }
            : null
          renderIconoplasmSidebar()
          void requestInbox.refresh()
          var geneContent = detail.host && detail.host.closest("#icono-gene-content")
          if (!geneContent) return
          syncViewerCaretakerToolbarIdentity(geneContent, viewerIsCaretaker)
          return supervoteControls.mount(geneContent, {
            symbol: detail.symbol,
            dossier: detail.dossier,
          })
        },
      })
      return Object.freeze({
        mount: manifestationPanel.mount,
        open: manifestationPanel.open,
        unmountSupervote: supervoteControls.unmount,
      })
    })
    return caretakerPanelPromise
  }

  function hydrateCaretakerManifestationIsland(container, genePayload) {
    var host = container && container.querySelector("[data-icono-caretaker-island]")
    if (!host) return
    if (!hasResolvedAuthState || !currentUser) {
      host.hidden = true
      host.replaceChildren()
      host.removeAttribute("data-icono-caretaker-signature")
      if (caretakerPanelPromise) {
        void caretakerPanelPromise.then(function (panel) {
          panel.unmountSupervote(container)
        })
      }
      return
    }
    var symbol = normalizedSymbol(genePayload && genePayload.symbol)
    hydrateCaretakerClaimAction(container, genePayload)
    var accountId = String(currentUser.account_id || currentUser.id || currentUser.user_id || "")
    var signature = accountId + ":" + symbol
    if (host.getAttribute("data-icono-caretaker-signature") === signature) {
      if (new URL(window.location.href).searchParams.get("caretaker") === "open") {
        void loadCaretakerPanel().then(function (panel) {
          panel.open(host)
        })
      }
      return
    }
    host.setAttribute("data-icono-caretaker-signature", signature)
    void loadCaretakerPanel()
      .then(async function (panel) {
        await panel.mount(host, {
          symbol: symbol,
          currentUser: currentUser,
          authResolved: hasResolvedAuthState,
        })
        if (new URL(window.location.href).searchParams.get("caretaker") === "open") panel.open(host)
      })
      .catch(function () {
        host.removeAttribute("data-icono-caretaker-signature")
        host.hidden = false
        host.innerHTML =
          '<section class="icono-caretaker-unavailable" aria-label="Caretaker tools"><p role="status">Caretaker tools could not be loaded. Reload the page to try again.</p></section>'
      })
  }

  function caretakerCommandId() {
    if (!globalThis.crypto?.randomUUID) {
      throw new Error("This browser cannot create a secure caretaker command ID.")
    }
    return "cmd_" + globalThis.crypto.randomUUID().replaceAll("-", "").toLowerCase()
  }

  function hydrateCaretakerClaimAction(container, genePayload) {
    var target = container && container.querySelector("[data-icono-caretaker-claim-action]")
    var symbol = normalizedSymbol(genePayload && genePayload.symbol)
    if (!target || !symbol || !currentUser) return
    var signature =
      String(currentUser.account_id || currentUser.id || currentUser.user_id || "") + ":" + symbol
    if (target.getAttribute("data-icono-caretaker-claim-signature") === signature) return
    target.setAttribute("data-icono-caretaker-claim-signature", signature)
    fetchAuthedJSON(
      "/api/iconoplasm/caretaker/genes/" +
        encodeURIComponent(symbol) +
        "/claim?fresh=" +
        Date.now(),
      { cache: "no-store" },
    )
      .then(function (payload) {
        if (!payload?.enabled || !payload.claim?.available || !payload.claim?.terms) {
          target.replaceChildren()
          return
        }
        var claim = payload.claim
        var terms = claim.terms
        var dialogId = "icono-caretaker-claim-dialog-" + symbol
        target.innerHTML =
          '<button type="button" class="icono-canonical-new-candidate-btn icono-caretaker-claim-btn" data-icono-caretaker-claim-open aria-haspopup="dialog" aria-controls="' +
          esc(dialogId) +
          '"><span>Become a ' +
          esc(symbol) +
          " caretaker</span></button>" +
          '<sl-dialog class="icono-standard-dialog icono-caretaker-claim-dialog" id="' +
          esc(dialogId) +
          '" data-icono-caretaker-claim-dialog label="Become a ' +
          esc(symbol) +
          ' caretaker">' +
          '<form class="icono-caretaker-claim-form" data-icono-caretaker-claim-form>' +
          '<div class="icono-caretaker-capabilities"><p>For their chosen gene, caretakers can:</p><ul><li>Write and revise gene character design (&quot;manifestation&quot;) as prose and tags</li><li>Rollback to an earlier manifestation version</li><li>Show or hide manifestation prose on the gene page.</li><li>Long-press the vote button to assign a 10x supervote to a single candidate image.</li><li>Get contacted on Discord by other caretakers</li></ul></div>' +
          '<sl-checkbox class="icono-caretaker-claim-terms" data-icono-caretaker-claim-terms>I accept the <a href="' +
          esc(terms.document_url) +
          '" target="_blank" rel="noopener">' +
          esc(terms.display_label || "caretaker terms") +
          '</a>.</sl-checkbox><p class="icono-caretaker-status" data-icono-caretaker-claim-status hidden role="status"></p>' +
          '</form><div class="icono-caretaker-claim-actions" slot="footer"><button type="button" class="icono-button icono-button--quiet" data-icono-caretaker-claim-cancel>Cancel</button><button type="button" class="icono-button" data-icono-caretaker-claim-submit disabled>Become caretaker</button></div></sl-dialog>'
        var dialog = target.querySelector("[data-icono-caretaker-claim-dialog]")
        var termsCheckbox = target.querySelector("[data-icono-caretaker-claim-terms]")
        var submit = target.querySelector("[data-icono-caretaker-claim-submit]")
        var status = target.querySelector("[data-icono-caretaker-claim-status]")
        target
          .querySelector("[data-icono-caretaker-claim-open]")
          ?.addEventListener("click", function () {
            if (!dialog.open) dialog.show()
            if (termsCheckbox && submit) submit.disabled = !termsCheckbox.checked
          })
        target
          .querySelector("[data-icono-caretaker-claim-cancel]")
          ?.addEventListener("click", function () {
            dialog.hide()
          })
        // The vendored sl-checkbox emits only sl-change; listen for both so a
        // native change event can never be the reason the button stays dead.
        function syncClaimSubmitState() {
          if (termsCheckbox && submit) submit.disabled = !termsCheckbox.checked
        }
        ;["change", "sl-change"].forEach(function (eventName) {
          termsCheckbox?.addEventListener(eventName, syncClaimSubmitState)
        })
        submit?.addEventListener("click", function () {
          if (!termsCheckbox?.checked || submit.disabled) return
          submit.disabled = true
          status.hidden = false
          status.textContent = "Claiming caretaking…"
          fetchAuthedJSON(
            "/api/iconoplasm/caretaker/genes/" + encodeURIComponent(symbol) + "/claim",
            {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({
                command_id: caretakerCommandId(),
                expected_gene_revision: claim.gene_revision,
                terms_version_id: terms.terms_version_id,
                terms_accepted: true,
                entitlement_policy_version: claim.entitlement_policy_version,
                default_leave_policy: "retain",
              }),
            },
          )
            .then(function () {
              dialog.hide()
              target.replaceChildren()
              var host = container.querySelector("[data-icono-caretaker-island]")
              if (host) host.removeAttribute("data-icono-caretaker-signature")
              hydrateCaretakerManifestationIsland(container, genePayload)
              void requestInbox.refresh()
            })
            .catch(function (error) {
              status.hidden = false
              status.dataset.tone = "error"
              status.textContent = String(error?.message || "Caretaking could not be claimed.")
              submit.disabled = !termsCheckbox.checked
            })
        })
      })
      .catch(function () {
        target.replaceChildren()
      })
  }

  var emulsionFavorites = createEmulsionFavoriteStore({
    readFavorites: function () {
      return fetchAuthedJSON("/api/iconoplasm/emulsion-favorites")
    },
    writeFavorite: function (emulsionId, isFavorite) {
      return fetchAuthedJSON(
        "/api/iconoplasm/emulsion-favorites/" + encodeURIComponent(emulsionId),
        { method: isFavorite ? "PUT" : "DELETE" },
      )
    },
  })

  function renderEmulsionFavoriteButtonMarkup(rawEmulsionId, extraClass) {
    var emulsionId = normalizeEmulsionFamilyId(rawEmulsionId)
    if (!emulsionId) return ""
    var displayCode = displayEmulsionCode(emulsionId)
    var isFavorite = emulsionFavorites.has(emulsionId)
    var isPending = emulsionFavorites.isPending(emulsionId)
    var authenticated = !!currentUser
    var label = authenticated
      ? (isFavorite ? "Remove " : "Add ") + displayCode + " from favorites"
      : "Log in to favorite " + displayCode
    return (
      '<button type="button" class="icono-emulsion-favorite-button' +
      (isFavorite ? " is-favorite" : "") +
      (extraClass ? " " + esc(extraClass) : "") +
      '" data-icono-emulsion-favorite="' +
      esc(emulsionId) +
      '" aria-pressed="' +
      (isFavorite ? "true" : "false") +
      '" aria-label="' +
      esc(label) +
      '"' +
      (isPending ? ' disabled aria-busy="true"' : "") +
      ">" +
      ICONO_STAR_ICON +
      '<span class="icono-visually-hidden">' +
      esc(label) +
      "</span></button>"
    )
  }

  function syncEmulsionFavoriteButtons(root, changedId) {
    var scope = root && root.querySelectorAll ? root : document
    var buttons = scope.querySelectorAll("[data-icono-emulsion-favorite]")
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i]
      var emulsionId = normalizeEmulsionFamilyId(
        button.getAttribute("data-icono-emulsion-favorite"),
      )
      if (!emulsionId || (changedId && emulsionId !== changedId)) continue
      var favorite = emulsionFavorites.has(emulsionId)
      var pending = emulsionFavorites.isPending(emulsionId)
      button.classList.toggle("is-favorite", favorite)
      button.setAttribute("aria-pressed", favorite ? "true" : "false")
      button.disabled = pending
      if (pending) button.setAttribute("aria-busy", "true")
      else button.removeAttribute("aria-busy")
      var label = currentUser
        ? (favorite ? "Remove " : "Add ") + displayEmulsionCode(emulsionId) + " from favorites"
        : "Log in to favorite " + displayEmulsionCode(emulsionId)
      button.setAttribute("aria-label", label)
      var hiddenLabel = button.querySelector(".icono-visually-hidden")
      if (hiddenLabel) hiddenLabel.textContent = label
    }
  }

  function syncSelectAllFavoriteButtons(root) {
    var buttons = (root || document).querySelectorAll("[data-icono-request-select-all-favorites]")
    var favoriteCount = emulsionFavorites.ids().length
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = "Select all " + favoriteCount + " favorites"
      buttons[i].hidden = !emulsionFavorites.isLoaded() || favoriteCount === 0
    }
  }

  function announceEmulsionFavoriteStatus(message) {
    var root = document.getElementById(ROOT_ID) || document.body
    var status = document.getElementById("icono-emulsion-favorite-status")
    if (!status) {
      status = document.createElement("div")
      status.id = "icono-emulsion-favorite-status"
      status.className = "icono-visually-hidden"
      status.setAttribute("role", "status")
      status.setAttribute("aria-live", "polite")
      root.appendChild(status)
    }
    status.textContent = ""
    window.setTimeout(function () {
      status.textContent = String(message || "")
    }, 0)
  }

  function wireEmulsionFavoriteButtons(container) {
    if (!container || container._iconoEmulsionFavoritesWired) return
    container._iconoEmulsionFavoritesWired = true
    container.addEventListener("click", function (event) {
      var button = event.target.closest("[data-icono-emulsion-favorite]")
      if (!button || !container.contains(button)) return
      event.preventDefault()
      event.stopPropagation()
      var emulsionId = normalizeEmulsionFamilyId(
        button.getAttribute("data-icono-emulsion-favorite"),
      )
      if (!emulsionId) return
      if (!currentUser) {
        openVoteLoginDialog({
          loginUrl: voteLoginUrl(),
          returnFocus: button,
          title: "Log in with Discord to save favorites",
        })
        return
      }
      emulsionFavorites
        .toggle(emulsionId)
        .then(function () {
          announceEmulsionFavoriteStatus(
            (emulsionFavorites.has(emulsionId) ? "Added " : "Removed ") +
              displayEmulsionCode(emulsionId) +
              (emulsionFavorites.has(emulsionId) ? " to favorites." : " from favorites."),
          )
        })
        .catch(function () {
          var matching = document.querySelectorAll(
            '[data-icono-emulsion-favorite="' + CSS.escape(emulsionId) + '"]',
          )
          for (var i = 0; i < matching.length; i++) {
            matching[i].classList.add("has-save-error")
          }
          announceEmulsionFavoriteStatus(
            "Could not save favorite. The previous state was restored.",
          )
          window.setTimeout(function () {
            for (var i = 0; i < matching.length; i++) {
              matching[i].classList.remove("has-save-error")
            }
          }, 1800)
        })
    })
  }

  // Favorite controls are rendered and replaced by auth hydration, picker
  // searches, and client-side navigation. Install one delegated listener as
  // soon as this module evaluates; unlike route initialization, it cannot be
  // skipped when Quartz adopts an already server-rendered gene page.
  wireEmulsionFavoriteButtons(document)

  emulsionFavorites.subscribe(function (state) {
    syncEmulsionFavoriteButtons(document, state && state.changedId)
    syncSelectAllFavoriteButtons(document)
  })

  function publishFailureMessage(error, fallback, resultLabel) {
    var payload = error && error.payload && typeof error.payload === "object" ? error.payload : null
    var failure =
      payload && payload.failure && typeof payload.failure === "object" ? payload.failure : null
    var headline = String(
      (payload && payload.error) || (error && error.message) || fallback || "Publishing failed.",
    ).trim()
    if (!failure) {
      var status = Number(error && error.status) || 0
      if (status === 409) return headline
      var fallbackLines = [headline]
      if (status === 401) {
        fallbackLines.push("Log in, then press Publish again. Your image is saved.")
      } else if (status === 404) {
        fallbackLines.push("Reload this gene page before trying again. Your image is saved.")
      } else {
        fallbackLines.push("Your " + String(resultLabel || "image") + " is saved.")
        fallbackLines.push(
          "Check your connection, then retry Publish. The image will not be regenerated.",
        )
      }
      return fallbackLines.join("\n")
    }

    var lines = [headline]
    var preserved = String(failure.preserved_message || "").trim()
    var nextAction = String(failure.next_action || "").trim()
    var code = String((payload && payload.code) || "").trim()
    var jobId = String(failure.job_id || "").trim()
    if (preserved && !lines.includes(preserved)) lines.push(preserved)
    if (nextAction && !lines.includes(nextAction)) lines.push(nextAction)
    if (code) lines.push("Reference: " + code + (jobId ? " · " + jobId : ""))
    return lines.join("\n")
  }

  var iconoplasmQueryInflight = new Map()

  function singleFlightQuery(key, producer) {
    var resolvedKey = String(key || "").trim()
    if (!resolvedKey) return producer()
    if (iconoplasmQueryInflight.has(resolvedKey)) {
      return iconoplasmQueryInflight.get(resolvedKey)
    }
    var promise = Promise.resolve()
      .then(producer)
      .finally(function () {
        iconoplasmQueryInflight.delete(resolvedKey)
      })
    iconoplasmQueryInflight.set(resolvedKey, promise)
    return promise
  }

  function fetchDiscoveryState(order, seed, init) {
    var resolvedOrder = normalizeHomeCollectionOrder(order || HOME_COLLECTION_DEFAULT_ORDER)
    var path = "/api/iconoplasm/discoveries/me?order=" + encodeURIComponent(resolvedOrder)
    if (resolvedOrder === "random" && seed) {
      path += "&seed=" + encodeURIComponent(String(seed))
    }
    return fetchAuthedJSON(path, init)
  }

  function fetchHomeCollectionCounts() {
    return Promise.resolve({
      total: ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT,
      publishedTotal: 0,
    })
  }

  function syncPublicInventoryStat() {
    var statEl = document.getElementById("icono-public-inventory-stat")
    if (!statEl) return
    statEl.textContent = ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT.toLocaleString() + " genes"
    statEl.hidden = false
  }

  function accountGalleryWindowOrderSupported(order) {
    var resolved = normalizeHomeCollectionOrder(order || HOME_COLLECTION_DEFAULT_ORDER)
    return resolved === "newest" || resolved === "symbol"
  }

  function accountGalleryWindowAvailable(order, scope) {
    var resolvedScope = String(scope || "personal")
      .trim()
      .toLowerCase()
    return (
      accountGalleryWindowOrderSupported(order) &&
      (resolvedScope === "shared" || !!currentUser) &&
      resolvedScope !== "guest"
    )
  }

  function fetchAccountGalleryWindow(order, paging, limit, options) {
    var opts = options || {}
    var resolvedOrder = normalizeHomeCollectionOrder(order || HOME_COLLECTION_DEFAULT_ORDER)
    var resolvedAfter = String((paging && paging.after) || "").trim()
    var resolvedBefore = String((paging && paging.before) || "").trim()
    if (resolvedAfter && resolvedBefore) {
      return Promise.reject(new Error("Account gallery accepts either after or before, not both."))
    }
    var resolvedLimit = Math.max(1, Math.min(48, Number(limit || 24) || 24))
    var resolvedView = String(opts.view || "").trim()
    var resolvedScope =
      String(opts.scope || "")
        .trim()
        .toLowerCase() === "shared"
        ? "shared"
        : "personal"
    var path =
      "/api/iconoplasm/account-gallery-window?order=" +
      encodeURIComponent(resolvedOrder) +
      "&limit=" +
      encodeURIComponent(String(resolvedLimit))
    if (resolvedScope === "shared") {
      path += "&scope=shared"
    }
    if (resolvedView) {
      path += "&view=" + encodeURIComponent(resolvedView)
    }
    if (resolvedAfter) {
      path += "&after=" + encodeURIComponent(resolvedAfter)
    } else if (resolvedBefore) {
      path += "&before=" + encodeURIComponent(resolvedBefore)
    }
    var singleFlightKey = [
      "account-gallery-window",
      resolvedOrder,
      resolvedAfter,
      resolvedBefore,
      resolvedLimit,
      resolvedView,
      resolvedScope,
    ].join(":")
    var bootstrap = window.__iconoplasmBootstrap || null
    if (
      bootstrap &&
      bootstrap.accountGalleryWindowData &&
      bootstrap.accountGalleryWindowData.ok &&
      bootstrap.accountGalleryWindowData.view === "image-only" &&
      resolvedOrder === "newest" &&
      resolvedLimit ===
        Math.max(1, Math.min(48, Number(bootstrap.accountGalleryWindowLimit || 48) || 48)) &&
      resolvedView === "image-only" &&
      resolvedScope === "personal" &&
      !resolvedAfter &&
      !resolvedBefore
    ) {
      return Promise.resolve(bootstrap.accountGalleryWindowData)
    }
    if (
      bootstrap &&
      !bootstrap.accountGalleryWindowUsed &&
      bootstrap.accountGalleryWindowPromise &&
      resolvedOrder === "newest" &&
      resolvedLimit ===
        Math.max(1, Math.min(48, Number(bootstrap.accountGalleryWindowLimit || 48) || 48)) &&
      resolvedView === "image-only" &&
      resolvedScope === "personal" &&
      !resolvedAfter &&
      !resolvedBefore
    ) {
      bootstrap.accountGalleryWindowUsed = true
      var bootstrapWindowPromise = bootstrap.accountGalleryWindowPromise
        .then(function (data) {
          if (data && data.ok && data.view === "image-only") {
            bootstrap.accountGalleryWindowData = data
          }
          if (data && data.ok && data.view === "image-only") return data
          return fetchAccountGalleryWindow(order, paging, limit, options)
        })
        .finally(function () {
          if (iconoplasmQueryInflight.get(singleFlightKey) === bootstrapWindowPromise) {
            iconoplasmQueryInflight.delete(singleFlightKey)
          }
        })
      iconoplasmQueryInflight.set(singleFlightKey, bootstrapWindowPromise)
      return bootstrapWindowPromise
    }
    var produceWindowRequest = function () {
      var requestInit = {
        cache: "no-store",
        signal: opts.signal,
        headers: {
          "Cache-Control": "no-store",
        },
      }
      return fetchAuthedJSON(path, requestInit).catch(function (err) {
        if (!err || (err.status !== 503 && err.status !== 502 && err.status !== 504)) {
          throw err
        }
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 450)
        }).then(function () {
          return fetchAuthedJSON(path, requestInit)
        })
      })
    }
    return opts.signal
      ? produceWindowRequest()
      : singleFlightQuery(singleFlightKey, produceWindowRequest)
  }

  /* ─── Utility ─── */

  function esc(s) {
    var d = document.createElement("div")
    d.textContent = s
    return d.innerHTML
  }

  var requestInbox = createRequestInbox({
    fetchJSON: fetchJSON,
    getCurrentUser: function () {
      return currentUser
    },
    renderSidebar: function () {
      renderIconoplasmSidebar()
    },
    escapeHtml: esc,
    ensurePortraitSource: portraitDelivery.ensure,
    resolvePortraitUrl: portraitDelivery.resolve,
    navigate: function (href, link) {
      navigateTo(href, link)
    },
  })

  function normalizedSymbol(symbol) {
    return String(symbol || "")
      .trim()
      .toUpperCase()
  }

  function rawPublishedPortraitUrl(genePayload, preferredSize) {
    var portrait = genePayload && genePayload.portrait
    var flatHeroUrl = String((genePayload && genePayload.ph) || "").trim()
    var flatMediumUrl = String((genePayload && genePayload.pt) || "").trim()
    var isPublished =
      (portrait && portrait.status === "published") || Boolean(flatHeroUrl || flatMediumUrl)
    if (!isPublished) return ""
    var heroUrl = String((portrait && portrait.hero_url) || flatHeroUrl).trim()
    var mediumUrl = String((portrait && portrait.medium_url) || flatMediumUrl).trim()
    var thumbUrl = String((portrait && portrait.thumb_url) || "").trim()
    if (preferredSize === "medium") return mediumUrl || thumbUrl || heroUrl
    if (preferredSize === "thumb") return thumbUrl || mediumUrl || heroUrl
    return heroUrl || mediumUrl || thumbUrl
  }

  function portraitAssetRefUrl(asset, preferredSize) {
    var renditions = (asset && asset.renditions) || {}
    var preferred = renditions[preferredSize] || null
    var fallback = renditions.medium || renditions.full || renditions.thumb || null
    return String(
      (preferred && preferred.canonical_url) || (fallback && fallback.canonical_url) || "",
    ).trim()
  }

  function publishedPortraitUrl(genePayload, preferredSize) {
    return portraitDelivery.resolve(rawPublishedPortraitUrl(genePayload, preferredSize))
  }

  function publishedGeneBlot(genePayload) {
    var blot = genePayload && genePayload.blot
    return blot && blot.status === "ready" && blot.canonical_url && blot.semantic_url ? blot : null
  }

  function canonicalGeneBlotMarkup(genePayload) {
    var blot = publishedGeneBlot(genePayload)
    var symbol = normalizedSymbol(genePayload && genePayload.symbol)
    if (!blot || !symbol) return ""
    // Always reveal the stable semantic route. Published cards are immutable,
    // so their canonical_url may still name an older blot renderer even after
    // the current renderer has been materialized for this exact card.
    var blotUrl = String(blot.semantic_url || "").trim()
    var fullName = String(
      (genePayload && (genePayload.full_name || genePayload.name)) || symbol,
    ).trim()
    var alt = symbol + " Iconoplasm gene blot — " + fullName
    return (
      '<figure class="icono-canonical-gene-blot" data-icono-canonical-gene-blot hidden>' +
      '<img class="icono-canonical-gene-blot-image" src="' +
      esc(blotUrl) +
      '" data-iconoplasm-role="canonical-blot" data-gene-symbol="' +
      esc(symbol) +
      '" data-iconoplasm-canonical-image-src="' +
      esc(blotUrl) +
      '" width="' +
      esc(String(blot.width || 768)) +
      '" height="' +
      esc(String(blot.height || 1024)) +
      '" loading="lazy" decoding="async" fetchpriority="low" alt="' +
      esc(alt) +
      '"></figure>'
    )
  }

  function rawCandidatePortraitUrl(candidate, preferredSize) {
    var item = candidate || {}
    var fullUrl = String(item.full_url || "").trim()
    var mediumUrl = String(item.medium_url || "").trim()
    var thumbUrl = String(item.thumb_url || "").trim()
    if (preferredSize === "medium") return mediumUrl || thumbUrl || fullUrl
    if (preferredSize === "thumb") return thumbUrl || mediumUrl || fullUrl
    return fullUrl || mediumUrl || thumbUrl
  }

  function candidatePortraitUrl(candidate, preferredSize) {
    return portraitDelivery.resolve(rawCandidatePortraitUrl(candidate, preferredSize))
  }

  function firstRawPortraitUrl(records) {
    var source = Array.isArray(records) ? records : [records]
    for (var i = 0; i < source.length; i++) {
      var item = source[i]
      var published = rawPublishedPortraitUrl(item, "medium")
      if (published) return published
      var candidates = Array.isArray(item && item.portrait_candidates)
        ? item.portrait_candidates
        : []
      for (var j = 0; j < candidates.length; j++) {
        var candidate = rawCandidatePortraitUrl(candidates[j], "medium")
        if (candidate) return candidate
      }
    }
    return ""
  }

  function ensurePortraitDelivery(records) {
    var firstUrl = firstRawPortraitUrl(records)
    return firstUrl ? portraitDelivery.ensure(firstUrl) : Promise.resolve("")
  }

  function emulsionDisplayInfo(item) {
    var source = item || {}
    var emulsionId = String(source.emulsion_id || "").trim()
    var artistId = String(source.artist_id || "").trim()
    var label = String(source.emulsion_label || "").trim()
    var primary =
      displayEmulsionCode(emulsionId) || label || (artistId ? "Emulsion " + artistId : "")
    return {
      emulsionId: emulsionId,
      artistId: artistId,
      label: label,
      primary: primary,
    }
  }

  function displayEmulsionCode(rawEmulsionId) {
    return String(rawEmulsionId || "").trim()
  }

  function renderCanonicalToolbarMetaMarkup(genePayload) {
    var portrait = (genePayload && genePayload.portrait) || null
    var emulsionInfo = emulsionDisplayInfo(portrait)
    if (!emulsionInfo.primary) return '<div class="icono-candidate-toolbar-meta"></div>'
    return (
      '<div class="icono-candidate-toolbar-meta icono-canonical-toolbar-meta">' +
      '<div class="icono-candidate-toolbar-pair icono-canonical-toolbar-pair">' +
      "<span>Published</span><strong>" +
      esc(emulsionInfo.primary) +
      "</strong></div>" +
      renderEmulsionFavoriteButtonMarkup(
        emulsionInfo.emulsionId,
        "icono-emulsion-favorite-button--toolbar",
      ) +
      "</div>"
    )
  }

  function renderCaretakerIdentityMarkup(caretaker, className) {
    var profile = caretaker && typeof caretaker === "object" ? caretaker : {}
    var username = String(profile.username || "").trim()
    var avatarUrl = String(profile.avatar_url || "").trim()
    if (!username || avatarUrl.indexOf("/api/avatar?src=") !== 0) return ""
    return (
      '<div class="icono-caretaker-identity ' +
      esc(className || "") +
      '" aria-label="Caretaker ' +
      esc(username) +
      '"><img class="icono-caretaker-identity__avatar" src="' +
      esc(avatarUrl) +
      '" alt="" loading="lazy" decoding="async"><span class="icono-caretaker-identity__name">' +
      esc(username) +
      "</span></div>"
    )
  }

  function syncViewerCaretakerToolbarIdentity(container, isCaretaker) {
    var actions = container && container.querySelector(".icono-canonical-toolbar-actions")
    if (!actions || !currentUser) return
    var existing = actions.querySelector(".icono-caretaker-identity--toolbar")
    if (!isCaretaker) {
      if (existing && existing.getAttribute("data-icono-viewer-caretaker") === "true") {
        existing.remove()
      }
      return
    }
    if (existing) {
      existing.setAttribute("data-icono-viewer-caretaker", "true")
      return
    }
    var markup = renderCaretakerIdentityMarkup(
      {
        username: currentUser.username,
        avatar_url: currentUser.avatar_url,
      },
      "icono-caretaker-identity--toolbar",
    )
    if (!markup) return
    var claimHost = actions.querySelector("[data-icono-caretaker-claim-action]")
    if (!claimHost) return
    claimHost.insertAdjacentHTML("beforebegin", markup)
    actions
      .querySelector(".icono-caretaker-identity--toolbar")
      ?.setAttribute("data-icono-viewer-caretaker", "true")
  }

  function portraitDimensions(genePayload) {
    var portrait = genePayload && genePayload.portrait
    var assetSha = String((portrait && portrait.asset_sha256) || "")
      .trim()
      .toLowerCase()
    var candidates = Array.isArray(genePayload && genePayload.portrait_candidates)
      ? genePayload.portrait_candidates
      : []
    var matchedCandidate = null
    if (assetSha) {
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i]
        var candidateSha = String((candidate && candidate.asset_sha256) || "")
          .trim()
          .toLowerCase()
        if (candidateSha && candidateSha === assetSha) {
          matchedCandidate = candidate
          break
        }
      }
    }
    var width = Number(
      (portrait && (portrait.width || portrait.image_width)) ||
        (matchedCandidate && (matchedCandidate.width || matchedCandidate.image_width)) ||
        (genePayload && genePayload.width) ||
        0,
    )
    var height = Number(
      (portrait && (portrait.height || portrait.image_height)) ||
        (matchedCandidate && (matchedCandidate.height || matchedCandidate.image_height)) ||
        (genePayload && genePayload.height) ||
        0,
    )
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { width: 1, height: 1 }
    }
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }
  }

  function deferWork(task) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(
        function () {
          task()
        },
        { timeout: 1200 },
      )
      return
    }
    window.setTimeout(task, 120)
  }

  function loadScriptOnce(src, test) {
    if (typeof test === "function" && test()) return Promise.resolve()
    var existing = document.querySelector('script[data-icono-script="' + src + '"]')
    if (existing) {
      return new Promise(function (resolve, reject) {
        existing.addEventListener("load", resolve, { once: true })
        existing.addEventListener("error", reject, { once: true })
      })
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script")
      script.src = src
      script.defer = true
      script.async = false
      script.setAttribute("data-icono-script", src)
      script.addEventListener(
        "load",
        function () {
          resolve()
        },
        { once: true },
      )
      script.addEventListener(
        "error",
        function () {
          reject(new Error("Failed to load " + src))
        },
        { once: true },
      )
      document.head.appendChild(script)
    })
  }

  function ensureMasonryLibs() {
    if (window.Masonry && window.imagesLoaded) return Promise.resolve()
    if (masonryLibsPromise) return masonryLibsPromise
    var masonryUrl = new URL("./vendor/masonry.pkgd.min.js?v=20260311a", import.meta.url).href
    var imagesLoadedUrl = new URL("./vendor/imagesloaded.pkgd.min.js?v=20260311a", import.meta.url)
      .href
    masonryLibsPromise = loadScriptOnce(masonryUrl, function () {
      return !!window.Masonry
    })
      .then(function () {
        return loadScriptOnce(imagesLoadedUrl, function () {
          return !!window.imagesLoaded
        })
      })
      .catch(function (error) {
        masonryLibsPromise = null
        throw error
      })
    return masonryLibsPromise
  }

  function rememberRetainedPortraitImage(url, img) {
    var resolvedUrl = String(url || "").trim()
    if (!resolvedUrl || !img) return
    if (!portraitRetainedImageCache[resolvedUrl]) {
      portraitRetainedImageOrder.push(resolvedUrl)
    }
    portraitRetainedImageCache[resolvedUrl] = img
    while (portraitRetainedImageOrder.length > 12) {
      var evictedUrl = portraitRetainedImageOrder.shift()
      if (!evictedUrl) continue
      delete portraitRetainedImageCache[evictedUrl]
    }
  }

  function preloadImage(url, options) {
    var resolvedUrl = String(url || "").trim()
    var opts = options || {}
    if (!resolvedUrl) return Promise.resolve("")
    if (portraitImageCache[resolvedUrl]) return Promise.resolve(resolvedUrl)
    if (portraitImagePromiseCache[resolvedUrl]) return portraitImagePromiseCache[resolvedUrl]

    portraitImagePromiseCache[resolvedUrl] = new Promise(function (resolve) {
      var img = new Image()
      var finished = false
      img.decoding = "async"
      function finish(value) {
        if (finished) return
        finished = true
        if (value) portraitImageCache[resolvedUrl] = true
        if (value && opts.retain) rememberRetainedPortraitImage(resolvedUrl, img)
        delete portraitImagePromiseCache[resolvedUrl]
        resolve(value)
      }
      img.addEventListener(
        "load",
        function () {
          if (typeof img.decode === "function") {
            img
              .decode()
              .catch(function () {
                return null
              })
              .finally(function () {
                finish(resolvedUrl)
              })
            return
          }
          finish(resolvedUrl)
        },
        { once: true },
      )
      img.addEventListener(
        "error",
        function () {
          finish("")
        },
        { once: true },
      )
      img.src = resolvedUrl
    })

    return portraitImagePromiseCache[resolvedUrl]
  }

  function refreshPortraitLightbox() {
    installIconoplasmLightbox(document)
  }

  var printCopyRequestState = Object.create(null)
  var turnstileScriptPromise = null
  var PRINT_COPY_STATUS_DELAYS_MS = [5000, 10000, 20000, 40000, 45000]

  function printCopyCurrentAssetSha(genePayload) {
    var portrait = genePayload && genePayload.portrait
    var assetSha = String((portrait && portrait.asset_sha256) || "")
      .trim()
      .toLowerCase()
    return /^[a-f0-9]{64}$/.test(assetSha) ? assetSha : ""
  }

  function normalizedAssetSha(value) {
    var assetSha = String(value || "")
      .trim()
      .toLowerCase()
    return /^[a-f0-9]{64}$/.test(assetSha) ? assetSha : ""
  }

  function printCopyTriggers(symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return []
    var selector = '[data-icono-print-copy-symbol="' + key.replace(/"/g, '\\"') + '"]'
    return Array.prototype.slice.call(document.querySelectorAll(selector))
  }

  function setPrintCopyTriggerState(symbol, state, payload) {
    var key = normalizedSymbol(symbol)
    if (!key) return
    printCopyRequestState[key] = state
    var buttons = printCopyTriggers(key)
    buttons.forEach(function (button) {
      button.setAttribute("data-icono-print-copy-state", state)
      button.removeAttribute("aria-disabled")
      if (state === "ready" && payload && payload.download_url) {
        button.setAttribute("data-icono-print-copy-ready", "true")
        button.setAttribute("href", payload.download_url)
        button.setAttribute("target", "_blank")
        button.setAttribute("rel", "noopener")
        button.textContent = "download " + key + " print copy"
        return
      }
      button.removeAttribute("data-icono-print-copy-ready")
      button.removeAttribute("href")
      button.removeAttribute("target")
      button.removeAttribute("rel")
      button.textContent =
        state === "queued"
          ? "preparing " + key + " print copy…"
          : state === "failed"
            ? "retry " + key + " print copy"
            : "request print copy"
    })
  }

  function beginPrintCopyDownload(payload) {
    if (!payload || !payload.download_url) return
    var link = document.createElement("a")
    link.href = payload.download_url
    link.download = payload.filename || "iconoplasm-gene-card.png"
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  function loadTurnstileScript() {
    if (window.turnstile && typeof window.turnstile.render === "function") {
      return Promise.resolve(window.turnstile)
    }
    if (turnstileScriptPromise) return turnstileScriptPromise
    turnstileScriptPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script")
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      script.async = true
      script.defer = true
      script.onload = function () {
        if (window.turnstile && typeof window.turnstile.render === "function") {
          resolve(window.turnstile)
        } else {
          reject(new Error("Bot check did not initialize"))
        }
      }
      script.onerror = function () {
        reject(new Error("Bot check could not be loaded"))
      }
      document.head.appendChild(script)
    })
    return turnstileScriptPromise
  }

  function requestPrintCopyTurnstile(trigger, symbol, siteKey) {
    if (!siteKey) return Promise.reject(new Error("Bot check is unavailable"))
    return loadTurnstileScript().then(function (turnstile) {
      return new Promise(function (resolve, reject) {
        var host = document.createElement("div")
        host.className = "icono-print-copy-turnstile"
        trigger.insertAdjacentElement("afterend", host)
        turnstile.render(host, {
          sitekey: siteKey,
          theme: "auto",
          action: "gene_card_request",
          callback: function (token) {
            host.remove()
            resolve(token)
          },
          "error-callback": function () {
            host.remove()
            reject(new Error("Bot check failed"))
          },
          "expired-callback": function () {
            host.remove()
            reject(new Error("Bot check expired"))
          },
        })
      })
    })
  }

  function fetchPrintCopyStatus(symbol) {
    return fetchJSON("/api/iconoplasm/print-copy-status/" + encodeURIComponent(symbol), {
      cache: "no-store",
    })
  }

  function waitForPrintCopy(symbol, attempt) {
    return fetchPrintCopyStatus(symbol).then(function (payload) {
      if (payload.status === "ready") return payload
      if (payload.status === "failed") throw new Error(payload.last_error || "Print copy failed")
      var delay = PRINT_COPY_STATUS_DELAYS_MS[attempt]
      if (!delay) return payload
      return new Promise(function (resolve) {
        window.setTimeout(resolve, delay)
      }).then(function () {
        return waitForPrintCopy(symbol, attempt + 1)
      })
    })
  }

  function postPrintCopyRequest(symbol, turnstileToken) {
    return fetch("/api/iconoplasm/print-copy-requests/" + encodeURIComponent(symbol), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(turnstileToken ? { turnstile_token: turnstileToken } : {}),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {}
        })
        .then(function (payload) {
          if (!response.ok) {
            var error = new Error(payload.error || "Print-copy request failed")
            error.payload = payload
            throw error
          }
          return payload
        })
    })
  }

  function wirePrintCopyRequests(container, genePayload) {
    if (!container || !container.querySelectorAll) return
    var buttons = container.querySelectorAll("[data-icono-print-copy]")
    buttons.forEach(function (button) {
      var symbol =
        String(button.getAttribute("data-icono-print-copy-symbol") || "").trim() ||
        String(genePayload && genePayload.symbol ? genePayload.symbol : "").trim()
      if (!symbol || button.getAttribute("data-icono-print-copy-wired") === "true") return
      button.setAttribute("data-icono-print-copy-wired", "true")
      var printCopy = genePayload && genePayload.print_copy
      if (printCopy && printCopy.status === "ready") {
        setPrintCopyTriggerState(symbol, "ready", {
          download_url:
            "/api/iconoplasm/print-copy/" + encodeURIComponent(normalizedSymbol(symbol)) + ".png",
          filename: printCopy.filename,
        })
      } else {
        setPrintCopyTriggerState(symbol, "idle")
        var route = getRoute()
        if (route.page === "gene" && normalizedSymbol(route.symbol) === normalizedSymbol(symbol)) {
          void fetchPrintCopyStatus(normalizedSymbol(symbol))
            .then(function (payload) {
              if (payload.status === "ready") setPrintCopyTriggerState(symbol, "ready", payload)
            })
            .catch(function () {
              // Status is optional presentation state. The explicit request path
              // remains available and is the only path allowed to mutate.
            })
        }
      }
    })
  }

  function openPrintCopyImage(trigger) {
    if (!trigger || !trigger.closest) return
    var sourceCard = trigger.closest(".icono-card")
    if (!sourceCard) return
    var symbol =
      String(trigger.getAttribute("data-icono-print-copy-symbol") || "").trim() ||
      String(sourceCard.getAttribute("data-icono-symbol") || "").trim()
    var key = normalizedSymbol(symbol)
    if (!key || printCopyRequestState[key] === "queued") return
    revealCanonicalGeneBlot(trigger, key)
    setPrintCopyTriggerState(key, "queued")
    void postPrintCopyRequest(key)
      .catch(function (error) {
        var payload = error && error.payload
        if (payload && payload.code === "TURNSTILE_REQUIRED") {
          return requestPrintCopyTurnstile(trigger, key, payload.turnstile_site_key).then(
            function (token) {
              return postPrintCopyRequest(key, token)
            },
          )
        }
        throw error
      })
      .then(function (payload) {
        if (payload.status === "ready") return payload
        return waitForPrintCopy(key, 0)
      })
      .then(function (payload) {
        if (payload.status === "ready") {
          setPrintCopyTriggerState(key, "ready", payload)
          beginPrintCopyDownload(payload)
        } else {
          setPrintCopyTriggerState(key, "queued")
        }
      })
      .catch(function (error) {
        console.error("[Iconoplasm] print-copy request failed:", error)
        setPrintCopyTriggerState(key, "failed")
      })
  }

  function revealCanonicalGeneBlot(trigger, symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return
    var geneContent = trigger && trigger.closest ? trigger.closest("#icono-gene-content") : null
    var scope = geneContent || document
    var blot = scope.querySelector("[data-icono-canonical-gene-blot]")
    if (!blot) return
    blot.removeAttribute("hidden")
  }

  function isCompleteGeneDetailPayload(payload, symbol) {
    var expectedSymbol = normalizedSymbol(symbol)
    return !!(
      payload &&
      typeof payload === "object" &&
      normalizedSymbol(payload.symbol) === expectedSymbol &&
      payload.essence &&
      typeof payload.essence === "object" &&
      Array.isArray(payload.portrait_candidates)
    )
  }

  function fetchCompleteGeneDetailFromEndpoint(key, options) {
    var detailPath = "/api/iconoplasm/site/genes/" + encodeURIComponent(key)
    var requestInit = undefined
    if (options && options.forceFresh) {
      detailPath += "?fresh=" + encodeURIComponent(String(Date.now()))
      requestInit = { cache: "no-store" }
    }
    return fetchJSON(detailPath, requestInit).then(function (data) {
      if (!isCompleteGeneDetailPayload(data, key)) {
        throw new Error("Incomplete gene detail response for " + key)
      }
      return data
    })
  }

  function fetchGeneDetail(symbol, options) {
    var key = normalizedSymbol(symbol)
    if (!key) return Promise.resolve(null)
    options = options || {}
    if (options.forceFresh) {
      // When a vote auto-promotes a new canonical portrait, the Worker still marks
      // public gene JSON cacheable. Bust both our in-memory cache and the request URL
      // so the current page reflects the new canonical immediately instead of after a
      // browser cache grace period or a couple of annoyed reloads.
      delete portraitDetailCache[key]
      delete portraitDetailPromiseCache[key]
    }
    if (!options.forceFresh && isCompleteGeneDetailPayload(portraitDetailCache[key], key))
      return Promise.resolve(portraitDetailCache[key])
    delete portraitDetailCache[key]
    if (!options.forceFresh && portraitDetailPromiseCache[key])
      return portraitDetailPromiseCache[key]
    var bootstrap = window.__iconoplasmBootstrap || null
    if (
      !options.forceFresh &&
      bootstrap &&
      bootstrap.geneDetailSymbol === key &&
      isCompleteGeneDetailPayload(bootstrap.geneDetailData, key)
    ) {
      portraitDetailCache[key] = bootstrap.geneDetailData
      return Promise.resolve(bootstrap.geneDetailData)
    }
    if (
      !options.forceFresh &&
      bootstrap &&
      bootstrap.geneDetailSymbol === key &&
      bootstrap.geneDetailPromise
    ) {
      portraitDetailPromiseCache[key] = bootstrap.geneDetailPromise
        .then(function (data) {
          if (isCompleteGeneDetailPayload(data, key)) {
            portraitDetailCache[key] = data
            bootstrap.geneDetailData = data
            return data
          }
          // A head-started promise from an older page build may still resolve
          // to the lean card projection. Repair it with the complete endpoint
          // instead of recursively rejoining the same incomplete promise.
          return fetchCompleteGeneDetailFromEndpoint(key, options).then(function (completeData) {
            portraitDetailCache[key] = completeData
            bootstrap.geneDetailData = completeData
            return completeData
          })
        })
        .finally(function () {
          delete portraitDetailPromiseCache[key]
        })
      return portraitDetailPromiseCache[key]
    }

    // Rich per-gene detail is intentionally first-party only now. Bulk consumers
    // should sync from catalog snapshots + changes instead of crawling one gene at a time.
    portraitDetailPromiseCache[key] = fetchCompleteGeneDetailFromEndpoint(key, options)
      .then(function (data) {
        portraitDetailCache[key] = data
        return data
      })
      .catch(function () {
        return null
      })
      .finally(function () {
        delete portraitDetailPromiseCache[key]
      })

    return portraitDetailPromiseCache[key]
  }

  function invalidateGeneDetail(symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return
    delete portraitDetailCache[key]
    delete portraitDetailPromiseCache[key]
    delete geneCardArtifactCache[key]
    delete geneRequestSummaryCache[key]
  }

  function fetchGeneRequestSummary(symbol, options) {
    var key = normalizedSymbol(symbol)
    if (!key) return Promise.resolve(null)
    var opts = options || {}
    if (opts.forceFresh) delete geneRequestSummaryCache[key]
    if (!opts.forceFresh && geneRequestSummaryCache[key]) {
      return Promise.resolve(geneRequestSummaryCache[key])
    }
    return singleFlightQuery("gene-request-summary:" + key, function () {
      var path = "/api/iconoplasm/requests/gene/" + encodeURIComponent(key) + "/summary"
      var requestInit = { credentials: "include" }
      if (opts.forceFresh) {
        path += "?fresh=" + encodeURIComponent(String(Date.now()))
        requestInit.cache = "no-store"
      }
      return fetchJSON(path, requestInit).then(function (state) {
        geneRequestSummaryCache[key] = state
        return state
      })
    })
  }

  function recordGenePageVisitDiscovery(symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return
    var visitKey = window.location.pathname + "|" + key
    if (lastGenePageDiscoveryVisitKey === visitKey) return
    lastGenePageDiscoveryVisitKey = visitKey
    // A dossier visit is a deliberate discovery. Signed-out visits stay in the
    // browser-local shelf and cost no Worker request. If an auth lookup
    // is still resolving, the login path merges this entry after authority is
    // established.
    if (!currentUser) {
      websiteGuestDiscoveries.remember(key)
      return
    }
    window.setTimeout(function () {
      fetchAuthedJSON("/api/iconoplasm/discoveries/encounter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: key,
          source: "gene_page_visit",
          trigger: "gene_page_visit",
        }),
      }).catch(function () {})
    }, 0)
  }

  function mergeWebsiteGuestDiscoveriesIfSignedIn() {
    if (!currentUser) return Promise.resolve(null)
    if (websiteGuestDiscoveryMergePromise) return websiteGuestDiscoveryMergePromise
    if (websiteGuestDiscoveryMergeRemaining <= 0) return Promise.resolve(null)
    var pendingSymbols = websiteGuestDiscoveries.pendingSymbols(websiteGuestDiscoveryMergeRemaining)
    if (!pendingSymbols.length) return Promise.resolve(null)
    websiteGuestDiscoveryMergePromise = fetchAuthedJSON("/api/iconoplasm/discoveries/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: pendingSymbols }),
      cache: "no-store",
    })
      .then(function (payload) {
        if (!payload || payload.ok !== true || payload.authenticated !== true) return null
        websiteGuestDiscoveries.remove(pendingSymbols)
        websiteGuestDiscoveryMergeRemaining = Math.max(
          0,
          websiteGuestDiscoveryMergeRemaining - pendingSymbols.length,
        )
        return payload
      })
      .catch(function (error) {
        console.warn(
          "[Iconoplasm] website guest discovery merge retained for retry:",
          String((error && error.message) || error || "unknown error"),
        )
        return null
      })
      .finally(function () {
        websiteGuestDiscoveryMergePromise = null
      })
    return websiteGuestDiscoveryMergePromise
  }

  function invalidateImageEditProviders() {
    imageEditProvidersCache = Object.create(null)
    imageEditProvidersPromise = Object.create(null)
  }

  function fetchImageEditProviders(options) {
    var opts = options || {}
    var op = opts.op === "candidate_generation" ? "candidate_generation" : "image_edit"
    var cacheKey = op
    if (opts.forceFresh) invalidateImageEditProviders()
    if (!opts.forceFresh && imageEditProvidersCache[cacheKey]) {
      return Promise.resolve(imageEditProvidersCache[cacheKey])
    }
    if (!opts.forceFresh && imageEditProvidersPromise[cacheKey]) {
      return imageEditProvidersPromise[cacheKey]
    }
    imageEditProvidersPromise[cacheKey] = singleFlightQuery(
      "image-edit-providers:" + op,
      function () {
        return fetchAuthedJSON(
          "/api/iconoplasm/image-edit/providers?op=" + encodeURIComponent(op),
          { cache: "no-store" },
        ).then(function (payload) {
          imageEditProvidersCache[cacheKey] = payload || {}
          return imageEditProvidersCache[cacheKey]
        })
      },
    ).finally(function () {
      imageEditProvidersPromise[cacheKey] = null
    })
    return imageEditProvidersPromise[cacheKey]
  }

  function hydrateGridPortrait(container, symbol, genePayload) {
    if (!container) return
    var key = normalizedSymbol(symbol)
    if (!key) return
    var card = container.querySelector('[data-icono-symbol="' + key + '"]')
    if (!card) return
    var media = card.querySelector(".icono-card-media")
    if (!media) return
    var portraitUrl = publishedPortraitUrl(genePayload, "medium")
    if (!portraitUrl) return
    var dims = portraitDimensions(genePayload)
    card.style.setProperty("--width", String(dims.width))
    card.style.setProperty("--height", String(dims.height))
    var existing = media.querySelector("img")
    if (existing) {
      existing.setAttribute("src", portraitUrl)
      // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Loading Performance, Smooth 60fps)
      // + C:\Users\Admin\.codex\skills\polish\SKILL.md (Performance / No layout shift).
      // When Masonry cards hydrate after initial shell render, keep the portrait fetch eager but
      // low priority so fast mobile scrolling does not flash blank media while preserving order.
      existing.setAttribute("loading", "eager")
      existing.setAttribute("fetchpriority", "low")
      existing.setAttribute("width", String(dims.width))
      existing.setAttribute("height", String(dims.height))
      media.classList.remove("icono-card-media--fallback")
      return
    }
    media.classList.remove("icono-card-media--fallback")
    media.innerHTML =
      '<img src="' +
      esc(portraitUrl) +
      '" alt="' +
      esc(key) +
      ' blot" loading="eager" decoding="async" fetchpriority="low" width="' +
      dims.width +
      '" height="' +
      dims.height +
      '">'
  }

  function prefetchPortraitBatch(entries, container) {
    var queue = []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      var key = normalizedSymbol(entry && entry.symbol ? entry.symbol : entry)
      if (!key) continue
      queue.push({
        symbol: key,
        data: entry && typeof entry === "object" ? entry : null,
      })
    }
    if (!queue.length) return Promise.resolve(null)

    var workerCount = Math.min(PREFETCH_DETAIL_CONCURRENCY, queue.length)
    var workers = []

    function next() {
      var entry = queue.shift()
      if (!entry) return Promise.resolve(null)
      var initialData = entry.data
      var initialUrl = publishedPortraitUrl(initialData, "medium")
      if (initialUrl) {
        hydrateGridPortrait(container, entry.symbol, initialData)
        return preloadImage(initialUrl).then(next)
      }
      return Promise.resolve(null).then(next)
    }

    for (var j = 0; j < workerCount; j++) {
      workers.push(next())
    }

    return Promise.all(workers).then(function () {
      return null
    })
  }

  function setupOrderedPortraitPrefetch(container, genes) {
    if (!container || !Array.isArray(genes) || !genes.length) return
    if (typeof container._iconoPrefetchCleanup === "function") {
      container._iconoPrefetchCleanup()
    }

    var orderedEntries = []
    for (var i = 0; i < genes.length; i++) {
      var entry = genes[i]
      var key = normalizedSymbol(entry && entry.symbol)
      if (!key) continue
      orderedEntries.push(entry)
    }
    if (!orderedEntries.length) return

    var nextBatchStart = 0

    function scheduleNextBatch() {
      if (nextBatchStart >= orderedEntries.length) return
      var batch = orderedEntries.slice(nextBatchStart, nextBatchStart + PREFETCH_BATCH_SIZE)
      nextBatchStart += PREFETCH_BATCH_SIZE
      deferWork(function () {
        void prefetchPortraitBatch(batch, container)
      })
    }

    function maybeAdvance(index) {
      if (!Number.isFinite(index)) return
      if (index >= nextBatchStart - PREFETCH_TRIGGER_OFFSET) {
        scheduleNextBatch()
      }
    }

    function handleIntent(event) {
      var card = event.target.closest(".icono-card[data-icono-index]")
      if (!card || !container.contains(card)) return
      var index = Number(card.getAttribute("data-icono-index"))
      maybeAdvance(index)
    }

    scheduleNextBatch()
    container.addEventListener("mouseover", handleIntent)
    container.addEventListener("focusin", handleIntent)
    container._iconoPrefetchCleanup = function () {
      container.removeEventListener("mouseover", handleIntent)
      container.removeEventListener("focusin", handleIntent)
      container._iconoPrefetchCleanup = null
    }
  }

  function scheduleHomeMasonry() {
    // no-op; layout is handled by Masonry instance
  }

  function destroyHomeMasonry(container) {
    if (container) {
      var mounted = homeMasonryInstances.get(container)
      if (mounted && mounted.instance) mounted.instance.destroy()
      homeMasonryInstances.delete(container)
      return
    }
    homeMasonryInstances.forEach(function (mounted) {
      if (mounted && mounted.instance) mounted.instance.destroy()
    })
    homeMasonryInstances.clear()
  }

  function applyHomeMasonryNow(container, newElements) {
    if (!container) return Promise.resolve()
    var Masonry = window.Masonry
    if (!Masonry) {
      console.warn("[Iconoplasm] Masonry library not loaded")
      return Promise.resolve()
    }
    var mountedMasonry = homeMasonryInstances.get(container)
    if (mountedMasonry && mountedMasonry.instance) {
      // Masonry already running — append new items if provided, then relayout
      var instance = mountedMasonry.instance
      if (newElements && newElements.length) {
        instance.appended(newElements)
      }
      if (window.imagesLoaded) {
        window.imagesLoaded(container, function () {
          instance.layout()
        })
      }
      return waitForMasonryLayout(instance)
    }
    destroyHomeMasonry(container)
    // Insert sizer elements if not already present
    if (!container.querySelector(".icono-grid-sizer")) {
      var sizer = document.createElement("div")
      sizer.className = "icono-grid-sizer"
      container.insertBefore(sizer, container.firstChild)
    }
    if (!container.querySelector(".icono-gutter-sizer")) {
      var gutter = document.createElement("div")
      gutter.className = "icono-gutter-sizer"
      container.insertBefore(gutter, container.children[1] || null)
    }
    var imageOnlyMasonry = container.getAttribute("data-layout") === "image-only-masonry"
    var msnry = new Masonry(container, {
      itemSelector: ".icono-card",
      columnWidth: ".icono-grid-sizer",
      gutter: ".icono-gutter-sizer",
      percentPosition: !imageOnlyMasonry,
      fitWidth: imageOnlyMasonry,
      transitionDuration: 0,
      initLayout: false,
    })
    homeMasonryInstances.set(container, {
      container: container,
      instance: msnry,
    })
    if (window.imagesLoaded) {
      window.imagesLoaded(container, function () {
        msnry.layout()
      })
    }
    return waitForMasonryLayout(msnry)
  }

  function waitForMasonryLayout(instance) {
    if (!instance || typeof instance.layout !== "function") return Promise.resolve()
    return new Promise(function (resolve) {
      var settled = false
      var fallbackTimer = 0
      var finish = function () {
        if (settled) return
        settled = true
        if (fallbackTimer) window.clearTimeout(fallbackTimer)
        resolve()
      }
      if (typeof instance.once === "function") instance.once("layoutComplete", finish)
      fallbackTimer = window.setTimeout(finish, 100)
      instance.layout()
    })
  }

  function applyHomeMasonry(container, newElements) {
    if (!container) return Promise.resolve()
    return ensureMasonryLibs()
      .then(function () {
        if (!container.isConnected) return
        return applyHomeMasonryNow(container, newElements)
      })
      .catch(function (error) {
        console.error("[Iconoplasm] failed to load Masonry:", error)
      })
  }

  function consumeBootstrapGallery(order, limit, offset) {
    var bootstrap = window.__iconoplasmBootstrap
    if (!bootstrap || bootstrap.homeGalleryUsed) return null
    if (offset !== 0 || order !== GALLERY_DEFAULT_ORDER || limit !== GALLERY_INITIAL_PAGE_SIZE) {
      return null
    }
    bootstrap.homeGalleryUsed = true
    if (bootstrap.homeGalleryData) return Promise.resolve(bootstrap.homeGalleryData)
    if (bootstrap.homeGalleryPromise) return bootstrap.homeGalleryPromise
    return null
  }

  function sharedOrderOptionsMarkup(defaultValue) {
    var html = ""
    for (var i = 0; i < HOME_COLLECTION_ORDERS.length; i++) {
      var option = HOME_COLLECTION_ORDERS[i]
      html +=
        '<option value="' +
        esc(option.value) +
        '"' +
        (option.value === defaultValue ? " selected" : "") +
        ">" +
        esc(option.label) +
        "</option>"
    }
    return html
  }

  function galleryOptionsMarkup() {
    return sharedOrderOptionsMarkup(GALLERY_DEFAULT_ORDER)
  }

  function homeCollectionOptionsMarkup() {
    return sharedOrderOptionsMarkup(HOME_COLLECTION_DEFAULT_ORDER)
  }

  function sharedDiscoveryOptionsMarkup() {
    var html = ""
    for (var i = 0; i < HOME_COLLECTION_ORDERS.length; i++) {
      var option = HOME_COLLECTION_ORDERS[i]
      if (!accountGalleryWindowOrderSupported(option.value)) continue
      html +=
        '<option value="' +
        esc(option.value) +
        '"' +
        (option.value === HOME_COLLECTION_DEFAULT_ORDER ? " selected" : "") +
        ">" +
        esc(option.label) +
        "</option>"
    }
    return html
  }

  function guestDiscoveryEntries() {
    // The signed-out archive is a fixed four-card preview, not a second local
    // collection. Gene visits are still buffered privately for a bounded merge
    // after login, but they must never enlarge or replace these visible starters.
    var starterEntries = GUEST_STARTER_GENES.map(function (entry) {
      return Object.assign({ encounter_count: 1 }, entry)
    })
    return normalizeDiscoveryEntries(starterEntries)
  }

  function fallbackDiscoveredGene(entry) {
    var symbol = normalizedSymbol(entry && entry.gene_symbol)
    var fullName = String((entry && entry.full_name) || "").trim()
    return {
      symbol: symbol,
      full_name: fullName || symbol || "Unknown gene",
      color: "#857565",
      portrait: { status: "pending" },
      portrait_candidates: [],
    }
  }

  function assertCompleteMobileCardVM(card) {
    if (!card || card.__complete !== true) {
      throw new Error("Attempted to render mobile dossier from an incomplete card VM")
    }
    if (card.schema_version !== "iconoplasm.mobileCard.v1") {
      throw new Error("Mobile card VM schema mismatch")
    }
    if (!normalizedSymbol(card.symbol) || !card.full_name || !card.payload) {
      throw new Error("Mobile card VM failed required identity contract")
    }
    if (!card.portrait || !card.field_status || card.portrait.status === "pending") {
      throw new Error("Mobile card VM failed portrait/field-status contract")
    }
    return card
  }

  function rememberGeneCardArtifact(payload, options) {
    var card = payload && typeof payload === "object" ? payload : null
    if (!card) return null
    var key = normalizedSymbol(card.symbol || card.canonical_symbol)
    if (!key) return null
    var trusted = !!(options && options.trusted)
    if (!trusted && !(card.mobile_card_vm && card.mobile_card_vm.schema_version)) return null
    geneCardArtifactCache[key] = card
    return card
  }

  function rememberGeneCardArtifacts(items) {
    var list = Array.isArray(items) ? items : []
    for (var i = 0; i < list.length; i++) {
      rememberGeneCardArtifact(list[i])
    }
  }

  function readCachedRenderableGenePayload(symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return null
    return portraitDetailCache[key] || geneCardArtifactCache[key] || null
  }

  function mobileCardPayloadFromVM(card) {
    var vm = assertCompleteMobileCardVM(card)
    var payload = vm.payload
    payload.mobile_card_vm = {
      schema_version: vm.schema_version,
      snapshot_version: vm.snapshot_version,
      data_source: vm.data_source,
      field_status: vm.field_status,
    }
    rememberGeneCardArtifact(payload, { trusted: true })
    return payload
  }

  var MOBILE_CARD_VM_SCHEMA = "iconoplasm.mobileCard.v1"
  var MOBILE_CARD_VM_IDB_NAME = "iconoplasm-mobile-card-vms"
  var MOBILE_CARD_VM_IDB_STORE = "card_vms"
  var MOBILE_CARD_VM_LAST_VERSION_KEY = "iconoplasm.mobileCardVM.lastVersion"
  var mobileCardVMDbPromise = null

  function mobileCardCacheKey(version, symbol) {
    return [MOBILE_CARD_VM_SCHEMA, String(version || ""), normalizedSymbol(symbol)].join(":")
  }

  function openMobileCardVMDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null)
    if (mobileCardVMDbPromise) return mobileCardVMDbPromise
    mobileCardVMDbPromise = new Promise(function (resolve) {
      var request = indexedDB.open(MOBILE_CARD_VM_IDB_NAME, 2)
      request.onupgradeneeded = function () {
        var db = request.result
        if (!db.objectStoreNames.contains(MOBILE_CARD_VM_IDB_STORE)) {
          db.createObjectStore(MOBILE_CARD_VM_IDB_STORE)
        }
      }
      request.onsuccess = function () {
        resolve(request.result)
      }
      request.onerror = function () {
        resolve(null)
      }
      request.onblocked = function () {
        resolve(null)
      }
    })
    return mobileCardVMDbPromise
  }

  function mobileCardCacheGetMany(version, symbols) {
    if (!version || !Array.isArray(symbols) || !symbols.length) return Promise.resolve(new Map())
    return openMobileCardVMDb().then(function (db) {
      if (!db) return new Map()
      return new Promise(function (resolve) {
        var out = new Map()
        var transaction = db.transaction(MOBILE_CARD_VM_IDB_STORE, "readonly")
        var store = transaction.objectStore(MOBILE_CARD_VM_IDB_STORE)
        var pending = symbols.length
        function finish() {
          pending -= 1
          if (pending <= 0) resolve(out)
        }
        for (var i = 0; i < symbols.length; i++) {
          var symbol = symbols[i]
          var request = store.get(mobileCardCacheKey(version, symbol))
          request.onsuccess = function (event) {
            var card = event.target && event.target.result
            try {
              if (card) out.set(normalizedSymbol(card.symbol), assertCompleteMobileCardVM(card))
            } catch (_) {}
            finish()
          }
          request.onerror = finish
        }
      })
    })
  }

  function mobileCardCacheSetMany(version, cards) {
    if (!version || !Array.isArray(cards) || !cards.length) return Promise.resolve()
    return openMobileCardVMDb().then(function (db) {
      if (!db) return
      return new Promise(function (resolve) {
        var transaction = db.transaction(MOBILE_CARD_VM_IDB_STORE, "readwrite")
        var store = transaction.objectStore(MOBILE_CARD_VM_IDB_STORE)
        for (var i = 0; i < cards.length; i++) {
          try {
            var card = assertCompleteMobileCardVM(cards[i])
            store.put(card, mobileCardCacheKey(version, card.symbol))
          } catch (_) {}
        }
        transaction.oncomplete = function () {
          resolve()
        }
        transaction.onerror = function () {
          resolve()
        }
        transaction.onabort = function () {
          resolve()
        }
      })
    })
  }

  function lastMobileCardVMVersion() {
    try {
      return String(window.localStorage.getItem(MOBILE_CARD_VM_LAST_VERSION_KEY) || "").trim()
    } catch (_) {
      return ""
    }
  }

  function rememberMobileCardVMVersion(version) {
    var value = String(version || "").trim()
    if (!value) return
    try {
      window.localStorage.setItem(MOBILE_CARD_VM_LAST_VERSION_KEY, value)
    } catch (_) {}
  }

  function loadMobileCardPageVM(pageEntries, options) {
    // The manifest endpoint is the single source of truth for gallery card
    // freshness. Persistent browser storage is write-through only here: Edge can
    // keep old IndexedDB rows for weeks, so a fully cached local page must still
    // ask the backend which KV_GALLERY_VERSION is current before rendering.
    var symbols = []
    var seen = Object.create(null)
    for (var i = 0; i < pageEntries.length; i++) {
      var symbol = normalizedSymbol(pageEntries[i] && pageEntries[i].gene_symbol)
      if (!symbol || seen[symbol]) continue
      seen[symbol] = true
      symbols.push(symbol)
    }
    if (!symbols.length) return Promise.resolve({ cards: [], failures: [] })
    var knownVersion = lastMobileCardVMVersion()
    return fetchAuthedJSON("/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: knownVersion || undefined,
        layout: "mobile-dossier-v1",
        symbols: symbols,
      }),
      signal: options && options.signal,
    }).then(function (manifest) {
      if (!manifest || manifest.schema !== "iconoplasm.mobileCardManifest.v1") {
        throw new Error("Mobile card manifest schema mismatch")
      }
      rememberMobileCardVMVersion(manifest.snapshot_version)
      var bySymbol = Object.create(null)
      var cards = Array.isArray(manifest.cards) ? manifest.cards : []
      for (var i = 0; i < cards.length; i++) {
        var vm = assertCompleteMobileCardVM(cards[i])
        bySymbol[normalizedSymbol(vm.symbol)] = vm
      }
      void mobileCardCacheSetMany(manifest.snapshot_version, cards)
      var ordered = []
      var failures = Array.isArray(manifest.missing)
        ? manifest.missing.map(function (symbol) {
            return { symbol: normalizedSymbol(symbol), reason: "snapshot_missing" }
          })
        : []
      for (var j = 0; j < symbols.length; j++) {
        var card = bySymbol[symbols[j]]
        if (card) ordered.push(mobileCardPayloadFromVM(card))
        else failures.push({ symbol: symbols[j], reason: "manifest_missing" })
      }
      return {
        cards: ordered,
        failures: failures,
        snapshotVersion: String(manifest.snapshot_version || ""),
      }
    })
  }

  function prewarmMobileCardPageVM(pageEntries) {
    if (!Array.isArray(pageEntries) || !pageEntries.length) return
    void loadMobileCardPageVM(pageEntries).catch(function (error) {
      console.warn(
        "[Iconoplasm] mobile card prewarm failed:",
        String((error && error.message) || error || "unknown"),
      )
    })
  }

  function buildMobileDataFailureMarkup(failures) {
    var items = Array.isArray(failures) ? failures : []
    var html = ""
    for (var i = 0; i < items.length; i++) {
      var symbol = normalizedSymbol(items[i] && items[i].symbol)
      if (!symbol) continue
      var reason = String((items[i] && items[i].reason) || "snapshot_missing").trim()
      html +=
        '<article class="icono-mobile-data-failure-card" data-icono-mobile-data-failure="' +
        esc(symbol) +
        '">' +
        '<div class="icono-mobile-data-failure-kicker">dossier unavailable</div>' +
        '<div class="icono-mobile-data-failure-symbol">' +
        esc(symbol) +
        "</div>" +
        '<div class="icono-mobile-data-failure-copy">Snapshot data failed to resolve. Reason: ' +
        esc(reason || "snapshot_missing") +
        ".</div>" +
        "</article>"
    }
    return html
  }

  function appendMobileDataFailureTiles(container, failures) {
    if (!container) return []
    var html = buildMobileDataFailureMarkup(failures)
    if (!html) return []
    var wrapper = document.createElement("div")
    wrapper.innerHTML = html
    var newElements = Array.prototype.slice.call(wrapper.children)
    for (var i = 0; i < newElements.length; i++) {
      container.appendChild(newElements[i])
    }
    return newElements
  }

  function buildCollectionSummaryMarkup(collectionState) {
    var discoveredCount =
      Math.max(0, Number(collectionState && collectionState.discoveredCount) || 0) ||
      Number(collectionState && collectionState.discoveryEntries.length) ||
      0
    var totalCount = ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT
    var progressPct =
      totalCount > 0 ? Math.max(0, Math.min(100, (discoveredCount / totalCount) * 100)) : 0
    var progressWidth = progressPct
    var totalCopy = totalCount.toLocaleString()
    var sharedChecked = !!(collectionState && collectionState.sharedDiscoveries)
    var sharedDisabled = false
    var guestStorageCopy =
      collectionState && !collectionState.authenticated
        ? " · dossier visits stay in this browser until you sign in"
        : ""
    return (
      '<section class="icono-collection-summary icono-collection-summary--single" aria-label="Collection progress">' +
      '<article class="icono-collection-card icono-collection-card--archive">' +
      '<div class="icono-collection-summary-row">' +
      '<div class="icono-collection-copy">' +
      esc(discoveredCount.toLocaleString()) +
      " genes found out of " +
      esc(totalCopy) +
      esc(guestStorageCopy) +
      "</div>" +
      '<label class="icono-collection-shared-toggle">' +
      '<input type="checkbox" data-icono-shared-discoveries-toggle' +
      (sharedChecked ? " checked" : "") +
      (sharedDisabled ? " disabled" : "") +
      "> " +
      "<span>show discoveries made by others</span>" +
      "</label>" +
      "</div>" +
      '<div class="icono-collection-progress-inline">' +
      '<div class="icono-collection-progress-track" aria-hidden="true">' +
      '<span class="icono-collection-progress-fill" style="width:' +
      esc(progressWidth.toFixed(1)) +
      '%"></span>' +
      "</div>" +
      "</div>" +
      "</article>" +
      "</section>"
    )
  }

  function buildCollectionEmptyMarkup(collectionState) {
    var isAuthenticated = !!(currentUser || (collectionState && collectionState.authenticated))
    var title = isAuthenticated ? "No genes discovered yet" : "Your browser shelf is empty"
    var body = isAuthenticated
      ? "Hover a gene in the extension for about a second, then come back here. Your shelf will fill itself in."
      : "Open a gene dossier and it will stay in this browser until you sign in."
    var support = isAuthenticated
      ? "You can still search any symbol above while the first discoveries come in."
      : "Sign in when you want to carry those discoveries across browsers and devices."
    var actions =
      '<div class="icono-empty-actions">' +
      (isAuthenticated
        ? '<a class="icono-home-auth-link icono-empty-link" href="' +
          esc(COMMUNITY_URL) +
          '" target="_blank" rel="noopener noreferrer">Join Discord</a>'
        : '<a class="icono-home-auth-link icono-empty-link" href="' +
          esc(voteLoginUrl()) +
          '">Log in with Discord</a>') +
      '<a class="icono-empty-link icono-empty-link--subtle" href="https://brinedew.bio/wiki/iconoplasm-faq">Read FAQ</a>' +
      "</div>"
    return (
      '<section class="icono-empty icono-empty--collection">' +
      '<div class="icono-empty-kicker">collection pending</div>' +
      "<h2>" +
      esc(title) +
      "</h2>" +
      "<p>" +
      esc(body) +
      "</p>" +
      '<p class="icono-empty-support">' +
      esc(support) +
      "</p>" +
      actions +
      "</section>"
    )
  }

  function buildCollectionSummarySkeletonMarkup(collectionState) {
    var sharedChecked = !!(collectionState && collectionState.sharedDiscoveries)
    return (
      '<section class="icono-collection-summary icono-collection-summary--single icono-collection-summary--skeleton" aria-label="Collection progress loading">' +
      '<article class="icono-collection-card icono-collection-card--archive icono-collection-card--skeleton">' +
      '<div class="icono-collection-summary-row">' +
      '<div class="icono-collection-copy">Loading collection...</div>' +
      '<label class="icono-collection-shared-toggle">' +
      '<input type="checkbox" data-icono-shared-discoveries-toggle' +
      (sharedChecked ? " checked" : "") +
      "> " +
      "<span>show discoveries made by others</span>" +
      "</label>" +
      "</div>" +
      "</article>" +
      "</section>"
    )
  }

  function buildBrickSkeletonCardMarkup() {
    return (
      '<article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">' +
      '<div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--skeleton">' +
      '<div class="icono-card-skeleton-portrait-wash"></div>' +
      '<div class="iconoplasm-tooltip-portrait-fade"></div>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-body iconoplasm-tooltip-body--skeleton">' +
      '<div class="iconoplasm-tooltip-header iconoplasm-tooltip-header--skeleton">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--symbol"></span>' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--name"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">' +
      renderTooltipMetaSkeletonHtml() +
      "</div>" +
      "</div>" +
      "</article>"
    )
  }

  function buildMasonrySkeletonCardMarkup(index) {
    var aspectRatio = index % 3 === 0 ? "4 / 5" : index % 3 === 1 ? "1 / 1" : "3 / 4"
    return (
      '<article class="icono-card icono-card--masonry icono-card--skeleton" aria-hidden="true" style="--icono-skeleton-aspect:' +
      aspectRatio +
      ';">' +
      '<div class="icono-card-media icono-card-skeleton-media"></div>' +
      '<div class="icono-card-info icono-card-skeleton-body">' +
      '<span class="icono-card-skeleton-line icono-card-skeleton-line--short"></span>' +
      '<span class="icono-card-skeleton-line icono-card-skeleton-line--medium"></span>' +
      "</div>" +
      "</article>"
    )
  }

  function buildReverseCardFaceMarkup() {
    return IconoCardShared.renderCardReverseFaceHtml()
  }

  function buildImageOnlySkeletonCardMarkup(index) {
    return (
      '<article class="icono-card icono-card--image-tile icono-card--variant-image-only icono-card--skeleton icono-card--reverse-skeleton" data-icono-index="' +
      index +
      '" style="--width:384;--height:512;">' +
      '<div class="icono-image-only-link icono-image-only-placeholder" aria-hidden="true">' +
      '<div class="icono-image-only-media-stage">' +
      buildReverseCardFaceMarkup() +
      "</div>" +
      "</div>" +
      "</article>"
    )
  }

  function buildHomeSkeletonGridMarkup(layout, cardVariant) {
    var resolvedLayout = effectiveHomeGridLayout(layout, cardVariant)
    var html = ""
    if (resolvedLayout === "masonry" || resolvedLayout === "image-only-masonry") {
      html += '<div class="icono-grid-sizer"></div><div class="icono-gutter-sizer"></div>'
    }
    for (var i = 0; i < HOME_SKELETON_CARD_COUNT; i++) {
      html +=
        resolvedLayout === "image-only-masonry"
          ? buildImageOnlySkeletonCardMarkup(i)
          : resolvedLayout === "masonry"
            ? buildMasonrySkeletonCardMarkup(i)
            : buildBrickSkeletonCardMarkup()
    }
    return html
  }

  function buildGuestReverseCardMarkup(cardIndex) {
    return (
      '<article class="icono-card icono-card--guest-reverse" aria-hidden="true" data-icono-guest-reverse-card="' +
      cardIndex +
      '">' +
      buildReverseCardFaceMarkup() +
      "</article>"
    )
  }

  function buildGuestContinuationMarkup() {
    var html = ""
    for (var i = 0; i < GUEST_CONTINUATION_CARD_COUNT; i++) {
      html += buildGuestReverseCardMarkup(i)
    }
    return (
      '<div class="icono-guest-continuation" id="icono-guest-continuation" hidden aria-hidden="true">' +
      '<div class="icono-guest-continuation-grid">' +
      html +
      "</div></div>"
    )
  }

  function buildHomeShellMarkup(layout, cardVariant) {
    var resolvedLayout = effectiveHomeGridLayout(layout, cardVariant)
    // Single source of truth: content/apps/iconoplasm/index.md intentionally ships an empty
    // mount root now. Keep the entire home shell here so the page cannot drift into a second
    // markdown-owned fallback renderer with stale dropdowns, copy, or skeleton markup.
    return (
      '<header class="icono-page-header">' +
      '<div class="icono-hero">' +
      '<div class="icono-hero-title">ICONOPLASM</div>' +
      '<p class="tagline">Gene character cards - <a class="internal" href="https://brinedew.bio/wiki/iconoplasm-faq">read FAQ</a></p>' +
      '<p class="stat" id="icono-public-inventory-stat" hidden aria-live="polite"></p>' +
      "</div>" +
      "</header>" +
      '<main class="icono-page-main" id="icono-main">' +
      '<div class="icono-gallery-toolbar">' +
      '<div class="icono-search icono-search--toolbar">' +
      '<div class="icono-search-wrapper">' +
      '<input type="text" id="icono-q" class="icono-search-input" placeholder="Search by gene symbol or name..." autocomplete="off" role="combobox" aria-label="Search genes" aria-autocomplete="list" aria-controls="icono-results" aria-expanded="false" />' +
      '<div class="icono-search-results" id="icono-results" role="listbox" aria-label="Gene search results"></div>' +
      "</div>" +
      "</div>" +
      '<div class="icono-gallery-actions">' +
      '<label class="icono-gallery-order" for="icono-order">' +
      '<span id="icono-order-label">Sort</span>' +
      '<select id="icono-order">' +
      homeCollectionOptionsMarkup() +
      "</select>" +
      "</label>" +
      '<div class="icono-gallery-install" id="icono-gallery-install"></div>' +
      "</div>" +
      "</div>" +
      '<div class="icono-collection-shell" id="icono-collection-shell">' +
      '<div class="icono-collection-summary-host" id="icono-collection-summary" hidden></div>' +
      '<div class="icono-empty" id="icono-empty" hidden></div>' +
      "</div>" +
      '<a class="icono-feed-skip" href="#icono-feed-after">Skip past gene collection</a>' +
      '<div class="icono-feed" id="icono-grid" aria-busy="true" role="feed" aria-label="Gene collection" tabindex="0">' +
      '<section class="icono-feed-segment" role="presentation"><div class="icono-grid" data-layout="' +
      esc(resolvedLayout) +
      '">' +
      buildHomeSkeletonGridMarkup(layout, cardVariant) +
      "</div></section></div>" +
      '<div class="icono-post-feed-stage" id="icono-post-feed-stage">' +
      buildGuestContinuationMarkup() +
      '<div class="icono-home-auxiliary" id="icono-home-auxiliary" hidden></div>' +
      "</div>" +
      '<div class="icono-feed-state"><span id="icono-feed-status" role="status" aria-live="polite"></span>' +
      '<button type="button" id="icono-feed-retry" hidden>Retry</button></div>' +
      '<span id="icono-feed-after" tabindex="-1"></span>' +
      '<a class="icono-feed-skip" href="#icono-grid">Back to gene collection</a>' +
      "</main>"
    )
  }

  function isLightColor(hex) {
    if (!hex || hex.length < 7) return false
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    return r * 0.299 + g * 0.587 + b * 0.114 > 160
  }

  function textColorFor(hex) {
    return isLightColor(hex) ? "rgba(0,0,0,0.7)" : "#fff"
  }

  function uniqueDisplayValues(values, limit) {
    return IconoCardShared.uniqueDisplayValues(values, limit)
  }

  var missingTooltipOriginWarnings = Object.create(null)

  function resolveHomeLayout() {
    var settings = readIconoplasmSettings()
    return (
      String((settings && settings.homeLayout) || HOME_LAYOUT_DEFAULT).trim() || HOME_LAYOUT_DEFAULT
    )
  }

  function normalizeRenderableCardVariant(cardVariant) {
    return IconoCardShared.normalizeCardVariant(cardVariant || CARD_VARIANT_DEFAULT)
  }

  function resolveCardVariant() {
    var settings = readIconoplasmSettings()
    if (isMobileLabelReviewEnabled()) {
      // Mobile has one supported physical review surface: the lit-archival dossier.
      // Desktop preferences like "image-only" are intentionally ignored here so a
      // synced desktop masonry setting cannot downgrade the mobile card contract.
      return "lit-archival"
    }
    return normalizeRenderableCardVariant(
      (settings && settings.cardVariant) || CARD_VARIANT_DEFAULT,
    )
  }

  function effectiveHomeGridLayout(layout, cardVariant) {
    var resolvedCardVariant = cardVariant || resolveCardVariant()
    if (isImageOnlyCardVariant(resolvedCardVariant)) return "image-only-masonry"
    return layout === "masonry" ? "masonry" : HOME_LAYOUT_DEFAULT
  }

  function shouldUseHomeMasonry(layout, cardVariant) {
    return effectiveHomeGridLayout(layout, cardVariant) === "masonry"
  }

  function shouldUseImmediateDiscoveryFallback(layout, cardVariant) {
    return layout === "masonry" && !isImageOnlyCardVariant(cardVariant)
  }

  function isArchivalCardVariant(cardVariant) {
    return cardVariant === "lit-archival" || cardVariant === "neo-drab"
  }

  function isImageOnlyCardVariant(cardVariant) {
    return cardVariant === "image-only"
  }

  function isLitCardVariant(cardVariant) {
    return isArchivalCardVariant(cardVariant) || isImageOnlyCardVariant(cardVariant)
  }

  function litLayoutVariantForCard(cardVariant) {
    if (isImageOnlyCardVariant(cardVariant)) return "image-only"
    if (cardVariant === "neo-drab") return "neo-drab"
    return "lit-archival"
  }

  function archivalVariantClass(cardVariant) {
    if (cardVariant === "neo-drab") {
      return " icono-card--variant-lab-label icono-card--variant-lit-archival icono-card--variant-neo-drab"
    }
    if (cardVariant === "lit-archival") {
      return " icono-card--variant-lab-label icono-card--variant-lit-archival"
    }
    if (cardVariant === "image-only") return " icono-card--variant-image-only"
    return ""
  }

  function buildArchivalBodyMarkup(genePayload, options) {
    return IconoCardShared.renderLabLabelCardHtml(genePayload, options || {})
  }

  function markImageOnlyPhotoLoaded(img) {
    if (!img || !img.classList) return
    img.classList.add("icono-image-only-photo--loaded")
    if (img.parentElement && img.parentElement.classList) {
      img.parentElement.classList.add("icono-image-only-media-stage--loaded")
    }
    var link = img.closest ? img.closest(".icono-image-only-link") : null
    if (link && link.classList) link.classList.add("icono-image-only-link--loaded")
  }

  function syncImageOnlyLoadState(scope) {
    var root = scope || document
    var images = root.querySelectorAll ? root.querySelectorAll(".icono-image-only-photo") : []
    for (var i = 0; i < images.length; i++) {
      var img = images[i]
      if (img.complete && img.naturalWidth > 0) {
        markImageOnlyPhotoLoaded(img)
        continue
      }
      if (img.getAttribute("data-icono-image-only-load-wired") === "true") continue
      img.setAttribute("data-icono-image-only-load-wired", "true")
      img.addEventListener("load", function (event) {
        markImageOnlyPhotoLoaded(event.currentTarget)
      })
    }
  }

  function mobileArchivalObjectMarkup(portraitHtml, infoHtml) {
    return (
      '<div class="icono-mobile-card-physical-object" data-icono-mobile-physical-object>' +
      portraitHtml +
      infoHtml +
      "</div>"
    )
  }

  function iconoRowMarkup(label, value) {
    return (
      '<div class="brd-sidebar-row">' +
      '<span class="brd-sidebar-row-label">' +
      esc(label) +
      "</span>" +
      '<span class="brd-sidebar-row-value">' +
      esc(value) +
      "</span>" +
      "</div>"
    )
  }

  function iconoSidebarPanelMarkup() {
    var page = String((iconoSidebarState && iconoSidebarState.page) || "home")
    if (page === "home") return ""
    if (page === "gene") {
      return requestInbox.caretakerPanelMarkup()
    }
    if (page === "404") {
      return (
        '<div class="brd-sidebar-section"><div class="brd-sidebar-panel-title">Iconoplasm</div>' +
        '<div class="brd-sidebar-rowlist">' +
        iconoRowMarkup("Page", "Not found") +
        "</div></div>"
      )
    }
    return ""
  }

  function renderIconoplasmSidebar() {
    var iconoSidebarMarkup = iconoSidebarPanelMarkup()
    var panels = [
      {
        id: "brd-shared-user-panel",
        className: "brd-sidebar-panel--user",
        markup: buildSharedUserPanelMarkup({
          user: currentUser,
          loginLabel: "Discord Login",
        }),
      },
    ]
    if (iconoSidebarMarkup) {
      panels.push({
        id: "icono-sidebar-panel",
        className: "brd-sidebar-panel--iconoplasm",
        markup: iconoSidebarMarkup,
      })
    }
    var requestInboxMarkup = requestInbox.panelMarkup()
    if (requestInboxMarkup) {
      panels.push({
        id: "icono-request-inbox-panel",
        className: "brd-sidebar-panel--request-inbox",
        markup: requestInboxMarkup,
        preserveScrollSelector: ".icono-request-inbox__group-body",
      })
    }
    var stack = mountSidebarStack({
      stackId: "brd-sidebar-stack",
      preserveExisting: true,
      panels: panels,
    })
    wireSharedUserPanel(stack, {
      onAuthRetry: refreshSharedUserState,
      onAuthChanged: function (user) {
        void updateSharedUserState(user)
      },
    })
    requestInbox.wire(stack)
    var caretakerOpen = stack && stack.querySelector("[data-icono-caretaker-open]")
    if (caretakerOpen) {
      caretakerOpen.addEventListener("click", function () {
        var host = document.querySelector("[data-icono-caretaker-island]")
        if (!host) return
        void loadCaretakerPanel().then(function (panel) {
          panel.open(host)
        })
      })
    }
    renderHomeInstallCta()
  }

  function rerenderCurrentGeneRoute(options) {
    var opts = options || {}
    var route = getRoute()
    if (route.page !== "gene") return
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    if (opts.forceFresh) invalidateGeneDetail(route.symbol)
    destroyHomeMasonry()
    renderGene(root, route.symbol, opts)
    refreshPortraitLightbox()
  }

  function refreshCurrentGeneInteractiveIslands() {
    var route = getRoute()
    if (route.page !== "gene") return
    var content = document.getElementById("icono-gene-content")
    if (!content) return
    var bootstrap = window.__iconoplasmBootstrap || null
    var genePayload =
      content._iconoGenePayload ||
      portraitDetailCache[normalizedSymbol(route.symbol)] ||
      (bootstrap && bootstrap.geneDetailData) ||
      null
    if (!isCompleteGeneDetailPayload(genePayload, route.symbol)) return
    wireGeneContent(content, genePayload)
  }

  function updateSharedUserState(user) {
    var previousHadUser = !!currentUser
    var previousUserId = String((currentUser && (currentUser.id || currentUser.user_id)) || "")
    var previousAdmin = !!currentUserIsIconoAdmin
    currentUser = user || null
    currentUserIsIconoAdmin = !!(currentUser && currentUser.is_admin)
    var currentUserId = String((currentUser && (currentUser.id || currentUser.user_id)) || "")
    hasResolvedAuthState = true
    if (previousHadUser !== !!currentUser) {
      invalidateImageEditProviders()
    }
    if (currentUser) {
      requestInbox.start()
      if (previousUserId !== currentUserId) emulsionFavorites.reset()
      emulsionFavorites
        .load()
        .then(function () {
          syncEmulsionFavoriteButtons(document)
        })
        .catch(function () {
          announceEmulsionFavoriteStatus("Favorites could not be loaded.")
        })
    } else {
      requestInbox.stop()
      requestInbox.reset()
      emulsionFavorites.reset()
    }
    renderIconoplasmSidebar()
    if (getRoute().page === "home") {
      render()
    }
    if (
      getRoute().page === "gene" &&
      (previousHadUser !== !!currentUser || previousAdmin !== currentUserIsIconoAdmin)
    ) {
      refreshCurrentGeneInteractiveIslands()
    }
    return mergeWebsiteGuestDiscoveriesIfSignedIn().then(function (merged) {
      if (merged && currentUser && getRoute().page === "home") render()
      return currentUser
    })
  }

  function refreshSharedUserState() {
    var bootstrap = window.__iconoplasmBootstrap || null
    var payloadPromise = bootstrap && !bootstrap.authUsed ? bootstrap.authPromise : null
    if (payloadPromise) bootstrap.authUsed = true
    return fetchAuthenticatedUser({ authBase: API, payloadPromise: payloadPromise })
      .then(updateSharedUserState)
      .catch(function () {
        // An unavailable authority is not a logout. Keep the current identity;
        // protected actions still require server authorization.
        renderIconoplasmSidebar()
        return currentUser
      })
  }

  function voteLoginUrl() {
    return buildLoginUrl({
      authBase: API,
    })
  }

  function detectInstallBrowser() {
    var ua = String((window.navigator && window.navigator.userAgent) || "").toLowerCase()
    var isMobile = /android|iphone|ipad|ipod|mobile/.test(ua)
    var platform =
      ua.indexOf("android") !== -1 ? "android" : /iphone|ipad|ipod/.test(ua) ? "ios" : "desktop"
    var hasBraveMarker = !!(window.navigator && window.navigator.brave)
    if (ua.indexOf("firefox") !== -1) {
      return {
        family: "firefox",
        label: isMobile ? "Firefox mobile" : "Firefox",
        managerUrl: "about:addons",
        isMobile: isMobile,
        platform: platform,
      }
    }
    if (ua.indexOf("edg/") !== -1) {
      return {
        family: "edge",
        label: isMobile ? "Edge mobile" : "Edge",
        managerUrl: "edge://extensions",
        isMobile: isMobile,
        platform: platform,
      }
    }
    if (
      hasBraveMarker ||
      ua.indexOf("chrome") !== -1 ||
      ua.indexOf("chromium") !== -1 ||
      ua.indexOf("brave") !== -1 ||
      ua.indexOf("opr/") !== -1 ||
      ua.indexOf("opera") !== -1
    ) {
      if (hasBraveMarker || ua.indexOf("brave") !== -1) {
        return {
          family: "brave",
          label: isMobile ? "Brave mobile" : "Brave",
          managerUrl: "brave://extensions",
          isMobile: isMobile,
          platform: platform,
        }
      }
      return {
        family: "chromium",
        label: isMobile ? "Chromium mobile" : "Chrome",
        managerUrl: "chrome://extensions",
        isMobile: isMobile,
        platform: platform,
      }
    }
    if (ua.indexOf("safari") !== -1) {
      return {
        family: "safari",
        label: isMobile ? "Safari mobile" : "Safari",
        managerUrl: "",
        isMobile: isMobile,
        platform: platform,
      }
    }
    return {
      family: "unknown",
      label: isMobile ? "this mobile browser" : "this browser",
      managerUrl: "",
      isMobile: isMobile,
      platform: platform,
    }
  }

  function syncInstallStateFromDomMarker() {
    var root = document.documentElement
    if (!root) return
    if (String(root.getAttribute("data-iconoplasm-extension-installed") || "") !== "true") return
    iconoInstallState.installed = true
    iconoInstallState.version = String(
      root.getAttribute("data-iconoplasm-extension-version") || "",
    ).trim()
  }

  function handleIconoplasmExtensionPresence(event) {
    var detail = (event && event.detail) || {}
    iconoInstallState.installed = true
    iconoInstallState.version = String(detail.version || iconoInstallState.version || "").trim()
    syncInstallStateFromDomMarker()
    renderHomeInstallCta()
  }

  function probeForIconoplasmExtensionPresence() {
    syncInstallStateFromDomMarker()
    if (iconoInstallState.installed) {
      renderHomeInstallCta()
      return
    }
    window.dispatchEvent(new CustomEvent(ICONO_EXTENSION_PRESENCE_PING_EVENT))
    window.setTimeout(function () {
      syncInstallStateFromDomMarker()
      renderHomeInstallCta()
    }, 120)
  }

  function loadInstallReleaseMetadata() {
    if (iconoInstallState.releaseLoaded) return
    iconoInstallState.releaseLoaded = true
    fetch(ICONO_EXTENSION_RELEASE_METADATA_URL, {
      cache: "no-store",
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status)
        return response.json()
      })
      .then(function (metadata) {
        if (!metadata || typeof metadata !== "object") return
        var chromeDeveloperPackageUrl = String(metadata.chromeDeveloperPackageUrl || "").trim()
        var firefoxListingUrl = String(metadata.firefoxListingUrl || "").trim()
        var edgeListingUrl = String(metadata.edgeListingUrl || "").trim()
        iconoInstallState.release = {
          version: String(metadata.version || iconoInstallState.release.version || "").trim(),
          chromeDeveloperPackageUrl:
            chromeDeveloperPackageUrl || iconoInstallState.release.chromeDeveloperPackageUrl,
          firefoxListingUrl: firefoxListingUrl || iconoInstallState.release.firefoxListingUrl,
          edgeListingUrl: edgeListingUrl || iconoInstallState.release.edgeListingUrl,
          edgeListingStatus: String(metadata.edgeListingStatus || "live").trim() || "live",
        }
        renderHomeInstallCta()
      })
      .catch(function () {
        // The inline fallback above keeps install instructions usable if the static
        // metadata file misses a deploy or is cached badly.
      })
  }

  function resolveInstallTab(browser) {
    var requested = String(iconoInstallState.installTab || "")
      .trim()
      .toLowerCase()
    if (
      requested === "chrome" ||
      requested === "brave" ||
      requested === "edge" ||
      requested === "firefox"
    )
      return requested
    if (browser && browser.family === "brave") return "brave"
    if (browser && browser.family === "edge") return "edge"
    return browser && browser.family === "firefox" ? "firefox" : "chrome"
  }

  function buildMobileInstallExperience(browser, faqUrl) {
    var family = String((browser && browser.family) || "unknown")
    var platform = String((browser && browser.platform) || "mobile")
    var title = "Install Iconoplasm on mobile"
    var note =
      "Mobile add-ons are not published yet. Use desktop Firefox or Edge for one-click install today."
    var steps = [
      "Iconoplasm is available on desktop Firefox and Edge today.",
      "Mobile browser installs are not supported yet.",
      "Use a desktop browser for the current extension.",
    ]
    if (family === "firefox" && platform === "android") {
      title = "Install Iconoplasm on Firefox Android"
      note =
        "Firefox Android is the right first mobile target, but this add-on is not published there yet."
      steps = [
        "We need to mark and test the AMO listing for Android compatibility.",
        "Once it passes review, this card should link directly to the Android-ready Firefox Add-ons page.",
        "For now, use desktop Firefox or Edge for one-click install.",
      ]
    } else if (family === "edge" && platform === "android") {
      title = "Install Iconoplasm on Edge Android"
      note =
        "Edge Android has mobile extension support, but Iconoplasm is not verified or published there yet."
      steps = [
        "Confirm the public Edge Add-ons listing supports Android installs.",
        "Run a real Android Edge install test before showing a live install button here.",
        "For now, use desktop Edge for one-click install.",
      ]
    } else if (family === "safari" && platform === "ios") {
      title = "Iconoplasm is not available for iPhone or iPad"
      note =
        "There is no Safari install path today, manual or automatic. Use desktop Firefox or Edge."
      steps = [
        "Open this page on desktop Firefox or Edge.",
        "Install from the browser add-on store there.",
        "Safari support would require a separate App Store package later.",
      ]
    }
    return {
      tone: "mobile",
      toggleLabel: "Install",
      toggleMeta: "Mobile",
      title: title,
      note: note,
      cardTitle: title,
      mobile: true,
      steps: steps,
      actions: [
        {
          href: faqUrl,
          label: "Read FAQ",
          subtle: true,
        },
      ],
    }
  }

  function chromeDeveloperPackageName(url) {
    var value = String(url || "").trim()
    var path = value.split("?")[0].split("#")[0]
    var lastSegment = path.slice(path.lastIndexOf("/") + 1)
    return (
      lastSegment ||
      "iconoplasm-extension-v" + String(iconoInstallState.release.version || "0.4.3") + ".zip"
    )
  }

  function buildInstallBrowserPanels(browser, faqUrl) {
    var release = iconoInstallState.release || {}
    var chromePackageUrl =
      String(release.chromeDeveloperPackageUrl || "").trim() ||
      "/static/iconoplasm/downloads/iconoplasm-extension-v" +
        String(release.version || "0.4.3").trim() +
        ".zip"
    var chromePackageName = chromeDeveloperPackageName(chromePackageUrl)
    var chromePackageBaseName = chromePackageName.replace(/\.zip$/i, "")
    var firefoxListingUrl =
      String(release.firefoxListingUrl || "").trim() || ICONO_EXTENSION_FIREFOX_LISTING_URL
    var edgeListingUrl =
      String(release.edgeListingUrl || "").trim() || ICONO_EXTENSION_EDGE_LISTING_URL
    return {
      chrome: {
        id: "chrome",
        label: "Chrome",
        tone: "manual",
        title: "Chrome",
        note: "Manual installation for the moment. For one-click install, visit this page on Edge or Firefox browsers.",
        managerUrl: "chrome://extensions",
        steps: [
          {
            text: "Tap the button above to download the extension zip. Your browser will save it to your Downloads folder:",
            action: {
              href: chromePackageUrl,
              label: "Download extension file",
              subtle: false,
            },
          },
          'In your Downloads folder, extract "' + chromePackageName + '".',
          "In Chrome, click the address bar, type chrome://extensions, and press Enter.",
          'In the top-right corner of chrome://extensions, click the "Developer mode" switch so it is on.',
          'Click the "Load unpacked" button.',
          'In the folder picker, select the extracted "' +
            chromePackageBaseName +
            '" folder, then click "Select Folder".',
        ],
        actions: [
          {
            href: faqUrl,
            label: "FAQ",
            subtle: true,
          },
        ],
      },
      edge: {
        id: "edge",
        label: "Edge",
        tone: "store",
        title: "Edge",
        note: "",
        managerUrl: "edge://extensions",
        steps: [
          {
            text: "Click this button to visit the Edge Add-ons page:",
            action: {
              href: edgeListingUrl,
              label: "Get extension for Edge",
              subtle: false,
            },
          },
          'On the Microsoft Edge Add-ons page, click the "Get" button.',
          'In the Edge confirmation dialog, click "Add extension".',
        ],
        actions: [
          {
            href: faqUrl,
            label: "FAQ",
            subtle: true,
          },
        ],
      },
      brave: {
        id: "brave",
        label: "Brave",
        tone: "manual",
        title: "Brave",
        note: "Manual installation for the moment. For one-click install, visit this page on Edge or Firefox browsers.",
        managerUrl: "brave://extensions",
        steps: [
          {
            text: "Tap the button above to download the extension zip. Your browser will save it to your Downloads folder:",
            action: {
              href: chromePackageUrl,
              label: "Download extension file",
              subtle: false,
            },
          },
          'In your Downloads folder, extract "' + chromePackageName + '".',
          "In Brave, click the address bar, type brave://extensions, and press Enter.",
          'In the top-right corner of brave://extensions, click the "Developer mode" switch so it is on.',
          'Click the "Load unpacked" button.',
          'In the folder picker, select the extracted "' +
            chromePackageBaseName +
            '" folder, then click "Select Folder".',
        ],
        actions: [
          {
            href: faqUrl,
            label: "FAQ",
            subtle: true,
          },
        ],
      },
      firefox: {
        id: "firefox",
        label: "Firefox",
        tone: "store",
        title: "Firefox",
        note: "",
        managerUrl: "",
        steps: [
          {
            text: "Click this button to visit the Firefox Add-ons page:",
            action: {
              href: firefoxListingUrl,
              label: "Get extension for Firefox",
              subtle: false,
            },
          },
          'On the Firefox Add-ons page, click the "Add to Firefox" button.',
          'In the Firefox confirmation dialog, click "Add".',
        ],
        actions: [
          {
            href: faqUrl,
            label: "FAQ",
            subtle: true,
          },
        ],
      },
    }
  }

  function currentInstallExperience() {
    syncInstallStateFromDomMarker()
    var browser = detectInstallBrowser()
    var faqUrl = "https://brinedew.bio/wiki/iconoplasm-faq"
    var guestLoginActions = currentUser
      ? []
      : [
          {
            href: voteLoginUrl(),
            label: "Log in with Discord",
          },
        ]
    if (iconoInstallState.installed) {
      return {
        tone: "installed",
        toggleLabel: "Installed",
        toggleMeta: iconoInstallState.version ? "v" + iconoInstallState.version : "Ready",
        title: "Want more cards? Hover over gene names on other websites.",
        note: "When you are logged in, your Iconoplasm add-on will record discoveries in the archive above.",
        steps: [],
        actions: guestLoginActions,
      }
    }
    if (browser && browser.isMobile) {
      return buildMobileInstallExperience(browser, faqUrl)
    }
    var panels = buildInstallBrowserPanels(browser, faqUrl)
    var activeTab = resolveInstallTab(browser)
    var activePanel = panels[activeTab] || panels.chrome
    return {
      tone: activePanel.tone || "manual",
      toggleLabel: "Install",
      toggleMeta: activePanel.label || "Chrome",
      activeTab: activeTab,
      tabs: [
        {
          id: "chrome",
          label: "Chrome",
          selected: activeTab === "chrome",
        },
        {
          id: "brave",
          label: "Brave",
          selected: activeTab === "brave",
        },
        {
          id: "edge",
          label: "Edge",
          selected: activeTab === "edge",
        },
        {
          id: "firefox",
          label: "Firefox",
          selected: activeTab === "firefox",
        },
      ],
      title: activePanel.title,
      cardTitle: "Install Iconoplasm for " + activePanel.label,
      note: activePanel.note,
      managerUrl: activePanel.managerUrl,
      steps: activePanel.steps,
      actions: (activePanel.actions || []).concat(guestLoginActions),
    }
  }

  function buildInstallToggleMarkup(model) {
    var meta = String(model.toggleMeta || "").trim()
    return (
      '<button type="button" class="icono-install-toggle icono-install-toggle--' +
      esc(model.tone || "info") +
      '" data-icono-install-toggle aria-expanded="' +
      (iconoInstallState.panelOpen ? "true" : "false") +
      '" aria-controls="icono-install-panel">' +
      '<span class="icono-install-toggle-label">' +
      esc(model.toggleLabel) +
      "</span>" +
      (meta ? '<span class="icono-install-toggle-meta">' + esc(meta) + "</span>" : "") +
      '<span class="icono-install-toggle-caret" aria-hidden="true">' +
      (iconoInstallState.panelOpen ? "▴" : "▾") +
      "</span>" +
      "</button>"
    )
  }

  function buildInstallTabsMarkup(model) {
    var tabs = Array.isArray(model.tabs) ? model.tabs : []
    if (!tabs.length) return ""
    var html =
      '<div class="icono-install-tablist" role="tablist" aria-label="Browser install instructions">'
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i]
      if (!tab || !tab.id) continue
      var tabId = String(tab.id || "").trim()
      html +=
        '<button type="button" class="icono-install-tab" id="icono-install-tab-' +
        esc(tabId) +
        '" role="tab" aria-selected="' +
        (tab.selected ? "true" : "false") +
        '" tabindex="' +
        (tab.selected ? "0" : "-1") +
        '" aria-controls="icono-install-tabpanel-' +
        esc(tabId) +
        '" data-icono-install-tab="' +
        esc(tabId) +
        '">' +
        esc(tab.label || tabId) +
        "</button>"
    }
    return html + "</div>"
  }

  function buildInstallPanelMarkup(model) {
    var steps = Array.isArray(model.steps) ? model.steps : []
    var actions = Array.isArray(model.actions) ? model.actions : []
    var managerUrl = String(model.managerUrl || "").trim()
    var activeTab = String(model.activeTab || "").trim()
    var primaryAction = null
    var firstStep = steps[0]
    if (firstStep && typeof firstStep === "object" && firstStep.action) {
      primaryAction = firstStep.action
      steps = steps.slice(1)
    }
    function buildInstallActionMarkup(action) {
      if (!action || !action.href) return ""
      return (
        '<a class="' +
        (action.subtle
          ? "icono-toolbar-link icono-install-link icono-install-link--subtle"
          : "icono-home-auth-link icono-guest-login-card-button icono-install-link") +
        '" href="' +
        esc(action.href) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(action.label || "Open") +
        "</a>"
      )
    }
    var stepsHtml = ""
    for (var i = 0; i < steps.length; i++) {
      var rawStep = steps[i]
      var step = String(
        rawStep && typeof rawStep === "object" ? rawStep.text || "" : rawStep || "",
      ).trim()
      if (!step) continue
      var stepActionHtml =
        rawStep && typeof rawStep === "object" ? buildInstallActionMarkup(rawStep.action) : ""
      if (managerUrl && step.indexOf(managerUrl) !== -1) {
        var escapedUrl = esc(managerUrl)
        var escapedStep = esc(step)
        stepsHtml +=
          "<li>" +
          '<span class="icono-install-step-copy">' +
          escapedStep.replace(
            escapedUrl,
            '<code class="icono-install-code">' + escapedUrl + "</code>",
          ) +
          (stepActionHtml
            ? ' <span class="icono-install-step-action">' + stepActionHtml + "</span>"
            : "") +
          "</span>" +
          "</li>"
        continue
      }
      stepsHtml +=
        "<li>" +
        '<span class="icono-install-step-copy">' +
        esc(step) +
        (stepActionHtml
          ? ' <span class="icono-install-step-action">' + stepActionHtml + "</span>"
          : "") +
        "</span>" +
        "</li>"
    }
    var actionsHtml = ""
    for (var j = 0; j < actions.length; j++) {
      var action = actions[j]
      actionsHtml += buildInstallActionMarkup(action)
    }
    var panelBodyAttrs = activeTab
      ? ' class="icono-install-panel-body" id="icono-install-tabpanel-' +
        esc(activeTab) +
        '" role="tabpanel" aria-labelledby="icono-install-tab-' +
        esc(activeTab) +
        '"'
      : ' class="icono-install-panel-body"'
    var headerHtml = activeTab
      ? ""
      : '<div class="icono-install-header">' +
        '<div class="icono-home-auth-title icono-guest-login-card-title icono-install-card-title" role="heading" aria-level="2">' +
        esc(model.title || "Install Iconoplasm") +
        "</div>" +
        (model.note ? '<p class="icono-install-note">' + esc(model.note) + "</p>" : "") +
        "</div>"
    var tabTitle = String(model.cardTitle || model.title || "Install Iconoplasm").trim()
    var tabNoteHtml =
      activeTab && model.note
        ? '<div class="icono-install-card-copy">' +
          '<div class="icono-home-auth-title icono-guest-login-card-title icono-install-card-title">' +
          esc(tabTitle) +
          "</div>" +
          '<p class="icono-install-tab-note">' +
          esc(model.note) +
          "</p>" +
          "</div>"
        : ""
    var primaryActionHtml = primaryAction
      ? '<div class="icono-install-primary-action">' +
        buildInstallActionMarkup(primaryAction) +
        "</div>"
      : ""
    return (
      '<section class="icono-card icono-guest-login-card icono-install-panel icono-install-panel--' +
      esc(model.tone || "info") +
      '" id="icono-install-panel" data-icono-home-install-card aria-live="polite">' +
      buildInstallTabsMarkup(model) +
      "<div" +
      panelBodyAttrs +
      ">" +
      headerHtml +
      tabNoteHtml +
      primaryActionHtml +
      (stepsHtml ? '<ol class="icono-install-steps">' + stepsHtml + "</ol>" : "") +
      (actionsHtml ? '<div class="icono-install-actions">' + actionsHtml + "</div>" : "") +
      (model.footnote ? '<p class="icono-install-footnote">' + esc(model.footnote) + "</p>" : "") +
      "</div>" +
      "</section>"
    )
  }

  function wireInstallPanelTabs(scope) {
    if (!scope) return
    var tabButtons = scope.querySelectorAll("[data-icono-install-tab]")
    for (var i = 0; i < tabButtons.length; i++) {
      ;(function (button) {
        button.addEventListener("click", function () {
          var nextTab = String(button.getAttribute("data-icono-install-tab") || "")
            .trim()
            .toLowerCase()
          if (!nextTab) return
          iconoInstallState.installTab = nextTab
          renderHomeInstallCta()
        })
      })(tabButtons[i])
    }
  }

  function renderHomeInstallCta() {
    var toggleHost = document.getElementById("icono-gallery-install")
    var panelHost = document.getElementById("icono-install-panel-host")
    var existingCard = document.querySelector("[data-icono-home-install-card]")
    var model = currentInstallExperience()
    if (!panelHost) {
      if (toggleHost) {
        toggleHost.hidden = true
        toggleHost.innerHTML = ""
      }
      if (existingCard) {
        existingCard.outerHTML = buildInstallPanelMarkup(model)
        wireInstallPanelTabs(document)
      }
      return
    }
    var showInstallCard = !iconoInstallState.installed
    toggleHost.hidden = showInstallCard
    toggleHost.innerHTML = showInstallCard ? "" : buildInstallToggleMarkup(model)
    panelHost.hidden = showInstallCard ? false : !iconoInstallState.panelOpen
    panelHost.innerHTML =
      showInstallCard || iconoInstallState.panelOpen ? buildInstallPanelMarkup(model) : ""
    if (!showInstallCard) {
      var toggle = toggleHost.querySelector("[data-icono-install-toggle]")
      if (toggle) {
        toggle.addEventListener("click", function () {
          iconoInstallState.panelOpen = !iconoInstallState.panelOpen
          renderHomeInstallCta()
        })
      }
    }
    wireInstallPanelTabs(panelHost)
  }

  function appendHomeInstallCard(container) {
    if (!container || container.querySelector("[data-icono-home-install-card]")) {
      return null
    }
    var wrapper = document.createElement("div")
    wrapper.innerHTML = buildInstallPanelMarkup(currentInstallExperience())
    var card = wrapper.firstElementChild
    if (!card) return null
    container.appendChild(card)
    wireInstallPanelTabs(card)
    return card
  }

  function buildGuestDiscoveryLoginCardMarkup() {
    return ""
  }

  function buildDiscordInviteCardMarkup() {
    return (
      '<article class="icono-card icono-guest-login-card" data-icono-discord-action-card data-icono-discord-invite-card>' +
      '<div class="icono-home-auth-copy">' +
      '<div class="icono-home-auth-title icono-guest-login-card-title">Join the Discord server</div>' +
      "</div>" +
      '<a class="icono-home-auth-link icono-guest-login-card-button" href="' +
      esc(COMMUNITY_URL) +
      '" target="_blank" rel="noopener noreferrer">Join Discord</a>' +
      "</article>"
    )
  }

  function buildDiscordActionCardMarkup() {
    return currentUser ? buildDiscordInviteCardMarkup() : buildGuestDiscoveryLoginCardMarkup()
  }

  function appendDiscordActionCard(container) {
    if (!container || container.querySelector("[data-icono-discord-action-card]")) {
      return null
    }
    var wrapper = document.createElement("div")
    wrapper.innerHTML = buildDiscordActionCardMarkup()
    var card = wrapper.firstElementChild
    if (!card) return null
    container.appendChild(card)
    return card
  }

  function homeAuxiliaryContainer(grid, cardVariant) {
    if (!grid || !isImageOnlyCardVariant(cardVariant)) return grid
    var host = document.getElementById("icono-home-auxiliary")
    if (!host) return grid
    host.hidden = false
    return host
  }

  function clearHomeAuxiliaryCards() {
    var host = document.getElementById("icono-home-auxiliary")
    if (!host) return
    host.innerHTML = ""
    host.hidden = true
  }

  function renderTooltipMetaSkeletonHtml() {
    // Shared source of truth: shared/iconoplasm-card/shared-card-runtime.js
    // This keeps tooltip/card skeleton behavior identical across the site and extension.
    return IconoCardShared.renderTooltipMetaSkeletonHtml()
  }

  function buildTooltipTraitOriginRows(essence) {
    return IconoCardShared.buildTooltipTraitOriginRows(essence)
  }

  function collectTooltipMetaRows(geneDetail) {
    return IconoCardShared.collectTooltipMetaRows(geneDetail, {
      onMissingOrigins: function (warnKey, detail) {
        if (missingTooltipOriginWarnings[warnKey]) return
        missingTooltipOriginWarnings[warnKey] = true
        console.error(
          "[Iconoplasm] Missing aesthetics/politics origin metadata for tooltip:",
          warnKey,
          detail,
        )
      },
    })
  }

  function renderTooltipMetaRowsHtml(rows) {
    return IconoCardShared.renderTooltipMetaRowsHtml(rows)
  }

  function renderTooltipMetaHtml(geneDetail) {
    return renderTooltipMetaRowsHtml(collectTooltipMetaRows(geneDetail))
  }

  function renderTooltipMobileRowGridHtml(rows, extraAttrs) {
    return IconoCardShared.renderTooltipMobileRowGridHtml(rows, extraAttrs)
  }

  function renderTooltipMobileSkeletonHtml(extraAttrs) {
    return IconoCardShared.renderTooltipMobileSkeletonHtml(extraAttrs)
  }

  function warmBrickCardImages(entries) {
    var source = Array.isArray(entries) ? entries : []
    // Mobile users scroll through the brick gallery faster than the detail hydrator can react.
    // Prewarm published portraits as soon as a page of cards lands so top/bottom viewport cards
    // do not briefly flash placeholder art during fast flicks.
    for (var i = 0; i < source.length; i++) {
      var portraitUrl = publishedPortraitUrl(source[i], "medium")
      if (!portraitUrl) continue
      void preloadImage(portraitUrl)
    }
  }

  function brickVoteAssetSha(genePayload) {
    return String(((genePayload || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
  }

  function brickVoteCandidateImageId(genePayload) {
    var candidateImageId = Number(((genePayload || {}).portrait || {}).candidate_image_id || 0)
    if (!Number.isFinite(candidateImageId) || candidateImageId <= 0) return ""
    return String(Math.round(candidateImageId))
  }

  function brickVoteVisionId(genePayload) {
    return String(((genePayload || {}).portrait || {}).vision_id || "").trim()
  }

  function brickVoteBoxMarkup(genePayload) {
    var assetSha = brickVoteAssetSha(genePayload)
    if (!assetSha) return ""
    var candidateImageId = brickVoteCandidateImageId(genePayload)
    var visionId = brickVoteVisionId(genePayload)
    var extraAttrs = 'data-icono-brick-vote-box="' + esc(assetSha) + '"'
    if (candidateImageId)
      extraAttrs += ' data-icono-candidate-image-id="' + esc(candidateImageId) + '"'
    if (visionId) extraAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
    return voteBoxMarkup(extraAttrs, {
      variant: "brick",
      showScore: false,
    })
  }

  function labelVoteBoxMarkup(genePayload, attrName, options) {
    var opts = options || {}
    var assetSha = brickVoteAssetSha(genePayload)
    if (!assetSha) return ""
    var candidateImageId = brickVoteCandidateImageId(genePayload)
    var visionId = brickVoteVisionId(genePayload)
    var extraAttrs = (attrName || "data-icono-brick-vote-box") + '="' + esc(assetSha) + '"'
    if (candidateImageId)
      extraAttrs += ' data-icono-candidate-image-id="' + esc(candidateImageId) + '"'
    if (visionId) extraAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
    return voteBoxMarkup(extraAttrs, {
      variant: "label",
      showScore: false,
      showArrows: !!opts.showArrows,
    })
  }

  function buildLabLabelPortraitMediaMarkup(
    symbol,
    portraitUrl,
    portraitFullUrl,
    dims,
    fetchPriority,
    options,
  ) {
    var opts = options || {}
    var portraitAlt = String(opts.portraitAlt || "").trim() || normalizedSymbol(symbol) + " blot"
    return IconoCardShared.renderLabLabelPortraitMediaHtml(
      symbol,
      portraitUrl,
      portraitFullUrl,
      dims,
      {
        buttonAttrs:
          'data-icono-pswp data-icono-pswp-src="' +
          esc(portraitFullUrl) +
          '" data-icono-pswp-alt="' +
          esc(portraitAlt) +
          '" data-pswp-width="' +
          dims.width +
          '" data-pswp-height="' +
          dims.height +
          '"',
        fetchPriority: fetchPriority || "low",
        buttonAriaLabel: opts.buttonAriaLabel,
        captionText: opts.captionText,
        portraitAlt: portraitAlt,
      },
    )
  }

  function buildBrickCardMarkup(g, cardIndex, cardVariant) {
    var dims = portraitDimensions(g)
    var key = normalizedSymbol(g.symbol)
    var portraitUrl = publishedPortraitUrl(g, "medium")
    var portraitFullUrl = publishedPortraitUrl(g, "full") || portraitUrl
    var detail = readCachedRenderableGenePayload(key)
    var resolvedCardVariant = normalizeRenderableCardVariant(cardVariant)
    var isArchivalVariant = isArchivalCardVariant(resolvedCardVariant)
    var isImageOnlyVariant = isImageOnlyCardVariant(resolvedCardVariant)
    var href = "/gene/" + esc(encodeURIComponent(g.symbol))
    var geneLinkAttrs = 'target="_blank" rel="noopener noreferrer"'
    var metaRows = detail ? collectTooltipMetaRows(detail) : []
    var metaHtml = detail ? renderTooltipMetaRowsHtml(metaRows) : renderTooltipMetaSkeletonHtml()
    var mobileRowsHtml = detail
      ? renderTooltipMobileRowGridHtml(metaRows, "data-icono-card-mobile-meta")
      : renderTooltipMobileSkeletonHtml("data-icono-card-mobile-meta")
    var voteHtml = brickVoteBoxMarkup(detail || g)
    var labelVoteHtml = labelVoteBoxMarkup(detail || g, "data-icono-brick-vote-box", {
      showArrows: isMobileLabelReviewEnabled(),
    })
    var portraitStateClass = portraitUrl
      ? "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--ready"
      : "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing"
    var labelPortraitHtml = buildLabLabelPortraitMediaMarkup(
      g.symbol,
      portraitUrl,
      portraitFullUrl,
      dims,
      cardIndex < 6 ? "high" : "low",
    )
    var bodyHtml = isLitCardVariant(resolvedCardVariant)
      ? buildArchivalBodyMarkup(detail || g, {
          mode: "brick",
          layoutVariant: litLayoutVariantForCard(resolvedCardVariant),
          mobileReview: isMobileLabelReviewEnabled(),
          portraitAlt: g.symbol + " blot",
          portraitSrc: portraitUrl,
          titleHref: href,
          titleLinkAttrs: geneLinkAttrs,
          voteHtml: isImageOnlyVariant ? "" : labelVoteHtml,
        })
      : '<div class="iconoplasm-tooltip-header">' +
        '<div class="icono-brick-header-row icono-shared-card-header-row">' +
        '<a class="icono-brick-header-link" href="' +
        href +
        '" ' +
        geneLinkAttrs +
        ">" +
        '<div class="iconoplasm-tooltip-symbol">' +
        esc(g.symbol) +
        "</div>" +
        '<div class="iconoplasm-tooltip-name">' +
        esc(g.full_name || g.symbol) +
        "</div>" +
        "</a>" +
        voteHtml +
        "</div>" +
        "</div>" +
        '<a class="icono-brick-meta-link" href="' +
        href +
        '" ' +
        geneLinkAttrs +
        ">" +
        '<div class="iconoplasm-tooltip-meta' +
        (detail ? "" : " iconoplasm-tooltip-meta--loading") +
        '" data-icono-card-meta>' +
        metaHtml +
        "</div>" +
        "</a>"
    var portraitHtml = isImageOnlyVariant
      ? ""
      : isArchivalVariant
        ? '<div class="' +
          portraitStateClass +
          " icono-label-mobile-portrait-card" +
          (portraitUrl ? '" data-icono-lightbox>' : '">') +
          IconoCardShared.renderLabLabelSpecimenRailHtml(labelPortraitHtml, detail || g) +
          "</div>"
        : '<div class="' +
          portraitStateClass +
          ' icono-brick-media-link"' +
          (portraitUrl ? " data-icono-lightbox>" : ">") +
          (portraitUrl
            ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-pswp data-icono-pswp-src="' +
              esc(portraitFullUrl) +
              '" data-icono-pswp-alt="' +
              esc(g.symbol) +
              ' blot" data-pswp-width="' +
              dims.width +
              '" data-pswp-height="' +
              dims.height +
              '" aria-label="Open full-size blot for ' +
              esc(g.symbol) +
              '">' +
              '<img class="iconoplasm-tooltip-portrait-img" src="' +
              esc(portraitUrl) +
              '" alt="' +
              esc(g.symbol) +
              // Keep brick portraits eager once a card is rendered. Lazy here made fast mobile
              // scroll show empty portrait boxes for a beat before the browser picked them up.
              ' blot" loading="eager" decoding="async" fetchpriority="' +
              (cardIndex < 6 ? "high" : "low") +
              '" width="' +
              dims.width +
              '" height="' +
              dims.height +
              '">' +
              "</button>"
            : '<img class="iconoplasm-tooltip-portrait-img" alt="">') +
          '<div class="iconoplasm-tooltip-portrait-fallback">' +
          '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
          '<div class="iconoplasm-tooltip-portrait-symbol">' +
          esc(g.symbol) +
          "</div>" +
          "</div>" +
          '<div class="iconoplasm-tooltip-portrait-fade"></div>' +
          "</div>"
    var infoHtml = isImageOnlyVariant
      ? ""
      : '<div class="iconoplasm-tooltip-body' +
        (isArchivalVariant ? " icono-label-mobile-info-card" : "") +
        '">' +
        bodyHtml +
        "</div>"
    return (
      // Source: C:\Users\Admin\.codex\skills\frontend-design\SKILL.md (Interaction, Layout &
      // Space) + C:\Users\Admin\.codex\skills\polish\SKILL.md (Interaction States). Brick cards
      // are no longer one giant anchor because the compact vote control needs to be a real,
      // keyboard-focusable control instead of an invalid nested button inside a link.
      '<article class="icono-card icono-card--brick' +
      archivalVariantClass(resolvedCardVariant) +
      '" data-icono-index="' +
      cardIndex +
      '" data-icono-symbol="' +
      esc(g.symbol) +
      '" data-icono-card-variant="' +
      esc(resolvedCardVariant) +
      '" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(g.color || "#888") +
      ';">' +
      (isImageOnlyVariant
        ? bodyHtml
        : isArchivalVariant
          ? mobileArchivalObjectMarkup(portraitHtml, infoHtml)
          : portraitHtml + infoHtml) +
      (isLitCardVariant(resolvedCardVariant)
        ? ""
        : '<a class="icono-brick-mobile-link" href="' +
          href +
          '" ' +
          geneLinkAttrs +
          ">" +
          mobileRowsHtml +
          "</a>") +
      "</article>"
    )
  }

  function buildGeneLeadCardMarkup(g) {
    var dims = portraitDimensions(g)
    var portraitAlt =
      normalizedSymbol(g.symbol) + " character portrait used inside the Iconoplasm gene blot"
    var portraitCaption =
      "Source portrait for the " + normalizedSymbol(g.symbol) + " Iconoplasm gene blot."
    var portraitUrl = publishedPortraitUrl(g, "medium")
    var portraitFullUrl = publishedPortraitUrl(g, "full") || portraitUrl
    var portraitAssetSha = String(((g || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
    var detail = g || null
    var cardVariant = "lit-archival"
    var isArchivalVariant = isArchivalCardVariant(cardVariant)
    var isImageOnlyVariant = isImageOnlyCardVariant(cardVariant)
    var metaRows = detail ? collectTooltipMetaRows(detail) : []
    var metaHtml = detail ? renderTooltipMetaRowsHtml(metaRows) : renderTooltipMetaSkeletonHtml()
    // The lead card intentionally consumes the same mobile row-grid renderer as home bricks.
    // Keep mobile structure changes centralized so the gene page and gallery do not diverge again.
    var mobileRowsHtml = renderTooltipMobileRowGridHtml(
      detail ? metaRows : [],
      "data-icono-card-mobile-meta",
    )
    var portraitStateClass = portraitUrl
      ? "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--ready"
      : "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing"
    var portraitMarkup =
      '<div class="' +
      portraitStateClass +
      '"' +
      (portraitUrl ? " data-icono-lightbox" : "") +
      ">" +
      (isArchivalVariant
        ? IconoCardShared.renderLabLabelSpecimenRailHtml(
            portraitUrl
              ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-pswp data-icono-pswp-src="' +
                  esc(portraitFullUrl) +
                  '" data-icono-pswp-alt="' +
                  esc(portraitAlt) +
                  '" data-pswp-width="' +
                  dims.width +
                  '" data-pswp-height="' +
                  dims.height +
                  '" aria-label="Open full-size source portrait for ' +
                  esc(g.symbol) +
                  '">' +
                  '<img class="iconoplasm-tooltip-portrait-img" src="' +
                  esc(portraitUrl) +
                  '" data-iconoplasm-role="source-portrait" data-gene-symbol="' +
                  esc(g.symbol) +
                  '" alt="' +
                  esc(portraitAlt) +
                  '" loading="eager" decoding="async" width="' +
                  dims.width +
                  '" height="' +
                  dims.height +
                  '">' +
                  "</button>" +
                  '<span class="icono-visually-hidden icono-portrait-caption">' +
                  esc(portraitCaption) +
                  "</span>"
              : '<img class="iconoplasm-tooltip-portrait-img" alt="">' +
                  '<div class="iconoplasm-tooltip-portrait-fallback">' +
                  '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
                  '<div class="iconoplasm-tooltip-portrait-symbol">' +
                  esc(g.symbol) +
                  "</div>" +
                  "</div>",
            g,
          )
        : portraitUrl
          ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-pswp data-icono-pswp-src="' +
            esc(portraitFullUrl) +
            '" data-icono-pswp-alt="' +
            esc(portraitAlt) +
            '" data-pswp-width="' +
            dims.width +
            '" data-pswp-height="' +
            dims.height +
            '" aria-label="Open full-size source portrait for ' +
            esc(g.symbol) +
            '">' +
            '<img class="iconoplasm-tooltip-portrait-img" src="' +
            esc(portraitUrl) +
            '" data-iconoplasm-role="source-portrait" data-gene-symbol="' +
            esc(g.symbol) +
            '" alt="' +
            esc(portraitAlt) +
            '" loading="eager" decoding="async" width="' +
            dims.width +
            '" height="' +
            dims.height +
            '">' +
            '<span class="icono-card-badge">' +
            esc(g.symbol) +
            "</span>" +
            "</button>" +
            '<span class="icono-visually-hidden icono-portrait-caption">' +
            esc(portraitCaption) +
            "</span>"
          : '<img class="iconoplasm-tooltip-portrait-img" alt="">' +
            '<div class="iconoplasm-tooltip-portrait-fallback">' +
            '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
            '<div class="iconoplasm-tooltip-portrait-symbol">' +
            esc(g.symbol) +
            "</div>" +
            "</div>" +
            '<div class="iconoplasm-tooltip-portrait-fade"></div>') +
      "</div>"
    // Source: C:\Users\Admin\.codex\skills\normalize\SKILL.md (Components) +
    // C:\Users\Admin\.codex\skills\extract\SKILL.md (single source of truth).
    // Gene detail must consume the same in-card action pattern as the shared card surfaces.
    // Keeping a second action bar under the card is what caused vote drift, redundant links,
    // and the off-spec color chip panel the user asked to remove.
    var voteSlotMarkup = portraitAssetSha
      ? '<div class="iconoplasm-tooltip-vote-slot" data-icono-gene-vote-slot>' +
        voteBoxMarkup("", { variant: isArchivalVariant ? "label" : "" }) +
        "</div>"
      : ""
    // B-471: at narrow viewports the desktop "sheet" archival layout
    // shrinks to ~7px field labels and is unreadable. Render the hero in
    // the same brick + mobile-review mode the home grid uses on mobile,
    // which gives big legible rows ("FULL NAME", "MISFIT/FIT", etc) plus
    // a tap-to-open dossier sheet.
    // Emit one deterministic lead-card DOM for server rendering and client adoption.
    // Desktop hides the mobile peek with CSS; mobile uses the same sheet as its dossier.
    // Viewport-dependent markup here would force a post-paint replacement on one device class.
    var heroMobileReview = isLitCardVariant(cardVariant)
    var heroMode = heroMobileReview ? "brick" : "sheet"
    var bodyHtml = isLitCardVariant(cardVariant)
      ? buildArchivalBodyMarkup(detail || g, {
          mode: heroMode,
          layoutVariant: litLayoutVariantForCard(cardVariant),
          mobileReview: heroMobileReview,
          includeCharacterProfile: true,
          portraitAlt: portraitAlt,
          portraitSrc: portraitUrl,
          voteHtml: !isImageOnlyVariant
            ? labelVoteBoxMarkup(g, "data-icono-gene-vote-box", {
                showArrows: true,
              })
            : "",
        })
      : '<div class="iconoplasm-tooltip-header">' +
        '<div class="icono-shared-card-header-row">' +
        '<div class="icono-shared-card-header-copy">' +
        '<div class="iconoplasm-tooltip-symbol">' +
        esc(g.symbol) +
        "</div>" +
        '<div class="iconoplasm-tooltip-name">' +
        esc(g.full_name || g.symbol) +
        "</div>" +
        "</div>" +
        voteSlotMarkup +
        "</div>" +
        '<div class="iconoplasm-tooltip-meta" data-icono-card-meta>' +
        metaHtml +
        "</div>" +
        "</div>" +
        mobileRowsHtml
    var heroInfoMarkup =
      '<div class="iconoplasm-tooltip-body' +
      (isArchivalVariant ? " icono-label-mobile-info-card" : "") +
      '">' +
      bodyHtml +
      "</div>"
    return (
      // B-471: drop `brick-static` on mobile so wireMobileLabelCard
      // can wire the peek/expand toggle. Static bricks are skipped by
      // the mobile-label wiring on purpose for grid-context cards we
      // don't want to expand; the hero is the page, so it should expand.
      '<article class="icono-card icono-card--brick icono-gene-lead-card' +
      archivalVariantClass(cardVariant) +
      '" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(g.color || "#888") +
      '" data-icono-card-variant="' +
      esc(cardVariant) +
      '">' +
      (isImageOnlyVariant
        ? bodyHtml
        : isArchivalVariant
          ? mobileArchivalObjectMarkup(portraitMarkup, heroInfoMarkup)
          : portraitMarkup + heroInfoMarkup) +
      "</article>"
    )
  }

  function hydrateBrickPortrait(card, genePayload) {
    if (!card) return
    var portrait = card.querySelector(".iconoplasm-tooltip-portrait")
    var portraitImg = card.querySelector(".iconoplasm-tooltip-portrait-img")
    if (!portrait || !portraitImg) return
    var isGeneLead = card.classList.contains("icono-gene-lead-card")
    var portraitUrl = publishedPortraitUrl(genePayload, "medium")
    if (!portraitUrl) {
      portrait.classList.remove("iconoplasm-tooltip-portrait--ready")
      portrait.classList.add("iconoplasm-tooltip-portrait-missing")
      portraitImg.removeAttribute("src")
      return
    }
    var dims = portraitDimensions(genePayload)
    portrait.classList.remove("iconoplasm-tooltip-portrait-missing")
    portrait.classList.add("iconoplasm-tooltip-portrait--ready")
    portraitImg.setAttribute("src", portraitUrl)
    // Hydration should keep the same loading strategy as initial brick markup so a returned card
    // does not downgrade to a slower image fetch after click-through/back navigation.
    portraitImg.setAttribute("loading", "eager")
    portraitImg.setAttribute("fetchpriority", "low")
    portraitImg.setAttribute("width", String(dims.width))
    portraitImg.setAttribute("height", String(dims.height))
    portraitImg.setAttribute(
      "alt",
      isGeneLead
        ? normalizedSymbol(genePayload.symbol) +
            " character portrait used inside the Iconoplasm gene blot"
        : normalizedSymbol(genePayload.symbol) + " blot",
    )
    card.style.setProperty("--width", String(dims.width))
    card.style.setProperty("--height", String(dims.height))
  }

  function ensureBrickVoteBox(card, genePayload) {
    if (!card) return
    if (isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) return
    var headerRow = card.querySelector(".icono-brick-header-row")
    if (!headerRow) return
    var assetSha = brickVoteAssetSha(genePayload)
    var existing = headerRow.querySelector("[data-icono-brick-vote-box]")
    if (!assetSha) {
      if (existing) existing.remove()
      return
    }
    if (!existing) {
      headerRow.insertAdjacentHTML("beforeend", brickVoteBoxMarkup(genePayload))
      existing = headerRow.querySelector("[data-icono-brick-vote-box]")
    } else if (existing.getAttribute("data-icono-brick-vote-box") !== assetSha) {
      existing.outerHTML = brickVoteBoxMarkup(genePayload)
      existing = headerRow.querySelector("[data-icono-brick-vote-box]")
    }
    if (!existing) return
    wireVoteBox(existing, card.getAttribute("data-icono-symbol"), assetSha, {
      // Cost fence: gallery cards can appear by the dozen on first paint and on lazy-load.
      // Personalized vote state is useful, but not worth a per-card snapshot storm before
      // the visitor actually tries to vote. The shared runtime fetches the snapshot before
      // submitting a click, so correctness is preserved while idle page load stays quiet.
      deferSnapshot: true,
    })
  }

  function ensureArchivalBrickVoteBox(card, genePayload) {
    if (!card) return
    if (!isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) return
    var assetSha = brickVoteAssetSha(genePayload)
    var boxes = Array.prototype.slice.call(card.querySelectorAll("[data-icono-brick-vote-box]"))
    if (!boxes.length || !assetSha) return
    var box = boxes[0]
    // Archival brick hydration replaces `.iconoplasm-tooltip-body` wholesale after detail fetch.
    // That DOM swap discards the initial vote controller and both responsive views. Rewire all
    // replacement views to one controller immediately so the visible breakpoint always submits
    // after hydration, after returning to the gallery, and after any later body swap.
    wireVoteBoxGroup(boxes, card.getAttribute("data-icono-symbol"), assetSha, {
      deferSnapshot: true,
      visionId: box.getAttribute("data-icono-vision-id") || brickVoteVisionId(genePayload) || "",
      candidateImageId:
        box.getAttribute("data-icono-candidate-image-id") ||
        brickVoteCandidateImageId(genePayload) ||
        0,
    })
  }

  function hydrateBrickCard(card, genePayload) {
    if (!card) return
    if (genePayload) hydrateBrickPortrait(card, genePayload)
    if (isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) {
      var body = card.querySelector(".iconoplasm-tooltip-body")
      var portraitShell = card.querySelector(".iconoplasm-tooltip-portrait")
      if (body) {
        body.innerHTML = buildArchivalBodyMarkup(genePayload, {
          mode: "brick",
          mobileReview: isMobileLabelReviewEnabled(),
          titleHref: "/gene/" + esc(encodeURIComponent(genePayload.symbol || "")),
          voteHtml: labelVoteBoxMarkup(genePayload, "data-icono-brick-vote-box", {
            showArrows: isMobileLabelReviewEnabled(),
          }),
        })
      }
      ensureArchivalBrickVoteBox(card, genePayload)
      if (portraitShell) {
        var dims = portraitDimensions(genePayload)
        var isGeneLead = card.classList.contains("icono-gene-lead-card")
        var portraitUrl = publishedPortraitUrl(genePayload, "medium")
        var portraitFullUrl = publishedPortraitUrl(genePayload, "full") || portraitUrl
        var geneLeadPortraitAlt = isGeneLead
          ? normalizedSymbol(genePayload.symbol) +
            " character portrait used inside the Iconoplasm gene blot"
          : ""
        var geneLeadPortraitCaption = isGeneLead
          ? "Source portrait for the " +
            normalizedSymbol(genePayload.symbol) +
            " Iconoplasm gene blot."
          : ""
        var labelPortraitHtml = buildLabLabelPortraitMediaMarkup(
          genePayload.symbol,
          portraitUrl,
          portraitFullUrl,
          dims,
          "low",
          isGeneLead
            ? {
                portraitAlt: geneLeadPortraitAlt,
                buttonAriaLabel:
                  "Open full-size source portrait for " + normalizedSymbol(genePayload.symbol),
                captionText: geneLeadPortraitCaption,
              }
            : null,
        )
        card.style.setProperty("--width", String(dims.width))
        card.style.setProperty("--height", String(dims.height))
        card.style.setProperty(
          "--icono-card-accent",
          String((genePayload && genePayload.color) || "#888"),
        )
        if (portraitUrl) {
          portraitShell.classList.remove("iconoplasm-tooltip-portrait-missing")
          portraitShell.classList.add("iconoplasm-tooltip-portrait--ready")
          portraitShell.setAttribute("data-icono-lightbox", "")
        } else {
          portraitShell.classList.remove("iconoplasm-tooltip-portrait--ready")
          portraitShell.classList.add("iconoplasm-tooltip-portrait-missing")
          portraitShell.removeAttribute("data-icono-lightbox")
        }
        portraitShell.innerHTML = IconoCardShared.renderLabLabelSpecimenRailHtml(
          labelPortraitHtml,
          genePayload,
        )
      }
      if (isMobileLabelReviewEnabled()) {
        wireMobileLabelCard(card)
        setMobileLabelExpanded(card, false, { preserveTop: false })
      } else {
        resetMobileLabelCardState(card)
      }
      refreshPortraitLightbox()
      return
    }
    var meta = card.querySelector("[data-icono-card-meta]")
    var mobileMeta = card.querySelector("[data-icono-card-mobile-meta]")
    var metaRows = collectTooltipMetaRows(genePayload)
    if (meta) {
      meta.classList.remove("iconoplasm-tooltip-meta--loading")
      meta.innerHTML = renderTooltipMetaRowsHtml(metaRows)
    }
    if (mobileMeta) {
      mobileMeta.outerHTML = renderTooltipMobileRowGridHtml(metaRows, "data-icono-card-mobile-meta")
    }
    ensureBrickVoteBox(card, genePayload)
    refreshPortraitLightbox()
  }

  function hydrateBrickCards(cards) {
    var queue = []
    var items = Array.isArray(cards) ? cards : []
    for (var i = 0; i < items.length; i++) {
      var card = items[i]
      if (!card || !card.classList || !card.classList.contains("icono-card--brick")) continue
      var symbol = normalizedSymbol(card.getAttribute("data-icono-symbol"))
      if (!symbol) continue
      var cachedPayload = readCachedRenderableGenePayload(symbol)
      if (cachedPayload) {
        hydrateBrickCard(card, cachedPayload)
        continue
      }
      queue.push({ card: card, symbol: symbol })
    }
    if (!queue.length) return Promise.resolve(null)

    var workerCount = Math.min(PREFETCH_DETAIL_CONCURRENCY, queue.length)
    var workers = []

    function next() {
      var entry = queue.shift()
      if (!entry) return Promise.resolve(null)
      return fetchGeneDetail(entry.symbol)
        .then(function (genePayload) {
          if (!entry.card.isConnected) return null
          hydrateBrickCard(entry.card, genePayload)
          return null
        })
        .then(next)
    }

    for (var j = 0; j < workerCount; j++) {
      workers.push(next())
    }
    return Promise.all(workers).then(function () {
      return null
    })
  }

  function voteBoxMarkup(extraAttrs, options) {
    return IconoCardShared.voteBoxMarkup(extraAttrs, options)
  }

  function wireVoteBox(box, symbolValue, assetShaValue, options) {
    var opts = options || {}
    return IconoCardShared.wireVoteBox(box, {
      symbol: symbolValue,
      assetSha: assetShaValue,
      visionId: opts.visionId || "",
      candidateImageId: opts.candidateImageId || 0,
      deferSnapshot: !!opts.deferSnapshot,
      initialSnapshot: opts.initialSnapshot || null,
      mirrorBoxes: Array.isArray(opts.mirrorBoxes) ? opts.mirrorBoxes : [],
      authenticated: !!opts.authenticated,
      apiBaseUrl: API,
      onSnapshot: function (snapshot, state) {
        if (typeof opts.onSnapshot === "function") opts.onSnapshot(snapshot, state)
      },
      onAuthRequired: function (_error, sourceControl) {
        openVoteLoginDialog({
          loginUrl: voteLoginUrl(),
          returnFocus: sourceControl || box,
        })
      },
      onVoteCommitted: function (data, state) {
        if (typeof opts.onVoteCommitted === "function") {
          opts.onVoteCommitted(data, state)
        }
      },
      onError: function (phase, err) {
        console.error("[Iconoplasm] vote " + phase + " error:", err)
        if (typeof opts.onError === "function") {
          opts.onError(phase, err)
        }
      },
    })
  }

  function wireBrickVoteBoxes(cards) {
    var items = Array.isArray(cards) ? cards : []
    for (var i = 0; i < items.length; i++) {
      var card = items[i]
      if (!card || !card.classList || !card.classList.contains("icono-card--brick")) continue
      var boxes = Array.prototype.slice.call(card.querySelectorAll("[data-icono-brick-vote-box]"))
      if (!boxes.length) continue
      ;(function (brickCard, voteBoxes) {
        var voteBox = voteBoxes[0]
        wireVoteBoxGroup(
          voteBoxes,
          brickCard.getAttribute("data-icono-symbol"),
          voteBox.getAttribute("data-icono-brick-vote-box"),
          {
            deferSnapshot: true,
            visionId: voteBox.getAttribute("data-icono-vision-id") || "",
            candidateImageId: voteBox.getAttribute("data-icono-candidate-image-id") || 0,
            onVoteCommitted: function () {
              clearMobileLabelSwipeState(brickCard)
            },
            onError: function () {
              clearMobileLabelSwipeState(brickCard)
            },
          },
        )
      })(card, boxes)
    }
  }

  function isMobileLabelReviewEnabled() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
  }

  function resetMobileLabelCardState(card) {
    if (!card) return
    // Breakpoint exit must restore the canonical specimen footer before desktop
    // geometry is measured. Leaving the mobile-relocated node in the dossier
    // makes the portrait consume the full rail and clips every spectral readout.
    syncMobileLabelDossierContent(card)
    card.removeAttribute("data-icono-mobile-label-wired")
    card.removeAttribute("data-icono-mobile-review-active")
    card.removeAttribute("data-icono-mobile-expanded")
    card.removeAttribute("data-icono-mobile-swiping")
    card.removeAttribute("data-icono-mobile-swipe-pending")
    card.removeAttribute("data-icono-mobile-swipe-dir")
    card.removeAttribute("data-icono-mobile-swipe-committed")
    card.style.removeProperty("--icono-label-mobile-swipe-offset")
    card.style.removeProperty("--icono-label-mobile-swipe-rotate")
    card.style.removeProperty("--icono-label-mobile-dossier-top")
    card.style.removeProperty("--icono-label-mobile-viewport-height")
    card.style.removeProperty("--icono-label-mobile-fit-scale")
    card.style.removeProperty("--icono-label-mobile-target-size")
  }

  function syncMobileLabelViewportGeometry(card) {
    if (!card || typeof window === "undefined" || !isMobileLabelReviewEnabled()) return
    var cardParent = card.parentElement
    var computedCard =
      typeof window.getComputedStyle === "function" ? window.getComputedStyle(card) : null
    var rootFontSize =
      typeof document !== "undefined" && document.documentElement
        ? parseFloat(window.getComputedStyle(document.documentElement).fontSize || "16")
        : 16
    var physicalWidthToken = computedCard
      ? String(computedCard.getPropertyValue("--icono-label-mobile-physical-width") || "").trim()
      : ""
    var physicalWidth = 0
    if (/rem$/.test(physicalWidthToken)) {
      physicalWidth = parseFloat(physicalWidthToken) * rootFontSize
    } else if (/px$/.test(physicalWidthToken)) {
      physicalWidth = parseFloat(physicalWidthToken)
    }
    if (!(physicalWidth > 0)) physicalWidth = card.scrollWidth || card.offsetWidth || 0
    var viewportWidth =
      document.documentElement && document.documentElement.clientWidth
        ? document.documentElement.clientWidth
        : window.innerWidth
    var parentRect =
      cardParent && typeof cardParent.getBoundingClientRect === "function"
        ? cardParent.getBoundingClientRect()
        : null
    var visibleParentLeft = parentRect ? Math.max(0, parentRect.left) : 0
    var visibleParentRight = parentRect ? Math.min(viewportWidth, parentRect.right) : viewportWidth
    var visibleParentWidth = Math.max(1, visibleParentRight - visibleParentLeft)
    var availableWidth =
      Math.min(
        card.offsetWidth ? card.offsetWidth : Number.POSITIVE_INFINITY,
        cardParent && cardParent.clientWidth ? cardParent.clientWidth : Number.POSITIVE_INFINITY,
        visibleParentWidth,
      ) || window.innerWidth
    if (physicalWidth > 0 && availableWidth > 0) {
      var fitScale = Math.min(1.9, availableWidth / physicalWidth)
      fitScale = Math.max(0.78, fitScale)
      card.style.setProperty("--icono-label-mobile-fit-scale", fitScale.toFixed(4))
    }
    var activeFitScale =
      typeof fitScale === "number" && fitScale > 0
        ? fitScale
        : computedCard && computedCard.getPropertyValue("--icono-label-mobile-fit-scale")
          ? parseFloat(computedCard.getPropertyValue("--icono-label-mobile-fit-scale"))
          : 1
    if (!(activeFitScale > 0)) activeFitScale = 1
    card.style.setProperty(
      "--icono-label-mobile-target-size",
      Math.ceil(44 / activeFitScale) + "px",
    )
    var toPhysicalCardPx = function (value) {
      return value / activeFitScale
    }

    var portrait = card.querySelector(".iconoplasm-tooltip-portrait")
    var infoCard = card.querySelector(".iconoplasm-tooltip-body")
    var peek = card.querySelector(".icono-label-mobile-peek")
    var voteBox = card.querySelector(
      ".icono-label-mobile-peek-swipe [data-icono-vote-box], .icono-label-mobile-peek-swipe .icono-vote-box--label",
    )
    if (
      !portrait ||
      !infoCard ||
      !peek ||
      typeof portrait.getBoundingClientRect !== "function" ||
      typeof infoCard.getBoundingClientRect !== "function" ||
      typeof peek.getBoundingClientRect !== "function"
    )
      return
    var cardRect = card.getBoundingClientRect()
    var portraitRect = portrait.getBoundingClientRect()
    var infoRect = infoCard.getBoundingClientRect()
    var peekRect = peek.getBoundingClientRect()
    var voteRect =
      voteBox && typeof voteBox.getBoundingClientRect === "function"
        ? voteBox.getBoundingClientRect()
        : null
    var dossierTop = Math.max(0, toPhysicalCardPx(portraitRect.bottom - cardRect.top))
    card.style.setProperty("--icono-label-mobile-dossier-top", dossierTop.toFixed(2) + "px")

    var isExpanded = card.getAttribute("data-icono-mobile-expanded") === "true"
    var closedBottom = voteRect
      ? toPhysicalCardPx(voteRect.bottom - cardRect.top) + 16
      : dossierTop + toPhysicalCardPx(peekRect.height) + 12
    var fullInfoHeight = Math.max(toPhysicalCardPx(peekRect.height))
    if (infoCard.scrollHeight) {
      fullInfoHeight = Math.max(fullInfoHeight, toPhysicalCardPx(infoCard.scrollHeight))
    }
    var measuredContent = infoCard.querySelectorAll(
      [
        ".icono-label-mobile-peek",
        ".icono-label-header-row",
        ".icono-label-band-row",
        ".icono-label-style-row",
        ".icono-label-alignment-row",
        ".icono-label-footer-row",
        ".icono-label-specimen-footer",
      ].join(", "),
    )
    for (var i = 0; i < measuredContent.length; i += 1) {
      var measuredNode = measuredContent[i]
      if (!measuredNode || typeof measuredNode.getBoundingClientRect !== "function") continue
      var measuredRect = measuredNode.getBoundingClientRect()
      fullInfoHeight = Math.max(
        fullInfoHeight,
        toPhysicalCardPx(measuredRect.bottom - infoRect.top),
      )
    }
    var openBottom = dossierTop + fullInfoHeight + 8
    var viewportHeight = Math.ceil(isExpanded ? openBottom : closedBottom)
    card.style.setProperty("--icono-label-mobile-viewport-height", viewportHeight + "px")
  }

  function syncMobileLabelDossierContent(card) {
    if (!card) return
    var isMobileReview = isMobileLabelReviewEnabled()
    if (isMobileReview) card.setAttribute("data-icono-mobile-review-active", "true")
    else card.removeAttribute("data-icono-mobile-review-active")

    var portrait = card.querySelector(".iconoplasm-tooltip-portrait")
    var footer = card.querySelector(".icono-label-specimen-footer")
    var footerRow = card.querySelector(".icono-label-dossier-shell .icono-label-footer-row")
    if (!footer || !portrait) return

    var footerAnchor = portrait.querySelector("[data-icono-specimen-footer-anchor]")
    if (!footerAnchor && typeof document !== "undefined") {
      footerAnchor = document.createElement("span")
      footerAnchor.setAttribute("data-icono-specimen-footer-anchor", "")
      footerAnchor.hidden = true
      if (footer.parentElement === portrait) portrait.insertBefore(footerAnchor, footer)
      else portrait.appendChild(footerAnchor)
    }

    if (isMobileReview && footerRow) {
      // Mobile keeps one canonical footer node, but it must remain a real printed sheet row.
      // Relocating it inside Alignment made everything after PFAM/aesthetics visually vanish
      // behind the fixed mobile grid.
      if (footer.parentElement !== footerRow) footerRow.appendChild(footer)
      footer.setAttribute("data-icono-mobile-footer-relocated", "true")
      return
    }

    if (footerAnchor && footer.parentElement !== portrait) {
      portrait.insertBefore(footer, footerAnchor.nextSibling)
    }
    footer.removeAttribute("data-icono-mobile-footer-relocated")
  }

  function setMobileLabelExpanded(card, expanded, options) {
    if (!card) return
    var shouldPreserveTop = !(options && options.preserveTop === false)
    var anchorTop = null
    if (
      shouldPreserveTop &&
      typeof card.getBoundingClientRect === "function" &&
      typeof window !== "undefined"
    ) {
      var anchorRect = card.getBoundingClientRect()
      if (anchorRect.bottom > 0 && anchorRect.top < window.innerHeight) {
        anchorTop = anchorRect.top
      }
    }
    var restoreCardTop = function () {
      if (anchorTop == null || typeof window === "undefined") return
      if (typeof card.getBoundingClientRect !== "function") return
      var nextTop = card.getBoundingClientRect().top
      var delta = nextTop - anchorTop
      if (Math.abs(delta) > 1 && typeof window.scrollBy === "function") {
        window.scrollBy(0, delta)
      }
    }
    syncMobileLabelDossierContent(card)
    var resolved = !!expanded
    card.setAttribute("data-icono-mobile-expanded", resolved ? "true" : "false")
    var toggle = card.querySelector("[data-icono-label-mobile-toggle]")
    if (toggle) toggle.setAttribute("aria-expanded", resolved ? "true" : "false")
    syncMobileLabelViewportGeometry(card)
    restoreCardTop()
    window.requestAnimationFrame(function () {
      syncMobileLabelViewportGeometry(card)
      restoreCardTop()
    })
    window.setTimeout(function () {
      syncMobileLabelViewportGeometry(card)
      restoreCardTop()
    }, 320)
    window.setTimeout(function () {
      syncMobileLabelViewportGeometry(card)
      restoreCardTop()
    }, 720)
  }

  function setMobileLabelQcCopy(card, copy) {
    if (!card) return
    var note = card.querySelector("[data-icono-qc-note], [data-icono-mobile-qc-note]")
    if (!note) return
    note.textContent = String(copy || "").trim() || "pending review"
  }

  function nextBrickCard(card) {
    var node = card && card.nextElementSibling
    while (node) {
      if (node.classList && node.classList.contains("icono-card--brick")) return node
      node = node.nextElementSibling
    }
    return null
  }

  function advanceToNextBrick(card) {
    var nextCard = nextBrickCard(card)
    if (!nextCard || typeof nextCard.scrollIntoView !== "function") return
    window.setTimeout(function () {
      nextCard.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }, 140)
  }

  function clearMobileLabelSwipeState(card) {
    if (!card) return
    var timer = card.__iconoMobileSwipeFallbackTimer
    if (timer) {
      window.clearTimeout(timer)
      card.__iconoMobileSwipeFallbackTimer = null
    }
    card.removeAttribute("data-icono-mobile-swiping")
    card.removeAttribute("data-icono-mobile-swipe-pending")
    card.removeAttribute("data-icono-mobile-swipe-dir")
    card.removeAttribute("data-icono-mobile-swipe-committed")
    card.style.removeProperty("--icono-label-mobile-swipe-offset")
    card.style.removeProperty("--icono-label-mobile-swipe-rotate")
    card.style.removeProperty("--icono-label-mobile-reject-circle-opacity")
    card.style.removeProperty("--icono-label-mobile-approve-circle-opacity")
  }

  function mobileLabelVoteBox(card) {
    if (!card || typeof card.querySelector !== "function") return null
    return card.querySelector(
      ".icono-label-mobile-peek-swipe [data-icono-brick-vote-box], .icono-label-mobile-peek-swipe [data-icono-vote-box], .icono-label-mobile-peek-swipe .icono-vote-box--label, [data-icono-brick-vote-box]",
    )
  }

  function updateMobileLabelSwipeDirection(card, dx) {
    if (!card) return
    if (!Number.isFinite(dx) || Math.abs(dx) < 1) {
      if (card.getAttribute("data-icono-mobile-swipe-pending") !== "true") {
        card.removeAttribute("data-icono-mobile-swipe-dir")
      }
      card.style.setProperty("--icono-label-mobile-reject-circle-opacity", "0")
      card.style.setProperty("--icono-label-mobile-approve-circle-opacity", "0")
      return
    }
    var direction = dx > 0 ? "right" : "left"
    card.setAttribute("data-icono-mobile-swipe-dir", direction)
    card.style.setProperty(
      "--icono-label-mobile-reject-circle-opacity",
      direction === "left" ? "0.42" : "0",
    )
    card.style.setProperty(
      "--icono-label-mobile-approve-circle-opacity",
      direction === "right" ? "0.42" : "0",
    )
  }

  function commitMobileLabelSwipe(card, direction) {
    if (!card) return
    if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
    var box = mobileLabelVoteBox(card)
    var button = box
      ? box.querySelector(direction > 0 ? "[data-icono-vote-up]" : "[data-icono-vote-down]")
      : null
    if (!button) {
      clearMobileLabelSwipeState(card)
      return
    }
    card.setAttribute("data-icono-mobile-swipe-pending", "true")
    card.setAttribute("data-icono-mobile-swipe-committed", "true")
    card.setAttribute("data-icono-mobile-swipe-dir", direction > 0 ? "right" : "left")
    card.style.setProperty(
      "--icono-label-mobile-swipe-offset",
      (direction > 0 ? 1 : -1) * Math.min(window.innerWidth * 0.48, 280) + "px",
    )
    card.style.setProperty("--icono-label-mobile-swipe-rotate", (direction > 0 ? 7 : -7) + "deg")
    card.style.setProperty(
      "--icono-label-mobile-reject-circle-opacity",
      direction > 0 ? "0" : "0.56",
    )
    card.style.setProperty(
      "--icono-label-mobile-approve-circle-opacity",
      direction > 0 ? "0.56" : "0",
    )
    button.click()
    if (currentUser) {
      setMobileLabelQcCopy(card, direction > 0 ? "looks viable" : "flagged misfit")
      advanceToNextBrick(card)
    } else {
      setMobileLabelQcCopy(card, "pending review")
    }
    card.__iconoMobileSwipeFallbackTimer = window.setTimeout(function () {
      card.__iconoMobileSwipeFallbackTimer = null
      clearMobileLabelSwipeState(card)
    }, 2600)
  }

  function wireMobileLabelCard(card) {
    if (!card || !card.classList || !card.classList.contains("icono-card--variant-lab-label"))
      return
    if (card.classList.contains("icono-card--brick-static")) return
    if (!isMobileLabelReviewEnabled()) {
      resetMobileLabelCardState(card)
      return
    }
    if (card.getAttribute("data-icono-mobile-label-wired") === "true") return
    card.setAttribute("data-icono-mobile-label-wired", "true")
    syncMobileLabelDossierContent(card)
    setMobileLabelExpanded(card, false, { preserveTop: false })
    window.setTimeout(function () {
      syncMobileLabelViewportGeometry(card)
    }, 180)

    var gesture = {
      pointerId: null,
      startX: 0,
      startY: 0,
      dx: 0,
      dragging: false,
      locked: false,
    }

    function resetGesture() {
      gesture.pointerId = null
      gesture.startX = 0
      gesture.startY = 0
      gesture.dx = 0
      gesture.dragging = false
      gesture.locked = false
      if (card.getAttribute("data-icono-mobile-swipe-pending") !== "true") {
        clearMobileLabelSwipeState(card)
      }
    }

    card.addEventListener("click", function (event) {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest(
          "[data-icono-vote-box], [data-icono-brick-vote-box], [data-icono-gene-vote-box]",
        )
      ) {
        return
      }
      var toggle =
        event.target && event.target.closest
          ? event.target.closest("[data-icono-label-mobile-toggle]")
          : null
      if (!toggle) return
      event.preventDefault()
      if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
      setMobileLabelExpanded(card, card.getAttribute("data-icono-mobile-expanded") !== "true")
    })

    card.addEventListener("keydown", function (event) {
      if (!event || (event.key !== "Enter" && event.key !== " ")) return
      if (
        event.target &&
        event.target.closest &&
        event.target.closest(
          "[data-icono-vote-box], [data-icono-brick-vote-box], [data-icono-gene-vote-box]",
        )
      ) {
        return
      }
      var toggle =
        event.target && event.target.closest
          ? event.target.closest("[data-icono-label-mobile-toggle]")
          : null
      if (!toggle) return
      event.preventDefault()
      if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
      setMobileLabelExpanded(card, card.getAttribute("data-icono-mobile-expanded") !== "true")
    })

    card.addEventListener("pointerdown", function (event) {
      if (!isMobileLabelReviewEnabled()) return
      if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
      if (card.getAttribute("data-icono-mobile-expanded") === "true") return
      if (event.pointerType === "mouse") return
      if (event.button != null && event.button !== 0) return
      var target = event.target
      if (
        target &&
        target.closest &&
        target.closest(
          "[data-icono-label-mobile-toggle], [data-icono-vote-box], [data-icono-nav], a",
        )
      ) {
        return
      }
      if (typeof card.setPointerCapture === "function") card.setPointerCapture(event.pointerId)
      gesture.pointerId = event.pointerId
      gesture.startX = event.clientX
      gesture.startY = event.clientY
      gesture.dx = 0
      gesture.dragging = false
      gesture.locked = false
      card.removeAttribute("data-icono-mobile-swipe-dir")
    })

    card.addEventListener("pointermove", function (event) {
      if (gesture.pointerId !== event.pointerId) return
      var dx = event.clientX - gesture.startX
      var dy = event.clientY - gesture.startY
      updateMobileLabelSwipeDirection(card, dx)
      if (!gesture.dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (Math.abs(dy) > Math.abs(dx) * 1.15) {
          gesture.locked = true
          resetGesture()
          return
        }
        gesture.dragging = true
      }
      if (gesture.locked) return
      gesture.dx = dx
      card.setAttribute("data-icono-mobile-swiping", "true")
      card.style.setProperty("--icono-label-mobile-swipe-offset", dx + "px")
      card.style.setProperty("--icono-label-mobile-swipe-rotate", dx / 22 + "deg")
    })

    function finishPointer(event) {
      if (gesture.pointerId !== event.pointerId) return
      if (
        typeof card.releasePointerCapture === "function" &&
        card.hasPointerCapture(event.pointerId)
      ) {
        card.releasePointerCapture(event.pointerId)
      }
      if (!gesture.dragging) {
        resetGesture()
        return
      }
      var threshold = Math.max(72, Math.min(116, Math.round(card.clientWidth * 0.22)))
      var direction = gesture.dx > 0 ? 1 : -1
      if (Math.abs(gesture.dx) >= threshold) commitMobileLabelSwipe(card, direction)
      else clearMobileLabelSwipeState(card)
      resetGesture()
    }

    card.addEventListener("pointerup", finishPointer)
    card.addEventListener("pointercancel", finishPointer)
  }

  function wireMobileLabelCards(cards) {
    var items = Array.isArray(cards) ? cards : []
    for (var i = 0; i < items.length; i++) {
      wireMobileLabelCard(items[i])
    }
  }

  function wireGeneVoteBox(container, genePayload) {
    var boxes = Array.prototype.slice.call(container.querySelectorAll("[data-icono-gene-vote-box]"))
    if (!boxes.length) {
      var fallbackBox = container.querySelector("[data-icono-vote-box]")
      if (fallbackBox) boxes.push(fallbackBox)
    }
    if (!boxes.length) return null
    var symbol = String((genePayload && genePayload.symbol) || "")
      .trim()
      .toUpperCase()
    var portrait = (genePayload && genePayload.portrait) || {}
    return wireVoteBoxGroup(boxes, symbol, portrait.asset_sha256, {
      deferSnapshot: true,
      visionId: portrait.vision_id || "",
      candidateImageId: portrait.candidate_image_id || 0,
    })
  }

  function wireCandidateVoteBoxes(container, genePayload) {
    if (!container || !genePayload) return []
    var symbol = String(genePayload.symbol || "")
      .trim()
      .toUpperCase()
    var boxes = container.querySelectorAll("[data-icono-candidate-vote-box]")
    var groups = []
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i]
      var candidateAssetSha = box.getAttribute("data-icono-candidate-vote-box")
      var group = wireVoteBoxGroup([box], symbol, candidateAssetSha, {
        deferSnapshot: true,
        visionId: box.getAttribute("data-icono-vision-id") || "",
        candidateImageId: box.getAttribute("data-icono-candidate-image-id") || 0,
      })
      if (group) groups.push(group)
    }
    return groups
  }

  function wireVoteBoxGroup(boxes, symbol, assetSha, options) {
    var opts = options || {}
    var targets = Array.isArray(boxes) ? boxes.filter(Boolean) : []
    if (!targets.length || !symbol || !assetSha) return null
    var handle = wireVoteBox(targets[0], symbol, assetSha, {
      deferSnapshot: opts.deferSnapshot !== false,
      mirrorBoxes: targets.slice(1),
      visionId: opts.visionId || "",
      candidateImageId: opts.candidateImageId || 0,
      onSnapshot: opts.onSnapshot,
      onVoteCommitted: opts.onVoteCommitted,
      onError: opts.onError,
    })
    if (!handle) return null
    return {
      candidateRef: "a:" + symbol + "|" + String(assetSha).toLowerCase(),
      item: {
        candidate_ref: "a:" + symbol + "|" + String(assetSha).toLowerCase(),
        symbol: symbol,
        asset_sha256: String(assetSha).toLowerCase(),
        vision_id: opts.visionId || "",
        candidate_image_id: Number(opts.candidateImageId || 0) || undefined,
      },
      handles: [handle],
    }
  }

  function primeGeneVoteBoxGroups(groups) {
    var voteGroups = (Array.isArray(groups) ? groups : []).filter(Boolean)
    if (!voteGroups.length) return Promise.resolve()
    var uniqueItems = []
    var seen = Object.create(null)
    for (var i = 0; i < voteGroups.length; i++) {
      var group = voteGroups[i]
      if (!group.item || seen[group.candidateRef]) continue
      seen[group.candidateRef] = true
      uniqueItems.push(group.item)
    }
    return fetchJSON("/api/iconoplasm/votes/snapshots", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: uniqueItems }),
    })
      .then(function (data) {
        var snapshots = Array.isArray(data && data.snapshots) ? data.snapshots : []
        var byCandidate = Object.create(null)
        for (var i = 0; i < snapshots.length; i++) {
          var row = snapshots[i]
          if (row && row.candidate_ref) byCandidate[row.candidate_ref] = row.snapshot
        }
        for (var i = 0; i < voteGroups.length; i++) {
          var group = voteGroups[i]
          var snapshot = byCandidate[group.candidateRef]
          var handle = group.handles && group.handles[0]
          if (snapshot && handle && typeof handle.setSnapshot === "function") {
            handle.setSnapshot(snapshot, { authenticated: !!data.authenticated })
          }
        }
      })
      .catch(function (err) {
        console.error("[Iconoplasm] batched vote snapshot error:", err)
      })
  }

  function wireGeneVoteControls(container, genePayload) {
    var groups = []
    var leadGroup = wireGeneVoteBox(container, genePayload)
    if (leadGroup) groups.push(leadGroup)
    groups = groups.concat(wireCandidateVoteBoxes(container, genePayload))
    primeGeneVoteBoxGroups(groups)
  }

  function wireCandidateRemoveButtons(container, genePayload) {
    if (!container || !genePayload || !currentUserIsIconoAdmin) return
    var buttons = container.querySelectorAll("[data-icono-candidate-remove]")
    for (var i = 0; i < buttons.length; i++) {
      ;(function (button) {
        if (!button || button.getAttribute("data-icono-remove-wired") === "true") return
        button.setAttribute("data-icono-remove-wired", "true")
        button.addEventListener("click", function () {
          var symbol = String(button.getAttribute("data-icono-symbol") || "")
            .trim()
            .toUpperCase()
          var assetSha = String(button.getAttribute("data-icono-asset-sha256") || "")
            .trim()
            .toLowerCase()
          var candidateImageId =
            Number(button.getAttribute("data-icono-candidate-image-id") || 0) || 0
          var sampleLabel = String(button.getAttribute("data-icono-sample-label") || "").trim()
          var emulsionLabel = String(button.getAttribute("data-icono-emulsion-label") || "").trim()
          if (!symbol || !assetSha) return
          openCandidateDeleteDialog({
            document: document,
            symbol: symbol,
            sampleLabel: sampleLabel,
            emulsionLabel: emulsionLabel,
            returnFocus: button,
            onFailure: function (error) {
              showCandidateDeleteNotice({
                document: document,
                message:
                  "Couldn’t delete " +
                  (sampleLabel || symbol) +
                  ". Nothing changed. " +
                  String((error && error.message) || "Please try again."),
              })
            },
            onConfirm: function () {
              var card = button.closest(".icono-candidate-card")
              button.disabled = true
              if (card) {
                card.classList.add("is-deleting")
                card.setAttribute("aria-busy", "true")
              }
              return fetchJSON("/api/iconoplasm/admin/remove-candidate", {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json; charset=utf-8",
                },
                body: JSON.stringify({
                  symbol: symbol,
                  asset_sha256: assetSha,
                  candidate_image_id: candidateImageId > 0 ? candidateImageId : null,
                }),
              })
                .then(function () {
                  var candidateCount = removeCandidateFromPageState({
                    genePayload: genePayload,
                    assetSha: assetSha,
                    card: card,
                  })
                  portraitDetailCache[normalizedSymbol(symbol)] = genePayload
                  if (iconoSidebarState.gene) {
                    iconoSidebarState.gene.candidateCount = candidateCount
                    renderIconoplasmSidebar()
                  }
                  refreshPortraitLightbox()
                  showCandidateDeleteNotice({
                    document: document,
                    message: (sampleLabel || symbol) + " candidate deleted.",
                  })
                })
                .catch(function (error) {
                  button.disabled = false
                  if (card) {
                    card.classList.remove("is-deleting")
                    card.removeAttribute("aria-busy")
                  }
                  throw error
                })
            },
          })
        })
      })(buttons[i])
    }
  }

  function wireCandidateCopyForms(container, genePayload) {
    if (!container || !genePayload) return
    // B-467: each candidate copy panel is a <details>. We register a single document-level
    // pointerdown handler per render so clicks outside the open panel collapse it. This is
    // the popover-close behaviour you'd expect from Linear/Notion-style menus.
    if (!container.getAttribute("data-icono-copy-outside-wired")) {
      container.setAttribute("data-icono-copy-outside-wired", "true")
      var closeOpenCopyPanels = function (event) {
        var panels = container.querySelectorAll(".icono-candidate-copy-panel[open]")
        for (var p = 0; p < panels.length; p++) {
          var panel = panels[p]
          if (panel.contains(event.target)) continue
          panel.removeAttribute("open")
        }
      }
      document.addEventListener("pointerdown", closeOpenCopyPanels, true)
      document.addEventListener(
        "keydown",
        function (event) {
          if (event.key !== "Escape") return
          var panels = container.querySelectorAll(".icono-candidate-copy-panel[open]")
          for (var p = 0; p < panels.length; p++) panels[p].removeAttribute("open")
        },
        true,
      )
    }
    var forms = container.querySelectorAll("[data-icono-candidate-copy-form]")
    for (var i = 0; i < forms.length; i++) {
      ;(function (form) {
        if (!form || form.getAttribute("data-icono-copy-wired") === "true") return
        form.setAttribute("data-icono-copy-wired", "true")
        var sourceSymbol = normalizedSymbol(
          form.getAttribute("data-icono-source-symbol") || genePayload.symbol,
        )
        var assetSha = String(form.getAttribute("data-icono-asset-sha256") || "")
          .trim()
          .toLowerCase()
        var input = form.querySelector("[data-icono-candidate-copy-query]")
        var hidden = form.querySelector("[data-icono-candidate-copy-target]")
        var results = form.querySelector("[data-icono-candidate-copy-results]")
        var note = form.querySelector("[data-icono-candidate-copy-note]")
        var searchTimer = null
        if (!sourceSymbol || !assetSha || !input || !hidden || !results) return

        function setCopyStatus(message, tone) {
          if (!note) return
          note.textContent = String(message || "").trim()
          note.hidden = !note.textContent
          note.style.color =
            tone === "error" ? "#b42318" : tone === "success" ? "#0f766e" : "inherit"
        }

        function renderCopyResults(genes) {
          var rows = Array.isArray(genes) ? genes : []
          if (!rows.length) {
            results.innerHTML = '<div class="icono-request-results-empty">No genes found.</div>'
            results.hidden = false
            return
          }
          var html = ""
          for (var j = 0; j < rows.length; j++) {
            var gene = rows[j] || {}
            var symbol = normalizedSymbol(gene.symbol || "")
            if (!symbol || symbol === sourceSymbol) continue
            html +=
              '<button type="button" class="icono-request-option" data-icono-candidate-copy-option="' +
              esc(symbol) +
              '">' +
              '<span class="icono-request-option-copy">' +
              '<span class="icono-request-option-title">' +
              esc(symbol) +
              "</span>" +
              "<span>" +
              esc(String(gene.full_name || symbol)) +
              "</span>" +
              "</span>" +
              "</button>"
          }
          results.innerHTML =
            html || '<div class="icono-request-results-empty">Only the source gene matched.</div>'
          results.hidden = false
        }

        function runCopySearch() {
          var query = String(input.value || "").trim()
          hidden.value = ""
          if (query.length < 2) {
            results.hidden = true
            results.innerHTML = ""
            return
          }
          fetchJSON(
            "/api/public/v1/genes/search?scope=catalog&limit=8&q=" + encodeURIComponent(query),
            { credentials: "include" },
          )
            .then(function (payload) {
              renderCopyResults(Array.isArray(payload && payload.genes) ? payload.genes : [])
            })
            .catch(function (error) {
              results.hidden = false
              results.innerHTML =
                '<div class="icono-request-results-empty">' +
                esc(String((error && error.message) || "Search failed")) +
                "</div>"
            })
        }

        input.addEventListener("input", function () {
          if (searchTimer) window.clearTimeout(searchTimer)
          searchTimer = window.setTimeout(runCopySearch, 180)
        })
        results.addEventListener("click", function (event) {
          var button = event.target.closest("[data-icono-candidate-copy-option]")
          if (!button) return
          var target = normalizedSymbol(
            button.getAttribute("data-icono-candidate-copy-option") || "",
          )
          if (!target) return
          hidden.value = target
          input.value = target
          results.hidden = true
          results.innerHTML = ""
        })
        form.addEventListener("submit", function (event) {
          event.preventDefault()
          var targetSymbol = normalizedSymbol(hidden.value || input.value || "")
          if (!targetSymbol) {
            setCopyStatus("Pick a target gene first.", "error")
            input.focus()
            return
          }
          var submit = form.querySelector('button[type="submit"]')
          // B-467: the submit button now has an inline icon plus a label span. Store the
          // original markup so the loading state ("Copying...") can be restored without
          // dropping the SVG and so we never lose the accessible label between submits.
          var submitOriginalHtml = submit ? submit.innerHTML : ""
          if (submit) {
            submit.disabled = true
            submit.innerHTML =
              ICONO_SEND_ICON + '<span class="icono-candidate-copy-submit-label">Copying...</span>'
          }
          setCopyStatus("", "")
          fetchJSON("/api/iconoplasm/candidates/copy", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              source_gene_symbol: sourceSymbol,
              target_gene_symbol: targetSymbol,
              asset_sha256: assetSha,
            }),
          })
            .then(function (payload) {
              var targetUrl = String((payload && payload.target_url) || "")
              var target = normalizedSymbol((payload && payload.target_gene_symbol) || targetSymbol)
              setCopyStatus("Copied to " + target + " and checkmarked.", "success")
              if (targetUrl && note) {
                note.innerHTML =
                  'Copied to <a href="' +
                  esc(targetUrl) +
                  '" data-icono-nav>' +
                  esc(target) +
                  "</a> and checkmarked."
              }
            })
            .catch(function (error) {
              var message = String((error && error.message) || "Could not copy candidate blot.")
              if (/log in|auth/i.test(message))
                message += " Use Discord Login first, then try again."
              setCopyStatus(message, "error")
            })
            .finally(function () {
              if (submit) {
                submit.disabled = false
                submit.innerHTML = submitOriginalHtml
              }
            })
        })
      })(forms[i])
    }
  }

  function geneRequestLaneLabel(item) {
    if (
      !item ||
      String(item.request_mode || "")
        .trim()
        .toLowerCase() !== "specific"
    ) {
      return "Random default"
    }
    return (
      String(item.requested_emulsion_label || "").trim() ||
      String(item.requested_vision_id || "").trim() ||
      "Specific emulsion"
    )
  }

  function renderGeneRequestSummaryMarkup(title, rows, countField) {
    var safeRows = Array.isArray(rows) ? rows : []
    if (!safeRows.length) return ""
    var html =
      '<div class="icono-gene-request-summary">' +
      '<div class="icono-home-auth-kicker">' +
      esc(title) +
      "</div>" +
      '<ul style="margin:8px 0 0;padding-left:18px;display:grid;gap:6px;">'
    for (var i = 0; i < safeRows.length; i++) {
      var item = safeRows[i] || {}
      var count = Number(item[countField] || 0) || 0
      html +=
        "<li>" +
        esc(geneRequestLaneLabel(item)) +
        " - " +
        esc(String(count)) +
        " request" +
        (count === 1 ? "" : "s") +
        "</li>"
    }
    html += "</ul></div>"
    return html
  }

  function requestOptionPrimaryLabel(option) {
    var item = option || {}
    return (
      String(item.primary_label || "").trim() ||
      String(item.label || "").trim() ||
      String(item.emulsion_id || "").trim() ||
      String(item.artist_tag || "").trim() ||
      String(item.artist_name || "").trim() ||
      String(item.vision_id || "").trim() ||
      "Specific emulsion"
    )
  }

  function requestOptionSecondaryLabel(option) {
    var item = option || {}
    return (
      String(item.secondary_label || "").trim() ||
      [item.artist_tag, item.artist_name, item.vision_id]
        .map(function (value) {
          return String(value || "").trim()
        })
        .filter(Boolean)
        .join(" · ")
    )
  }

  function rawRequestOptionPreviewUrl(asset) {
    var item = asset || {}
    return String(item.medium_url || item.thumb_url || "").trim()
  }

  function requestOptionPreviewUrl(asset) {
    return portraitDelivery.resolve(rawRequestOptionPreviewUrl(asset))
  }

  function renderRequestOptionPreviewStripMarkup(option) {
    var previews = Array.isArray(option && option.preview_assets) ? option.preview_assets : []
    if (!previews.length) {
      if (option && option.is_preallocated_without_preview) {
        return '<span class="icono-request-option-strip icono-request-option-strip--empty"><span class="icono-request-option-empty">First blot</span></span>'
      }
      return ""
    }
    var html = '<span class="icono-request-option-strip">'
    for (var i = 0; i < previews.length && i < 5; i++) {
      var asset = previews[i] || {}
      var url = requestOptionPreviewUrl(asset)
      if (!url) continue
      html +=
        '<span class="icono-request-option-thumb' +
        (asset.is_current ? " is-current" : "") +
        '">' +
        '<img class="icono-thumbnail-viewport-image" src="' +
        esc(url) +
        '" alt="' +
        esc(String(asset.gene_symbol || "Example") + " example blot") +
        '" loading="lazy" decoding="async">' +
        "</span>"
    }
    html += "</span>"
    return html
  }

  function renderRequestOptionButtonMarkup(
    option,
    selectedVisionState,
    isRandom,
    optionAttribute,
    favoriteEnabled,
  ) {
    var item = option || {}
    var attributeName = String(optionAttribute || "data-icono-request-option").trim()
    var optionValue = isRandom
      ? ""
      : String(
          String(item.option_type || "") === "user_emulsion"
            ? item.user_emulsion_id || item.emulsion_id || ""
            : item.vision_id || "",
        ).trim()
    var isSelected =
      selectedVisionState instanceof Set
        ? selectedVisionState.has(optionValue)
        : String(selectedVisionState || "").trim() === optionValue
    var primary = isRandom ? "Random emulsion" : requestOptionPrimaryLabel(item)
    var optionId =
      "icono-request-option-" +
      String(optionValue || "random")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
    var selectButton =
      '<button type="button" class="icono-request-option' +
      (isSelected ? " is-selected" : "") +
      (isRandom ? " is-random" : "") +
      '" id="' +
      optionId +
      '"' +
      (favoriteEnabled ? "" : ' role="option"') +
      (favoriteEnabled ? ' aria-pressed="' : ' aria-selected="') +
      (isSelected ? "true" : "false") +
      '" ' +
      esc(attributeName) +
      '="' +
      esc(optionValue) +
      '">' +
      '<span class="icono-request-option-copy">' +
      '<span class="icono-request-option-title-row">' +
      '<span class="icono-request-option-title">' +
      esc(primary) +
      "</span>" +
      '<span class="icono-request-option-selected-mark" aria-hidden="true">✓</span>' +
      "</span>" +
      "</span>" +
      renderRequestOptionPreviewStripMarkup(item) +
      "</button>"
    if (!favoriteEnabled) return selectButton
    return (
      '<div class="icono-request-option-row' +
      (isRandom ? " is-random" : "") +
      '" role="listitem">' +
      selectButton +
      (isRandom || item.is_preallocated_without_preview
        ? ""
        : renderEmulsionFavoriteButtonMarkup(
            item.emulsion_family_id || item.emulsion_id,
            "icono-emulsion-favorite-button--picker",
          )) +
      "</div>"
    )
  }

  function renderRequestDiagnosticsMarkup(diagnostics) {
    var payload = diagnostics || {}
    var requestOptions = payload.request_options || {}
    var sample = Array.isArray(requestOptions.sample) ? requestOptions.sample : []
    var html =
      '<details class="icono-request-diagnostics">' +
      "<summary>Admin diagnostics</summary>" +
      '<div class="icono-request-diagnostics-body">' +
      '<div class="icono-request-diagnostics-grid">' +
      '<div><span class="icono-request-diagnostics-label">Gene</span><strong>' +
      esc(String(payload.gene_symbol || "").trim() || "Unknown") +
      "</strong></div>" +
      '<div><span class="icono-request-diagnostics-label">Open requests</span><strong>' +
      esc(String(Number(payload.open_request_count || 0) || 0)) +
      "</strong></div>" +
      '<div><span class="icono-request-diagnostics-label">Request lanes</span><strong>' +
      esc(String(Number(payload.lane_count || 0) || 0)) +
      "</strong></div>" +
      '<div><span class="icono-request-diagnostics-label">Option hydration</span><strong>' +
      esc(requestOptions.ok ? "OK" : String(requestOptions.error || "Failed")) +
      "</strong></div>" +
      "</div>"
    if (sample.length) {
      html +=
        '<div class="icono-request-diagnostics-sample"><div class="icono-request-diagnostics-label">Sample options</div><ul>'
      for (var i = 0; i < sample.length; i++) {
        var row = sample[i] || {}
        html +=
          "<li><strong>" +
          esc(String(row.label || row.vision_id || "Unknown")) +
          "</strong>" +
          (row.secondary_label
            ? "<span> · " + esc(String(row.secondary_label || "")) + "</span>"
            : "") +
          "<span> · " +
          esc(String(Number(row.preview_count || 0) || 0)) +
          " previews</span></li>"
      }
      html += "</ul></div>"
    }
    html += "</div></details>"
    return html
  }

  function loadGeneRequestDiagnostics(symbol) {
    return fetchJSON(
      "/api/iconoplasm/admin/requests/gene/" + encodeURIComponent(symbol) + "/diagnostics",
      {
        credentials: "include",
      },
    )
  }

  function renderRequestFormMarkup(symbol, options) {
    var config = options || {}
    var disabledAttr = config.disabled ? ' disabled aria-disabled="true"' : ""
    // Public visitors should see "style", not the internal "emulsion" workflow term.
    var placeholder = String(config.placeholder || "pick an emulsion").trim() || "pick an emulsion"
    return (
      '<form id="icono-request-form-' +
      esc(symbol) +
      '" data-icono-request-form class="icono-request-form">' +
      '<div class="icono-search icono-search--toolbar icono-request-search">' +
      '<div class="icono-search-wrapper icono-request-picker-search" data-icono-request-picker>' +
      '<input id="icono-request-query-' +
      esc(symbol) +
      '" data-icono-request-query class="icono-search-input icono-request-picker-input" type="search" autocomplete="off" placeholder="' +
      esc(placeholder) +
      '" role="searchbox" aria-expanded="false" aria-controls="icono-request-results-' +
      esc(symbol) +
      // Aria-label was "Search emulsion lane" — internal workflow jargon that
      // confuses screen-reader users. Mirror the placeholder copy instead.
      '" aria-label="Search styles for new candidate"' +
      disabledAttr +
      ">" +
      '<input type="hidden" data-icono-request-vision value="">' +
      '<div class="icono-search-results icono-request-results" id="icono-request-results-' +
      esc(symbol) +
      '" role="list" aria-label="Emulsions" data-icono-request-results hidden></div>' +
      "</div>" +
      "</div>" +
      "</form>"
    )
  }

  function renderRequestDirectGenerationMarkup() {
    return (
      '<div class="icono-request-direct-panel" data-icono-request-direct-panel>' +
      '<div class="icono-request-direct-result" data-icono-request-direct-result data-empty="true">' +
      '<div class="icono-request-direct-result-placeholder" data-icono-request-direct-result-placeholder>' +
      "<span>No candidate yet</span>" +
      "</div>" +
      '<img data-icono-request-direct-image alt="Generated candidate blot" loading="eager" hidden>' +
      "</div>" +
      '<div class="icono-request-direct-controls">' +
      '<div class="icono-request-direct-provider-row">' +
      '<label class="icono-request-provider-field"><span>Provider</span><select class="icono-request-provider-select" data-icono-request-provider></select></label>' +
      "</div>" +
      '<div class="icono-search-wrapper icono-request-picker-search icono-request-direct-emulsion-picker" data-icono-request-direct-emulsion-picker>' +
      '<input data-icono-request-direct-emulsion-query class="icono-search-input icono-request-picker-input" type="text" autocomplete="off" placeholder="use my emulsion" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="icono-request-direct-emulsion-results">' +
      '<div class="icono-search-results icono-request-results icono-request-direct-emulsion-results" id="icono-request-direct-emulsion-results" role="listbox" data-icono-request-direct-emulsion-results hidden></div>' +
      "</div>" +
      '<p class="icono-request-direct-status" data-icono-request-direct-status hidden></p>' +
      '<div class="icono-request-direct-preview" data-icono-request-direct-preview>' +
      '<div class="icono-request-direct-preview-row"><span>Sample</span><strong data-icono-request-subject-source>Loading sample</strong></div>' +
      "</div>" +
      "</div>" +
      "</div>"
    )
  }

  function renderRequestShellMarkup(symbol) {
    var safeSymbol = normalizedSymbol(symbol)
    return (
      '<div class="icono-request-shell">' +
      '<div class="icono-request-actions">' +
      '<div class="icono-request-tabs" role="tablist" aria-label="Generation method">' +
      '<button type="button" class="icono-request-tab" id="icono-request-tab-free-' +
      esc(safeSymbol) +
      '" role="tab" aria-selected="true" aria-controls="icono-request-panel-free-' +
      esc(safeSymbol) +
      '" data-icono-request-tab="free">Free queue</button>' +
      '<button type="button" class="icono-request-tab" id="icono-request-tab-api-' +
      esc(safeSymbol) +
      '" role="tab" aria-selected="false" tabindex="-1" aria-controls="icono-request-panel-api-' +
      esc(safeSymbol) +
      '" data-icono-request-tab="api">Image API</button>' +
      "</div>" +
      '<div class="icono-request-lanes">' +
      '<section class="icono-request-lane icono-request-lane--queue" id="icono-request-panel-free-' +
      esc(safeSymbol) +
      '" role="tabpanel" aria-labelledby="icono-request-tab-free-' +
      esc(safeSymbol) +
      '" data-icono-request-lane="free">' +
      renderRequestFormMarkup(symbol) +
      "</section>" +
      '<section class="icono-request-lane icono-request-lane--api" id="icono-request-panel-api-' +
      esc(safeSymbol) +
      '" role="tabpanel" aria-labelledby="icono-request-tab-api-' +
      esc(safeSymbol) +
      '" data-icono-request-lane="api" hidden>' +
      renderRequestDirectGenerationMarkup() +
      "</section>" +
      "</div>" +
      "<div data-icono-request-my-summary hidden></div>" +
      "<div data-icono-request-gene-summary hidden></div>" +
      '<div data-icono-request-note hidden style="font-size:0.92rem;"></div>' +
      "</div>" +
      "</div>"
    )
  }

  function renderRequestDialogTriggerMarkup(symbol) {
    var safeSymbol = normalizedSymbol(symbol)
    var dialogId = "icono-request-dialog-" + safeSymbol
    return (
      '<button type="button" class="icono-canonical-new-candidate-btn" data-icono-request-dialog-open aria-haspopup="dialog" aria-controls="' +
      esc(dialogId) +
      '">' +
      ICONO_PLUS_ICON +
      "<span>New candidate</span>" +
      "</button>"
    )
  }

  function renderRequestDialogMarkup(symbol) {
    var safeSymbol = normalizedSymbol(symbol)
    var dialogId = "icono-request-dialog-" + safeSymbol
    return (
      '<sl-dialog class="icono-standard-dialog icono-request-dialog" id="' +
      esc(dialogId) +
      '" data-icono-request-dialog label="New candidate for ' +
      esc(safeSymbol) +
      '">' +
      '<div class="icono-request-dialog-shell" data-icono-request-body>' +
      renderRequestShellMarkup(safeSymbol) +
      "</div>" +
      '<div class="icono-request-footer" slot="footer">' +
      '<div class="icono-request-free-actions" data-icono-request-free-footer>' +
      '<button type="button" class="icono-request-select-all-favorites" data-icono-request-select-all-favorites hidden>Select all 0 favorites</button>' +
      '<button type="submit" form="icono-request-form-' +
      esc(safeSymbol) +
      '" class="icono-request-free-submit" data-icono-request-free-submit data-default-label="Queue random">Queue random</button>' +
      "</div>" +
      '<div class="icono-request-direct-actions" data-icono-request-direct-footer hidden>' +
      '<button type="button" class="icono-request-direct-generate" data-icono-request-image-generate disabled>Generate candidate</button>' +
      '<button type="button" class="icono-request-direct-publish" data-icono-request-image-publish hidden disabled>Publish candidate</button>' +
      "</div>" +
      "</div>" +
      "</sl-dialog>"
    )
  }

  function renderCanonicalToolbarMarkup(genePayload) {
    var g = genePayload || {}
    return (
      '<section class="icono-canonical-toolbar-shell" data-icono-request-panel="' +
      esc(g.symbol) +
      '">' +
      '<div class="icono-gene-toolbar-rail" data-icono-canonical-rail>' +
      renderEditImageActionMarkup("canonical", g, (g && g.portrait) || {}) +
      '<section class="icono-gene-request-surface icono-gene-request-panel">' +
      renderCanonicalToolbarMetaMarkup(g) +
      '<div class="icono-canonical-toolbar-actions">' +
      renderCaretakerIdentityMarkup(g.caretaker, "icono-caretaker-identity--toolbar") +
      "<span data-icono-caretaker-claim-action></span>" +
      renderRequestDialogTriggerMarkup(g.symbol) +
      "</div>" +
      "</section>" +
      "</div>" +
      renderRequestDialogMarkup(g.symbol) +
      "</section>"
    )
  }

  function sourceVoteCount(item, key) {
    var value = Number((item && item[key]) || 0)
    return Number.isFinite(value) ? value : 0
  }

  function imageEditFirstTextValue() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i]
      if (Array.isArray(value) || (value && typeof value === "object")) continue
      var text = String(value == null ? "" : value).trim()
      if (text) return text
    }
    return ""
  }

  function imageEditFirstNumberValue() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i]
      if (value == null || value === "") continue
      var number = Number(value)
      if (Number.isFinite(number)) return number
    }
    return null
  }

  function imageEditFirstHexValue() {
    for (var i = 0; i < arguments.length; i++) {
      var text = imageEditFirstTextValue(arguments[i])
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase()
    }
    return ""
  }

  function imageEditFirstTextListValue() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i]
      if (value && typeof value === "object" && !Array.isArray(value)) continue
      var parts = Array.isArray(value) ? value : String(value || "").split(/[,+]/)
      var list = parts
        .map(function (part) {
          return String(part || "").trim()
        })
        .filter(Boolean)
        .slice(0, 8)
      if (list.length) return list
    }
    return []
  }

  function imageEditSourceAdjustmentContext(genePayload, item) {
    var gene = genePayload || {}
    var sourceItem = item || {}
    var essence = gene && gene.essence && typeof gene.essence === "object" ? gene.essence : {}
    var ageYears = imageEditFirstNumberValue(
      sourceItem.age_years,
      sourceItem.ageYears,
      essence.age_years,
      gene.age_years,
    )
    var massKg = imageEditFirstNumberValue(
      sourceItem.mass_kg,
      sourceItem.massKg,
      sourceItem.weight_kg,
      essence.weight_kg,
      gene.weight_kg,
    )
    var fashionStyles = imageEditFirstTextListValue(
      sourceItem.fashion_styles,
      sourceItem.fashionStyles,
      sourceItem.aesthetics,
      essence.fashion_styles,
      essence.fashionStyles,
      essence.aesthetics,
      gene.fashion_styles,
      gene.aesthetics,
    )
    var context = {
      sex: imageEditFirstTextValue(sourceItem.sex, essence.sex, gene.sex),
      surface_tone_hex: imageEditFirstHexValue(
        sourceItem.surface_tone_hex,
        sourceItem.surfaceToneHex,
        sourceItem.skin_hex,
        essence.surface_tone_hex,
        essence.skin_hex,
        gene.skin_hex,
      ),
      surface_tone_name: imageEditFirstTextValue(
        sourceItem.surface_tone_name,
        sourceItem.skin_name,
        essence.skin_name,
        gene.skin_name,
      ),
      fantastical_feature: imageEditFirstTextValue(
        sourceItem.fantastical_feature,
        sourceItem.fantasticalFeature,
        sourceItem.feature_name,
        sourceItem.family_feature,
        essence.family_feature,
        gene.family_feature,
      ),
    }
    if (ageYears != null) context.age_years = ageYears
    if (massKg != null) context.mass_kg = massKg
    if (fashionStyles.length) context.fashion_styles = fashionStyles
    return context
  }

  function imageEditSourceAdjustmentContextAttr(genePayload, item) {
    return (
      ' data-icono-source-adjustments="' +
      esc(JSON.stringify(imageEditSourceAdjustmentContext(genePayload, item))) +
      '"'
    )
  }

  function renderEditImageActionMarkup(source, genePayload, item) {
    var symbol = normalizedSymbol(genePayload && genePayload.symbol)
    var sourceItem = item || {}
    var assetSha = String((sourceItem && sourceItem.asset_sha256) || "")
      .trim()
      .toLowerCase()
    var imageUrl =
      source === "candidate"
        ? candidatePortraitUrl(sourceItem, "medium")
        : publishedPortraitUrl(genePayload, "medium")
    if (!imageUrl && source === "candidate") imageUrl = candidatePortraitUrl(sourceItem, "full")
    if (!imageUrl && source !== "candidate") imageUrl = publishedPortraitUrl(genePayload, "full")
    if (!symbol || !assetSha) return ""
    var candidateImageId = Number((sourceItem && sourceItem.candidate_image_id) || 0)
    var visionId = String((sourceItem && sourceItem.vision_id) || "").trim()
    var sourceWidth = Number((sourceItem && sourceItem.width) || 0)
    var sourceHeight = Number((sourceItem && sourceItem.height) || 0)
    var label = source === "candidate" ? "Edit candidate blot" : "Edit blot"
    return (
      '<section class="icono-gene-request-surface icono-gene-edit-panel">' +
      '<button type="button" class="icono-candidate-action-btn icono-canonical-edit-btn icono-image-edit-open" data-icono-edit-source="' +
      esc(source) +
      '" data-icono-source-symbol="' +
      esc(symbol) +
      '" data-icono-source-asset-sha256="' +
      esc(assetSha) +
      '" data-icono-source-image-url="' +
      esc(imageUrl || "") +
      '" data-icono-source-candidate-image-id="' +
      esc(candidateImageId > 0 ? String(Math.round(candidateImageId)) : "") +
      '" data-icono-source-vision-id="' +
      esc(visionId) +
      '" data-icono-source-width="' +
      esc(sourceWidth > 0 ? String(Math.round(sourceWidth)) : "") +
      '" data-icono-source-height="' +
      esc(sourceHeight > 0 ? String(Math.round(sourceHeight)) : "") +
      '" data-icono-source-upvotes="' +
      esc(String(sourceVoteCount(sourceItem, "image_upvotes"))) +
      '" data-icono-source-downvotes="' +
      esc(String(sourceVoteCount(sourceItem, "image_downvotes"))) +
      '" data-icono-source-score="' +
      esc(String(sourceVoteCount(sourceItem, "image_score"))) +
      '"' +
      imageEditSourceAdjustmentContextAttr(genePayload, sourceItem) +
      ' aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '">' +
      ICONO_EDIT_ICON +
      '<span class="icono-visually-hidden">' +
      esc(label) +
      "</span>" +
      "</button>" +
      "</section>"
    )
  }

  var imageEditDialogState = {
    dialog: null,
    source: null,
    providers: [],
    supportedProviders: [],
    lastUsed: null,
    job: null,
    loading: false,
    encryptionConfigured: false,
  }

  function renderImageEditDialogMarkup() {
    return (
      '<sl-dialog class="icono-image-edit-dialog" data-icono-image-edit-dialog label="Edit blot">' +
      '<div class="icono-image-edit-shell">' +
      '<div class="icono-image-edit-body">' +
      '<section class="icono-image-edit-preview">' +
      '<div class="icono-image-edit-artboard" data-icono-image-edit-source-viewer><img data-icono-image-edit-source-img alt="Source blot" loading="eager"></div>' +
      '<div class="icono-image-edit-before-after" data-icono-image-edit-result hidden>' +
      '<div class="icono-image-edit-comparison-labels" aria-hidden="true"><span>Before</span><span>After</span></div>' +
      '<img-comparison-slider class="icono-image-edit-comparison" data-icono-image-edit-comparison tabindex="0">' +
      '<img slot="first" data-icono-image-edit-before alt="Before edit">' +
      '<img slot="second" data-icono-image-edit-after alt="After edit">' +
      "</img-comparison-slider>" +
      "</div>" +
      "</section>" +
      '<section class="icono-image-edit-controls">' +
      '<sl-select label="Editing API" hoist data-icono-image-edit-provider></sl-select>' +
      '<p data-icono-image-edit-status class="icono-image-edit-status" role="status" hidden></p>' +
      '<section class="icono-image-edit-adjustments" aria-label="Adjustments">' +
      '<div class="icono-image-edit-adjustment-row icono-image-edit-adjustment-row--solo" data-icono-image-edit-adjustment-row="remove_ai_generation_errors"><sl-checkbox data-icono-image-edit-adjustment="remove_ai_generation_errors">Remove visible AI errors</sl-checkbox><span class="icono-image-edit-adjustment-value" data-icono-image-edit-adjustment-value="remove_ai_generation_errors">Uses the source blot only</span></div>' +
      '<div class="icono-image-edit-adjustment-row" data-icono-image-edit-adjustment-row="sex"><sl-checkbox data-icono-image-edit-adjustment="sex">Sex</sl-checkbox><span class="icono-image-edit-adjustment-value" data-icono-image-edit-adjustment-value="sex"></span></div>' +
      '<div class="icono-image-edit-adjustment-row" data-icono-image-edit-adjustment-row="age_years"><sl-checkbox data-icono-image-edit-adjustment="age_years">Age</sl-checkbox><span class="icono-image-edit-adjustment-value" data-icono-image-edit-adjustment-value="age_years"></span></div>' +
      '<div class="icono-image-edit-adjustment-row" data-icono-image-edit-adjustment-row="mass_kg"><sl-checkbox data-icono-image-edit-adjustment="mass_kg">Mass</sl-checkbox><span class="icono-image-edit-adjustment-value" data-icono-image-edit-adjustment-value="mass_kg"></span></div>' +
      '<div class="icono-image-edit-adjustment-row" data-icono-image-edit-adjustment-row="surface_tone_hex"><sl-checkbox data-icono-image-edit-adjustment="surface_tone_hex">Surface tone</sl-checkbox><span class="icono-image-edit-adjustment-value icono-image-edit-adjustment-value--tone" data-icono-image-edit-adjustment-value="surface_tone_hex"></span></div>' +
      '<div class="icono-image-edit-adjustment-row" data-icono-image-edit-adjustment-row="fantastical_feature"><sl-checkbox data-icono-image-edit-adjustment="fantastical_feature">Feature</sl-checkbox><span class="icono-image-edit-adjustment-value" data-icono-image-edit-adjustment-value="fantastical_feature"></span></div>' +
      '<div class="icono-image-edit-adjustment-row" data-icono-image-edit-adjustment-row="fashion_styles"><sl-checkbox data-icono-image-edit-adjustment="fashion_styles">Style mix</sl-checkbox><span class="icono-image-edit-adjustment-value" data-icono-image-edit-adjustment-value="fashion_styles"></span></div>' +
      "</section>" +
      "</section>" +
      "</div>" +
      "</div>" +
      '<div slot="footer" class="icono-image-edit-actions">' +
      '<button type="button" class="icono-image-edit-action-button icono-image-edit-action-button--primary" data-icono-image-edit-submit disabled>Edit</button>' +
      '<button type="button" class="icono-image-edit-action-button" data-icono-image-edit-publish hidden disabled>Publish</button>' +
      "</div>" +
      "</sl-dialog>"
    )
  }

  function ensureImageEditDialog() {
    if (imageEditDialogState.dialog && document.body.contains(imageEditDialogState.dialog)) {
      return imageEditDialogState.dialog
    }
    var wrapper = document.createElement("div")
    wrapper.innerHTML = renderImageEditDialogMarkup()
    var dialog = wrapper.firstElementChild
    document.body.appendChild(dialog)
    imageEditDialogState.dialog = dialog
    wireImageEditDialog(dialog)
    return dialog
  }

  function imageEditSetStatus(message, tone) {
    var dialog = ensureImageEditDialog()
    var status = dialog.querySelector("[data-icono-image-edit-status]")
    if (!status) return
    status.textContent = String(message || "").trim()
    status.hidden = !status.textContent
    status.dataset.tone = tone || ""
    status.setAttribute("role", tone === "error" ? "alert" : "status")
  }

  function imageEditSelectedProvider() {
    var dialog = ensureImageEditDialog()
    var select = dialog.querySelector("[data-icono-image-edit-provider]")
    return String((select && select.value) || "").trim()
  }

  function imageEditHasAdjustment() {
    var dialog = ensureImageEditDialog()
    var options = dialog.querySelectorAll("[data-icono-image-edit-adjustment]")
    for (var i = 0; i < options.length; i++) {
      if (options[i].checked && !options[i].disabled) return true
    }
    return false
  }

  function updateImageEditButtons() {
    var dialog = ensureImageEditDialog()
    var editButton = dialog.querySelector("[data-icono-image-edit-submit]")
    var publishButton = dialog.querySelector("[data-icono-image-edit-publish]")
    if (editButton) {
      editButton.disabled =
        imageEditDialogState.loading ||
        !imageEditDialogState.encryptionConfigured ||
        !imageEditSelectedProvider() ||
        !imageEditHasAdjustment()
      editButton.textContent = imageEditDialogState.loading ? "Editing..." : "Edit"
    }
    if (publishButton) {
      var shouldShowPublish =
        imageEditDialogState.job &&
        imageEditDialogState.job.status === "succeeded" &&
        !imageEditDialogState.job.published
      publishButton.hidden = !shouldShowPublish
      publishButton.disabled =
        imageEditDialogState.loading ||
        !imageEditDialogState.job ||
        imageEditDialogState.job.status !== "succeeded" ||
        imageEditDialogState.job.published
      publishButton.textContent = imageEditDialogState.loading ? "Publishing..." : "Publish"
    }
  }

  function renderImageEditProviders() {
    var dialog = ensureImageEditDialog()
    var select = dialog.querySelector("[data-icono-image-edit-provider]")
    if (!select) return
    var providers = imageEditDialogState.providers || []
    var supported = imageEditDialogState.supportedProviders || []
    var configured = {}
    providers.forEach(function (p) {
      configured[p.provider_id] = p
    })
    // Prefer the explicit last_used selection from the API. Fall back to any
    // model_options last_used flag for older payloads.
    var lastUsedSelection = imageEditDialogState.lastUsed || null
    var lastUsedValue = ""
    if (lastUsedSelection && lastUsedSelection.provider_id && lastUsedSelection.model) {
      lastUsedValue = lastUsedSelection.provider_id + ":" + lastUsedSelection.model
    }
    var options = []
    supported.forEach(function (sp) {
      if (!configured[sp.provider_id]) return
      ;(sp.model_options || []).forEach(function (m) {
        var value = sp.provider_id + ":" + m.model
        var label = sp.label + " · " + m.label
        if (!lastUsedValue && m.last_used) lastUsedValue = value
        options.push({
          value: value,
          label: label,
          lastUsed: false,
        })
      })
    })
    // Stable alphanumeric order. Last-used is a label/preselect only — never
    // rearrange the list, which made the menu feel jumpy and error-prone.
    options.sort(function (a, b) {
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true })
    })
    if (lastUsedValue) {
      options.forEach(function (opt) {
        if (opt.value === lastUsedValue) {
          opt.lastUsed = true
          opt.label = opt.label + " · last used"
        }
      })
    }
    var selectedValue = lastUsedValue || (options.length ? options[0].value : "")
    // If the remembered selection is no longer available, fall back to the
    // first sorted option instead of leaving a stale value.
    if (
      selectedValue &&
      !options.some(function (opt) {
        return opt.value === selectedValue
      })
    ) {
      selectedValue = options.length ? options[0].value : ""
    }
    select.innerHTML = options.length
      ? options
          .map(function (opt) {
            return '<sl-option value="' + esc(opt.value) + '">' + esc(opt.label) + "</sl-option>"
          })
          .join("")
      : '<sl-option value="">No saved image editing provider</sl-option>'
    select.disabled = !options.length
    if (!imageEditDialogState.encryptionConfigured) select.disabled = true
    setImageEditProviderValue(select, selectedValue)
    updateImageEditButtons()
  }

  function setImageEditProviderValue(select, providerId) {
    if (!select) return
    var selectedProviderId = String(providerId || "")
    select.value = selectedProviderId
    var afterUpgrade =
      typeof customElements !== "undefined" && customElements.whenDefined
        ? Promise.all([
            customElements.whenDefined("sl-select"),
            customElements.whenDefined("sl-option"),
          ])
        : Promise.resolve()
    afterUpgrade.then(function () {
      select.value = selectedProviderId
      if (select.updateComplete && typeof select.updateComplete.then === "function") {
        select.updateComplete.then(function () {
          select.value = selectedProviderId
          updateImageEditButtons()
        })
        return
      }
      updateImageEditButtons()
    })
  }

  function loadImageEditProviders() {
    imageEditSetStatus("Loading providers...", "")
    return fetchImageEditProviders({ op: "image_edit" })
      .then(function (payload) {
        imageEditDialogState.providers = Array.isArray(payload && payload.providers)
          ? payload.providers
          : []
        imageEditDialogState.supportedProviders = Array.isArray(
          payload && payload.supported_providers,
        )
          ? payload.supported_providers
          : []
        imageEditDialogState.lastUsed =
          payload && payload.last_used && typeof payload.last_used === "object"
            ? payload.last_used
            : null
        imageEditDialogState.encryptionConfigured = Boolean(
          payload && payload.encryption_configured,
        )
        imageEditSetStatus(
          !imageEditDialogState.encryptionConfigured
            ? "Image editing provider storage is not configured."
            : imageEditDialogState.providers.length
              ? ""
              : "Set up a saved image editing provider before editing blots.",
          imageEditDialogState.encryptionConfigured && imageEditDialogState.providers.length
            ? ""
            : "warn",
        )
        renderImageEditProviders()
      })
      .catch(function (error) {
        imageEditDialogState.providers = []
        imageEditDialogState.encryptionConfigured = false
        renderImageEditProviders()
        imageEditSetStatus(String((error && error.message) || "Could not load providers."), "error")
      })
  }

  function collectImageEditAdjustments() {
    var dialog = ensureImageEditDialog()
    var context = (imageEditDialogState.source && imageEditDialogState.source.adjustments) || {}
    function checked(kind) {
      var el = dialog.querySelector('[data-icono-image-edit-adjustment="' + kind + '"]')
      return Boolean(el && el.checked && !el.disabled)
    }
    var adjustments = {}
    if (checked("remove_ai_generation_errors")) adjustments.remove_ai_generation_errors = true
    if (checked("sex")) adjustments.sex = imageEditFirstTextValue(context.sex)
    if (checked("age_years")) adjustments.age_years = Number(context.age_years)
    if (checked("mass_kg")) adjustments.mass_kg = Number(context.mass_kg)
    if (checked("surface_tone_hex"))
      adjustments.surface_tone_hex = imageEditFirstHexValue(context.surface_tone_hex)
    if (checked("fantastical_feature"))
      adjustments.fantastical_feature =
        imageEditFirstTextValue(context.fantastical_feature) ||
        "remove all fantastical features, restore human anatomy"
    if (checked("fashion_styles")) {
      adjustments.fashion_styles = imageEditFirstTextListValue(context.fashion_styles)
    }
    return adjustments
  }

  function imageEditContextValue(kind, context) {
    var source = context || {}
    if (kind === "sex") return imageEditFirstTextValue(source.sex)
    if (kind === "age_years") return imageEditFirstNumberValue(source.age_years)
    if (kind === "mass_kg") return imageEditFirstNumberValue(source.mass_kg)
    if (kind === "surface_tone_hex") return imageEditFirstHexValue(source.surface_tone_hex)
    if (kind === "fantastical_feature") return imageEditFirstTextValue(source.fantastical_feature)
    if (kind === "fashion_styles") return imageEditFirstTextListValue(source.fashion_styles)
    return true
  }

  function imageEditContextValueAvailable(kind, value) {
    if (kind === "remove_ai_generation_errors") return true
    if (kind === "fantastical_feature") return true
    if (kind === "age_years") return value != null && value >= 0 && value <= 140
    if (kind === "mass_kg") return value != null && value > 0
    if (kind === "fashion_styles") return Array.isArray(value) && value.length > 0
    return Boolean(value)
  }

  function imageEditContextValueLabel(kind, value, context) {
    if (kind === "remove_ai_generation_errors") return "Uses the source blot only"
    if (kind === "age_years") return String(value) + " years"
    if (kind === "mass_kg") return String(value) + " kg"
    if (kind === "surface_tone_hex") {
      var name = imageEditFirstTextValue(context && context.surface_tone_name)
      return name ? value + " · " + name : value
    }
    if (kind === "fantastical_feature") return value ? String(value) : "Remove fantastical features"
    if (kind === "fashion_styles") return value.join(" + ")
    return String(value || "")
  }

  function applyImageEditAspectRatio(dialog, source) {
    var width = Number(source && source.width)
    var height = Number(source && source.height)
    var ratio = width > 0 && height > 0 ? Math.round(width) + " / " + Math.round(height) : ""
    var targets = [
      dialog,
      dialog && dialog.querySelector("[data-icono-image-edit-source-viewer]"),
      dialog && dialog.querySelector("[data-icono-image-edit-result]"),
      dialog && dialog.querySelector("[data-icono-image-edit-comparison]"),
    ]
    targets.forEach(function (target) {
      if (!target || !target.style) return
      if (ratio) target.style.setProperty("--icono-image-edit-aspect-ratio", ratio)
      else target.style.removeProperty("--icono-image-edit-aspect-ratio")
    })
  }

  function renderImageEditContext(source) {
    var dialog = ensureImageEditDialog()
    var context = (source && source.adjustments) || {}
    var rows = dialog.querySelectorAll("[data-icono-image-edit-adjustment-row]")
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      var kind = row.getAttribute("data-icono-image-edit-adjustment-row") || ""
      var checkbox = row.querySelector("[data-icono-image-edit-adjustment]")
      var valueEl = row.querySelector("[data-icono-image-edit-adjustment-value]")
      var value = imageEditContextValue(kind, context)
      var available = imageEditContextValueAvailable(kind, value)
      if (checkbox) {
        checkbox.checked = false
        checkbox.disabled = !available
      }
      row.classList.toggle("icono-image-edit-adjustment-row--unavailable", !available)
      if (valueEl) {
        valueEl.textContent = available
          ? imageEditContextValueLabel(kind, value, context)
          : "Unavailable from gene data"
        if (kind === "surface_tone_hex") {
          valueEl.style.setProperty("--icono-context-color", available ? value : "transparent")
        }
      }
    }
    updateImageEditButtons()
  }

  function openImageEditDialog(source) {
    var dialog = ensureImageEditDialog()
    imageEditDialogState.source = source
    imageEditDialogState.job = null
    imageEditDialogState.loading = false
    var sourceImg = dialog.querySelector("[data-icono-image-edit-source-img]")
    var sourceViewer = dialog.querySelector("[data-icono-image-edit-source-viewer]")
    var result = dialog.querySelector("[data-icono-image-edit-result]")
    dialog.label = source.source === "candidate" ? "Edit candidate blot" : "Edit blot"
    if (sourceImg) {
      var syncNaturalRatio = function () {
        if (!source.width && sourceImg.naturalWidth > 0) source.width = sourceImg.naturalWidth
        if (!source.height && sourceImg.naturalHeight > 0) source.height = sourceImg.naturalHeight
        applyImageEditAspectRatio(dialog, source)
      }
      sourceImg.onload = syncNaturalRatio
      portraitDelivery.bind(sourceImg, source.image_url || "")
      sourceImg.alt = source.symbol + " " + source.source + " blot"
      if (sourceImg.complete) syncNaturalRatio()
    }
    applyImageEditAspectRatio(dialog, source)
    if (sourceViewer) sourceViewer.hidden = false
    if (result) result.hidden = true
    imageEditSetStatus("", "")
    renderImageEditContext(source)
    updateImageEditButtons()
    loadImageEditProviders()
    if (typeof dialog.show === "function") dialog.show()
    else dialog.setAttribute("open", "open")
  }

  function sourceFromEditButton(button) {
    var adjustments = {}
    try {
      var parsed = JSON.parse(button.getAttribute("data-icono-source-adjustments") || "{}")
      if (parsed && typeof parsed === "object") adjustments = parsed
    } catch (_err) {
      adjustments = {}
    }
    return {
      source: String(button.getAttribute("data-icono-edit-source") || "canonical"),
      symbol: normalizedSymbol(button.getAttribute("data-icono-source-symbol")),
      asset_sha256: String(button.getAttribute("data-icono-source-asset-sha256") || "")
        .trim()
        .toLowerCase(),
      image_url: String(button.getAttribute("data-icono-source-image-url") || "").trim(),
      candidate_image_id: String(button.getAttribute("data-icono-source-candidate-image-id") || ""),
      vision_id: String(button.getAttribute("data-icono-source-vision-id") || ""),
      width: Number(button.getAttribute("data-icono-source-width") || 0),
      height: Number(button.getAttribute("data-icono-source-height") || 0),
      adjustments: adjustments,
    }
  }

  function submitImageEdit() {
    var source = imageEditDialogState.source
    if (!source || !source.symbol || !source.asset_sha256) return
    var raw = imageEditSelectedProvider()
    var providerParts = raw.split(":")
    var providerId = providerParts[0] || raw
    var model = providerParts.slice(1).join(":") || ""
    var adjustments = collectImageEditAdjustments()
    var dialog = ensureImageEditDialog()
    var sourceViewer = dialog.querySelector("[data-icono-image-edit-source-viewer]")
    var result = dialog.querySelector("[data-icono-image-edit-result]")
    if (sourceViewer) sourceViewer.hidden = false
    if (result) result.hidden = true
    imageEditDialogState.loading = true
    imageEditDialogState.job = null
    updateImageEditButtons()
    imageEditSetStatus("Editing blot...", "")
    var body = {
      provider_id: providerId,
      source_gene_symbol: source.symbol,
      source_asset_sha256: source.asset_sha256,
      source_candidate_image_id: source.candidate_image_id || null,
      source_vision_id: source.vision_id || "",
      adjustments: adjustments,
    }
    if (model) body.model = model
    fetchAuthedJSON("/api/iconoplasm/image-edit/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    })
      .then(function (payload) {
        var job = payload && payload.job
        imageEditDialogState.job = job
        if (payload && payload.ok === false && payload.error) {
          // The route returned 502 with an error string in the body. Show
          // the error to the user. The Edit button is re-enabled so they
          // can retry.
          imageEditDialogState.loading = false
          imageEditSetStatus(String(payload.error), "error")
          updateImageEditButtons()
          return
        }
        imageEditDialogState.loading = false
        showImageEditResult(job, source)
        updateImageEditButtons()
      })
      .catch(function (error) {
        imageEditDialogState.loading = false
        imageEditSetStatus(String((error && error.message) || "Image edit failed."), "error")
        updateImageEditButtons()
      })
  }

  function showImageEditResult(job, source) {
    if (!job) {
      imageEditSetStatus("Image edit did not return a job.", "error")
      return
    }
    var dialog = ensureImageEditDialog()
    var sourceViewer = dialog.querySelector("[data-icono-image-edit-source-viewer]")
    var result = dialog.querySelector("[data-icono-image-edit-result]")
    var before = dialog.querySelector("[data-icono-image-edit-before]")
    var after = dialog.querySelector("[data-icono-image-edit-after]")
    if (before) portraitDelivery.bind(before, source.image_url || "")
    if (after) portraitDelivery.bind(after, portraitAssetRefUrl(job && job.result_asset, "medium"))
    applyImageEditAspectRatio(dialog, source)
    if (job.status === "failed") {
      imageEditSetStatus(String((job && job.error) || "Image edit failed."), "error")
      if (sourceViewer) sourceViewer.hidden = false
      if (result) result.hidden = true
      return
    }
    if (sourceViewer) sourceViewer.hidden = true
    if (result) result.hidden = false
    imageEditSetStatus("Edit ready to publish.", "success")
  }

  function closeImageEditDialog() {
    var dialog = imageEditDialogState.dialog
    if (!dialog || !document.body.contains(dialog)) return
    if (typeof dialog.hide === "function") dialog.hide()
    else dialog.removeAttribute("open")
  }

  function seedPublisherVoteSnapshotAfterImageEditPublish(payload) {
    // Publish writes a real upvote for the publisher. Seed the shared vote
    // localStorage key before the gene re-render so the candidate checkmark
    // lights immediately and the first click does not toggle that endorsement off.
    try {
      if (typeof localStorage === "undefined") return
      var symbol = normalizedSymbol(
        (payload && payload.job && payload.job.source_gene_symbol) ||
          (imageEditDialogState.source && imageEditDialogState.source.symbol) ||
          "",
      )
      var assetSha = normalizedAssetSha(
        (payload && payload.asset_sha256) ||
          (payload && payload.job && payload.job.result_asset_sha256) ||
          "",
      )
      if (!symbol || !assetSha) return
      var inherit = (payload && payload.vote_inheritance) || {}
      var upvotes = Math.max(
        1,
        Number(inherit.imported_votes || 0) ||
          Number(inherit.inherited_upvotes || 0) + (inherit.user_upvote ? 1 : 0) ||
          1,
      )
      var snapshot = {
        image_upvotes: upvotes,
        image_downvotes: 0,
        image_score: upvotes,
        user_vote: 1,
      }
      localStorage.setItem("iconoplasm.vote.a:" + symbol + "|" + assetSha, JSON.stringify(snapshot))
      // Vote projection is already queued by publish. The visible canonical
      // portrait advances only when the next exact card artifact is released;
      // do not hammer site detail while it correctly remains on that published
      // version. The caller rerenders once so the new candidate and vote state
      // are visible immediately.
    } catch (_error) {
      /* best-effort UI hydration */
    }
  }

  function publishImageEditJob() {
    var state = imageEditDialogState
    if (!state.job || !state.job.id) return
    state.loading = true
    updateImageEditButtons()
    imageEditSetStatus("Publishing candidate blot...", "")
    fetchAuthedJSON(
      "/api/iconoplasm/image-edit/jobs/" + encodeURIComponent(state.job.id) + "/publish",
      {
        method: "POST",
      },
    )
      .then(function (payload) {
        state.job = payload && payload.job ? payload.job : state.job
        state.loading = false
        updateImageEditButtons()
        seedPublisherVoteSnapshotAfterImageEditPublish(payload)
        var root = document.getElementById(ROOT_ID)
        if (root && state.source && state.source.symbol) {
          renderGene(root, state.source.symbol, { forceFresh: true })
        }
        // Publish finished: dismiss the modal so the refreshed candidate grid
        // is visible immediately. Failures keep the dialog open with the error.
        closeImageEditDialog()
      })
      .catch(function (error) {
        state.loading = false
        if (error && error.payload && error.payload.job) state.job = error.payload.job
        imageEditSetStatus(
          publishFailureMessage(error, "Could not publish edit.", "edited image"),
          "error",
        )
        updateImageEditButtons()
      })
  }

  function wireImageEditDialog(dialog) {
    dialog.addEventListener("change", function (event) {
      if (
        event.target &&
        (event.target.matches("[data-icono-image-edit-adjustment]") ||
          event.target.matches("[data-icono-image-edit-provider]"))
      ) {
        updateImageEditButtons()
      }
    })
    dialog.addEventListener("sl-change", function (event) {
      if (
        event.target &&
        (event.target.matches("[data-icono-image-edit-adjustment]") ||
          event.target.matches("[data-icono-image-edit-provider]"))
      ) {
        updateImageEditButtons()
      }
    })
    var edit = dialog.querySelector("[data-icono-image-edit-submit]")
    var publish = dialog.querySelector("[data-icono-image-edit-publish]")
    if (edit) edit.addEventListener("click", submitImageEdit)
    if (publish) publish.addEventListener("click", publishImageEditJob)
  }

  function imageEditSourceItemForButton(genePayload, button) {
    var source = String(button.getAttribute("data-icono-edit-source") || "").trim()
    if (source !== "candidate") return (genePayload && genePayload.portrait) || {}
    var candidates = Array.isArray(genePayload && genePayload.portrait_candidates)
      ? genePayload.portrait_candidates
      : []
    var assetSha = String(button.getAttribute("data-icono-source-asset-sha256") || "")
      .trim()
      .toLowerCase()
    var candidateImageId = Number(button.getAttribute("data-icono-source-candidate-image-id") || 0)
    var visionId = String(button.getAttribute("data-icono-source-vision-id") || "").trim()
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i] || {}
      if (
        assetSha &&
        String(candidate.asset_sha256 || "")
          .trim()
          .toLowerCase() === assetSha
      ) {
        return candidate
      }
      if (candidateImageId > 0 && Number(candidate.candidate_image_id || 0) === candidateImageId) {
        return candidate
      }
      if (visionId && String(candidate.vision_id || "").trim() === visionId) return candidate
    }
    return {}
  }

  function refreshGeneEditImageAdjustmentContext(container, genePayload) {
    if (!container || !genePayload) return
    var buttons = container.querySelectorAll("[data-icono-edit-source]")
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i]
      var sourceItem = imageEditSourceItemForButton(genePayload, button)
      button.setAttribute(
        "data-icono-source-adjustments",
        JSON.stringify(imageEditSourceAdjustmentContext(genePayload, sourceItem)),
      )
    }
  }

  function wireGeneEditImagePanel(container, genePayload) {
    if (!container) return
    refreshGeneEditImageAdjustmentContext(container, genePayload)
    var buttons = container.querySelectorAll("[data-icono-edit-source]")
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute("data-icono-edit-wired") === "true") continue
      buttons[i].setAttribute("data-icono-edit-wired", "true")
      buttons[i].addEventListener("click", function (event) {
        openImageEditDialog(sourceFromEditButton(event.currentTarget))
      })
    }
  }

  function wireGeneRequestPanel(container, genePayload) {
    if (!container || !genePayload) return
    var panel = container.querySelector("[data-icono-request-panel]")
    if (!panel) return
    var body = panel.querySelector("[data-icono-request-body]")
    if (!body) return
    var symbol = normalizedSymbol(genePayload.symbol)
    if (!symbol) return
    body.innerHTML = renderRequestShellMarkup(symbol)
    var dialog = panel.querySelector("[data-icono-request-dialog]")
    var dialogOpenButton = panel.querySelector("[data-icono-request-dialog-open]")
    var requestTabs = Array.from(body.querySelectorAll("[data-icono-request-tab]"))
    var requestLanes = Array.from(body.querySelectorAll("[data-icono-request-lane]"))
    var freeFooter = dialog ? dialog.querySelector("[data-icono-request-free-footer]") : null
    var directFooter = dialog ? dialog.querySelector("[data-icono-request-direct-footer]") : null
    var freeQueueAvailable = !!currentUser

    function savedRequestTab() {
      try {
        return localStorage.getItem(ICONO_REQUEST_TAB_STORAGE_KEY) === "api" ? "api" : "free"
      } catch (_error) {
        return "free"
      }
    }

    function activateRequestTab(tabName, options) {
      var nextTab = tabName === "api" ? "api" : "free"
      var config = options || {}
      for (var i = 0; i < requestTabs.length; i++) {
        var selected = requestTabs[i].getAttribute("data-icono-request-tab") === nextTab
        requestTabs[i].setAttribute("aria-selected", selected ? "true" : "false")
        requestTabs[i].tabIndex = selected ? 0 : -1
        if (selected && config.focus) requestTabs[i].focus()
      }
      for (var j = 0; j < requestLanes.length; j++) {
        requestLanes[j].hidden = requestLanes[j].getAttribute("data-icono-request-lane") !== nextTab
      }
      if (freeFooter) freeFooter.hidden = nextTab !== "free" || !freeQueueAvailable
      if (directFooter) directFooter.hidden = nextTab !== "api"
      if (config.persist) {
        try {
          localStorage.setItem(ICONO_REQUEST_TAB_STORAGE_KEY, nextTab)
        } catch (_error) {}
      }
      panel.dispatchEvent(
        new CustomEvent("icono-request-tab-activate", { detail: { tab: nextTab } }),
      )
    }

    for (var requestTabIndex = 0; requestTabIndex < requestTabs.length; requestTabIndex++) {
      requestTabs[requestTabIndex].addEventListener("click", function (event) {
        activateRequestTab(event.currentTarget.getAttribute("data-icono-request-tab"), {
          persist: true,
        })
      })
      requestTabs[requestTabIndex].addEventListener("keydown", function (event) {
        var currentIndex = requestTabs.indexOf(event.currentTarget)
        var nextIndex = currentIndex
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % requestTabs.length
        else if (event.key === "ArrowLeft")
          nextIndex = (currentIndex - 1 + requestTabs.length) % requestTabs.length
        else if (event.key === "Home") nextIndex = 0
        else if (event.key === "End") nextIndex = requestTabs.length - 1
        else return
        event.preventDefault()
        activateRequestTab(requestTabs[nextIndex].getAttribute("data-icono-request-tab"), {
          focus: true,
          persist: true,
        })
      })
    }

    function openRequestDialog() {
      if (!dialog) return
      activateRequestTab(savedRequestTab())
      if (typeof dialog.show === "function") dialog.show()
      else dialog.setAttribute("open", "open")
    }

    if (dialogOpenButton) {
      dialogOpenButton.addEventListener("click", openRequestDialog)
    }

    function setStatus(message, tone) {
      var note = body.querySelector("[data-icono-request-note]")
      if (!note) return
      note.textContent = String(message || "").trim()
      note.hidden = !note.textContent
      note.style.color = tone === "error" ? "#b42318" : tone === "success" ? "#0f766e" : "inherit"
    }

    function updateSummaryHosts(myLaneSummary, geneLaneSummary) {
      var mySummaryHost = body.querySelector("[data-icono-request-my-summary]")
      var geneSummaryHost = body.querySelector("[data-icono-request-gene-summary]")
      if (mySummaryHost) {
        var myHtml = renderGeneRequestSummaryMarkup(
          "Your open requests",
          myLaneSummary,
          "my_request_count",
        )
        mySummaryHost.innerHTML = myHtml
        mySummaryHost.hidden = !String(myHtml || "").trim()
      }
      if (geneSummaryHost) {
        var geneHtml = renderGeneRequestSummaryMarkup(
          "Open requests on this gene",
          geneLaneSummary,
          "request_count",
        )
        geneSummaryHost.innerHTML = geneHtml
        geneSummaryHost.hidden = !String(geneHtml || "").trim()
      }
    }

    function wireAuthenticatedRequestForm(summaryState) {
      var safeState = summaryState || {}
      var myLaneSummary = Array.isArray(safeState.my_lane_summary) ? safeState.my_lane_summary : []
      var geneLaneSummary = Array.isArray(safeState.gene_lane_summary)
        ? safeState.gene_lane_summary
        : []
      updateSummaryHosts(myLaneSummary, geneLaneSummary)

      var form = body.querySelector("[data-icono-request-form]")
      var hiddenInput = body.querySelector("[data-icono-request-vision]")
      var queryInput = body.querySelector("[data-icono-request-query]")
      var results = body.querySelector("[data-icono-request-results]")
      var picker = body.querySelector("[data-icono-request-picker]")
      if (!form || !hiddenInput || !queryInput || !results || !picker) return
      if (form._iconoRequestFormWired) return
      form._iconoRequestFormWired = true
      var directPanel = body.querySelector("[data-icono-request-direct-panel]")
      var queueSubmitButton = dialog
        ? dialog.querySelector("[data-icono-request-free-submit]")
        : null
      var selectAllFavoritesButton = dialog
        ? dialog.querySelector("[data-icono-request-select-all-favorites]")
        : null
      syncSelectAllFavoriteButtons(dialog || body)
      var providerSelect = body.querySelector("[data-icono-request-provider]")
      var directGenerateButton = dialog
        ? dialog.querySelector("[data-icono-request-image-generate]")
        : null
      var directPublishButton = dialog
        ? dialog.querySelector("[data-icono-request-image-publish]")
        : null
      var directResult = body.querySelector("[data-icono-request-direct-result]")
      var directImage = body.querySelector("[data-icono-request-direct-image]")
      var directStatus = body.querySelector("[data-icono-request-direct-status]")
      var directSubjectSource = body.querySelector("[data-icono-request-subject-source]")
      var directEmulsionPicker = body.querySelector("[data-icono-request-direct-emulsion-picker]")
      var directEmulsionQuery = body.querySelector("[data-icono-request-direct-emulsion-query]")
      var directEmulsionResults = body.querySelector("[data-icono-request-direct-emulsion-results]")
      var requestDirectState = {
        providers: [],
        supportedProviders: [],
        lastUsed: null,
        providerReady: false,
        loading: false,
        job: null,
        selectedUserEmulsion: null,
      }
      var requestOptions = []
      var requestOptionsByVisionId = Object.create(null)
      var requestOptionsByQuery = Object.create(null)
      var requestOptionsLoadingByQuery = Object.create(null)
      var numericRequestHydrationTimer = null
      var optionsLoaded = false
      var selectedRequestVisionIds = new Set([""])
      var requestSelectionLimit = 20
      var activeIndex = -1
      var filteredOptions = []
      var pickerOpen = false
      var directUserEmulsionOptions = []
      var directUserEmulsionOptionsLoaded = false
      var directUserEmulsionOptionsLoading = null
      var directUserEmulsionActiveIndex = -1
      var directUserEmulsionPickerOpen = false
      var refreshedSampleForDirectPrompt = false
      var directTabInitialized = false

      function initializeDirectTab() {
        if (directTabInitialized) return
        directTabInitialized = true
        refreshDirectGenerationSamplePreview()
        void loadDirectProviders()
      }

      function renderDirectProviders() {
        if (!providerSelect) return
        var providers = requestDirectState.providers || []
        var supported = requestDirectState.supportedProviders || []
        var configured = {}
        providers.forEach(function (p) {
          configured[p.provider_id] = p
        })
        var lastUsedSelection = requestDirectState.lastUsed || null
        var lastUsedValue = ""
        if (lastUsedSelection && lastUsedSelection.provider_id && lastUsedSelection.model) {
          lastUsedValue = lastUsedSelection.provider_id + ":" + lastUsedSelection.model
        }
        var options = []
        supported.forEach(function (sp) {
          if (!configured[sp.provider_id]) return
          ;(sp.model_options || []).forEach(function (m) {
            var value = sp.provider_id + ":" + m.model
            var label = sp.label + " · " + m.label
            if (!lastUsedValue && m.last_used) lastUsedValue = value
            options.push({ value: value, label: label })
          })
        })
        options.sort(function (a, b) {
          return a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true })
        })
        if (lastUsedValue) {
          options.forEach(function (opt) {
            if (opt.value === lastUsedValue) opt.label = opt.label + " · last used"
          })
        }
        var selectedValue = lastUsedValue || (options.length ? options[0].value : "")
        if (
          selectedValue &&
          !options.some(function (opt) {
            return opt.value === selectedValue
          })
        ) {
          selectedValue = options.length ? options[0].value : ""
        }
        providerSelect.innerHTML = options.length
          ? options
              .map(function (opt) {
                return '<option value="' + esc(opt.value) + '">' + esc(opt.label) + "</option>"
              })
              .join("")
          : '<option value="">No saved image API</option>'
        providerSelect.value = selectedValue
        providerSelect.disabled = !options.length
      }

      function setDirectStatus(message, tone) {
        if (!directStatus) return
        directStatus.textContent = String(message || "").trim()
        directStatus.hidden = !directStatus.textContent
        directStatus.dataset.tone = tone || ""
      }

      function updateDirectGenerationButtons() {
        var hasProvider = Boolean(providerSelect && String(providerSelect.value || "").trim())
        var providers = requestDirectState.providers || []
        if (directPanel) directPanel.hidden = false
        if (!requestDirectState.providerReady) {
          setDirectStatus("Provider setup is not available on this deployment.", "warn")
        } else if (!providers.length) {
          setDirectStatus("No saved image provider. The free queue still works.", "warn")
        } else {
          setDirectStatus("", "")
        }
        if (directGenerateButton) {
          directGenerateButton.disabled = Boolean(requestDirectState.loading || !hasProvider)
          directGenerateButton.textContent = requestDirectState.loading
            ? "Generating..."
            : "Generate candidate"
        }
        if (directPublishButton) {
          var canPublish = Boolean(
            !requestDirectState.loading &&
            requestDirectState.job &&
            hasDirectGeneratedImage() &&
            !requestDirectState.job.published,
          )
          directPublishButton.hidden = !canPublish
          directPublishButton.disabled = !canPublish
        }
        updateDirectGenerationPreview()
      }

      function loadDirectProviders() {
        return fetchImageEditProviders({ op: "candidate_generation" })
          .then(function (payload) {
            requestDirectState.providers = Array.isArray(payload && payload.providers)
              ? payload.providers
              : []
            requestDirectState.supportedProviders = Array.isArray(
              payload && payload.supported_providers,
            )
              ? payload.supported_providers
              : []
            requestDirectState.lastUsed =
              payload && payload.last_used && typeof payload.last_used === "object"
                ? payload.last_used
                : null
            requestDirectState.providerReady = Boolean(payload && payload.encryption_configured)
            renderDirectProviders()
            updateDirectGenerationButtons()
          })
          .catch(function () {
            requestDirectState.providers = []
            requestDirectState.supportedProviders = []
            requestDirectState.lastUsed = null
            requestDirectState.providerReady = false
            renderDirectProviders()
            updateDirectGenerationButtons()
          })
      }

      function selectedDirectProviderId() {
        // Returns the raw selected value, which is "provider_id:model".
        return String((providerSelect && providerSelect.value) || "").trim()
      }

      function selectedDirectProviderAndModel() {
        var raw = selectedDirectProviderId()
        if (!raw) return { providerId: "", model: "" }
        var idx = raw.indexOf(":")
        if (idx < 0) return { providerId: raw, model: "" }
        return { providerId: raw.slice(0, idx), model: raw.slice(idx + 1) }
      }

      function selectedDirectUserEmulsionId() {
        var option = requestDirectState.selectedUserEmulsion || null
        return String((option && (option.user_emulsion_id || option.emulsion_id)) || "").trim()
      }

      function directUserEmulsionOptionFromSaved(emulsion, kind) {
        var id = String((emulsion && emulsion.id) || "").trim()
        if (!id) return null
        var slot = Number((emulsion && emulsion.slot) || 0) || 0
        var publicLabel = slot > 0 ? "Emulsion " + String(slot) : "Saved emulsion"
        return {
          option_type: "user_emulsion",
          user_emulsion_id: id,
          emulsion_id: id,
          label: publicLabel,
          primary_label: publicLabel,
          secondary_label: kind === "current" ? "Current saved emulsion" : "Saved revision",
          search_text: publicLabel,
          image_count: 0,
          live_count: 0,
          score: 0,
          vote_h_index: 0,
          preview_assets: [],
        }
      }

      function rememberDirectUserEmulsionOptions(payload) {
        var seen = Object.create(null)
        var options = []
        var current = directUserEmulsionOptionFromSaved(payload && payload.emulsion, "current")
        if (current) {
          options.push(current)
          seen[current.user_emulsion_id] = true
        }
        var history = Array.isArray(payload && payload.history) ? payload.history : []
        for (var i = 0; i < history.length; i++) {
          var option = directUserEmulsionOptionFromSaved(history[i], "history")
          if (!option || seen[option.user_emulsion_id]) continue
          options.push(option)
          seen[option.user_emulsion_id] = true
        }
        directUserEmulsionOptions = options
        directUserEmulsionOptionsLoaded = true
        return options
      }

      function ensureDirectUserEmulsionOptionsLoaded() {
        if (directUserEmulsionOptionsLoaded) return Promise.resolve(directUserEmulsionOptions)
        if (directUserEmulsionOptionsLoading) return directUserEmulsionOptionsLoading
        directUserEmulsionOptionsLoading = fetchAuthedJSON("/api/iconoplasm/user-emulsion", {
          credentials: "include",
        })
          .then(function (payload) {
            directUserEmulsionOptionsLoading = null
            return rememberDirectUserEmulsionOptions(payload || {})
          })
          .catch(function () {
            directUserEmulsionOptionsLoading = null
            directUserEmulsionOptionsLoaded = true
            directUserEmulsionOptions = []
            return directUserEmulsionOptions
          })
        return directUserEmulsionOptionsLoading
      }

      function candidateGenerationSampleLabel() {
        var latestSample = genePayload && genePayload.latest_sample ? genePayload.latest_sample : {}
        var label = String((latestSample && latestSample.sample_label) || "").trim()
        if (label) return label
        return symbol ? symbol + "-0" : "legacy-0"
      }

      function updateDirectGenerationPreview() {
        if (directSubjectSource) {
          directSubjectSource.textContent =
            candidateGenerationSampleLabel() + " · active factory Vision"
        }
      }

      function hasDirectGeneratedImage() {
        return Boolean(requestDirectState.job && directResultUrl(requestDirectState.job))
      }

      function refreshDirectGenerationSamplePreview() {
        if (refreshedSampleForDirectPrompt) return
        refreshedSampleForDirectPrompt = true
        fetchGeneDetail(symbol, { forceFresh: true })
          .then(function (freshGene) {
            var freshSample =
              freshGene && freshGene.latest_sample && typeof freshGene.latest_sample === "object"
                ? freshGene.latest_sample
                : null
            if (!freshSample) return
            genePayload.latest_sample = {
              sample_label: freshSample.sample_label || null,
              sample_number: freshSample.sample_number || null,
            }
            updateDirectGenerationPreview()
          })
          .catch(function () {})
      }

      function directResultUrl(job) {
        return portraitAssetRefUrl(job && job.result_asset, "medium")
      }

      function setDirectResultEmpty(empty) {
        if (directResult) directResult.setAttribute("data-empty", empty ? "true" : "false")
        if (directImage) directImage.hidden = !!empty
      }

      function submitDirectCandidateGeneration() {
        var selected = selectedDirectProviderAndModel()
        if (!selected.providerId) return
        requestDirectState.loading = true
        requestDirectState.job = null
        setDirectResultEmpty(true)
        if (directImage) {
          portraitDelivery.unbind(directImage)
          directImage.removeAttribute("src")
        }
        updateDirectGenerationButtons()
        setStatus("Generating candidate...", "")
        var body = {
          provider_id: selected.providerId,
          symbol: symbol,
          request_kind: "new_candidate",
          request_mode: "novel",
          user_emulsion_id: selectedDirectUserEmulsionId(),
        }
        if (selected.model) body.model = selected.model
        fetchAuthedJSON("/api/iconoplasm/candidate-generation/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(body),
        })
          .then(function (payload) {
            var job = payload && payload.job
            requestDirectState.job = job || null
            if (payload && payload.ok === false && payload.error) {
              setStatus(String(payload.error), "error")
              return
            }
            var url = directResultUrl(job)
            if (directImage && url) portraitDelivery.bind(directImage, url)
            setDirectResultEmpty(!url)
            setStatus("Candidate generated.", "success")
          })
          .catch(function (error) {
            setStatus(
              String((error && error.message) || "Could not generate candidate with image API."),
              "error",
            )
          })
          .finally(function () {
            requestDirectState.loading = false
            updateDirectGenerationButtons()
          })
      }

      function publishDirectCandidateGeneration() {
        if (!requestDirectState.job || !requestDirectState.job.id) return
        requestDirectState.loading = true
        updateDirectGenerationButtons()
        setStatus("Publishing candidate blot...", "")
        fetchAuthedJSON(
          "/api/iconoplasm/candidate-generation/jobs/" +
            encodeURIComponent(requestDirectState.job.id) +
            "/publish",
          {
            method: "POST",
          },
        )
          .then(function (payload) {
            requestDirectState.job = payload && payload.job ? payload.job : requestDirectState.job
            setStatus("Published as a new candidate blot.", "success")
            var root = document.getElementById(ROOT_ID)
            if (root) renderGene(root, symbol, { forceFresh: true })
          })
          .catch(function (error) {
            if (error && error.payload && error.payload.job) {
              requestDirectState.job = error.payload.job
            }
            setStatus(
              publishFailureMessage(error, "Could not publish candidate.", "generated image"),
              "error",
            )
          })
          .finally(function () {
            requestDirectState.loading = false
            updateDirectGenerationButtons()
          })
      }

      function openResults() {
        pickerOpen = true
        results.hidden = false
        queryInput.setAttribute("aria-expanded", "true")
      }

      function requestOptionsQueryKey(query) {
        var cleaned = String(query || "")
          .trim()
          .replace(/\s+/g, " ")
        return cleaned.length >= 2 ? cleaned.slice(0, 80) : ""
      }

      function requestOptionFromImmediateNumericQuery(query) {
        var compact = String(query || "")
          .trim()
          .replace(/\s+/g, "")
        var match = /^(?:(?:[a-z][1-9][0-9]*|anima-v1)-)?([1-9][0-9]*)(?:-e)?$/i.exec(compact)
        if (!match) return null
        var slot = Number(match[1])
        if (!Number.isSafeInteger(slot)) return null
        var intervals = Array.isArray(
          ICONOPLASM_ANIMA_EMULSION_SLOT_CONTRACT.callable_slot_intervals,
        )
          ? ICONOPLASM_ANIMA_EMULSION_SLOT_CONTRACT.callable_slot_intervals
          : []
        var callable = intervals.some(function (interval) {
          return (
            Array.isArray(interval) &&
            interval.length === 2 &&
            slot >= Number(interval[0]) &&
            slot <= Number(interval[1])
          )
        })
        if (!callable) return null
        return {
          vision_id: "anima-v1-" + slot,
          label: String(slot),
          primary_label: String(slot),
          secondary_label: "",
          search_text: String(slot),
          emulsion_id: "0-" + slot,
          emulsion_family_id: "0-" + slot,
          image_count: 0,
          live_count: 0,
          score: 0,
          vote_h_index: 0,
          preview_assets: [],
        }
      }

      function isNumericRequestQuery(query) {
        return /^(?:(?:[a-z][1-9][0-9]*|anima-v1)-)?[0-9]+(?:-e)?$/i.test(
          String(query || "")
            .trim()
            .replace(/\s+/g, ""),
        )
      }

      function rememberRequestOptions(options) {
        var list = Array.isArray(options) ? options : []
        for (var i = 0; i < list.length; i++) {
          var visionId = String((list[i] && list[i].vision_id) || "").trim()
          if (visionId) requestOptionsByVisionId[visionId] = list[i]
        }
      }

      function ensureRequestOptionsLoaded(query, options) {
        var config = options || {}
        var queryKey = requestOptionsQueryKey(query)
        if (!queryKey && optionsLoaded) return Promise.resolve(requestOptions)
        if (requestOptionsByQuery[queryKey]) return Promise.resolve(requestOptionsByQuery[queryKey])
        if (requestOptionsLoadingByQuery[queryKey]) return requestOptionsLoadingByQuery[queryKey]
        var requestOptionsUrl = "/api/iconoplasm/requests/options"
        if (queryKey) requestOptionsUrl += "?query=" + encodeURIComponent(queryKey)
        requestOptionsLoadingByQuery[queryKey] = fetchJSON(requestOptionsUrl, {
          credentials: "include",
        })
          .then(function (payload) {
            var loadedOptions = Array.isArray(payload && payload.request_options)
              ? payload.request_options
              : []
            requestOptionsByQuery[queryKey] = loadedOptions
            rememberRequestOptions(loadedOptions)
            if (!queryKey) {
              requestOptions = loadedOptions
              optionsLoaded = true
            }
            delete requestOptionsLoadingByQuery[queryKey]
            return loadedOptions
          })
          .catch(function (error) {
            delete requestOptionsLoadingByQuery[queryKey]
            if (!config.silent) {
              setStatus(
                String((error && error.message) || "Could not load emulsion lanes."),
                "error",
              )
            }
            throw error
          })
        return requestOptionsLoadingByQuery[queryKey]
      }

      function scoreRequestOption(option, query) {
        var cleanedQuery = String(query || "")
          .trim()
          .toLowerCase()
        if (!cleanedQuery) return 0
        var primary = requestOptionPrimaryLabel(option).toLowerCase()
        var secondary = requestOptionSecondaryLabel(option).toLowerCase()
        var searchText = String((option && option.search_text) || "").toLowerCase()
        if (primary === cleanedQuery) return 0
        if (primary.indexOf(cleanedQuery) === 0) return 1
        if (searchText.indexOf(cleanedQuery) === 0) return 2
        if (secondary.indexOf(cleanedQuery) === 0) return 3
        if (primary.indexOf(cleanedQuery) >= 0) return 4
        if (searchText.indexOf(cleanedQuery) >= 0) return 5
        if (secondary.indexOf(cleanedQuery) >= 0) return 6
        return 99
      }

      function compareRequestOptionStrength(left, right) {
        var hIndexDiff =
          Number((right && right.vote_h_index) || 0) - Number((left && left.vote_h_index) || 0)
        if (hIndexDiff) return hIndexDiff
        var liveDiff =
          Number((right && right.live_count) || 0) - Number((left && left.live_count) || 0)
        if (liveDiff) return liveDiff
        var scoreDiff = Number((right && right.score) || 0) - Number((left && left.score) || 0)
        if (scoreDiff) return scoreDiff
        var imageDiff =
          Number((right && right.image_count) || 0) - Number((left && left.image_count) || 0)
        if (imageDiff) return imageDiff
        return String((left && left.vision_id) || "").localeCompare(
          String((right && right.vision_id) || ""),
        )
      }

      function isQueueRequestOption(option) {
        return String((option && option.option_type) || "") !== "user_emulsion"
      }

      function isDirectUserEmulsionOption(option) {
        return String((option && option.option_type) || "") === "user_emulsion"
      }

      function isFavoriteRequestOption(option) {
        return emulsionFavorites.has(
          option && (option.emulsion_family_id || option.emulsion_id || ""),
        )
      }

      function filterRequestOptions(query, options, optionPredicate) {
        var cleanedQuery = String(query || "")
          .trim()
          .toLowerCase()
        var terms = cleanedQuery ? cleanedQuery.split(/\s+/g).filter(Boolean) : []
        var sourceOptions = Array.isArray(options) ? options : requestOptions
        var matched = sourceOptions.filter(function (option) {
          if (optionPredicate && !optionPredicate(option)) return false
          if (!terms.length) return true
          var haystack = [
            requestOptionPrimaryLabel(option),
            requestOptionSecondaryLabel(option),
            String((option && option.search_text) || ""),
          ]
            .join(" ")
            .toLowerCase()
          for (var i = 0; i < terms.length; i++) {
            if (haystack.indexOf(terms[i]) < 0) return false
          }
          return true
        })
        matched.sort(function (a, b) {
          var scoreDiff = scoreRequestOption(a, cleanedQuery) - scoreRequestOption(b, cleanedQuery)
          if (scoreDiff) return scoreDiff
          var favoriteDiff = Number(isFavoriteRequestOption(b)) - Number(isFavoriteRequestOption(a))
          if (favoriteDiff) return favoriteDiff
          return compareRequestOptionStrength(a, b)
        })
        if (cleanedQuery) return matched.slice(0, 10)
        var favorites = matched.filter(isFavoriteRequestOption)
        var others = matched.filter(function (option) {
          return !isFavoriteRequestOption(option)
        })
        return favorites.concat(others.slice(0, 6))
      }

      function paintActiveOption() {
        var items = results.querySelectorAll(".icono-request-option")
        for (var i = 0; i < items.length; i++) {
          items[i].classList.toggle("active", i === activeIndex)
        }
        var activeItem = items[activeIndex] || null
        if (activeItem && activeItem.id) {
          queryInput.setAttribute("aria-activedescendant", activeItem.id)
        } else {
          queryInput.removeAttribute("aria-activedescendant")
        }
      }

      function paintRequestResults(renderQuery, loadedOptions) {
        filteredOptions = filterRequestOptions(renderQuery, loadedOptions, isQueueRequestOption)
        var hasQuery = !!String(renderQuery || "").trim()
        var html = hasQuery
          ? ""
          : renderRequestOptionButtonMarkup(null, selectedRequestVisionIds, true, null, true)
        if (filteredOptions.length) {
          var favoriteOptions = filteredOptions.filter(isFavoriteRequestOption)
          var otherOptions = filteredOptions.filter(function (option) {
            return !isFavoriteRequestOption(option)
          })
          if (hasQuery) {
            html += filteredOptions
              .map(function (option) {
                return renderRequestOptionButtonMarkup(
                  option,
                  selectedRequestVisionIds,
                  false,
                  null,
                  true,
                )
              })
              .join("")
          } else {
            if (favoriteOptions.length) {
              html += '<div class="icono-request-option-group-label">Favorites</div>'
            }
            html += favoriteOptions
              .map(function (option) {
                return renderRequestOptionButtonMarkup(
                  option,
                  selectedRequestVisionIds,
                  false,
                  null,
                  true,
                )
              })
              .join("")
            if (otherOptions.length) {
              html += '<div class="icono-request-option-group-label">Other emulsions</div>'
            }
            html += otherOptions
              .map(function (option) {
                return renderRequestOptionButtonMarkup(
                  option,
                  selectedRequestVisionIds,
                  false,
                  null,
                  true,
                )
              })
              .join("")
          }
        } else {
          html +=
            '<div class="icono-request-results-empty">No emulsions match that number or artist.</div>'
        }
        results.innerHTML = html
        results.removeAttribute("aria-busy")
        paintActiveOption()
      }

      function scheduleNumericRequestHydration(renderQuery, immediateOption) {
        if (numericRequestHydrationTimer) window.clearTimeout(numericRequestHydrationTimer)
        numericRequestHydrationTimer = window.setTimeout(function () {
          numericRequestHydrationTimer = null
          ensureRequestOptionsLoaded(renderQuery, { silent: true })
            .then(function (loadedOptions) {
              if (queryInput.value !== renderQuery) return
              paintRequestResults(
                requestOptionPrimaryLabel(immediateOption),
                Array.isArray(loadedOptions) && loadedOptions.length
                  ? loadedOptions
                  : [immediateOption],
              )
            })
            .catch(function () {
              // The immediately selectable canonical option remains usable when
              // optional preview enrichment is unavailable.
            })
        }, 250)
      }

      async function renderResultsList() {
        var renderQuery = queryInput.value
        openResults()
        var immediateOption = requestOptionFromImmediateNumericQuery(renderQuery)
        if (immediateOption) {
          rememberRequestOptions([immediateOption])
          paintRequestResults(requestOptionPrimaryLabel(immediateOption), [immediateOption])
          scheduleNumericRequestHydration(renderQuery, immediateOption)
          return
        }
        if (isNumericRequestQuery(renderQuery)) {
          if (numericRequestHydrationTimer) {
            window.clearTimeout(numericRequestHydrationTimer)
            numericRequestHydrationTimer = null
          }
          paintRequestResults(renderQuery, [])
          return
        }
        if (numericRequestHydrationTimer) {
          window.clearTimeout(numericRequestHydrationTimer)
          numericRequestHydrationTimer = null
        }
        results.setAttribute("aria-busy", "true")
        if (currentUser && !emulsionFavorites.isLoaded()) {
          await emulsionFavorites.load().catch(function () {
            return null
          })
        }
        var loadedOptions
        try {
          loadedOptions = await ensureRequestOptionsLoaded(renderQuery)
        } catch (error) {
          results.removeAttribute("aria-busy")
          results.innerHTML =
            '<div class="icono-request-results-empty">Could not load emulsions. Try again.</div>'
          return
        }
        if (queryInput.value !== renderQuery) {
          void renderResultsList()
          return
        }
        paintRequestResults(renderQuery, loadedOptions)
      }

      function updateQueueSelectionControls() {
        var selectedVisionIds = Array.from(selectedRequestVisionIds).filter(Boolean)
        hiddenInput.value = selectedVisionIds.join(",")
        var optionButtons = results.querySelectorAll("[data-icono-request-option]")
        for (var i = 0; i < optionButtons.length; i++) {
          var optionVisionId = String(
            optionButtons[i].getAttribute("data-icono-request-option") || "",
          ).trim()
          var selected = selectedRequestVisionIds.has(optionVisionId)
          optionButtons[i].classList.toggle("is-selected", selected)
          optionButtons[i].setAttribute("aria-pressed", selected ? "true" : "false")
        }
        if (queueSubmitButton) {
          var queueLabel = "Queue random"
          if (selectedVisionIds.length === 1) {
            var selectedOption = requestOptionsByVisionId[selectedVisionIds[0]] || null
            queueLabel = selectedOption
              ? "Queue " + requestOptionPrimaryLabel(selectedOption)
              : "Queue 1 candidate"
          } else if (selectedVisionIds.length > 1) {
            queueLabel = "Queue " + selectedVisionIds.length + " candidates"
          }
          queueSubmitButton.textContent = queueLabel
          queueSubmitButton.setAttribute("data-default-label", queueLabel)
        }
      }

      function requestOptionForFavoriteFamilyId(rawFamilyId) {
        var familyId = normalizeEmulsionFamilyId(rawFamilyId)
        if (!familyId) return null
        var knownOptions = Object.values(requestOptionsByVisionId)
        for (var i = 0; i < knownOptions.length; i++) {
          var knownFamilyId = normalizeEmulsionFamilyId(
            knownOptions[i] && (knownOptions[i].emulsion_family_id || knownOptions[i].emulsion_id),
          )
          if (knownFamilyId === familyId) return knownOptions[i]
        }
        var neutralSlot = /^0-([1-9][0-9]*)$/.exec(familyId)
        return neutralSlot ? requestOptionFromImmediateNumericQuery(neutralSlot[1]) : null
      }

      function selectAllFavoriteRequestOptions() {
        var favorites = emulsionFavorites
          .ids()
          .map(requestOptionForFavoriteFamilyId)
          .filter(Boolean)
        var selectable = favorites.slice(0, requestSelectionLimit)
        if (!selectable.length) return
        selectedRequestVisionIds.clear()
        rememberRequestOptions(selectable)
        for (var i = 0; i < selectable.length; i++) {
          selectedRequestVisionIds.add(selectable[i].vision_id)
        }
        updateQueueSelectionControls()
        if (favorites.length > selectable.length) {
          setStatus("Selected the first " + selectable.length + " favorites for this batch.", "")
        }
      }

      function setSelection(option) {
        var visionId = String((option && option.vision_id) || "").trim()
        if (!visionId) {
          selectedRequestVisionIds.clear()
          selectedRequestVisionIds.add("")
        } else {
          selectedRequestVisionIds.delete("")
          if (selectedRequestVisionIds.has(visionId)) {
            selectedRequestVisionIds.delete(visionId)
          } else if (selectedRequestVisionIds.size >= requestSelectionLimit) {
            setStatus("Choose up to " + requestSelectionLimit + " emulsions at once.", "error")
            return
          } else {
            selectedRequestVisionIds.add(visionId)
          }
          if (!selectedRequestVisionIds.size) selectedRequestVisionIds.add("")
        }
        updateQueueSelectionControls()
        openResults()
      }

      function closeDirectUserEmulsionResults() {
        directUserEmulsionPickerOpen = false
        directUserEmulsionActiveIndex = -1
        if (directEmulsionResults) directEmulsionResults.hidden = true
        if (directEmulsionQuery) {
          directEmulsionQuery.setAttribute("aria-expanded", "false")
          directEmulsionQuery.removeAttribute("aria-activedescendant")
        }
      }

      function openDirectUserEmulsionResults() {
        directUserEmulsionPickerOpen = true
        if (directEmulsionResults) directEmulsionResults.hidden = false
        if (directEmulsionQuery) directEmulsionQuery.setAttribute("aria-expanded", "true")
      }

      function renderDirectUserEmulsionOptionMarkup(option, selectedUserEmulsionId, isDefault) {
        if (isDefault) {
          return (
            '<button type="button" class="icono-request-option is-random' +
            (!selectedUserEmulsionId ? " is-selected" : "") +
            '" id="icono-request-direct-emulsion-default" role="option" aria-selected="' +
            (!selectedUserEmulsionId ? "true" : "false") +
            '" data-icono-request-direct-emulsion-option="">' +
            '<span class="icono-request-option-copy"><span class="icono-request-option-title-row"><span class="icono-request-option-title">Use my emulsion</span></span></span>' +
            '<span class="icono-request-option-strip icono-request-option-strip--empty"><span class="icono-request-option-empty">Default</span></span>' +
            "</button>"
          )
        }
        return renderRequestOptionButtonMarkup(
          option,
          selectedUserEmulsionId,
          false,
          "data-icono-request-direct-emulsion-option",
        )
      }

      function paintDirectUserEmulsionActiveOption() {
        if (!directEmulsionResults || !directEmulsionQuery) return
        var items = directEmulsionResults.querySelectorAll(".icono-request-option")
        for (var i = 0; i < items.length; i++) {
          items[i].classList.toggle("active", i === directUserEmulsionActiveIndex)
        }
        var activeItem = items[directUserEmulsionActiveIndex] || null
        if (activeItem && activeItem.id) {
          directEmulsionQuery.setAttribute("aria-activedescendant", activeItem.id)
        } else {
          directEmulsionQuery.removeAttribute("aria-activedescendant")
        }
      }

      async function renderDirectUserEmulsionResultsList() {
        if (!directEmulsionQuery || !directEmulsionResults) return
        var renderQuery = directEmulsionQuery.value
        var loadedOptions = await ensureDirectUserEmulsionOptionsLoaded()
        if (directEmulsionQuery.value !== renderQuery) {
          void renderDirectUserEmulsionResultsList()
          return
        }
        directUserEmulsionOptions = filterRequestOptions(renderQuery, loadedOptions)
        var selectedId = selectedDirectUserEmulsionId()
        var html = renderDirectUserEmulsionOptionMarkup(null, selectedId, true)
        if (directUserEmulsionOptions.length) {
          html += directUserEmulsionOptions
            .map(function (option) {
              return renderDirectUserEmulsionOptionMarkup(option, selectedId, false)
            })
            .join("")
        } else {
          html +=
            '<div class="icono-request-results-empty">No user emulsions match that search.</div>'
        }
        directEmulsionResults.innerHTML = html
        paintDirectUserEmulsionActiveOption()
        if (!directUserEmulsionPickerOpen) openDirectUserEmulsionResults()
      }

      function setDirectUserEmulsionSelection(option) {
        requestDirectState.selectedUserEmulsion = option || null
        if (directEmulsionQuery) {
          directEmulsionQuery.value = option ? requestOptionPrimaryLabel(option) : ""
        }
        requestDirectState.job = null
        setDirectResultEmpty(true)
        if (directImage) directImage.removeAttribute("src")
        updateDirectGenerationButtons()
        closeDirectUserEmulsionResults()
      }

      queryInput.addEventListener("focus", function () {
        void renderResultsList()
      })
      queryInput.addEventListener("click", function () {
        void renderResultsList()
      })
      queryInput.addEventListener("input", function () {
        updateDirectGenerationButtons()
        activeIndex = -1
        void renderResultsList()
      })
      queryInput.addEventListener("keydown", function (event) {
        var items = results.querySelectorAll(".icono-request-option")
        if (event.key === "ArrowDown") {
          event.preventDefault()
          if (!pickerOpen) {
            void renderResultsList()
            return
          }
          activeIndex = Math.min(activeIndex + 1, items.length - 1)
          paintActiveOption()
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          if (!pickerOpen) {
            void renderResultsList()
            return
          }
          activeIndex = Math.max(activeIndex - 1, 0)
          paintActiveOption()
          return
        }
        if (event.key === "Enter" && pickerOpen) {
          event.preventDefault()
          var activeItem = items[activeIndex >= 0 ? activeIndex : 0]
          if (activeItem) activeItem.click()
          return
        }
        if (event.key === "Escape") {
          if (queryInput.value) {
            event.preventDefault()
            queryInput.value = ""
            activeIndex = -1
            void renderResultsList()
          }
        }
      })
      results.addEventListener("click", function (event) {
        var button = event.target.closest("[data-icono-request-option]")
        if (!button) return
        var visionId = String(button.getAttribute("data-icono-request-option") || "").trim()
        if (!visionId) {
          setSelection(null)
          return
        }
        for (var i = 0; i < requestOptions.length; i++) {
          if (
            String((requestOptions[i] && requestOptions[i].vision_id) || "").trim() === visionId
          ) {
            setSelection(requestOptions[i])
            return
          }
        }
        for (var j = 0; j < filteredOptions.length; j++) {
          if (
            String((filteredOptions[j] && filteredOptions[j].vision_id) || "").trim() === visionId
          ) {
            setSelection(filteredOptions[j])
            return
          }
        }
        if (requestOptionsByVisionId[visionId]) setSelection(requestOptionsByVisionId[visionId])
      })
      if (directEmulsionQuery && directEmulsionResults && directEmulsionPicker) {
        directEmulsionQuery.addEventListener("focus", function () {
          void renderDirectUserEmulsionResultsList()
        })
        directEmulsionQuery.addEventListener("click", function () {
          void renderDirectUserEmulsionResultsList()
        })
        directEmulsionQuery.addEventListener("input", function () {
          requestDirectState.selectedUserEmulsion = null
          requestDirectState.job = null
          setDirectResultEmpty(true)
          if (directImage) directImage.removeAttribute("src")
          updateDirectGenerationButtons()
          directUserEmulsionActiveIndex = -1
          void renderDirectUserEmulsionResultsList()
        })
        directEmulsionQuery.addEventListener("keydown", function (event) {
          var items = directEmulsionResults.querySelectorAll(".icono-request-option")
          if (event.key === "ArrowDown") {
            event.preventDefault()
            if (!directUserEmulsionPickerOpen) {
              void renderDirectUserEmulsionResultsList()
              return
            }
            directUserEmulsionActiveIndex = Math.min(
              directUserEmulsionActiveIndex + 1,
              items.length - 1,
            )
            paintDirectUserEmulsionActiveOption()
            return
          }
          if (event.key === "ArrowUp") {
            event.preventDefault()
            if (!directUserEmulsionPickerOpen) {
              void renderDirectUserEmulsionResultsList()
              return
            }
            directUserEmulsionActiveIndex = Math.max(directUserEmulsionActiveIndex - 1, 0)
            paintDirectUserEmulsionActiveOption()
            return
          }
          if (event.key === "Enter" && directUserEmulsionPickerOpen) {
            event.preventDefault()
            var activeItem =
              items[directUserEmulsionActiveIndex >= 0 ? directUserEmulsionActiveIndex : 0]
            if (activeItem) activeItem.click()
            return
          }
          if (event.key === "Escape") {
            closeDirectUserEmulsionResults()
          }
        })
        directEmulsionResults.addEventListener("click", function (event) {
          var button = event.target.closest("[data-icono-request-direct-emulsion-option]")
          if (!button) return
          var userEmulsionId = String(
            button.getAttribute("data-icono-request-direct-emulsion-option") || "",
          ).trim()
          if (!userEmulsionId) {
            setDirectUserEmulsionSelection(null)
            return
          }
          for (var i = 0; i < directUserEmulsionOptions.length; i++) {
            var option = directUserEmulsionOptions[i]
            var optionId = String(
              (option && (option.user_emulsion_id || option.emulsion_id)) || "",
            ).trim()
            if (optionId === userEmulsionId) {
              setDirectUserEmulsionSelection(option)
              return
            }
          }
        })
      }
      if (panel._iconoRequestOutsideClickHandler) {
        document.removeEventListener("click", panel._iconoRequestOutsideClickHandler)
      }
      panel._iconoRequestOutsideClickHandler = function (event) {
        if (directEmulsionPicker && !directEmulsionPicker.contains(event.target)) {
          closeDirectUserEmulsionResults()
        }
      }
      document.addEventListener("click", panel._iconoRequestOutsideClickHandler)
      queryInput.value = ""
      if (directEmulsionQuery) directEmulsionQuery.value = ""
      closeDirectUserEmulsionResults()
      if (providerSelect) {
        providerSelect.addEventListener("change", updateDirectGenerationButtons)
      }
      if (selectAllFavoritesButton) {
        selectAllFavoritesButton.addEventListener("click", selectAllFavoriteRequestOptions)
      }
      if (directGenerateButton) {
        directGenerateButton.addEventListener("click", submitDirectCandidateGeneration)
      }
      if (directPublishButton) {
        directPublishButton.addEventListener("click", publishDirectCandidateGeneration)
      }
      panel.addEventListener("icono-request-tab-activate", function (event) {
        if (event.detail && event.detail.tab === "api") initializeDirectTab()
        if (event.detail && event.detail.tab === "free") void renderResultsList()
      })
      var selectedRequestTab = body.querySelector('[data-icono-request-tab][aria-selected="true"]')
      if (
        selectedRequestTab &&
        selectedRequestTab.getAttribute("data-icono-request-tab") === "api"
      ) {
        initializeDirectTab()
      }
      form.addEventListener("submit", function (event) {
        event.preventDefault()
        var requestedVisionIds = Array.from(selectedRequestVisionIds).filter(Boolean)
        var isBatch = requestedVisionIds.length > 0
        var payload = isBatch
          ? {
              symbol: symbol,
              request_kind: "new_candidate",
              request_mode: "specific",
              requested_vision_ids: requestedVisionIds,
              client_batch_id: crypto.randomUUID(),
            }
          : {
              symbol: symbol,
              request_kind: "new_candidate",
              request_mode: "random",
              requested_vision_id: null,
            }
        var button = event.submitter || queueSubmitButton
        if (button) {
          button.disabled = true
          button.textContent = isBatch ? "Queueing " + requestedVisionIds.length + "…" : "Queueing…"
        }
        setStatus("", "")
        fetchJSON("/api/iconoplasm/requests", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(payload),
        })
          .then(function (responsePayload) {
            var failures = Array.isArray(responsePayload && responsePayload.failures)
              ? responsePayload.failures
              : []
            var failedVisionIds = new Set(
              failures.map(function (failure) {
                return String((failure && failure.requested_vision_id) || "").trim()
              }),
            )
            selectedRequestVisionIds.clear()
            failedVisionIds.forEach(function (visionId) {
              if (visionId) selectedRequestVisionIds.add(visionId)
            })
            if (!selectedRequestVisionIds.size) selectedRequestVisionIds.add("")
            updateQueueSelectionControls()
            void renderResultsList()
            delete geneRequestSummaryCache[symbol]
            var queuedCount = Math.max(
              0,
              Number(responsePayload && responsePayload.queued_count) ||
                (isBatch ? requestedVisionIds.length : 1),
            )
            if (failures.length) {
              setStatus(
                "Queued " +
                  queuedCount +
                  "; " +
                  failures.length +
                  " could not be queued and remain selected.",
                "error",
              )
            } else {
              setStatus(
                "Queued " + queuedCount + " candidate" + (queuedCount === 1 ? "." : "s."),
                "success",
              )
            }
            void requestInbox.refresh()
            return fetchGeneRequestSummary(symbol, { forceFresh: true }).then(function (state) {
              wireAuthenticatedRequestForm(state)
              return state
            })
          })
          .catch(function (error) {
            setStatus(String((error && error.message) || "Could not queue request."), "error")
          })
          .finally(function () {
            if (button) {
              button.disabled = false
              button.textContent = String(
                button.getAttribute("data-default-label") || "Queue random",
              )
            }
          })
      })
    }

    function loadSummary() {
      // Chesterton fence: summary is intentionally its own request. Do not fold
      // this back into a one-shot endpoint that also hydrates picker options.
      return fetchGeneRequestSummary(symbol).then(function (state) {
        if (!state || !state.authenticated) {
          freeQueueAvailable = false
          if (freeFooter) freeFooter.hidden = true
          body.innerHTML =
            '<div class="icono-home-auth-copy">' +
            '<div class="icono-home-auth-kicker">request access</div>' +
            '<div class="icono-home-auth-title">Log in to request new candidates</div>' +
            '<div class="icono-home-auth-note">Requests feed the free generation queue. You can choose a specific emulsion ID after login.</div>' +
            "</div>" +
            '<div style="display:grid;gap:12px;">' +
            '<a class="icono-home-auth-link" href="' +
            esc(currentUser ? COMMUNITY_URL : voteLoginUrl()) +
            '"' +
            (currentUser ? ' target="_blank" rel="noopener noreferrer"' : "") +
            ">" +
            (currentUser ? "Join Discord" : "Log in with Discord") +
            "</a>" +
            renderGeneRequestSummaryMarkup(
              "Open requests on this gene",
              Array.isArray(state && state.gene_lane_summary) ? state.gene_lane_summary : [],
              "request_count",
            ) +
            '<div data-icono-request-note hidden style="font-size:0.92rem;"></div>' +
            "</div>"
          return state
        }
        freeQueueAvailable = true
        var selectedTab = body.querySelector('[data-icono-request-tab][aria-selected="true"]')
        if (freeFooter) {
          freeFooter.hidden =
            !selectedTab || selectedTab.getAttribute("data-icono-request-tab") !== "free"
        }
        wireAuthenticatedRequestForm(state)
        return state
      })
    }

    function handleSummaryLoadError(error) {
      setStatus(
        "Request tools unavailable: " + String((error && error.message) || "Unknown error"),
        "error",
      )
      if (!currentUserIsIconoAdmin) return
      loadGeneRequestDiagnostics(symbol)
        .then(function (diagnostics) {
          body.innerHTML += renderRequestDiagnosticsMarkup(diagnostics)
        })
        .catch(function (diagnosticError) {
          body.innerHTML +=
            '<details class="icono-request-diagnostics">' +
            "<summary>Admin diagnostics</summary>" +
            '<div class="icono-request-diagnostics-body">' +
            esc(String((diagnosticError && diagnosticError.message) || "Diagnostics unavailable")) +
            "</div></details>"
        })
    }

    var freeTabLoaded = false
    var freeTabLoading = null
    function initializeFreeTab() {
      if (freeTabLoaded || freeTabLoading) return freeTabLoading
      setStatus("Loading free queue…")
      freeTabLoading = loadSummary()
        .then(function (state) {
          freeTabLoaded = true
          setStatus("")
          return state
        })
        .catch(function (error) {
          handleSummaryLoadError(error)
          return null
        })
        .finally(function () {
          freeTabLoading = null
        })
      return freeTabLoading
    }

    // Install the interaction model without fetching either workflow. Each
    // tab owns its first backend read and keeps its DOM state when hidden.
    wireAuthenticatedRequestForm({})
    panel.addEventListener("icono-request-tab-activate", function (event) {
      if (event.detail && event.detail.tab === "free") void initializeFreeTab()
    })
  }

  /* ─── Client-side router ─── */

  function getRoute() {
    var path = window.location.pathname
    if (
      path === "/" ||
      path === "" ||
      path === "/apps/iconoplasm" ||
      path === "/apps/iconoplasm/" ||
      path === "/Iconoplasm" ||
      path === "/Iconoplasm.html"
    )
      return { page: "home" }
    if (
      path === "/clans" ||
      path === "/clans/" ||
      path === "/apps/iconoplasm/clans" ||
      path === "/apps/iconoplasm/clans/"
    )
      return { page: "clans" }
    if (
      path === "/studio" ||
      path === "/studio/" ||
      path === "/apps/iconoplasm/studio" ||
      path === "/apps/iconoplasm/studio/"
    )
      return { page: "studio" }
    var m = path.match(/^\/gene\/(.+)$/)
    if (m) return { page: "gene", symbol: decodeURIComponent(m[1]) }
    return { page: "404" }
  }

  /* ─── Rendering: Home page ─── */

  function renderHome(root, restoreState) {
    restoreState = restoreState || pendingHomeRestoreState
    lastGenePageDiscoveryVisitKey = ""
    var homeLayout = resolveHomeLayout()
    var cardVariant = resolveCardVariant()
    var homeGridLayout = effectiveHomeGridLayout(homeLayout, cardVariant)
    var settings = readIconoplasmSettings()
    var useClassicGallery = !!(
      currentUser &&
      currentUserIsIconoAdmin &&
      settings &&
      settings.showAllGenes
    )
    var initialUrl = new URL(window.location.href)
    var restoredScope = String(
      (restoreState && restoreState.scope) || initialUrl.searchParams.get("scope"),
    )
    var restoredOrder = String(
      (restoreState && restoreState.order) || initialUrl.searchParams.get("order"),
    )
    if (
      !restoreState &&
      (initialUrl.searchParams.has("after") ||
        initialUrl.searchParams.has("offset") ||
        initialUrl.searchParams.has("anchor"))
    ) {
      restoreState = {
        page: Math.max(1, Number(initialUrl.searchParams.get("page") || 1) || 1),
        cursor: String(initialUrl.searchParams.get("after") || ""),
        offset: Math.max(0, Number(initialUrl.searchParams.get("offset") || 0) || 0),
        anchorGene: String(initialUrl.searchParams.get("anchor") || ""),
        anchorTop: Number(initialUrl.searchParams.get("anchorOffset") || 0) || 0,
        seed: String(initialUrl.searchParams.get("seed") || ""),
      }
    }
    if (restoreState && (restoreState.anchorGene || Number(restoreState.offset || 0) > 0)) {
      pendingHomeRestoreState = restoreState
    }
    var galleryState = {
      order: useClassicGallery
        ? restoredOrder || GALLERY_DEFAULT_ORDER
        : normalizeHomeCollectionOrder(restoredOrder || HOME_COLLECTION_DEFAULT_ORDER),
      seed: String((restoreState && restoreState.seed) || ""),
      total: 0,
      publishedTotal: 0,
      discoveredCount: 0,
      authenticated: !!currentUser,
      ready: useClassicGallery,
      sharedDiscoveries: !useClassicGallery && restoredScope === "shared",
      discoveryEntries: [],
      sortedDiscoveries: [],
      items: [],
      showAllGenes: useClassicGallery,
    }
    var disposed = false
    var localReadyPromise = null
    var latestFeedSnapshot = null
    if (galleryState.order === "random" && !galleryState.seed) {
      galleryState.seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    }

    iconoSidebarState.page = "home"
    iconoSidebarState.homeLayout = homeGridLayout
    iconoSidebarState.gene = null
    root.innerHTML = buildHomeShellMarkup(homeLayout, cardVariant)
    loadInstallReleaseMetadata()
    renderHomeInstallCta()
    syncPublicInventoryStat()
    probeForIconoplasmExtensionPresence()

    var feed = document.getElementById("icono-grid")
    var statusEl = document.getElementById("icono-feed-status")
    var retryButton = document.getElementById("icono-feed-retry")
    var countEl = document.getElementById("icono-gene-count")
    var summaryEl = document.getElementById("icono-collection-summary")
    var emptyEl = document.getElementById("icono-empty")
    var input = document.getElementById("icono-q")
    var resultsEl = document.getElementById("icono-results")
    var orderEl = document.getElementById("icono-order")
    var activeSearchRequest = 0
    var searchTimer = null
    var activeSearchIndex = -1
    var currentSearchResults = []

    function activeScope() {
      return galleryState.sharedDiscoveries ? "shared" : "personal"
    }

    function collectionPageSize() {
      return isMobileLabelReviewEnabled()
        ? HOME_COLLECTION_MOBILE_PAGE_SIZE
        : HOME_COLLECTION_PAGE_SIZE
    }

    function mountedCardLimit() {
      return isMobileLabelReviewEnabled() ? 24 : 48
    }

    function syncOrderOptions() {
      orderEl.innerHTML = useClassicGallery
        ? galleryOptionsMarkup()
        : galleryState.sharedDiscoveries
          ? sharedDiscoveryOptionsMarkup()
          : homeCollectionOptionsMarkup()
      var allowed = Array.from(orderEl.options).some(function (option) {
        return option.value === galleryState.order
      })
      if (!allowed)
        galleryState.order = useClassicGallery
          ? GALLERY_DEFAULT_ORDER
          : HOME_COLLECTION_DEFAULT_ORDER
      orderEl.value = galleryState.order
    }

    function syncCounts() {
      var discovered = Math.max(galleryState.discoveredCount, galleryState.discoveryEntries.length)
      iconoSidebarState.total = useClassicGallery ? galleryState.total : discovered
      iconoSidebarState.publishedTotal = useClassicGallery
        ? galleryState.publishedTotal
        : galleryState.total
      renderIconoplasmSidebar()
      if (!countEl) return
      if (useClassicGallery) {
        countEl.textContent = galleryState.total
          ? galleryState.total.toLocaleString() +
            " human genes, " +
            galleryState.publishedTotal.toLocaleString() +
            " AI blots"
          : "Loading gallery..."
      } else if (galleryState.total) {
        countEl.textContent =
          discovered.toLocaleString() +
          " discovered of " +
          galleryState.total.toLocaleString() +
          " human genes"
      } else if (discovered) {
        countEl.textContent = discovered.toLocaleString() + " discovered genes"
      } else {
        countEl.textContent = galleryState.authenticated
          ? "No discovered genes yet"
          : "Sign in to keep a synced collection"
      }
    }

    function syncCollectionChrome() {
      syncCounts()
      var guestPreviewActive =
        !useClassicGallery &&
        galleryState.ready &&
        !galleryState.authenticated &&
        !galleryState.sharedDiscoveries
      var postFeedStage = document.getElementById("icono-post-feed-stage")
      var guestContinuation = document.getElementById("icono-guest-continuation")
      if (postFeedStage) {
        postFeedStage.classList.toggle("icono-post-feed-stage--guest-preview", guestPreviewActive)
      }
      if (guestContinuation) guestContinuation.hidden = !guestPreviewActive
      if (useClassicGallery) {
        summaryEl.hidden = true
        emptyEl.hidden = true
        orderEl.disabled = false
        return
      }
      summaryEl.hidden = false
      summaryEl.innerHTML = galleryState.ready
        ? buildCollectionSummaryMarkup(galleryState)
        : buildCollectionSummarySkeletonMarkup(galleryState)
      var toggle = summaryEl.querySelector("[data-icono-shared-discoveries-toggle]")
      if (toggle) {
        toggle.addEventListener("change", function () {
          var nextShared = !!toggle.checked
          if (nextShared === galleryState.sharedDiscoveries) return
          galleryState.sharedDiscoveries = nextShared
          if (nextShared && !accountGalleryWindowOrderSupported(galleryState.order)) {
            galleryState.order = HOME_COLLECTION_DEFAULT_ORDER
          }
          restoreState = null
          pendingHomeRestoreState = null
          resetCollection(true)
          refreshSearchResults()
        })
      }
      var hasItems = galleryState.discoveredCount > 0 || galleryState.discoveryEntries.length > 0
      emptyEl.hidden = !galleryState.ready || hasItems
      emptyEl.innerHTML = emptyEl.hidden ? "" : buildCollectionEmptyMarkup(galleryState)
      orderEl.disabled = galleryState.ready && !hasItems
    }

    function ensureLocalCollection(signal) {
      if (galleryState.ready && galleryState.sortedDiscoveries.length) return Promise.resolve()
      if (localReadyPromise) return localReadyPromise
      if (!currentUser && !galleryState.sharedDiscoveries) {
        localReadyPromise = initialSharedSettingsPromise
          .then(function () {
            if (disposed) return
            galleryState.total = ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT
            galleryState.publishedTotal = 0
            galleryState.authenticated = false
            galleryState.discoveryEntries = guestDiscoveryEntries()
            galleryState.sortedDiscoveries = galleryState.discoveryEntries.slice()
            galleryState.discoveredCount = galleryState.sortedDiscoveries.length
            galleryState.ready = true
            syncCollectionChrome()
          })
          .finally(function () {
            localReadyPromise = null
          })
        return localReadyPromise
      }
      localReadyPromise = initialSharedSettingsPromise
        .then(function () {
          fetchHomeCollectionCounts().then(function (countData) {
            if (disposed) return
            galleryState.total = Math.max(0, Number((countData && countData.total) || 0) || 0)
            galleryState.publishedTotal = Math.max(
              0,
              Number((countData && countData.publishedTotal) || 0) || 0,
            )
            syncCollectionChrome()
          })
          return fetchDiscoveryState(galleryState.order, galleryState.seed, {
            signal: signal,
          })
        })
        .then(function (discoveryData) {
          if (disposed) return
          discoveryData = discoveryData || {}
          galleryState.authenticated = !!discoveryData.authenticated
          galleryState.seed =
            galleryState.order === "random" ? String(discoveryData.seed || galleryState.seed) : ""
          galleryState.discoveryEntries = normalizeDiscoveryEntries(
            galleryState.authenticated ? discoveryData.discoveries : guestDiscoveryEntries(),
          )
          galleryState.sortedDiscoveries = galleryState.discoveryEntries.slice()
          galleryState.discoveredCount = galleryState.sortedDiscoveries.length
          galleryState.ready = true
          syncCollectionChrome()
        })
        .finally(function () {
          localReadyPromise = null
        })
      return localReadyPromise
    }

    async function requestFeedPage(request) {
      var direction = request.direction
      var offset = Math.max(0, Number(request.offset || 0) || 0)
      var limit = request.limit
      if (useClassicGallery) {
        var path =
          "/api/public/v1/gallery?order=" +
          encodeURIComponent(galleryState.order) +
          "&limit=" +
          encodeURIComponent(String(limit)) +
          "&offset=" +
          encodeURIComponent(String(offset))
        if (galleryState.seed) path += "&seed=" + encodeURIComponent(galleryState.seed)
        var data = await fetchJSON(path, { signal: request.signal })
        var galleryItems = Array.isArray(data.items) ? data.items : []
        await ensurePortraitDelivery(galleryItems)
        galleryState.total = Math.max(0, Number(data.total || 0) || 0)
        galleryState.publishedTotal = Math.max(0, Number(data.published_total || 0) || 0)
        galleryState.ready = true
        syncCollectionChrome()
        return {
          items: galleryItems,
          startIndex: offset,
          total: galleryState.total,
          hasMore: !!data.has_more,
          hasPrevious: offset > 0,
          snapshotVersion: data.snapshot_version,
        }
      }

      if (accountGalleryWindowAvailable(galleryState.order, activeScope())) {
        var paging =
          direction === "backward" ? { before: request.cursor } : { after: request.cursor }
        var accountData = await fetchAccountGalleryWindow(galleryState.order, paging, limit, {
          scope: activeScope(),
          view: isImageOnlyCardVariant(cardVariant) ? "image-only" : "",
          signal: request.signal,
        })
        var cards = Array.isArray(accountData.cards)
          ? accountData.view === "image-only"
            ? accountData.cards
            : accountData.cards.map(mobileCardPayloadFromVM)
          : []
        var accountFailures = Array.isArray(accountData.missing)
          ? accountData.missing.map(function (symbol) {
              return { symbol: normalizedSymbol(symbol), reason: "manifest_missing" }
            })
          : []
        await ensurePortraitDelivery(cards)
        galleryState.authenticated = !!accountData.authenticated
        galleryState.discoveredCount = Math.max(0, Number(accountData.discovered_count || 0) || 0)
        galleryState.discoveryEntries = Array.isArray(accountData.items)
          ? accountData.items
              .map(function (item) {
                return item.discovery
              })
              .filter(Boolean)
          : []
        galleryState.ready = true
        syncCollectionChrome()
        return {
          items: cards,
          failures: accountFailures,
          startIndex: offset,
          total: galleryState.discoveredCount,
          discoveredCount: galleryState.discoveredCount,
          hasPrevious: !!accountData.has_previous,
          previousCursor: accountData.previous_cursor,
          hasMore: !!accountData.has_more,
          nextCursor: accountData.next_cursor,
          snapshotVersion: String(accountData.vm_version || ""),
        }
      }

      await ensureLocalCollection(request.signal)
      var entries = galleryState.sortedDiscoveries.slice(offset, offset + limit)
      var localItems
      var localFailures = []
      if (shouldUseImmediateDiscoveryFallback(homeLayout, cardVariant)) {
        localItems = entries.map(fallbackDiscoveredGene).filter(Boolean)
      } else {
        var result = await loadMobileCardPageVM(entries, { signal: request.signal })
        localItems = Array.isArray(result && result.cards) ? result.cards.filter(Boolean) : []
        localFailures = Array.isArray(result && result.failures) ? result.failures : []
      }
      await ensurePortraitDelivery(localItems)
      prewarmMobileCardPageVM(
        galleryState.sortedDiscoveries.slice(offset + limit, offset + limit * 2),
      )
      return {
        items: localItems,
        failures: localFailures,
        startIndex: offset,
        total: galleryState.sortedDiscoveries.length,
        discoveredCount: galleryState.sortedDiscoveries.length,
        hasPrevious: offset > 0,
        hasMore: offset + entries.length < galleryState.sortedDiscoveries.length,
        snapshotVersion: String((result && result.snapshotVersion) || ""),
      }
    }

    function renderFeedSegment(segmentElement, items, startIndex) {
      var inner = document.createElement("div")
      inner.className = "icono-grid icono-feed-segment-grid"
      inner.setAttribute("data-layout", homeGridLayout)
      segmentElement.appendChild(inner)
      appendGrid(inner, items, startIndex, homeLayout, cardVariant)
    }

    function wireMountedSegment(segment, cards) {
      var inner = segment.element.querySelector(".icono-feed-segment-grid")
      if (segment.failures.length) appendMobileDataFailureTiles(inner, segment.failures)
      galleryState.items = itemsFromCards(cards)
      if (shouldUseHomeMasonry(homeLayout, cardVariant)) {
        var layoutReady = applyHomeMasonry(inner, cards)
        void layoutReady
          .then(function () {
            return hydrateBrickCards(cards)
          })
          .then(function () {
            if (inner.isConnected) return applyHomeMasonry(inner)
          })
          .catch(function (error) {
            console.error("[Iconoplasm] mounted feed hydration failed:", error)
          })
        return layoutReady
      } else {
        warmBrickCardImages(segment.items)
        wireBrickVoteBoxes(cards)
        wireMobileLabelCards(cards)
        refreshPortraitLightbox()
        return hydrateBrickCards(cards)
      }
    }

    function itemsFromCards(cards) {
      return Array.from(cards || []).map(function (card) {
        return { symbol: card.getAttribute("data-icono-symbol") || "" }
      })
    }

    function updateFeedHistory(snapshot) {
      latestFeedSnapshot = snapshot
      writeCollectionHistory(false)
    }

    function syncCrawlableNextLink(payload, segment) {
      var link = document.head.querySelector("link[data-icono-feed-next]")
      if (segment.direction !== "forward" || !payload.hasMore) {
        if (segment.direction === "forward" && link) link.remove()
        return
      }
      if (!link) {
        link = document.createElement("link")
        link.rel = "next"
        link.setAttribute("data-icono-feed-next", "")
        document.head.appendChild(link)
      }
      var nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set("page", String(segment.page + 1))
      nextUrl.searchParams.set("offset", String(segment.startIndex + segment.count))
      var nextCursor = String(payload.nextCursor || payload.next_cursor || "")
      if (nextCursor) nextUrl.searchParams.set("after", nextCursor)
      else nextUrl.searchParams.delete("after")
      nextUrl.searchParams.delete("anchor")
      nextUrl.searchParams.delete("anchorOffset")
      link.href = nextUrl.href
    }

    var feedController = createCollectionFeedController({
      feed: feed,
      status: statusEl,
      retryButton: retryButton,
      initialPageSize: HOME_COLLECTION_INITIAL_PAGE_SIZE,
      pageSize: collectionPageSize,
      mountedCardLimit: mountedCardLimit,
      payloadCacheSize: 8,
      requestPage: requestFeedPage,
      renderSegment: renderFeedSegment,
      onSegmentMounted: wireMountedSegment,
      onSegmentUnmount: function (_segment, element) {
        var inner = element.querySelector(".icono-feed-segment-grid")
        if (inner) destroyHomeMasonry(inner)
      },
      onPage: function (_payload, segment) {
        syncCrawlableNextLink(_payload, segment)
        if (segment.startIndex === 0) {
          var auxiliary = document.getElementById("icono-home-auxiliary")
          auxiliary.hidden = false
          appendHomeInstallCard(auxiliary)
          appendDiscordActionCard(auxiliary)
        }
        syncCollectionChrome()
        if (restoreState && restoreState.anchorGene) {
          var pendingRestore = {
            gene: String(restoreState.anchorGene).toUpperCase(),
            top: Number(restoreState.anchorTop || 0),
          }
          restoreState = null
          Promise.resolve(segment.mountReady).then(function () {
            var correctAnchor = function () {
              if (disposed) return
              var card = feed.querySelector(
                '[data-icono-symbol="' + CSS.escape(pendingRestore.gene) + '"]',
              )
              if (!card) return
              var delta = card.getBoundingClientRect().top - pendingRestore.top
              if (Math.abs(delta) > 0.5) {
                scrollWindowInstantly(
                  Number(window.scrollX || 0),
                  Math.max(0, Number(window.scrollY || 0) + delta),
                )
              }
              pendingHomeRestoreState = null
            }
            correctAnchor()
            runAfterNextPaint(correctAnchor)
          })
        }
      },
      onStateChange: updateFeedHistory,
      onError: function (error) {
        console.error("[Iconoplasm] collection feed error:", error)
      },
    })

    function snapshotHomeState() {
      var pendingCard = pendingHomeAnchor && pendingHomeAnchor.card
      var snapshot = pendingCard
        ? feedController.snapshot(pendingCard)
        : latestFeedSnapshot || feedController.snapshot()
      return {
        restoreSession: ICONO_ARCHIVE_RESTORE_SESSION,
        order: galleryState.order,
        scope: activeScope(),
        sharedDiscoveries: galleryState.sharedDiscoveries,
        seed: galleryState.seed,
        page: snapshot.page || 1,
        cursor: snapshot.cursor || "",
        offset: snapshot.offset || 0,
        anchorGene: snapshot.anchorGene || "",
        anchorTop: Number(snapshot.anchorTop || 0),
        scrollY: Math.max(0, Math.round(window.scrollY || 0)),
      }
    }

    function writeCollectionHistory(push) {
      var snapshot = snapshotHomeState()
      var state = Object.assign({}, window.history.state || {}, {
        iconoplasm: true,
        quartzRouterIgnore: true,
        iconoplasmPage: "home",
        iconoplasmHome: snapshot,
      })
      var visibleUrl = buildIconoplasmCollectionVisibleUrl(window.location.href, {
        order: galleryState.order,
        defaultOrder: useClassicGallery ? GALLERY_DEFAULT_ORDER : HOME_COLLECTION_DEFAULT_ORDER,
        scope: activeScope(),
        seed: galleryState.seed,
      })
      window.history[push ? "pushState" : "replaceState"](state, "", visibleUrl)
    }

    function resetCollection(pushHistory) {
      destroyHomeMasonry()
      clearHomeAuxiliaryCards()
      galleryState.ready = useClassicGallery
      galleryState.discoveryEntries = []
      galleryState.sortedDiscoveries = []
      galleryState.items = []
      galleryState.discoveredCount = 0
      localReadyPromise = null
      latestFeedSnapshot = { page: 1, cursor: "", offset: 0, anchorGene: "", anchorTop: 0 }
      syncOrderOptions()
      syncCollectionChrome()
      if (pushHistory) writeCollectionHistory(true)
      var startOffset = Math.max(0, Number((restoreState && restoreState.offset) || 0) || 0)
      var startCursor = String((restoreState && restoreState.cursor) || "")
      var startPage = Math.max(1, Number((restoreState && restoreState.page) || 1) || 1)
      if (!hasResolvedAuthState && !galleryState.sharedDiscoveries && !useClassicGallery) return
      void feedController.reset({ offset: startOffset, cursor: startCursor, page: startPage })
    }

    syncOrderOptions()
    syncCollectionChrome()
    activeHomeHistorySnapshot = snapshotHomeState
    var refreshVisibleSnapshot = function () {
      if (disposed || document.visibilityState === "hidden") return Promise.resolve(false)
      var loadedVersion = String(feedController.debugState().snapshotVersion || "").trim()
      if (!loadedVersion) return Promise.resolve(false)
      if (refreshVisibleSnapshot.promise) return refreshVisibleSnapshot.promise
      refreshVisibleSnapshot.promise = fetchJSON(
        "/api/public/v1/metadata?gallery-freshness=" + encodeURIComponent(String(Date.now())),
        {
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        },
      )
        .then(function (metadata) {
          if (disposed) return false
          var currentVersion = String((metadata && metadata.card_snapshot_version) || "").trim()
          if (!currentVersion || currentVersion === loadedVersion) return false
          // Preserve the visible card and its viewport position, but discard all
          // mounted payloads. A long-lived or back/forward-restored tab must not
          // keep displaying a portrait from an older canonical snapshot.
          pendingHomeRestoreState = snapshotHomeState()
          render()
          return true
        })
        .catch(function (error) {
          console.warn(
            "[Iconoplasm] visible gallery freshness check failed:",
            String((error && error.message) || error || "unknown"),
          )
          return false
        })
        .finally(function () {
          refreshVisibleSnapshot.promise = null
        })
      return refreshVisibleSnapshot.promise
    }
    refreshVisibleSnapshot.promise = null
    activeHomeFreshnessCheck = refreshVisibleSnapshot
    activeHomeRenderCleanup = function () {
      disposed = true
      if (activeHomeFreshnessCheck === refreshVisibleSnapshot) activeHomeFreshnessCheck = null
      activeSearchRequest += 1
      clearTimeout(searchTimer)
      feedController.dispose()
      destroyHomeMasonry()
      var nextLink = document.head.querySelector("link[data-icono-feed-next]")
      if (nextLink) nextLink.remove()
      document.removeEventListener("click", handleSearchOutsideClick)
    }
    orderEl.addEventListener("change", function () {
      galleryState.order = useClassicGallery
        ? String(orderEl.value || GALLERY_DEFAULT_ORDER)
        : normalizeHomeCollectionOrder(orderEl.value || HOME_COLLECTION_DEFAULT_ORDER)
      galleryState.seed =
        galleryState.order === "random"
          ? Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
          : ""
      restoreState = null
      pendingHomeRestoreState = null
      resetCollection(true)
    })
    resetCollection(false)

    function activeSearchScope() {
      if (useClassicGallery) return "catalog"
      return galleryState.sharedDiscoveries ? "shared" : "discoveries"
    }

    function refreshSearchResults() {
      if (disposed) return
      var query = input.value.trim()
      var scope = activeSearchScope()
      var requestId = ++activeSearchRequest
      clearTimeout(searchTimer)
      activeSearchIndex = -1
      if (!query) {
        currentSearchResults = []
        resultsEl.innerHTML = ""
        input.setAttribute("aria-expanded", "false")
        return
      }
      fetchAuthedJSON(
        "/api/public/v1/genes/search?q=" +
          encodeURIComponent(query) +
          "&limit=12&scope=" +
          encodeURIComponent(scope),
      )
        .then(function (data) {
          if (requestId !== activeSearchRequest || input.value.trim() !== query) return
          currentSearchResults = data.genes || []
          renderSearchResults(resultsEl, currentSearchResults)
        })
        .catch(function () {
          if (requestId !== activeSearchRequest) return
          currentSearchResults = []
          resultsEl.innerHTML = ""
          input.setAttribute("aria-expanded", "false")
        })
    }

    input.addEventListener("input", function () {
      clearTimeout(searchTimer)
      searchTimer = window.setTimeout(refreshSearchResults, DEBOUNCE_MS)
    })
    input.addEventListener("keydown", function (event) {
      var items = resultsEl.querySelectorAll(".icono-search-result")
      if (event.key === "ArrowDown" && items.length) {
        event.preventDefault()
        activeSearchIndex = Math.min(activeSearchIndex + 1, items.length - 1)
        highlightResult(items, activeSearchIndex)
      } else if (event.key === "ArrowUp" && items.length) {
        event.preventDefault()
        activeSearchIndex = Math.max(activeSearchIndex - 1, -1)
        highlightResult(items, activeSearchIndex)
      } else if (event.key === "Enter" && currentSearchResults.length) {
        event.preventDefault()
        var selected = currentSearchResults[Math.max(0, activeSearchIndex)]
        navigateTo("/gene/" + encodeURIComponent(selected.symbol))
      } else if (event.key === "Escape") {
        resultsEl.innerHTML = ""
        input.setAttribute("aria-expanded", "false")
      }
    })
    function handleSearchOutsideClick(event) {
      if (!event.target.closest(".icono-search-wrapper")) {
        resultsEl.innerHTML = ""
        input.setAttribute("aria-expanded", "false")
      }
    }
    document.addEventListener("click", handleSearchOutsideClick)
  }

  function highlightResult(items, idx) {
    var input = items.length
      ? items[0].closest(".icono-search-wrapper").querySelector("input")
      : null
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === idx)
      items[i].setAttribute("aria-selected", i === idx ? "true" : "false")
    }
    if (!input) return
    if (idx >= 0 && items[idx]) input.setAttribute("aria-activedescendant", items[idx].id)
    else input.removeAttribute("aria-activedescendant")
  }

  function renderSearchResults(container, genes) {
    var input = container.closest(".icono-search-wrapper").querySelector("input")
    input.setAttribute("aria-expanded", "true")
    input.removeAttribute("aria-activedescendant")
    if (!genes.length) {
      container.innerHTML =
        '<div class="icono-search-result" role="option" aria-disabled="true" style="pointer-events:none;opacity:0.5;">No results</div>'
      return
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      var g = genes[i]
      var portraitUrl = publishedPortraitUrl(g, "thumb") || publishedPortraitUrl(g, "medium")
      var mediaHtml = portraitUrl
        ? '<span class="icono-search-result-media icono-search-result-media--portrait">' +
          '<img class="icono-search-result-portrait icono-thumbnail-viewport-image" src="' +
          esc(portraitUrl) +
          '" alt="' +
          esc(g.symbol) +
          ' blot" loading="eager" decoding="async">' +
          "</span>"
        : '<span class="icono-search-result-media icono-search-result-media--fallback" style="background:' +
          esc(g.color) +
          '"></span>'
      html +=
        '<a class="icono-search-result" id="icono-search-result-' +
        i +
        '" role="option" aria-selected="false" data-icono-nav href="/gene/' +
        esc(encodeURIComponent(g.symbol)) +
        '">' +
        mediaHtml +
        '<span class="icono-search-result-copy">' +
        '<span class="icono-search-result-symbol">' +
        esc(g.symbol) +
        "</span>" +
        '<span class="icono-search-result-name">' +
        esc(g.full_name) +
        "</span>" +
        "</span>" +
        "</a>"
    }
    container.innerHTML = html
  }

  function buildMasonryGridMarkup(genes, startIndex) {
    if (!genes.length) {
      return ""
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      var g = genes[i]
      var cardIndex = startIndex + i
      var dims = portraitDimensions(g)
      var tc = textColorFor(g.color)
      var portraitUrl = publishedPortraitUrl(g, "medium")
      var mediaClass = portraitUrl
        ? "icono-card-media"
        : "icono-card-media icono-card-media--fallback"
      html +=
        '<a class="icono-card icono-card--masonry" href="/gene/' +
        esc(encodeURIComponent(g.symbol)) +
        '" target="_blank" rel="noopener noreferrer" data-icono-index="' +
        cardIndex +
        '" data-icono-symbol="' +
        esc(g.symbol) +
        '" style="--width:' +
        dims.width +
        ";--height:" +
        dims.height +
        ";--icono-card-accent:" +
        esc(g.color || "#888") +
        ';">' +
        '<div class="' +
        mediaClass +
        '" style="background:' +
        esc(g.color) +
        ";color:" +
        tc +
        '">' +
        (portraitUrl
          ? // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Loading Performance) +
            // C:\Users\Admin\.codex\skills\frontend-design\SKILL.md (Motion / keep exits and
            // reveals lightweight). The first visible home cards stay eager so the public gallery
            // feels present immediately, then later cards fall back to lazy loading.
            '<img src="' +
            esc(portraitUrl) +
            '" alt="' +
            esc(g.symbol) +
            ' blot" loading="' +
            (cardIndex < 12 ? "eager" : "lazy") +
            '" decoding="async" width="' +
            dims.width +
            '" height="' +
            dims.height +
            '" fetchpriority="' +
            (cardIndex < 8 ? "high" : "low") +
            '">'
          : '<span class="icono-card-fallback-symbol">' + esc(g.symbol) + "</span>") +
        '<span class="icono-card-badge">' +
        esc(g.symbol) +
        "</span>" +
        "</div>" +
        '<div class="icono-card-info">' +
        '<div class="icono-card-name">' +
        esc(g.full_name) +
        "</div>" +
        "</div>" +
        "</a>"
    }
    return html
  }

  function buildImageOnlyTileCardMarkup(g, cardIndex) {
    var dims = portraitDimensions(g)
    var key = normalizedSymbol(g.symbol)
    var portraitUrl = publishedPortraitUrl(g, "medium")
    var href = "/gene/" + esc(encodeURIComponent(g.symbol))
    var geneLinkAttrs = 'target="_blank" rel="noopener noreferrer"'
    var detail = readCachedRenderableGenePayload(key)
    return (
      '<article class="icono-card icono-card--image-tile icono-card--variant-image-only" data-icono-index="' +
      cardIndex +
      '" data-icono-symbol="' +
      esc(g.symbol) +
      '" data-icono-card-variant="image-only" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(g.color || "#888") +
      ';">' +
      buildArchivalBodyMarkup(detail || g, {
        mode: "brick",
        layoutVariant: "image-only",
        mobileReview: false,
        portraitAlt: g.symbol + " blot",
        portraitSrc: portraitUrl,
        titleHref: href,
        titleLinkAttrs: geneLinkAttrs,
        voteHtml: "",
      }) +
      "</article>"
    )
  }

  function buildImageOnlyTileGridMarkup(genes, startIndex) {
    if (!genes.length) {
      return ""
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      html += buildImageOnlyTileCardMarkup(genes[i], startIndex + i)
    }
    return html
  }

  function buildBrickGridMarkup(genes, startIndex, cardVariant) {
    if (!genes.length) {
      return ""
    }
    var html = ""
    var resolvedCardVariant = normalizeRenderableCardVariant(cardVariant)
    for (var i = 0; i < genes.length; i++) {
      html += buildBrickCardMarkup(genes[i], startIndex + i, resolvedCardVariant)
    }
    return html
  }

  function renderGrid(container, genes, layout, cardVariant) {
    var resolvedLayout = layout || resolveHomeLayout()
    var resolvedCardVariant = cardVariant || resolveCardVariant()
    rememberGeneCardArtifacts(genes)
    container.innerHTML = isImageOnlyCardVariant(resolvedCardVariant)
      ? buildImageOnlyTileGridMarkup(genes, 0)
      : resolvedLayout === "masonry"
        ? buildMasonryGridMarkup(genes, 0)
        : buildBrickGridMarkup(genes, 0, resolvedCardVariant)
    syncImageOnlyLoadState(container)
  }

  function appendGrid(container, genes, startIndex, layout, cardVariant) {
    var resolvedLayout = layout || resolveHomeLayout()
    var resolvedCardVariant = cardVariant || resolveCardVariant()
    rememberGeneCardArtifacts(genes)
    var html = isImageOnlyCardVariant(resolvedCardVariant)
      ? buildImageOnlyTileGridMarkup(genes, startIndex)
      : resolvedLayout === "masonry"
        ? buildMasonryGridMarkup(genes, startIndex)
        : buildBrickGridMarkup(genes, startIndex, resolvedCardVariant)
    if (!html) return []
    var wrapper = document.createElement("div")
    wrapper.innerHTML = html
    var newElements = Array.prototype.slice.call(wrapper.children)
    for (var i = 0; i < newElements.length; i++) {
      container.appendChild(newElements[i])
    }
    syncImageOnlyLoadState(container)
    return newElements
  }

  function renderCandidateGallery(genePayload) {
    var candidates = Array.isArray(genePayload && genePayload.portrait_candidates)
      ? genePayload.portrait_candidates
      : []
    var visibleCandidates = []
    for (var i = 0; i < candidates.length; i++) {
      var item = candidates[i]
      if (!item || item.is_current) continue
      if (!candidatePortraitUrl(item, "medium")) continue
      visibleCandidates.push(item)
    }
    if (!visibleCandidates.length)
      return IconoCardShared.renderCandidateGalleryStatusHtml(genePayload)
    var gridClass =
      visibleCandidates.length === 1
        ? "icono-candidate-grid icono-candidate-grid--single"
        : "icono-candidate-grid"
    var html =
      '<section class="icono-candidate-gallery">' +
      '<div class="icono-candidate-gallery-heading">' +
      '<h2>Other candidate images <span class="icono-candidate-count">' +
      visibleCandidates.length +
      "</span></h2>" +
      "</div>" +
      '<div class="' +
      gridClass +
      '" data-icono-lightbox>'
    for (var i = 0; i < visibleCandidates.length; i++) {
      var candidate = visibleCandidates[i]
      var mediumUrl = candidatePortraitUrl(candidate, "medium")
      var fullUrl = candidatePortraitUrl(candidate, "full") || mediumUrl
      var width = Number((candidate && candidate.width) || 4) || 4
      var height = Number((candidate && candidate.height) || 5) || 5
      var assetSha = String((candidate && candidate.asset_sha256) || "")
        .trim()
        .toLowerCase()
      var candidateImageId = Number((candidate && candidate.candidate_image_id) || 0)
      var visionId = String((candidate && candidate.vision_id) || "").trim()
      var sampleLabel = String((candidate && candidate.sample_label) || "").trim()
      var emulsionInfo = emulsionDisplayInfo(candidate)
      var sampleToolbarMarkup = sampleLabel
        ? '<div class="icono-candidate-toolbar-pair"><span>Sample</span><strong>' +
          esc(sampleLabel) +
          "</strong></div>"
        : ""
      var emulsionToolbarMarkup = emulsionInfo.primary
        ? '<div class="icono-candidate-toolbar-pair"><span>Emulsion</span><strong>' +
          esc(emulsionInfo.primary) +
          "</strong></div>" +
          renderEmulsionFavoriteButtonMarkup(
            emulsionInfo.emulsionId,
            "icono-emulsion-favorite-button--toolbar",
          )
        : ""
      var voteAttrs = 'data-icono-candidate-vote-box="' + esc(assetSha) + '"'
      if (Number.isFinite(candidateImageId) && candidateImageId > 0) {
        voteAttrs +=
          ' data-icono-candidate-image-id="' + esc(String(Math.round(candidateImageId))) + '"'
      }
      if (visionId) {
        voteAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
      }
      var removeMarkup = ""
      if (currentUserIsIconoAdmin && assetSha) {
        // B-467: the admin remove control is now an icon button so it visually matches the
        // approve/reject vote buttons. The "Remove" label stays as accessible text inside a
        // .icono-visually-hidden span so screen readers still announce the destructive verb.
        removeMarkup =
          '<div class="icono-candidate-admin-actions">' +
          '<button type="button" class="icono-candidate-action-btn icono-candidate-action-btn--remove icono-candidate-remove-button" data-icono-candidate-remove="true" data-icono-symbol="' +
          esc(genePayload.symbol) +
          '" data-icono-asset-sha256="' +
          esc(assetSha) +
          '" data-icono-candidate-image-id="' +
          esc(candidateImageId > 0 ? String(Math.round(candidateImageId)) : "") +
          '" data-icono-sample-label="' +
          esc(sampleLabel) +
          '" data-icono-emulsion-label="' +
          esc(emulsionInfo.primary) +
          '" aria-label="Remove candidate blot for ' +
          esc(genePayload.symbol) +
          '" title="Remove candidate blot">' +
          ICONO_TRASH_ICON +
          '<span class="icono-visually-hidden">Remove</span>' +
          "</button>" +
          "</div>"
      }
      var editMarkup =
        '<button type="button" class="icono-candidate-action-btn icono-candidate-action-btn--edit icono-image-edit-open" data-icono-edit-source="candidate" data-icono-source-symbol="' +
        esc(genePayload.symbol) +
        '" data-icono-source-asset-sha256="' +
        esc(assetSha) +
        '" data-icono-source-image-url="' +
        esc(mediumUrl || fullUrl || "") +
        '" data-icono-source-candidate-image-id="' +
        esc(candidateImageId > 0 ? String(Math.round(candidateImageId)) : "") +
        '" data-icono-source-vision-id="' +
        esc(visionId) +
        '" data-icono-source-upvotes="' +
        esc(String(sourceVoteCount(candidate, "image_upvotes"))) +
        '" data-icono-source-downvotes="' +
        esc(String(sourceVoteCount(candidate, "image_downvotes"))) +
        '" data-icono-source-score="' +
        esc(String(sourceVoteCount(candidate, "image_score"))) +
        '"' +
        imageEditSourceAdjustmentContextAttr(genePayload, candidate) +
        ' aria-label="Edit candidate blot for ' +
        esc(genePayload.symbol) +
        '" title="Edit candidate blot">' +
        ICONO_EDIT_ICON +
        '<span class="icono-visually-hidden">Edit candidate blot</span>' +
        "</button>"
      html +=
        '<article class="icono-candidate-card" style="--width:' +
        width +
        ";--height:" +
        height +
        ';">' +
        '<button type="button" class="icono-candidate-media-button" data-icono-pswp data-icono-pswp-src="' +
        esc(fullUrl) +
        '" data-icono-pswp-alt="' +
        esc(genePayload.symbol) +
        ' candidate blot" data-pswp-width="' +
        width +
        '" data-pswp-height="' +
        height +
        '" aria-label="Open candidate blot for ' +
        esc(genePayload.symbol) +
        '">' +
        '<span class="icono-candidate-media">' +
        '<img src="' +
        esc(mediumUrl) +
        '" data-iconoplasm-role="candidate-blot" data-gene-symbol="' +
        esc(genePayload.symbol) +
        '" alt="' +
        esc(genePayload.symbol) +
        ' candidate blot" loading="lazy" decoding="async" fetchpriority="low' +
        '" width="' +
        width +
        '" height="' +
        height +
        '">' +
        "</span>" +
        "</button>" +
        '<div class="icono-candidate-footer">' +
        voteBoxMarkup(voteAttrs) +
        (sampleToolbarMarkup || emulsionToolbarMarkup
          ? '<div class="icono-candidate-toolbar-meta">' +
            sampleToolbarMarkup +
            emulsionToolbarMarkup +
            "</div>"
          : "") +
        '<div class="icono-candidate-secondary-actions" data-icono-candidate-actions-island="' +
        esc(assetSha) +
        '">' +
        removeMarkup +
        editMarkup +
        // B-467: "Copy to gene" stays a <details>/<summary> for keyboard semantics, but the
        // summary is rendered as a circular icon control. The visible "Copy to gene" string
        // is preserved inside .icono-visually-hidden so the public-candidate-actions test
        // and screen-reader users still find the label, while the form opens as a floating
        // popover that does not push the candidate card height.
        '<details class="icono-candidate-copy-panel">' +
        '<summary class="icono-candidate-action-btn icono-candidate-action-btn--copy" aria-label="Copy to gene" title="Copy to gene">' +
        ICONO_BRANCH_ICON +
        '<span class="icono-visually-hidden">Copy to gene</span>' +
        "</summary>" +
        '<form class="icono-request-form icono-candidate-copy-popover" data-icono-candidate-copy-form data-icono-source-symbol="' +
        esc(genePayload.symbol) +
        '" data-icono-asset-sha256="' +
        esc(assetSha) +
        '">' +
        '<label class="icono-candidate-copy-popover-label">Copy to gene</label>' +
        '<input class="icono-search-input icono-request-picker-input" data-icono-candidate-copy-query type="text" autocomplete="off" placeholder="target gene symbol" aria-label="Target gene">' +
        '<input type="hidden" data-icono-candidate-copy-target value="">' +
        '<button type="submit" class="icono-request-inline-submit icono-candidate-copy-submit" aria-label="Copy blot to selected gene" title="Copy blot">' +
        ICONO_SEND_ICON +
        '<span class="icono-candidate-copy-submit-label">Copy blot</span>' +
        "</button>" +
        '<div class="icono-search-results icono-request-results" data-icono-candidate-copy-results hidden></div>' +
        '<div data-icono-candidate-copy-note hidden style="font-size:0.92rem;"></div>' +
        "</form>" +
        "</details>" +
        "</div>" +
        "</div>" +
        "</article>"
    }
    html += "</div>" + "</section>"
    return html
  }

  /* ─── Rendering: Gene detail page ─── */

  function genePageShellMarkup(includeSkeleton) {
    return (
      '<header class="icono-gene-page-header"><div class="icono-nav">' +
      '<a href="/" data-icono-nav>' +
      ICONO_ARROW_LEFT +
      "All genes</a>" +
      "</div></header>" +
      '<main class="icono-gene-page-main" id="icono-main">' +
      (includeSkeleton
        ? '<div class="icono-gene-skeleton" id="icono-gene-loading">' +
          buildBrickSkeletonCardMarkup() +
          "</div>"
        : "") +
      '<div id="icono-gene-content"></div>' +
      "</main>"
    )
  }

  function ensureGenePageLandmarks(root) {
    if (!root || root.querySelector(".icono-gene-page-main")) return
    var nav = root.querySelector(".icono-nav")
    var header = document.createElement("header")
    header.className = "icono-gene-page-header"
    if (nav && nav.parentNode === root) {
      root.insertBefore(header, nav)
      header.appendChild(nav)
    } else {
      header.innerHTML =
        '<div class="icono-nav"><a href="/" data-icono-nav>' +
        ICONO_ARROW_LEFT +
        "All genes</a></div>"
      root.insertBefore(header, root.firstChild)
    }
    var main = document.createElement("main")
    main.className = "icono-gene-page-main"
    main.id = "icono-main"
    var loading = root.querySelector("#icono-gene-loading")
    var content = root.querySelector("#icono-gene-content")
    root.appendChild(main)
    if (loading) main.appendChild(loading)
    if (content) main.appendChild(content)
  }

  function geneProfileDocumentTitle(gene, fallbackSymbol) {
    var symbol = normalizedSymbol(gene && gene.symbol ? gene.symbol : fallbackSymbol)
    var fullName = String((gene && gene.full_name) || "").trim()
    return fullName
      ? symbol + " — " + fullName + " | Iconoplasm character profile"
      : symbol + " | Iconoplasm character profile"
  }

  function renderGene(root, symbol, options) {
    var opts = options || {}
    var renderId = ++activeGeneRenderId
    var resolvedSymbol = normalizedSymbol(symbol)
    var bootstrap = window.__iconoplasmBootstrap || null
    var hasHeadStartedGene =
      !opts.forceFresh &&
      bootstrap &&
      bootstrap.geneDetailSymbol === resolvedSymbol &&
      (bootstrap.geneDetailPromise || bootstrap.geneCardData || bootstrap.geneCardPromise)
    if (
      !opts.forceFresh &&
      bootstrap &&
      bootstrap.geneDetailSymbol === resolvedSymbol &&
      bootstrap.geneCardData
    ) {
      rememberGeneCardArtifact(bootstrap.geneCardData, { trusted: true })
    }
    iconoSidebarState.page = "gene"
    iconoSidebarState.homeLayout = resolveHomeLayout()
    iconoSidebarState.gene = {
      symbol: resolvedSymbol,
      error: false,
      hasPortrait: false,
      candidateCount: 0,
      aliasCount: 0,
    }
    iconoSidebarState.caretaker = null
    renderIconoplasmSidebar()
    if (!hasHeadStartedGene) {
      root.innerHTML = genePageShellMarkup(true)
    }
    ensureGenePageLandmarks(root)

    var contentEl = document.getElementById("icono-gene-content")
    var loadingEl = document.getElementById("icono-gene-loading")
    if (contentEl) contentEl.classList.remove("icono-static-shell-only")
    root.querySelectorAll(".icono-static-shell-only").forEach(function (el) {
      el.classList.remove("icono-static-shell-only")
    })

    if (opts.forceFresh) {
      invalidateGeneDetail(symbol)
    }

    var richGenePromise = null
    var getRichGenePromise = function () {
      if (!richGenePromise) richGenePromise = fetchGeneDetail(symbol, opts)
      return richGenePromise
    }
    var firstGenePromise = getRichGenePromise()
      .then(function (richData) {
        return richData ? { data: richData, source: "detail" } : null
      })
      .then(function (winner) {
        if (!winner || !winner.data) return winner
        return ensurePortraitDelivery(winner.data).then(function () {
          return winner
        })
      })
    var renderGeneResult = function (result) {
      if (renderId !== activeGeneRenderId) return
      var g = result && result.data
      if (!g) throw new Error("Gene not found")
      document.title = geneProfileDocumentTitle(g, symbol)
      if (!contentEl) {
        root.innerHTML = genePageShellMarkup(false)
        contentEl = document.getElementById("icono-gene-content")
      }
      if (loadingEl) loadingEl.style.display = "none"
      if (!contentEl) {
        root.innerHTML = genePageShellMarkup(false)
        contentEl = document.getElementById("icono-gene-content")
      }
      iconoSidebarState.gene = {
        symbol: normalizedSymbol(g && g.symbol ? g.symbol : symbol),
        error: false,
        hasPortrait: !!publishedPortraitUrl(g, "medium"),
        candidateCount: Array.isArray(g && g.portrait_candidates)
          ? g.portrait_candidates.length
          : 0,
        aliasCount: Array.isArray(g && g.aliases) ? g.aliases.length : 0,
      }
      renderIconoplasmSidebar()
      var embeddedSnapshot =
        bootstrap && bootstrap.geneDetailSymbol === resolvedSymbol
          ? String(bootstrap.geneDetailSnapshotVersion || "")
          : ""
      var renderedSnapshot = String(
        (contentEl && contentEl.getAttribute("data-icono-gene-snapshot")) || "",
      )
      var publicManifestation = g && g.canonical_manifestation
      var publicManifestationProse = String(
        (publicManifestation && publicManifestation.prose) || "",
      )
      var shouldRenderPublicManifestation = !!(
        publicManifestation &&
        publicManifestation.public_page_visible === true &&
        publicManifestationProse.trim()
      )
      var renderedPublicManifestation =
        contentEl && contentEl.querySelector(".icono-public-manifestation")
      var renderedPublicManifestationBody =
        renderedPublicManifestation &&
        renderedPublicManifestation.querySelector(".icono-public-manifestation__body")
      var publicManifestationMatches = shouldRenderPublicManifestation
        ? !!(
            renderedPublicManifestationBody &&
            renderedPublicManifestationBody.textContent === publicManifestationProse
          )
        : !renderedPublicManifestation
      var canAdoptServerContent = !!(
        contentEl &&
        contentEl.getAttribute("data-icono-server-rendered-gene") === "true" &&
        contentEl.querySelector(".icono-candidate-gallery") &&
        embeddedSnapshot &&
        renderedSnapshot === embeddedSnapshot &&
        normalizedSymbol(contentEl.getAttribute("data-icono-gene-symbol")) === resolvedSymbol &&
        publicManifestationMatches
      )
      if (canAdoptServerContent) {
        wireGeneContent(contentEl, g)
      } else {
        renderGeneContent(contentEl, g)
      }
      recordGenePageVisitDiscovery(g && g.symbol ? g.symbol : symbol)
    }
    firstGenePromise.then(renderGeneResult).catch(function (err) {
      if (renderId !== activeGeneRenderId) return
      if (loadingEl) loadingEl.style.display = "none"
      iconoSidebarState.gene = {
        symbol: normalizedSymbol(symbol),
        error: true,
        hasPortrait: false,
        candidateCount: 0,
        aliasCount: 0,
      }
      renderIconoplasmSidebar()
      contentEl.innerHTML =
        '<div class="icono-empty">' +
        "<h2>Gene not found</h2>" +
        '<p>"' +
        esc(symbol) +
        "\" doesn't match any gene in our catalog.</p>" +
        '<p><a href="/" data-icono-nav>Browse all genes</a></p>' +
        "</div>"
      console.error("[Iconoplasm] gene load error:", err)
    })
  }

  function hydrateServerCandidateActionIslands(container, genePayload) {
    if (!container || !genePayload) return
    var signature = currentUserIsIconoAdmin ? "admin" : "public"
    var targets = Array.prototype.slice.call(
      container.querySelectorAll("[data-icono-candidate-actions-island]"),
    )
    targets = targets.filter(function (target) {
      return target.getAttribute("data-icono-candidate-actions-signature") !== signature
    })
    if (!targets.length) return
    var wrapper = document.createElement("div")
    wrapper.innerHTML = renderCandidateGallery(genePayload)
    var sources = wrapper.querySelectorAll(".icono-candidate-secondary-actions")
    var sourcesByAsset = new Map()
    for (var i = 0; i < sources.length; i += 1) {
      var sourceAsset = String(sources[i].getAttribute("data-icono-candidate-actions-island") || "")
        .trim()
        .toLowerCase()
      if (sourceAsset) sourcesByAsset.set(sourceAsset, sources[i])
    }
    for (var j = 0; j < targets.length; j += 1) {
      var targetAsset = String(targets[j].getAttribute("data-icono-candidate-actions-island") || "")
        .trim()
        .toLowerCase()
      var source = sourcesByAsset.get(targetAsset)
      targets[j].innerHTML = source ? source.innerHTML : ""
      targets[j].setAttribute("data-icono-candidate-actions-signature", signature)
      var sourceCard = source && source.closest(".icono-candidate-card")
      var targetCard = targets[j].closest(".icono-candidate-card")
      var sourceToolbar = sourceCard && sourceCard.querySelector(".icono-candidate-toolbar-meta")
      var targetToolbar = targetCard && targetCard.querySelector(".icono-candidate-toolbar-meta")
      if (sourceToolbar && targetToolbar) targetToolbar.innerHTML = sourceToolbar.innerHTML
    }
  }

  function syncServerGenePortraitUrls(container, genePayload) {
    if (!container || !genePayload) return
    var leadImage = container.querySelector(
      ".icono-gene-lead-card .iconoplasm-tooltip-portrait-img",
    )
    var leadButton = container.querySelector(".icono-gene-lead-card [data-icono-pswp]")
    var leadMedium = publishedPortraitUrl(genePayload, "medium")
    var leadFull = publishedPortraitUrl(genePayload, "full") || leadMedium
    if (leadImage && leadMedium) leadImage.setAttribute("src", leadMedium)
    if (leadButton && leadFull) leadButton.setAttribute("data-icono-pswp-src", leadFull)

    var candidates = Array.isArray(genePayload.portrait_candidates)
      ? genePayload.portrait_candidates.filter(function (item) {
          return item && !item.is_current && candidatePortraitUrl(item, "medium")
        })
      : []
    var cards = container.querySelectorAll(".icono-candidate-card")
    for (var i = 0; i < cards.length; i += 1) {
      var candidate = candidates[i]
      if (!candidate) continue
      var image = cards[i].querySelector(".icono-candidate-media img")
      var button = cards[i].querySelector("[data-icono-pswp]")
      var medium = candidatePortraitUrl(candidate, "medium")
      var full = candidatePortraitUrl(candidate, "full") || medium
      if (image && medium) image.setAttribute("src", medium)
      if (button && full) button.setAttribute("data-icono-pswp-src", full)
    }
  }

  function hydrateGeneInteractiveIslands(container, genePayload) {
    if (!container || !genePayload) return
    var authSignature = currentUser ? "signed-in" : "guest"
    var adminSignature = currentUserIsIconoAdmin ? "admin" : "public"
    var caretakerSignature = JSON.stringify((genePayload && genePayload.caretaker) || null)
    var toolbarSignature = authSignature + ":" + adminSignature + ":" + caretakerSignature
    var toolbarHost = container.querySelector("[data-icono-canonical-toolbar-island]")
    if (
      toolbarHost &&
      toolbarHost.getAttribute("data-icono-island-signature") !== toolbarSignature
    ) {
      toolbarHost.innerHTML = renderCanonicalToolbarMarkup(genePayload)
      toolbarHost.setAttribute("data-icono-island-signature", toolbarSignature)
    }
    var suggestHost = container.querySelector("[data-icono-suggest-island]")
    if (suggestHost && suggestHost.getAttribute("data-icono-island-signature") !== authSignature) {
      suggestHost.innerHTML = buildSuggestSectionMarkup(genePayload.symbol)
      suggestHost.setAttribute("data-icono-island-signature", authSignature)
    }
    var discordHost = container.querySelector("[data-icono-discord-island]")
    if (discordHost && discordHost.getAttribute("data-icono-island-signature") !== authSignature) {
      discordHost.innerHTML = buildDiscordActionCardMarkup()
      discordHost.setAttribute("data-icono-island-signature", authSignature)
    }
    hydrateCaretakerManifestationIsland(container, genePayload)
    hydrateServerCandidateActionIslands(container, genePayload)
  }

  function wireGeneContent(container, genePayload) {
    if (!container || !genePayload) return
    var candidateRetry = container.querySelector("[data-icono-candidates-retry]")
    if (candidateRetry && !candidateRetry.hasAttribute("data-icono-wired")) {
      candidateRetry.setAttribute("data-icono-wired", "true")
      candidateRetry.addEventListener("click", async function () {
        candidateRetry.disabled = true
        candidateRetry.textContent = "Checking…"
        var status = container.querySelector("[data-icono-candidates-status]")
        var retryRenderId = activeGeneRenderId
        try {
          var refreshed = await fetchGeneDetail(genePayload.symbol, { forceFresh: true })
          if (!container.isConnected || retryRenderId !== activeGeneRenderId) return
          if (
            !refreshed ||
            refreshed.detail_availability?.live_candidates === "temporarily_unavailable"
          ) {
            if (status)
              status.textContent = "Candidate images are still unavailable. Please try again later."
            return
          }
          await ensurePortraitDelivery(refreshed)
          if (!container.isConnected || retryRenderId !== activeGeneRenderId) return
          // Refresh only this collection. Keep the open page's published card,
          // caretaker editor, and any unsent form text intact.
          var displayedSha = String(genePayload.portrait?.asset_sha256 || "").toLowerCase()
          var updated = Object.assign({}, genePayload, {
            portrait_candidates: refreshed.portrait_candidates.map(function (candidate) {
              if (!candidate) return candidate
              return Object.assign({}, candidate, {
                is_current:
                  !!displayedSha &&
                  String(candidate.asset_sha256 || "").toLowerCase() === displayedSha,
              })
            }),
            detail_availability: Object.assign({}, genePayload.detail_availability, {
              live_candidates: "available",
            }),
          })
          var template = document.createElement("template")
          template.innerHTML = renderCandidateGallery(updated)
          var gallery = container.querySelector(".icono-candidate-gallery")
          if (!gallery || !template.content.firstElementChild) return
          gallery.replaceWith(template.content.firstElementChild)
          wireGeneContent(container, updated)
          iconoSidebarState.gene.candidateCount = refreshed.portrait_candidates.length
          renderIconoplasmSidebar()
        } catch (_error) {
          if (status) status.textContent = "Candidate images could not be loaded. Please try again."
        } finally {
          candidateRetry.disabled = false
          candidateRetry.textContent = "Try again"
        }
      })
    }
    container._iconoGenePayload = genePayload
    var blot = publishedGeneBlot(genePayload)
    var blotImage = container.querySelector(
      ".icono-canonical-gene-blot-image[data-iconoplasm-canonical-image-src]",
    )
    if (blot && blotImage) {
      // Hydration must preserve the same current-renderer route emitted by the
      // server. Replacing it with the immutable card's historical URL would
      // visibly roll the blot back after page load.
      var canonicalBlotUrl = String(blot.semantic_url || "").trim()
      var currentBlotUrl = blotImage.currentSrc || blotImage.getAttribute("src") || ""
      if (blotImage.complete && blotImage.naturalWidth === 0 && currentBlotUrl) {
        portraitDelivery.reportFailure(currentBlotUrl)
      }
      // Server markup always starts first-party so Vietnam never depends on an
      // accelerator decision made before the delivery handler is installed.
      blotImage.setAttribute("src", canonicalBlotUrl)
      portraitDelivery.ensure(canonicalBlotUrl).then(function () {
        portraitDelivery.bind(blotImage, canonicalBlotUrl)
      })
    }
    syncServerGenePortraitUrls(container, genePayload)
    hydrateGeneInteractiveIslands(container, genePayload)
    wireGeneVoteControls(container, genePayload)
    wireGeneEditImagePanel(container, genePayload)
    wireGeneRequestPanel(container, genePayload)
    wireGeneSuggestions(container, genePayload)
    wirePrintCopyRequests(container, genePayload)
    wireCandidateRemoveButtons(container, genePayload)
    wireCandidateCopyForms(container, genePayload)
    var leadCard = container.querySelector(".icono-gene-lead-card")
    if (leadCard && isMobileLabelReviewEnabled()) wireMobileLabelCard(leadCard)
    refreshPortraitLightbox()
  }

  /* ─── Gene page: resampling suggestions ─── */

  function suggestRelativeTime(iso) {
    var t = Date.parse(iso || "")
    if (!isFinite(t)) return ""
    var mins = Math.floor(Math.max(0, Date.now() - t) / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return mins + "m"
    var hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs + "h"
    var days = Math.floor(hrs / 24)
    if (days < 30) return days + "d"
    try {
      return new Date(t).toLocaleDateString()
    } catch (_err) {
      return ""
    }
  }

  function suggestAvatarMarkup(c) {
    var url = String((c && c.avatar_url) || "").trim()
    if (url) {
      return (
        '<span class="icono-suggest-av"><img alt="" loading="lazy" src="' + esc(url) + '"></span>'
      )
    }
    var letter =
      String((c && c.username) || "?")
        .trim()
        .charAt(0) || "?"
    return '<span class="icono-suggest-av">' + esc(letter.toUpperCase()) + "</span>"
  }

  function renderSuggestItemMarkup(c) {
    var item = c || {}
    var id = Number(item.id || 0) || 0
    var who = esc(String(item.username || "anon"))
    var body = esc(String(item.body || ""))
    var when = esc(suggestRelativeTime(item.created_at))
    var edited = item.updated_at ? " · edited" : ""
    var acts = item.is_own
      ? '<div class="icono-suggest-acts">' +
        '<button type="button" data-icono-suggest-edit="' +
        id +
        '">Edit</button>' +
        '<button type="button" data-icono-suggest-del="' +
        id +
        '">Delete</button>' +
        "</div>"
      : ""
    return (
      '<div class="icono-suggest-item" data-icono-suggest-id="' +
      id +
      '">' +
      suggestAvatarMarkup(item) +
      '<div class="icono-suggest-main">' +
      '<div class="icono-suggest-meta"><span class="icono-suggest-who">' +
      who +
      "</span> · " +
      when +
      edited +
      "</div>" +
      '<div class="icono-suggest-body">' +
      body +
      "</div>" +
      acts +
      "</div></div>"
    )
  }

  function renderSuggestList(listEl, comments, countEl) {
    if (!listEl) return
    var list = Array.isArray(comments) ? comments : []
    if (countEl) countEl.textContent = list.length ? " · " + list.length : ""
    if (!list.length) {
      listEl.innerHTML = '<p class="icono-suggest-empty">No suggestions yet.</p>'
      return
    }
    var html = ""
    for (var i = 0; i < list.length; i++) html += renderSuggestItemMarkup(list[i])
    listEl.innerHTML = html
  }

  function suggestErrText(err) {
    return (
      (err && err.payload && err.payload.error) || (err && err.message) || "Something went wrong."
    )
  }

  function setSuggestCount(listEl, countEl) {
    if (!countEl) return
    var n = listEl ? listEl.querySelectorAll(".icono-suggest-item").length : 0
    countEl.textContent = n ? " · " + n : ""
  }

  function startSuggestEdit(item) {
    if (!item) return
    var main = item.querySelector(".icono-suggest-main")
    var bodyEl = item.querySelector(".icono-suggest-body")
    if (!main || !bodyEl || main.querySelector(".icono-suggest-editbox")) return
    var actsEl = item.querySelector(".icono-suggest-acts")
    var current = bodyEl.textContent || ""
    bodyEl.style.display = "none"
    if (actsEl) actsEl.style.display = "none"
    var box = document.createElement("div")
    box.className = "icono-suggest-editbox"
    box.innerHTML =
      '<textarea class="icono-suggest-input" maxlength="2000" rows="2"></textarea>' +
      '<div class="icono-suggest-editrow">' +
      '<button type="button" class="icono-suggest-btn" data-icono-suggest-save>Save</button>' +
      '<button type="button" class="icono-suggest-cancel" data-icono-suggest-cancel>Cancel</button>' +
      "</div>" +
      '<p class="icono-suggest-err" data-icono-suggest-editerr hidden></p>'
    main.appendChild(box)
    var ta = box.querySelector("textarea")
    if (ta) {
      ta.value = current
      ta.focus()
    }
  }

  function cancelSuggestEdit(item) {
    if (!item) return
    var box = item.querySelector(".icono-suggest-editbox")
    if (box) box.remove()
    var bodyEl = item.querySelector(".icono-suggest-body")
    if (bodyEl) bodyEl.style.display = ""
    var actsEl = item.querySelector(".icono-suggest-acts")
    if (actsEl) actsEl.style.display = ""
  }

  function saveSuggestEdit(item, path) {
    if (!item) return
    var id = Number(item.getAttribute("data-icono-suggest-id") || 0) || 0
    var box = item.querySelector(".icono-suggest-editbox")
    var ta = box ? box.querySelector("textarea") : null
    var errEl = box ? box.querySelector("[data-icono-suggest-editerr]") : null
    var saveBtn = box ? box.querySelector("[data-icono-suggest-save]") : null
    var newBody = ta ? String(ta.value || "").trim() : ""
    if (errEl) {
      errEl.hidden = true
      errEl.textContent = ""
    }
    if (!id || newBody.length < 3) {
      if (errEl) {
        errEl.textContent = "Write at least 3 characters."
        errEl.hidden = false
      }
      return
    }
    if (saveBtn) saveBtn.disabled = true
    fetchAuthedJSON(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, body: newBody }),
    })
      .then(function () {
        var bodyEl = item.querySelector(".icono-suggest-body")
        if (bodyEl) {
          bodyEl.textContent = newBody
          bodyEl.style.display = ""
        }
        var actsEl = item.querySelector(".icono-suggest-acts")
        if (actsEl) actsEl.style.display = ""
        var metaEl = item.querySelector(".icono-suggest-meta")
        if (metaEl && metaEl.textContent.indexOf("edited") === -1) {
          metaEl.appendChild(document.createTextNode(" · edited"))
        }
        if (box) box.remove()
      })
      .catch(function (err) {
        if (errEl) {
          errEl.textContent = suggestErrText(err)
          errEl.hidden = false
        }
        if (saveBtn) saveBtn.disabled = false
      })
  }

  function deleteSuggest(item, path, listEl, countEl) {
    if (!item) return
    var id = Number(item.getAttribute("data-icono-suggest-id") || 0) || 0
    if (!id) return
    if (!window.confirm("Delete this suggestion?")) return
    fetchAuthedJSON(path, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id }),
    })
      .then(function () {
        item.remove()
        setSuggestCount(listEl, countEl)
        if (listEl && !listEl.querySelector(".icono-suggest-item")) {
          listEl.innerHTML = '<p class="icono-suggest-empty">No suggestions yet.</p>'
        }
      })
      .catch(function (err) {
        window.alert(suggestErrText(err))
      })
  }

  function buildSuggestSectionMarkup(symbol) {
    var safe = esc(normalizedSymbol(symbol) || symbol || "")
    var composer = currentUser
      ? '<form class="icono-suggest-form" data-icono-suggest-form>' +
        '<textarea class="icono-suggest-input" data-icono-suggest-input rows="2" maxlength="2000" placeholder="Suggest a prop, theme, or activity…"></textarea>' +
        '<button type="submit" class="icono-suggest-btn">Suggest</button>' +
        "</form>" +
        '<p class="icono-suggest-err" data-icono-suggest-err hidden></p>'
      : '<p class="icono-suggest-signin">Sign in with Discord to suggest a resample.</p>'
    return (
      '<section id="gene-comments" class="icono-suggest" data-icono-suggest="' +
      safe +
      '">' +
      '<div class="icono-suggest-lab">Suggestions<span data-icono-suggest-count></span></div>' +
      composer +
      '<div class="icono-suggest-list" data-icono-suggest-list></div>' +
      "</section>"
    )
  }

  function wireGeneSuggestions(container, g) {
    if (!container || !g) return
    var sec = container.querySelector("[data-icono-suggest]")
    if (!sec) return
    var symbol = normalizedSymbol(g.symbol)
    if (!symbol) return
    var listEl = sec.querySelector("[data-icono-suggest-list]")
    var countEl = sec.querySelector("[data-icono-suggest-count]")
    var commentsPath = "/api/iconoplasm/genes/" + encodeURIComponent(symbol) + "/comments"
    fetchAuthedJSON(commentsPath)
      .then(function (data) {
        renderSuggestList(listEl, data && data.comments, countEl)
      })
      .catch(function () {
        if (listEl)
          listEl.innerHTML = '<p class="icono-suggest-empty">Could not load suggestions.</p>'
      })
    var form = sec.querySelector("[data-icono-suggest-form]")
    if (form && form.getAttribute("data-wired") !== "true") {
      form.setAttribute("data-wired", "true")
      form.addEventListener("submit", function (e) {
        e.preventDefault()
        var input = sec.querySelector("[data-icono-suggest-input]")
        var errEl = sec.querySelector("[data-icono-suggest-err]")
        var btn = form.querySelector("[type=submit]")
        var body = input ? String(input.value || "").trim() : ""
        if (errEl) {
          errEl.hidden = true
          errEl.textContent = ""
        }
        if (body.length < 3) {
          if (errEl) {
            errEl.textContent = "Write at least 3 characters."
            errEl.hidden = false
          }
          return
        }
        if (btn) btn.disabled = true
        fetchAuthedJSON(commentsPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: body }),
        })
          .then(function (data) {
            if (input) input.value = ""
            var item = data && data.comment
            if (!item || !listEl) return
            var empty = listEl.querySelector(".icono-suggest-empty")
            if (empty) listEl.innerHTML = ""
            listEl.insertAdjacentHTML("afterbegin", renderSuggestItemMarkup(item))
            setSuggestCount(listEl, countEl)
          })
          .catch(function (err) {
            if (errEl) {
              errEl.textContent = suggestErrText(err)
              errEl.hidden = false
            }
          })
          .finally(function () {
            if (btn) btn.disabled = false
          })
      })
    }
    // Edit / delete on your own suggestions (delegated).
    if (sec.getAttribute("data-wired-mutate") !== "true") {
      sec.setAttribute("data-wired-mutate", "true")
      sec.addEventListener("click", function (e) {
        var t = e.target
        if (!t || !t.closest) return
        if (t.closest("[data-icono-suggest-edit]")) {
          startSuggestEdit(t.closest(".icono-suggest-item"))
        } else if (t.closest("[data-icono-suggest-cancel]")) {
          cancelSuggestEdit(t.closest(".icono-suggest-item"))
        } else if (t.closest("[data-icono-suggest-save]")) {
          saveSuggestEdit(t.closest(".icono-suggest-item"), commentsPath)
        } else if (t.closest("[data-icono-suggest-del]")) {
          deleteSuggest(t.closest(".icono-suggest-item"), commentsPath, listEl, countEl)
        }
      })
    }
  }

  function publicManifestationMarkup(g) {
    var publicManifestation = g && g.canonical_manifestation
    if (
      !publicManifestation ||
      publicManifestation.public_page_visible !== true ||
      !String(publicManifestation.prose || "").trim()
    ) {
      return ""
    }
    return (
      '<section class="icono-public-manifestation" aria-labelledby="icono-public-manifestation-title">' +
      '<p class="icono-public-manifestation__eyebrow">Caretaker manifestation</p>' +
      '<h2 id="icono-public-manifestation-title">How this gene manifests</h2>' +
      '<p class="icono-public-manifestation__body">' +
      esc(String(publicManifestation.prose)) +
      "</p></section>"
    )
  }

  function reconcilePublicManifestationSection(container, g) {
    if (!container) return
    var current = container.querySelector(".icono-public-manifestation")
    var markup = publicManifestationMarkup(g)
    if (!markup) {
      if (current) current.remove()
      return
    }
    var template = document.createElement("template")
    template.innerHTML = markup
    var replacement = template.content.firstElementChild
    if (!replacement) return
    if (current) {
      current.replaceWith(replacement)
      return
    }
    var lead = container.querySelector(".icono-gene-lead")
    if (lead) lead.insertAdjacentElement("afterend", replacement)
  }

  function renderGeneContent(container, g) {
    var html =
      '<section class="icono-gene-lead">' + buildGeneLeadCardMarkup(g) + canonicalGeneBlotMarkup(g)

    html += "<div data-icono-canonical-toolbar-island>" + renderCanonicalToolbarMarkup(g) + "</div>"
    html += "</section>"

    html += renderCandidateGallery(g)

    html += publicManifestationMarkup(g)

    html += '<div class="icono-caretaker-island" data-icono-caretaker-island hidden></div>'

    html += "<div data-icono-suggest-island>" + buildSuggestSectionMarkup(g.symbol) + "</div>"
    html +=
      '<section class="icono-gene-discord-card" data-icono-discord-island>' +
      buildDiscordActionCardMarkup() +
      "</section>"

    container.innerHTML = html
    wireGeneContent(container, g)
  }

  /* ─── Rendering: 404 ─── */

  function render404(root) {
    iconoSidebarState.page = "404"
    iconoSidebarState.gene = null
    lastGenePageDiscoveryVisitKey = ""
    renderIconoplasmSidebar()
    root.innerHTML =
      '<main class="icono-page-main" id="icono-main"><div class="icono-empty">' +
      "<h2>Page not found</h2>" +
      '<p><a href="/" data-icono-nav>Back to Iconoplasm</a></p>' +
      "</div></main>"
  }

  /* ─── Client-side navigation ─── */

  var lastRenderedPath = null
  var activeHomeHistorySnapshot = null
  var activeHomeRenderCleanup = null
  var activeHomeFreshnessCheck = null
  var pendingHomeRestoreState = null
  var queuedHomeHistorySync = null
  var pendingHomeAnchor = null
  var mobileLabelReviewMode = false
  var mobileLabelBreakpointObserverStarted = false
  var queuedMobileLabelBreakpointRefresh = false

  function readHistoryState() {
    var state = window.history.state
    return state && typeof state === "object" ? state : {}
  }

  function scrollWindowInstantly(x, y) {
    try {
      window.scrollTo({ left: x, top: y, behavior: "instant" })
    } catch (_err) {
      window.scrollTo(x, y)
    }
  }

  function runAfterNextPaint(callback) {
    var settled = false
    var frame = 0
    var timer = 0
    var run = function () {
      if (settled) return
      settled = true
      if (frame) window.cancelAnimationFrame(frame)
      if (timer) window.clearTimeout(timer)
      callback()
    }
    frame = window.requestAnimationFrame(run)
    timer = window.setTimeout(run, 100)
  }

  function replaceHistoryStatePatch(patch) {
    var prev = readHistoryState()
    var next = {}
    var key = ""
    for (key in prev) {
      if (Object.prototype.hasOwnProperty.call(prev, key)) {
        next[key] = prev[key]
      }
    }
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        next[key] = patch[key]
      }
    }
    next.iconoplasm = true
    next.quartzRouterIgnore = true
    window.history.replaceState(next, "", window.location.href)
  }

  function syncHomeHistoryState(immediate, options) {
    if (!activeHomeHistorySnapshot) return
    var restoreOnGeneBack = !!(options && options.restoreOnGeneBack)
    var commit = function () {
      queuedHomeHistorySync = null
      if (!activeHomeHistorySnapshot) return
      var homeState = activeHomeHistorySnapshot()
      homeState.restoreOnGeneBack = restoreOnGeneBack
      replaceHistoryStatePatch({
        iconoplasmPage: "home",
        iconoplasmHome: homeState,
      })
    }
    // The home gallery is infinite and masonry-like, so we persist loaded count + scroll instead
    // of resetting to gene 1 on every render. This state must be kept current for both browser
    // Back and the in-page "All genes" backlink to feel native.
    if (immediate) {
      if (queuedHomeHistorySync) {
        window.clearTimeout(queuedHomeHistorySync)
        queuedHomeHistorySync = null
      }
      commit()
      return
    }
    if (queuedHomeHistorySync) return
    queuedHomeHistorySync = window.setTimeout(commit, 120)
  }

  function clearActiveHomeRenderState() {
    activeHomeHistorySnapshot = null
    if (queuedHomeHistorySync) {
      window.clearTimeout(queuedHomeHistorySync)
      queuedHomeHistorySync = null
    }
    if (typeof activeHomeRenderCleanup === "function") {
      var cleanup = activeHomeRenderCleanup
      activeHomeRenderCleanup = null
      cleanup()
    }
  }

  function reconcileMobileLabelBreakpoint() {
    if (typeof window === "undefined") return
    var nextMode = isMobileLabelReviewEnabled()
    if (nextMode === mobileLabelReviewMode) {
      var mobileCards = document.querySelectorAll(
        ".icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-review-active='true']",
      )
      for (var i = 0; i < mobileCards.length; i += 1) {
        syncMobileLabelViewportGeometry(mobileCards[i])
      }
      return
    }
    mobileLabelReviewMode = nextMode
    var route = getRoute()
    if (route.page === "home") {
      // Card markup chooses between desktop and mobile review modes during render.
      // If the viewport crosses the breakpoint after first paint, we need a real rerender,
      // not just CSS, or desktop-built cards stay stuck without mobile review affordances.
      syncHomeHistoryState(true)
      render()
      return
    }
    if (route.page === "gene") {
      var leadCard = document.querySelector("#icono-gene-content .icono-gene-lead-card")
      if (leadCard && nextMode) wireMobileLabelCard(leadCard)
      if (leadCard && !nextMode) resetMobileLabelCardState(leadCard)
      if (leadCard) syncMobileLabelViewportGeometry(leadCard)
    }
  }

  function queueMobileLabelBreakpointRefresh() {
    if (queuedMobileLabelBreakpointRefresh) return
    queuedMobileLabelBreakpointRefresh = true
    var flush = function () {
      queuedMobileLabelBreakpointRefresh = false
      reconcileMobileLabelBreakpoint()
    }
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(flush)
      return
    }
    window.setTimeout(flush, 0)
  }

  function startMobileLabelBreakpointObserver() {
    if (mobileLabelBreakpointObserverStarted || typeof window === "undefined") return
    mobileLabelBreakpointObserverStarted = true
    mobileLabelReviewMode = isMobileLabelReviewEnabled()
    var mq = window.matchMedia("(max-width: 720px)")
    var handleBreakpointChange = function () {
      queueMobileLabelBreakpointRefresh()
    }
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handleBreakpointChange)
    } else if (typeof mq.addListener === "function") {
      mq.addListener(handleBreakpointChange)
    }
    window.addEventListener("resize", handleBreakpointChange, { passive: true })
  }

  function readHomeRestoreState() {
    var state = readHistoryState()
    if (!state || state.iconoplasmPage !== "home") return null
    var home = state.iconoplasmHome
    if (!home || typeof home !== "object") return null
    if (home.restoreSession !== ICONO_ARCHIVE_RESTORE_SESSION) return null
    if (home.restoreOnGeneBack !== true) return null
    var order = normalizeHomeCollectionOrder(home.order || HOME_COLLECTION_DEFAULT_ORDER)
    var page = Number(home.page || 1)
    var offset = Number(home.offset || 0)
    var scrollY = Number(home.scrollY || 0)
    if (!(offset > 0 || page > 1 || scrollY > 0 || home.anchorGene)) return null
    return {
      order: order,
      scope: home.scope === "shared" ? "shared" : "personal",
      sharedDiscoveries: !!home.sharedDiscoveries,
      restoreSession: ICONO_ARCHIVE_RESTORE_SESSION,
      seed: String(home.seed || ""),
      page: Number.isFinite(page) ? Math.max(1, Math.round(page)) : 1,
      cursor: String(home.cursor || ""),
      offset: Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0,
      scrollY: Number.isFinite(scrollY) ? Math.max(0, Math.round(scrollY)) : 0,
      anchorGene: String(home.anchorGene || home.focusSymbol || ""),
      anchorTop: Number.isFinite(Number(home.anchorTop || home.focusTop || 0))
        ? Number(home.anchorTop || home.focusTop || 0)
        : 0,
    }
  }

  function homeStateWithoutGeneBackIntent(home) {
    if (!home || typeof home !== "object") return null
    var copy = {}
    for (var key in home) {
      if (Object.prototype.hasOwnProperty.call(home, key)) {
        copy[key] = home[key]
      }
    }
    copy.restoreOnGeneBack = false
    return copy
  }

  function captureHomeAnchor(link) {
    pendingHomeAnchor = null
    if (!link) return
    if (getRoute().page !== "home") return
    var card = link.closest(".icono-card[data-icono-symbol]")
    if (!card) return
    var symbol = String(card.getAttribute("data-icono-symbol") || "")
      .trim()
      .toUpperCase()
    if (!symbol) return
    var rect = card.getBoundingClientRect()
    pendingHomeAnchor = {
      card: card,
      focusSymbol: symbol,
      focusTop: Math.round(rect.top),
    }
  }

  function buildNavigationState(path) {
    var nextState = { iconoplasm: true, quartzRouterIgnore: true }
    var currentState = readHistoryState()
    var carriedHomeState =
      currentState &&
      currentState.iconoplasmHome &&
      typeof currentState.iconoplasmHome === "object" &&
      currentState.iconoplasmHome.restoreSession === ICONO_ARCHIVE_RESTORE_SESSION
        ? currentState.iconoplasmHome
        : null
    if (path === "/" || path === "") {
      if (carriedHomeState) {
        nextState.iconoplasmPage = "home"
        nextState.iconoplasmHome = homeStateWithoutGeneBackIntent(carriedHomeState)
      }
      return nextState
    }
    // Carry the current home snapshot into gene routes so browser Back can restore the deep
    // gallery position without making ordinary in-page links auto-scroll.
    if (carriedHomeState) {
      nextState.iconoplasmHome = carriedHomeState
    }
    return nextState
  }

  function navigateTo(path, link) {
    var currentRoute = getRoute()
    var leavingHomeForGene = !!(
      currentRoute &&
      currentRoute.page === "home" &&
      /^\/gene\/[^/?#]+/.test(String(path || ""))
    )
    captureHomeAnchor(link)
    syncHomeHistoryState(true, { restoreOnGeneBack: leavingHomeForGene })
    window.history.pushState(buildNavigationState(path), "", path)
    pendingHomeAnchor = null
    render()
  }

  /* ─── Rendering: Clans page ─── */

  // A clan member is a discovered gene rendered with the SHARED design-system
  // blot-only card (the "image-only" variant). We reuse its exact markup + classes
  // (.icono-card--variant-image-only / .icono-image-only-*) so the portrait fitting,
  // the gene name (bottom-left) + symbol (bottom-right) caption, and the container-
  // query type scaling all match the archive cards instead of being reinvented.
  // The medium portrait variant is used (the thumb variant is a 256x256 square crop).
  function renderClanBlotMarkup(member) {
    var item = member || {}
    var symbol = String(item.symbol || "")
    var safeSymbol = esc(symbol)
    var fullName = String(item.full_name || "").trim() || symbol
    var photo = candidatePortraitUrl(item, "medium") || candidatePortraitUrl(item, "thumb")
    var media =
      '<div class="icono-image-only-media-stage">' +
      buildReverseCardFaceMarkup() +
      (photo
        ? '<img class="icono-image-only-photo" src="' +
          esc(photo) +
          '" alt="' +
          safeSymbol +
          ' blot" loading="lazy" decoding="async">'
        : '<div class="icono-image-only-fallback" aria-hidden="true"></div>') +
      "</div>"
    var overlay =
      '<div class="icono-image-only-overlay">' +
      '<div class="icono-image-only-caption-row">' +
      '<div class="icono-label-name icono-image-only-name">' +
      esc(fullName) +
      "</div>" +
      '<div class="icono-label-symbol icono-image-only-symbol">' +
      safeSymbol +
      "</div></div></div>"
    return (
      '<article class="icono-card icono-card--image-tile icono-card--variant-image-only icono-clan-tile" role="listitem">' +
      '<a class="icono-image-only-link" href="/gene/' +
      encodeURIComponent(symbol) +
      '" data-icono-nav title="' +
      safeSymbol +
      '">' +
      media +
      overlay +
      "</a></article>"
    )
  }

  function clanKickerMarkup(clan) {
    var label = clan && clan.accession ? "Pfam · " + clan.accession : "Pfam clan"
    return clan && clan.pfam_url
      ? '<a class="icono-clan-k" href="' +
          esc(clan.pfam_url) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(label) +
          "</a>"
      : '<span class="icono-clan-k">' + esc(label) + "</span>"
  }

  // The aesthetic is the family's "look" — rendered in the Caveat teal pen voice
  // (handwritten annotation), linking out to aestheticswiki.
  function clanAestheticMarkup(clan) {
    if (!clan || !clan.aesthetic) return ""
    var name = esc(String(clan.aesthetic))
    return clan.aesthetic_url
      ? '<a class="icono-clan-ae" href="' +
          esc(clan.aesthetic_url) +
          '" target="_blank" rel="noopener noreferrer">' +
          name +
          "</a>"
      : '<span class="icono-clan-ae">' + name + "</span>"
  }

  var ICONO_CLAN_PAGE_SIZE = 4

  function escAttr(s) {
    return esc(String(s == null ? "" : s)).replace(/"/g, "&quot;")
  }

  // Foot line: total recorded, plus a page indicator only when the clan spans more
  // than one page of blots (so small clans stay terse).
  function clanFootText(total, page, totalPages) {
    var base = total + " recorded"
    if (totalPages > 1) base += " · page " + (page + 1) + " of " + totalPages
    return base
  }

  // One row per clan: kicker + name on the left, the aesthetic pen-mark on the
  // right, then a 2x2 reel of portrait tiles flanked by prev/next arrows. The
  // overview ships only the first page (four); the arrows lazy-fetch later pages
  // so a clan with hundreds of discoveries never dumps them all into one card.
  // Both arrows are ALWAYS present; the non-navigable one (prev on the first page,
  // next on the last) is shown in a disabled state rather than hidden.
  function renderRevealedClanCardMarkup(clan) {
    var members = clan && Array.isArray(clan.members) ? clan.members : []
    var discovered = Number(clan && clan.discovered_count) || members.length
    var totalPages = Math.max(1, Math.ceil(discovered / ICONO_CLAN_PAGE_SIZE))
    var clanName = String((clan && clan.clan) || "")
    var blots = members.map(renderClanBlotMarkup).join("")
    var nextDisabled = totalPages > 1 ? "" : " disabled"
    return (
      '<article class="icono-clan" data-clan="' +
      escAttr(clanName) +
      '" data-page="0" data-total-pages="' +
      totalPages +
      '">' +
      '<div class="icono-clan-head"><div class="icono-clan-head-l">' +
      clanKickerMarkup(clan) +
      '<div class="icono-clan-nm">' +
      esc(clanName) +
      "</div></div>" +
      clanAestheticMarkup(clan) +
      "</div>" +
      '<div class="icono-clan-reel">' +
      '<button type="button" class="icono-clan-nav icono-clan-prev" data-icono-clan-prev disabled aria-label="Previous members">&#8249;</button>' +
      '<div class="icono-clan-strip" role="list" data-icono-clan-strip>' +
      blots +
      "</div>" +
      '<button type="button" class="icono-clan-nav icono-clan-next" data-icono-clan-next' +
      nextDisabled +
      ' aria-label="More members">&#8250;</button>' +
      "</div>" +
      '<div class="icono-clan-foot" data-icono-clan-foot>' +
      clanFootText(discovered, 0, totalPages) +
      "</div>" +
      "</article>"
    )
  }

  // Lazy page swap: fetch one clan's members for the requested page and re-render
  // just that card's strip, arrows, and foot. Guards against double-fires.
  function clanPageFetch(card, targetPage) {
    if (!card) return
    var clanName = card.getAttribute("data-clan")
    var strip = card.querySelector("[data-icono-clan-strip]")
    if (!clanName || !strip) return
    if (card.getAttribute("data-loading") === "1") return
    card.setAttribute("data-loading", "1")
    strip.setAttribute("aria-busy", "true")
    var prev = card.querySelector("[data-icono-clan-prev]")
    var next = card.querySelector("[data-icono-clan-next]")
    var foot = card.querySelector("[data-icono-clan-foot]")
    fetchAuthedJSON(
      "/api/iconoplasm/clans/" + encodeURIComponent(clanName) + "/members?page=" + targetPage,
    )
      .then(function (data) {
        card.removeAttribute("data-loading")
        strip.removeAttribute("aria-busy")
        if (!data || data.ok === false) return
        var members = Array.isArray(data.members) ? data.members : []
        var page = Number(data.page) || 0
        var totalPages = Math.max(1, Number(data.total_pages) || 1)
        var totalMembers = Number(data.total_members) || members.length
        strip.innerHTML = members.map(renderClanBlotMarkup).join("")
        syncImageOnlyLoadState(strip)
        card.setAttribute("data-page", String(page))
        card.setAttribute("data-total-pages", String(totalPages))
        if (prev) prev.disabled = page <= 0
        if (next) next.disabled = page >= totalPages - 1
        if (foot) foot.textContent = clanFootText(totalMembers, page, totalPages)
      })
      .catch(function () {
        card.removeAttribute("data-loading")
        strip.removeAttribute("aria-busy")
      })
  }

  // One delegated listener for the whole list handles every card's arrows.
  function wireClanPaging(grid) {
    if (!grid || grid.getAttribute("data-paging-wired") === "1") return
    grid.setAttribute("data-paging-wired", "1")
    grid.addEventListener("click", function (ev) {
      var t = ev.target
      var btn = t && t.closest ? t.closest("[data-icono-clan-prev],[data-icono-clan-next]") : null
      if (!btn || !grid.contains(btn)) return
      ev.preventDefault()
      var card = btn.closest(".icono-clan")
      if (!card) return
      var page = Number(card.getAttribute("data-page")) || 0
      var totalPages = Math.max(1, Number(card.getAttribute("data-total-pages")) || 1)
      var target = btn.hasAttribute("data-icono-clan-next") ? page + 1 : page - 1
      if (target < 0 || target > totalPages - 1) return
      clanPageFetch(card, target)
    })
  }

  function clansLoadingSkeletonMarkup() {
    var out = '<div class="icono-clans-list">'
    for (var i = 0; i < 4; i++) {
      out += '<div class="icono-clan icono-clan--skeleton" aria-hidden="true"></div>'
    }
    return out + "</div>"
  }

  var ICONO_CLANS_UNFILED_SHOWN = 60

  // Archive-style progress header (design system .arch-head): mono kicker, a big
  // League Spartan count, a typewriter sub line, a teal progress bar.
  function clanHeadMarkup(data) {
    var total = Number(data && data.total_clans) || 0
    var revealed = data && Array.isArray(data.clans) ? data.clans : []
    var discoveredCount = Number(data && data.discovered_clan_count) || revealed.length
    var pct = total > 0 ? Math.round((discoveredCount / total) * 100) : 0
    return (
      '<h1 class="icono-clans-kicker">Clans</h1>' +
      '<div class="icono-clans-count">' +
      discoveredCount +
      "</div>" +
      '<div class="icono-clans-sub">recorded out of ' +
      total +
      " protein clans</div>" +
      '<div class="icono-clans-bar"><span class="icono-clans-bar-fill" style="width:' +
      pct +
      '%"></span></div>'
    )
  }

  var iconoClansObserver = null

  function clansUnfiledSectionMarkup(sealedCount) {
    if (!(sealedCount > 0)) return ""
    var shown = Math.min(sealedCount, ICONO_CLANS_UNFILED_SHOWN)
    var html =
      '<div class="icono-clans-sec">Unfiled · ' +
      sealedCount +
      ' clans</div><div class="icono-clan-unfiled-grid" aria-hidden="true">'
    for (var s = 0; s < shown; s++) {
      html += '<div class="icono-clan-unfiled"><span>Unfiled</span></div>'
    }
    return html + "</div>"
  }

  // Scalability: a long-time player can be in ~500 clans. Render the recorded
  // cards in chunks as the user scrolls (IntersectionObserver) so the initial DOM
  // stays small, then append the Unfiled grid once every recorded card is in.
  function renderClansData(data) {
    if (getRoute().page !== "clans") return
    if (iconoClansObserver) {
      try {
        iconoClansObserver.disconnect()
      } catch (_e) {
        /* ignore */
      }
      iconoClansObserver = null
    }
    var head = document.getElementById("icono-clans-head")
    var body = document.getElementById("icono-clans-body")
    var content = document.getElementById("icono-clans-content")
    if (content) content.setAttribute("aria-busy", "false")
    if (!head || !body) return
    var total = Number(data && data.total_clans) || 0
    var revealed = data && Array.isArray(data.clans) ? data.clans : []
    var sealedCount = Math.max(0, Number(data && data.sealed_count) || total - revealed.length)
    var isGuest = !!(data && data.authenticated === false)

    head.innerHTML = clanHeadMarkup(data)
    body.innerHTML = ""

    if (!revealed.length) {
      body.innerHTML = isGuest
        ? '<p class="icono-clans-note">Sign in with Discord and discover genes to start recording clans.</p>'
        : '<p class="icono-clans-note">No clans recorded yet. Discover a gene to file its clan.</p>'
      body.insertAdjacentHTML("beforeend", clansUnfiledSectionMarkup(sealedCount))
      return
    }

    body.insertAdjacentHTML(
      "beforeend",
      '<div class="icono-clans-sec">Recorded</div><div class="icono-clans-list" id="icono-clan-grid"></div>',
    )
    var grid = document.getElementById("icono-clan-grid")
    wireClanPaging(grid)
    var idx = 0
    var CHUNK = 30

    function renderChunk() {
      if (!grid || getRoute().page !== "clans") return
      var end = Math.min(idx + CHUNK, revealed.length)
      var chunk = ""
      for (; idx < end; idx++) chunk += renderRevealedClanCardMarkup(revealed[idx])
      grid.insertAdjacentHTML("beforeend", chunk)
      syncImageOnlyLoadState(grid)
    }

    function finish() {
      body.insertAdjacentHTML("beforeend", clansUnfiledSectionMarkup(sealedCount))
    }

    renderChunk()
    if (idx >= revealed.length) {
      finish()
      return
    }
    if (typeof window.IntersectionObserver !== "function") {
      while (idx < revealed.length) renderChunk()
      finish()
      return
    }
    var sentinel = document.createElement("div")
    sentinel.className = "icono-clans-sentinel"
    body.appendChild(sentinel)
    iconoClansObserver = new IntersectionObserver(
      function (entries) {
        if (!entries[0] || !entries[0].isIntersecting) return
        if (getRoute().page !== "clans") {
          if (iconoClansObserver) iconoClansObserver.disconnect()
          return
        }
        renderChunk()
        if (idx >= revealed.length) {
          if (iconoClansObserver) iconoClansObserver.disconnect()
          iconoClansObserver = null
          if (sentinel.parentNode) sentinel.remove()
          finish()
        }
      },
      { rootMargin: "600px 0px" },
    )
    iconoClansObserver.observe(sentinel)
  }

  function renderClansError() {
    if (getRoute().page !== "clans") return
    var body = document.getElementById("icono-clans-body")
    var content = document.getElementById("icono-clans-content")
    if (content) content.setAttribute("aria-busy", "false")
    if (!body) return
    body.innerHTML =
      '<p class="icono-clans-note">Could not load clans right now. ' +
      '<a href="/clans" data-icono-nav>Try again</a>.</p>'
  }

  function renderClans(root) {
    iconoSidebarState.page = "clans"
    renderIconoplasmSidebar()
    root.innerHTML =
      '<header class="icono-clans-page-header"><div class="icono-nav"><a href="/" data-icono-nav>' +
      ICONO_ARROW_LEFT +
      "Archive</a></div></header>" +
      '<main class="icono-clans-page-main" id="icono-main">' +
      '<section class="icono-clans" id="icono-clans-content" aria-busy="true">' +
      '<div class="icono-clans-head" id="icono-clans-head"></div>' +
      '<div id="icono-clans-body">' +
      clansLoadingSkeletonMarkup() +
      "</div>" +
      "</section></main>"
    fetchAuthedJSON("/api/iconoplasm/clans")
      .then(function (data) {
        renderClansData(data)
      })
      .catch(function () {
        renderClansError()
      })
  }

  // ARCHITECTURE FENCE [IPD-003]: Desktop and mobile switchers are part of the
  // immersive application, not the crawler frontier. Keep them Archive/Clans/Studio;
  // the existing non-visual homepage description owns the ordinary /genes link.
  function ensureMobilePageSwitcher() {
    var root = document.getElementById(ROOT_ID)
    if (!root || !root.parentNode) return
    if (document.querySelector(".icono-mobile-switcher")) return
    var bar = document.createElement("nav")
    bar.className = "icono-mobile-switcher"
    bar.setAttribute("data-icono-page-switcher", "")
    bar.setAttribute("aria-label", "Iconoplasm sections")
    bar.innerHTML =
      '<a href="/" class="icono-page-tab" data-icono-nav data-icono-switch="archive">Archive</a>' +
      '<a href="/clans" class="icono-page-tab" data-icono-nav data-icono-switch="clans">Clans</a>' +
      '<a href="/studio" class="icono-page-tab" data-icono-nav data-icono-switch="studio">Studio</a>'
    root.parentNode.insertBefore(bar, root)
  }

  function syncPageSwitcher(route) {
    var active =
      route && route.page === "clans"
        ? "clans"
        : route && route.page === "studio"
          ? "studio"
          : "archive"
    var tabs = document.querySelectorAll("[data-icono-page-switcher] [data-icono-switch]")
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i]
      var isActive = tab.getAttribute("data-icono-switch") === active
      tab.classList.toggle("is-active", isActive)
      if (isActive) tab.setAttribute("aria-current", "page")
      else tab.removeAttribute("aria-current")
    }
  }

  function render() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    mobileLabelReviewMode = isMobileLabelReviewEnabled()
    var route = getRoute()
    document.body.classList.toggle("icono-studio-route", route.page === "studio")
    var homeRestoreState = route.page === "home" ? readHomeRestoreState() : null
    unmountDiagramStudio()
    clearActiveHomeRenderState()
    destroyHomeMasonry()
    lastRenderedPath = window.location.pathname + window.location.search
    // Update page title
    if (route.page === "home") {
      document.title = "Iconoplasm - Gene character cards"
    } else if (route.page === "gene") {
      // A direct gene response already owns the full canonical title. Preserve
      // it through hydration; SPA navigation upgrades this temporary title as
      // soon as the same shared card payload resolves below.
      if (!document.title.endsWith(" | Iconoplasm character profile")) {
        document.title = geneProfileDocumentTitle(null, route.symbol)
      }
    } else if (route.page === "clans") {
      document.title = "Clans - Iconoplasm"
    } else if (route.page === "studio") {
      document.title = "Diagram Studio - Iconoplasm"
    } else {
      document.title = "Not found - Iconoplasm"
    }
    // Render the appropriate page
    if (route.page === "home") {
      renderHome(root, homeRestoreState)
      refreshPortraitLightbox()
    } else if (route.page === "gene") {
      scrollWindowInstantly(0, 0)
      renderGene(root, route.symbol)
    } else if (route.page === "clans") {
      scrollWindowInstantly(0, 0)
      renderClans(root)
    } else if (route.page === "studio") {
      iconoSidebarState.page = "studio"
      renderIconoplasmSidebar()
      scrollWindowInstantly(0, 0)
      renderDiagramStudio(root)
    } else {
      scrollWindowInstantly(0, 0)
      render404(root)
      refreshPortraitLightbox()
    }
    ensureMobilePageSwitcher()
    syncPageSwitcher(route)
  }

  /* ─── Event delegation for internal links ─── */

  document.addEventListener("click", function (e) {
    var printCopyTrigger =
      e.target && e.target.closest ? e.target.closest("[data-icono-print-copy]") : null
    if (printCopyTrigger) {
      revealCanonicalGeneBlot(
        printCopyTrigger,
        printCopyTrigger.getAttribute("data-icono-print-copy-symbol"),
      )
      if (printCopyTrigger.getAttribute("href")) {
        if (e.stopImmediatePropagation) e.stopImmediatePropagation()
        else e.stopPropagation()
        return
      }
      e.preventDefault()
      if (e.stopImmediatePropagation) e.stopImmediatePropagation()
      else e.stopPropagation()
      openPrintCopyImage(printCopyTrigger)
      return
    }

    var link = e.target.closest("a[data-icono-nav], [role='feed'] a[href^='/gene/']")
    if (!link) return
    var href = link.getAttribute("href")
    if (!href || href.startsWith("http") || link.getAttribute("target") === "_blank") return
    e.preventDefault()
    navigateTo(href, link)
  })

  /* B-470 — make the whole gene tile a tap target.
     The grid tile only had a real link wrapping the gene symbol/name title. The rest of the
     dossier (the lab card body, the portrait fields, the swipe area on mobile) was inert,
     even though the user had every right to expect "tap the card → open the gene page". This
     is a delegated click handler that fills the gap.
     Scope is intentionally tight:
       - Only runs for cards that live inside a gallery grid (.icono-grid). On the gene
         detail page the same dossier markup is the page hero, and we don't want to make
         that hero re-navigate to itself.
       - Skips clicks on real interactive controls (links, buttons, summaries, inputs,
         labels, the mobile peek toggle, the vote box, the portrait hotzone). Those have
         their own click semantics and stay untouched.
       - Skips clicks where the user is selecting text, so the dossier text stays readable
         on long-press.
   */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented) return
    if (e.button != null && e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    var card =
      e.target && e.target.closest ? e.target.closest(".icono-card[data-icono-symbol]") : null
    if (!card) return
    if (!card.closest(".icono-grid")) return
    if (
      e.target.closest(
        "a, button, summary, input, select, textarea, label, [role='button']," +
          " [data-icono-vote-box], [data-icono-label-mobile-toggle], [data-no-navigate]," +
          " .icono-label-specimen-viewport, .iconoplasm-tooltip-portrait-media," +
          " .iconoplasm-tooltip-portrait-fallback",
      )
    ) {
      return
    }
    try {
      var sel = window.getSelection && window.getSelection()
      if (sel && String(sel.toString() || "").length > 0) return
    } catch (_err) {
      /* selection API can throw in some embedded contexts; safe to ignore. */
    }
    var symbol = String(card.getAttribute("data-icono-symbol") || "").trim()
    if (!symbol) return
    var href = "/gene/" + encodeURIComponent(symbol)
    e.preventDefault()
    navigateTo(href, card)
  })

  window.addEventListener("popstate", function () {
    render()
  })

  function refreshVisibleHomeSnapshot() {
    if (document.visibilityState === "hidden") return
    if (getRoute().page !== "home" || typeof activeHomeFreshnessCheck !== "function") return
    void activeHomeFreshnessCheck()
  }

  // A browser can preserve the mounted archive for hours or restore it from the
  // back/forward cache without running a new page load. Revalidate the published
  // snapshot whenever that page becomes visible again.
  document.addEventListener("visibilitychange", refreshVisibleHomeSnapshot)
  window.addEventListener("pageshow", refreshVisibleHomeSnapshot)

  window.addEventListener(ICONO_EXTENSION_PRESENCE_EVENT, handleIconoplasmExtensionPresence)

  document.addEventListener("iconoplasmsettingschange", function () {
    var route = getRoute()
    if (route.page === "home") {
      syncHomeHistoryState(true)
      render()
      return
    }
    if (route.page === "gene") {
      render()
    }
  })

  /* ─── Init ─── */

  function init() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    portraitDelivery.install(document)
    startMobileLabelBreakpointObserver()
    var currentState = readHistoryState()
    if (
      currentState &&
      currentState.iconoplasmHome &&
      currentState.iconoplasmHome.restoreSession !== ICONO_ARCHIVE_RESTORE_SESSION
    ) {
      replaceHistoryStatePatch({ iconoplasmHome: null })
    } else {
      replaceHistoryStatePatch({})
    }
    // ARCHITECTURE FENCE [IPD-008]: anonymous startup is static. The readable
    // marker carries no authority; it only tells us whether spending one direct
    // auth lookup is potentially useful.
    if (hasSharedSessionPresenceHint()) {
      void refreshSharedUserState()
    } else {
      hasResolvedAuthState = true
      currentUser = null
      currentUserIsIconoAdmin = false
    }
    render()
    void registerDiagramWebMcp({
      openStudio: function () {
        if (getRoute().page !== "studio") navigateTo("/studio")
      },
    }).catch(function (error) {
      console.warn("[Iconoplasm] WebMCP tool registration failed:", error)
    })
  }

  // Quartz uses SPA navigation, so the root might already be in the DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  // Handle Quartz SPA navigation: micromorph replaces the body after popstate,
  // potentially emptying #iconoplasm-root. Re-init when the popstate handler's
  // render() couldn't have run yet (different path) or the root is empty.
  document.addEventListener("nav", function () {
    var currentPath = window.location.pathname + window.location.search
    if (lastRenderedPath === currentPath) {
      // popstate handler already rendered this path — check if the root survived
      var root = document.getElementById(ROOT_ID)
      if (root && root.children.length > 0) return
    }
    setTimeout(init, 0)
  })
})()
