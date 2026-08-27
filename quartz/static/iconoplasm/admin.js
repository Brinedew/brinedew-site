;(function () {
  var API_BASE = "/api/iconoplasm/admin"
  var factoryBelts = null
  var ADMIN_READ_TIMEOUT_MS = 12000
  var ADMIN_WRITE_TIMEOUT_MS = 30000
  var EXTENSION_BLOCKLIST_MAX_TERMS = 500
  var EXTENSION_BLOCKLIST_MAX_TERM_LENGTH = 64
  var EXTENSION_BLOCKLIST_CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/
  var EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000]
  var PUBLICATION_ALIAS_MAX_OPERATIONS = 500
  var PUBLICATION_ALIAS_MAX_LENGTH = 64
  var PUBLICATION_ALIAS_CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/
  var PUBLICATION_ALIAS_SEARCH_MIN_LENGTH = 2
  var PUBLICATION_ALIAS_SEARCH_DEBOUNCE_MS = 200
  var PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000]
  function defaultVisionPageSize() {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 700px)").matches
      ? 8
      : 12
  }
  function defaultRequestPageSize() {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 700px)").matches
      ? 12
      : 25
  }
  var state = {
    assets: [],
    overviewSummary: null,
    overviewCoverage: null,
    overviewAttention: [],
    recentEvents: [],
    visionStats: [],
    visionPreviewMap: {},
    loadingVisionPreviewIds: {},
    blacklistedStyles: [],
    pendingBlacklistSubmissions: [],
    generationRequests: [],
    generationRequestLanes: [],
    selectedRequestId: null,
    requestsLoaded: false,
    requestPage: 1,
    requestPageSize: defaultRequestPageSize(),
    imageEditPrompts: [],
    imageEditPromptPrefix: null,
    imageEditPromptSuffix: null,
    factoryRecipe: null,
    factoryLoaded: false,
    factoryBusy: false,
    diagnosticRun: null,
    diagnosticBusy: false,
    diagnosticEmulsionSlots: [30593, 255, 343, 21329, 24210],
    diagnosticSelectedPipelines: ["A", "B", "C", "D", "E"],
    diagnosticVisionRevision: 0,
    diagnosticPollTimer: null,
    selectedPromptKind: "",
    promptsLoaded: false,
    promptMaxLength: 2400,
    extensionBlocklistPolicy: null,
    extensionBlocklistPublication: null,
    extensionBlocklistLimits: {
      max_terms: EXTENSION_BLOCKLIST_MAX_TERMS,
      max_term_length: EXTENSION_BLOCKLIST_MAX_TERM_LENGTH,
    },
    extensionBlocklistDraft: [],
    extensionBlocklistInvalidTerms: [],
    extensionBlocklistLoaded: false,
    extensionBlocklistBusy: false,
    extensionBlocklistPublicationRetry: null,
    extensionBlocklistPublicationRetryTimer: null,
    extensionBlocklistPublicationRetryRunId: 0,
    recognitionSection: "aliases",
    publicationAliasPolicy: null,
    publicationAliasPublication: null,
    publicationAliasLimits: {
      max_aliases: PUBLICATION_ALIAS_MAX_OPERATIONS,
      max_alias_length: PUBLICATION_ALIAS_MAX_LENGTH,
    },
    publicationAliasDraftBySymbol: {},
    publicationAliasLoaded: false,
    publicationAliasBusy: false,
    publicationAliasConflictOperations: [],
    publicationAliasEditing: null,
    publicationAliasSelectedGene: null,
    publicationAliasSearchResults: [],
    publicationAliasSearchActiveIndex: -1,
    publicationAliasSearchError: "",
    publicationAliasSearchTimer: null,
    publicationAliasSearchController: null,
    publicationAliasSearchRequestId: 0,
    publicationAliasPublicationRetry: null,
    publicationAliasPublicationRetryTimer: null,
    publicationAliasPublicationRetryRunId: 0,
    visionPage: 1,
    visionPageSize: defaultVisionPageSize(),
    selectedVisionId: "",
    selectedVisionDetail: null,
    selectedVisionAssetSha: "",
    visionDetailCache: {},
    preloadedImageUrls: {},
    visionPreviewRequestId: 0,
    visionDetailRequestId: 0,
    selectedGene: "",
    selectedGeneDetail: null,
    selectedCandidateSha: "",
    activeTab: "overview",
    archiveLoaded: false,
    costLoaded: false,
    costReport: null,
    galleryMode: "live",
    visionSort: { key: "live", dir: "desc" },
    activityActionFilter: "all",
  }

  var els = {
    tabs: document.getElementById("admin-tabs"),
    panels: {
      overview: document.getElementById("panel-overview"),
      factory: document.getElementById("panel-factory"),
      costs: document.getElementById("panel-costs"),
      requests: document.getElementById("panel-requests"),
      prompts: document.getElementById("panel-prompts"),
      extension: document.getElementById("panel-extension"),
      archive: document.getElementById("panel-archive"),
      styles: document.getElementById("panel-styles"),
      activity: document.getElementById("panel-activity"),
    },
    costRefresh: document.getElementById("cost-refresh"),
    costUpdatedAt: document.getElementById("cost-updated-at"),
    costContextStrip: document.getElementById("cost-context-strip"),
    costMetrics: document.getElementById("cost-metrics"),
    costSnapshotTrustChart: document.getElementById("cost-snapshot-trust-chart"),
    costSnapshotTrustDetails: document.getElementById("cost-snapshot-trust-details"),
    costTrendMeta: document.getElementById("cost-trend-meta"),
    costReadTrend: document.getElementById("cost-read-trend"),
    costD1WriteAdaptiveChart: document.getElementById("cost-d1-write-adaptive-chart"),
    costWorkerLimiterChart: document.getElementById("cost-worker-limiter-chart"),
    costDoTrafficChart: document.getElementById("cost-do-traffic-chart"),
    costD1QueryVolumeChart: document.getElementById("cost-d1-query-volume-chart"),
    costD1ResponseBytesChart: document.getElementById("cost-d1-response-bytes-chart"),
    costD1LatencyChart: document.getElementById("cost-d1-latency-chart"),
    costD1StorageChart: document.getElementById("cost-d1-storage-chart"),
    costDoActivityMixChart: document.getElementById("cost-do-activity-mix-chart"),
    costProductSmallMultiples: document.getElementById("cost-product-small-multiples"),
    costLimitRatioHeatmap: document.getElementById("cost-limit-ratio-heatmap"),
    costSensorCoverageMatrix: document.getElementById("cost-sensor-coverage-matrix"),
    costOverageMagnitudePlot: document.getElementById("cost-overage-magnitude-plot"),
    costDailyBurnCalendar: document.getElementById("cost-daily-burn-calendar"),
    costQueueBacklogChart: document.getElementById("cost-queue-backlog-chart"),
    costHeadroomSlopeChart: document.getElementById("cost-headroom-slope-chart"),
    costSnapshotIntegrityChart: document.getElementById("cost-snapshot-integrity-chart"),
    costEventOverlayChart: document.getElementById("cost-event-overlay-chart"),
    costUnknownSeries: document.getElementById("cost-unknown-series"),
    costRequestDistributionChart: document.getElementById("cost-request-distribution-chart"),
    costTopRoutes: document.getElementById("cost-top-routes"),
    overviewMetrics: document.getElementById("overview-metrics"),
    overviewCoverage: document.getElementById("overview-coverage"),
    attentionList: document.getElementById("attention-list"),
    overviewEvents: document.getElementById("overview-events"),
    requestsRefresh: document.getElementById("requests-refresh"),
    requestsSearch: document.getElementById("requests-search"),
    requestsKind: document.getElementById("requests-kind"),
    requestsMode: document.getElementById("requests-mode"),
    requestsStatus: document.getElementById("requests-status"),
    requestsLimit: document.getElementById("requests-limit"),
    requestsPageSize: document.getElementById("requests-page-size"),
    requestsPageLabel: document.getElementById("requests-page-label"),
    requestsPageFirst: document.getElementById("requests-page-first"),
    requestsPagePrev: document.getElementById("requests-page-prev"),
    requestsPageNext: document.getElementById("requests-page-next"),
    requestsPageLast: document.getElementById("requests-page-last"),
    requestsSummary: document.getElementById("requests-summary"),
    requestsList: document.getElementById("requests-list"),
    requestsDetail: document.getElementById("requests-detail"),
    promptsRefresh: document.getElementById("prompts-refresh"),
    factoryPipeline: document.getElementById("factory-pipeline"),
    factoryVision: document.getElementById("factory-vision"),
    factoryActiveCode: document.getElementById("factory-active-code"),
    factoryRecipeDetail: document.getElementById("factory-recipe-detail"),
    factorySave: document.getElementById("factory-save"),
    factoryRefresh: document.getElementById("factory-refresh"),
    factoryStatus: document.getElementById("factory-status"),
    factoryWiringRows: document.getElementById("factory-wiring-rows"),
    factoryWiringStatus: document.getElementById("factory-wiring-status"),
    diagnosticGene: document.getElementById("diagnostic-gene"),
    diagnosticPipelineOptions: document.getElementById("diagnostic-pipeline-options"),
    diagnosticEmulsionInput: document.getElementById("diagnostic-emulsion-input"),
    diagnosticEmulsionAdd: document.getElementById("diagnostic-emulsion-add"),
    diagnosticEmulsionChips: document.getElementById("diagnostic-emulsion-chips"),
    diagnosticVision: document.getElementById("diagnostic-vision"),
    diagnosticCellCount: document.getElementById("diagnostic-cell-count"),
    diagnosticRunButton: document.getElementById("diagnostic-run"),
    diagnosticDownload: document.getElementById("diagnostic-download"),
    diagnosticRefresh: document.getElementById("diagnostic-refresh"),
    diagnosticStatus: document.getElementById("diagnostic-status"),
    diagnosticProgress: document.getElementById("diagnostic-progress"),
    diagnosticFigure: document.getElementById("diagnostic-figure"),
    diagnosticCaption: document.getElementById("diagnostic-caption"),
    diagnosticRunCode: document.getElementById("diagnostic-run-code"),
    diagnosticMatrix: document.getElementById("diagnostic-matrix"),
    diagnosticLegend: document.getElementById("diagnostic-legend"),
    promptTemplateList: document.getElementById("prompt-template-list"),
    promptTemplateEditor: document.getElementById("prompt-template-editor"),
    promptTemplateHeading: document.getElementById("prompt-template-heading"),
    promptTemplateDescription: document.getElementById("prompt-template-description"),
    promptTemplateText: document.getElementById("prompt-template-text"),
    promptTemplateDefault: document.getElementById("prompt-template-default"),
    promptPrefixText: document.getElementById("prompt-prefix-text"),
    promptPrefixDefault: document.getElementById("prompt-prefix-default"),
    promptPrefixSave: document.querySelector("[data-prompt-prefix-save]"),
    promptSuffixText: document.getElementById("prompt-suffix-text"),
    promptSuffixDefault: document.getElementById("prompt-suffix-default"),
    promptTemplateStatus: document.getElementById("prompt-template-status"),
    promptTemplateSave: document.querySelector("[data-prompt-save]"),
    promptSuffixSave: document.querySelector("[data-prompt-suffix-save]"),
    recognitionTabs: document.querySelector(".recognition-tabs"),
    recognitionPanels: {
      aliases: document.getElementById("recognition-panel-aliases"),
      blocklist: document.getElementById("recognition-panel-blocklist"),
    },
    publicationAliasTabCount: document.getElementById("publication-alias-tab-count"),
    publicationAliasRefresh: document.getElementById("publication-alias-refresh"),
    publicationAliasCount: document.getElementById("publication-alias-count"),
    publicationAliasRemovalCount: document.getElementById("publication-alias-removal-count"),
    publicationAliasRevision: document.getElementById("publication-alias-revision"),
    publicationAliasSync: document.getElementById("publication-alias-sync"),
    publicationAliasForm: document.getElementById("publication-alias-form"),
    publicationAliasInput: document.getElementById("publication-alias-input"),
    publicationAliasGeneQuery: document.getElementById("publication-alias-gene-query"),
    publicationAliasGeneResults: document.getElementById("publication-alias-gene-results"),
    publicationAliasGeneStatus: document.getElementById("publication-alias-gene-status"),
    publicationAliasTargetPreview: document.getElementById("publication-alias-target-preview"),
    publicationAliasConflict: document.getElementById("publication-alias-conflict"),
    publicationAliasAdd: document.getElementById("publication-alias-add"),
    publicationAliasCancelEdit: document.getElementById("publication-alias-cancel-edit"),
    publicationAliasEditing: document.getElementById("publication-alias-editing"),
    publicationAliasFilter: document.getElementById("publication-alias-filter"),
    publicationAliasMappings: document.getElementById("publication-alias-mappings"),
    publicationAliasDirty: document.getElementById("publication-alias-dirty"),
    publicationAliasStatus: document.getElementById("publication-alias-status"),
    publicationAliasPublish: document.getElementById("publication-alias-publish"),
    extensionBlocklistTabCount: document.getElementById("extension-blocklist-tab-count"),
    extensionBlocklistRefresh: document.getElementById("extension-blocklist-refresh"),
    extensionBlocklistCount: document.getElementById("extension-blocklist-count"),
    extensionBlocklistRevision: document.getElementById("extension-blocklist-revision"),
    extensionBlocklistUpdated: document.getElementById("extension-blocklist-updated"),
    extensionBlocklistSync: document.getElementById("extension-blocklist-sync"),
    extensionBlocklistInput: document.getElementById("extension-blocklist-input"),
    extensionBlocklistAdd: document.getElementById("extension-blocklist-add"),
    extensionBlocklistTerms: document.getElementById("extension-blocklist-terms"),
    extensionBlocklistDirty: document.getElementById("extension-blocklist-dirty"),
    extensionBlocklistStatus: document.getElementById("extension-blocklist-status"),
    extensionBlocklistPublish: document.getElementById("extension-blocklist-publish"),
    visionStatsList: document.getElementById("vision-stats-list"),
    visionStatsMeta: document.getElementById("vision-stats-meta"),
    visionCleanupPanel: document.getElementById("vision-cleanup-panel"),
    visionCleanupSummary: document.getElementById("vision-cleanup-summary"),
    visionQuickContext: document.getElementById("vision-quick-context"),
    visionOpenCurrentGene: document.getElementById("vision-open-current-gene"),
    visionCopyCurrentTag: document.getElementById("vision-copy-current-tag"),
    stylesPending: document.getElementById("styles-pending"),
    visionPageSize: document.getElementById("vision-page-size"),
    visionPageLabel: document.getElementById("vision-page-label"),
    visionPageFirst: document.getElementById("vision-page-first"),
    visionPagePrev: document.getElementById("vision-page-prev"),
    visionPageNext: document.getElementById("vision-page-next"),
    visionPageLast: document.getElementById("vision-page-last"),
    stylesNotes: document.getElementById("styles-notes"),
    activityFilter: document.getElementById("activity-filter"),
    activityList: document.getElementById("activity-list"),
    status: document.getElementById("gallery-filter"),
    stale: document.getElementById("gallery-sort"),
    limit: document.getElementById("gallery-limit"),
    search: document.getElementById("gallery-search"),
    token: document.getElementById("admin-token"),
    unstaleVisible: document.getElementById("assets-unstale-visible"),
    refresh: document.getElementById("assets-refresh"),
    meta: document.getElementById("assets-meta"),
    body: document.getElementById("gallery-grid"),
    detail: document.getElementById("gallery-detail"),
    actionReason: document.getElementById("action-reason"),
    actionLog: document.getElementById("action-log"),
  }

  var mountedAdminTab = ""
  var activeTabReadController = null
  var ADMIN_TAB_RENDER_ROOTS = {
    overview: ["overview-metrics", "overview-coverage", "attention-list", "overview-events"],
    factory: [
      "factory-recipe-detail",
      "diagnostic-pipeline-options",
      "diagnostic-emulsion-chips",
      "diagnostic-matrix",
    ],
    costs: [
      "cost-context-strip",
      "cost-metrics",
      "cost-snapshot-trust-chart",
      "cost-snapshot-trust-details",
      "cost-read-trend",
      "cost-d1-write-adaptive-chart",
      "cost-worker-limiter-chart",
      "cost-do-traffic-chart",
      "cost-d1-query-volume-chart",
      "cost-d1-response-bytes-chart",
      "cost-d1-latency-chart",
      "cost-d1-storage-chart",
      "cost-do-activity-mix-chart",
      "cost-product-small-multiples",
      "cost-limit-ratio-heatmap",
      "cost-sensor-coverage-matrix",
      "cost-overage-magnitude-plot",
      "cost-daily-burn-calendar",
      "cost-queue-backlog-chart",
      "cost-headroom-slope-chart",
      "cost-snapshot-integrity-chart",
      "cost-event-overlay-chart",
      "cost-unknown-series",
      "cost-request-distribution-chart",
      "cost-top-routes",
    ],
    requests: ["requests-summary", "requests-list", "requests-detail"],
    prompts: ["prompt-template-list"],
    extension: [
      "publication-alias-mappings",
      "publication-alias-gene-results",
      "extension-blocklist-terms",
    ],
    archive: ["gallery-grid", "gallery-detail"],
    styles: [
      "vision-stats-list",
      "vision-cleanup-panel",
      "vision-quick-context",
      "styles-pending",
      "styles-notes",
    ],
    activity: ["activity-list"],
  }

  function clearAdminTabRenderRoots(tab) {
    ;(ADMIN_TAB_RENDER_ROOTS[tab] || []).forEach(function (id) {
      var root = document.getElementById(id)
      if (root) root.replaceChildren()
    })
  }

  function unmountAdminTab(tab) {
    if (!tab) return
    if (tab === "styles") {
      state.visionPreviewRequestId += 1
      state.visionDetailRequestId += 1
    }
    if (tab === "extension") cancelPublicationAliasSearch()
    if (tab === "factory" && factoryBelts) factoryBelts.unmount()
    if (tab === "factory" && state.diagnosticPollTimer) {
      window.clearTimeout(state.diagnosticPollTimer)
      state.diagnosticPollTimer = null
    }
    clearAdminTabRenderRoots(tab)
  }

  function mountAdminTab(tab) {
    if (tab === "overview") {
      renderOverview()
      if (!state.overviewSummary || !state.overviewCoverage) refreshDerivedAdminViews()
      return
    }
    if (tab === "costs") {
      if (state.costReport) renderCostUsage(state.costReport)
      else refreshCostUsage()
      return
    }
    if (tab === "factory") {
      if (factoryBelts) factoryBelts.mount()
      if (state.factoryLoaded) {
        renderFactoryRecipe()
        renderDiagnosticBuilder()
        renderDiagnosticMatrix()
      } else refreshFactoryRecipe()
      if (!factoryBelts) refreshDiagnosticMatrix({ quiet: true })
      return
    }
    if (tab === "requests") {
      if (state.requestsLoaded) renderGenerationRequests()
      else refreshGenerationRequests()
      return
    }
    if (tab === "prompts") {
      if (state.promptsLoaded) renderImageEditPrompts()
      else refreshImageEditPrompts()
      return
    }
    if (tab === "extension") {
      setRecognitionSection(state.recognitionSection || "aliases", { force: true })
      return
    }
    if (tab === "archive") {
      if (state.archiveLoaded) {
        renderTable()
        if (state.selectedGeneDetail) renderGeneDetail()
      } else {
        refreshAssets()
      }
      return
    }
    if (tab === "styles") {
      renderVisionCleanupPanel()
      renderVisionQuickActions()
      if (state.visionStats.length) renderVisionStats()
      else refreshVisionStats()
      return
    }
    if (tab === "activity") {
      if (state.overviewSummary) renderActivityFeed()
      else refreshOverviewSummary()
    }
  }

  function setActiveTab(tab) {
    if (!els.panels[tab]) return
    var changed = mountedAdminTab !== tab
    if (changed && mountedAdminTab === "extension" && tab !== "extension") {
      cancelPublicationAliasPublicationRetry(
        "Automatic publication retry stopped because you left this tab. Use Retry publication to try again.",
      )
      cancelExtensionBlocklistPublicationRetry(
        "Automatic publication retry stopped because you left this tab. Use Retry publication to try again.",
      )
      cancelPublicationAliasSearch()
    }
    if (changed && activeTabReadController) activeTabReadController.abort()
    if (changed && mountedAdminTab) unmountAdminTab(mountedAdminTab)
    if (changed) {
      activeTabReadController = typeof AbortController === "function" ? new AbortController() : null
      mountedAdminTab = tab
    }
    state.activeTab = tab
    if (
      window.location.hash !== "#" + tab &&
      typeof history !== "undefined" &&
      history.replaceState
    ) {
      history.replaceState(null, "", "#" + tab)
    }
    Object.keys(els.panels).forEach(function (key) {
      var panel = els.panels[key]
      if (!panel) return
      if (key === tab) {
        panel.classList.add("active")
        panel.hidden = false
      } else {
        panel.classList.remove("active")
        panel.hidden = true
      }
    })
    if (els.tabs) {
      els.tabs.querySelectorAll("[data-tab]").forEach(function (btn) {
        var selected = btn.getAttribute("data-tab") === tab
        btn.classList.toggle("active", selected)
        btn.setAttribute("aria-selected", selected ? "true" : "false")
        btn.setAttribute("tabindex", selected ? "0" : "-1")
      })
    }
    if (changed) mountAdminTab(tab)
  }

  function renderRecognitionSectionTabs() {
    var activeSection = state.recognitionSection === "blocklist" ? "blocklist" : "aliases"
    if (els.recognitionTabs) {
      els.recognitionTabs.querySelectorAll("[data-recognition-section]").forEach(function (button) {
        var selected = button.getAttribute("data-recognition-section") === activeSection
        button.classList.toggle("active", selected)
        button.setAttribute("aria-selected", selected ? "true" : "false")
        button.setAttribute("tabindex", selected ? "0" : "-1")
      })
    }
    Object.keys(els.recognitionPanels || {}).forEach(function (section) {
      var panel = els.recognitionPanels[section]
      if (!panel) return
      var selected = section === activeSection
      panel.classList.toggle("active", selected)
      panel.hidden = !selected
    })
  }

  function mountRecognitionSection(section) {
    if (section === "blocklist") {
      if (state.extensionBlocklistLoaded) renderExtensionBlocklist()
      else refreshExtensionBlocklist()
      return
    }
    if (state.publicationAliasLoaded) renderPublicationAliases()
    else refreshPublicationAliases()
  }

  function setRecognitionSection(section, options) {
    var nextSection = section === "blocklist" ? "blocklist" : "aliases"
    var previousSection = state.recognitionSection === "blocklist" ? "blocklist" : "aliases"
    var changed = previousSection !== nextSection
    if (changed && previousSection === "aliases") {
      cancelPublicationAliasPublicationRetry(
        "Automatic publication retry stopped because you switched sections. Use Retry publication to try again.",
      )
      cancelPublicationAliasSearch()
    }
    if (changed && previousSection === "blocklist") {
      cancelExtensionBlocklistPublicationRetry(
        "Automatic publication retry stopped because you switched sections. Use Retry publication to try again.",
      )
    }
    state.recognitionSection = nextSection
    renderRecognitionSectionTabs()
    if ((changed || options?.force) && state.activeTab === "extension") {
      mountRecognitionSection(nextSection)
    }
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  }

  function shortSha(sha) {
    var s = String(sha || "")
    if (s.length <= 20) return s
    return s.slice(0, 10) + "..." + s.slice(-8)
  }

  function syncGalleryModeButtons() {
    document.querySelectorAll("[data-gallery-mode]").forEach(function (btn) {
      btn.classList.toggle(
        "active",
        String(btn.getAttribute("data-gallery-mode") || "live") === state.galleryMode,
      )
    })
  }

  function activeModeLabel() {
    if (state.galleryMode === "all") return "all candidates"
    if (state.galleryMode === "side-by-side") return "canonical vs votes"
    return "canonical only"
  }

  // Terminology rule: "canonical" is the blot shown in the extension.
  // Votes auto-pick the canonical blot unless admin_override is active.
  // Keep this language consistent in the admin even though legacy route/state
  // names still use "live" internally.

  function statusPill(status) {
    var s = String(status || "unknown").toLowerCase()
    return '<span class="status status-' + esc(s) + '">' + esc(s) + "</span>"
  }

  function displayRouteFamily(routeFamily) {
    return String(routeFamily || "unknown route")
      .replace(/admin_essence/g, "admin_phenotype")
      .replace(/essence/g, "phenotype")
  }

  function previewCell(asset) {
    function thumb(url, label) {
      if (!url) return ""
      var safe = esc(url)
      return (
        '<a href="' +
        safe +
        '" target="_blank" rel="noreferrer" title="' +
        esc(label) +
        '"><img src="' +
        safe +
        '" alt="' +
        esc(label) +
        '" loading="lazy" /></a>'
      )
    }
    var html = [
      thumb(asset.hero_url, "full"),
      thumb(asset.medium_url, "medium"),
      thumb(asset.thumb_url, "thumb"),
    ]
      .filter(Boolean)
      .join("")
    return html ? '<div class="thumbs">' + html + "</div>" : '<span class="small">-</span>'
  }

  function flagsCell(asset) {
    var out = []
    if (asset.is_stale) out.push('<span class="flag flag-stale">stale</span>')
    if (asset.is_legacy) out.push('<span class="flag flag-legacy">legacy</span>')
    return out.length ? out.join("") : '<span class="small">-</span>'
  }

  function canonCell(asset) {
    var out = []
    if (asset.is_current) out.push('<span class="flag flag-current">canonical</span>')
    if (asset.is_vote_leader) out.push('<span class="flag flag-leader">top voted</span>')
    if (asset.is_current && asset.admin_override)
      out.push('<span class="flag flag-override">manual override</span>')
    return out.length ? out.join("") : '<span class="small">-</span>'
  }

  function votesCell(asset) {
    return [
      "<div><strong>" + esc(String(asset.image_score || 0)) + "</strong></div>",
      '<div class="small">+' +
        esc(String(asset.image_upvotes || 0)) +
        " / -" +
        esc(String(asset.image_downvotes || 0)) +
        "</div>",
    ].join("")
  }

  function authHeaders() {
    var out = {}
    var token = String((els.token && els.token.value) || "").trim()
    if (token) out["X-Iconoplasm-Admin-Token"] = token
    return out
  }

  function requestTimeoutError(path, timeoutMs) {
    var err = new Error("Request timed out after " + String(Math.round(timeoutMs / 1000)) + "s")
    err.code = "TIMEOUT"
    err.response = {
      error: "Request timed out",
      path: path,
      timeout_ms: timeoutMs,
    }
    return err
  }

  function requestErrorMessage(err, fallback) {
    if (err && err.code === "TIMEOUT")
      return String(err.message || fallback || "Request timed out.")
    if (err && err.response && err.response.error) return String(err.response.error)
    if (err && err.message) return String(err.message)
    return String(fallback || err || "Request failed")
  }

  function inlineFailureMarkup(title, message) {
    return [
      '<div class="gallery-empty">',
      "<strong>" + esc(title || "Request failed") + "</strong>",
      '<div class="small">' + esc(message || "Please try again.") + "</div>",
      "</div>",
    ].join("")
  }

  function tableFailureMarkup(title, message, colspan) {
    return [
      "<tr>",
      '<td colspan="' + esc(String(colspan || 1)) + '">',
      inlineFailureMarkup(title, message),
      "</td>",
      "</tr>",
    ].join("")
  }

  async function apiJson(path, options) {
    var opts = options || {}
    var method = String(opts.method || "GET").toUpperCase()
    var timeoutMs = Number(
      opts.timeoutMs || (method === "GET" ? ADMIN_READ_TIMEOUT_MS : ADMIN_WRITE_TIMEOUT_MS),
    )
    var headers = Object.assign({}, opts.headers || {}, authHeaders())
    var controller = typeof AbortController === "function" ? new AbortController() : null
    var ownerSignal =
      method === "GET" && activeTabReadController ? activeTabReadController.signal : null
    var timedOut = false
    var abortOwnedRequest = function () {
      if (controller) controller.abort()
    }
    var timeoutId = null
    if (ownerSignal) {
      if (ownerSignal.aborted) abortOwnedRequest()
      else ownerSignal.addEventListener("abort", abortOwnedRequest, { once: true })
    }
    if (controller && timeoutMs > 0) {
      timeoutId = window.setTimeout(function () {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    }
    try {
      var requestOptions = Object.assign({}, opts, {
        headers: headers,
        credentials: "include",
      })
      if (controller) requestOptions.signal = controller.signal
      var resp = await fetch(API_BASE + path, requestOptions)
      var text = await resp.text()
      var data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = { raw: text }
      }
      if (!resp.ok) {
        var err = new Error("HTTP " + resp.status)
        err.status = resp.status
        err.response = data
        throw err
      }
      return data
    } catch (err) {
      if (controller && controller.signal && controller.signal.aborted) {
        if (!timedOut) {
          var canceled = new Error("Request canceled because its admin tab was unmounted.")
          canceled.code = "ABORTED"
          throw canceled
        }
        throw requestTimeoutError(path, timeoutMs)
      }
      throw err
    } finally {
      if (timeoutId != null) window.clearTimeout(timeoutId)
      if (ownerSignal) ownerSignal.removeEventListener("abort", abortOwnedRequest)
    }
  }

  function isRequestCanceled(err) {
    return Boolean(err && err.code === "ABORTED")
  }

  function setLog(v) {
    els.actionLog.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2)
  }

  function metricMarkup(label, value, note) {
    return [
      '<article class="metric">',
      '<div class="metric-label">' + esc(label) + "</div>",
      '<div class="metric-value">' + esc(String(value == null ? "-" : value)) + "</div>",
      '<div class="metric-note">' + esc(note || "") + "</div>",
      "</article>",
    ].join("")
  }

  function overviewEventMarkup(evt) {
    return [
      '<article class="overview-event">',
      '<div class="overview-thumb">',
      evt.thumb_url
        ? '<img src="' +
          esc(evt.thumb_url) +
          '" alt="Blot thumbnail" loading="lazy" width="40" height="40" />'
        : "",
      "</div>",
      "<div>",
      "<strong>" + esc(evt.symbol || "unknown") + "</strong>",
      '<div class="small">' +
        esc(evt.action || "event") +
        (evt.reason ? " · " + esc(evt.reason) : "") +
        "</div>",
      "</div>",
      '<div class="event-meta">' + esc(evt.created_at || "") + "</div>",
      "</article>",
    ].join("")
  }

  function activityAccent(action) {
    var value = String(action || "").toLowerCase()
    if (value === "publish") return "activity-accent-publish"
    if (value === "reject") return "activity-accent-reject"
    if (value === "rollback") return "activity-accent-rollback"
    if (value === "unpublish") return "activity-accent-unpublish"
    if (value === "unstale") return "activity-accent-unstale"
    return ""
  }

  function eventMarkup(evt) {
    return [
      '<article class="activity-card">',
      '<div class="activity-accent ' + activityAccent(evt.action) + '"></div>',
      '<div class="activity-thumb">',
      evt.thumb_url
        ? '<img src="' +
          esc(evt.thumb_url) +
          '" alt="Event thumbnail" loading="lazy" width="36" height="36" />'
        : "",
      "</div>",
      "<div>",
      '<div class="activity-title"><strong>' +
        esc(evt.symbol || "unknown") +
        "</strong>" +
        statusPill(evt.action || "event") +
        "</div>",
      '<div class="small">' + esc(evt.reason || "") + "</div>",
      evt.actor ? '<div class="activity-actor">' + esc(evt.actor) + "</div>" : "",
      "</div>",
      '<div class="event-meta">' + esc(evt.created_at || "") + "</div>",
      "</article>",
    ].join("")
  }

  function renderActivityFeed() {
    if (state.activeTab !== "activity") return
    var query = String((els.activityFilter && els.activityFilter.value) || "")
      .trim()
      .toLowerCase()
    var events = (state.recentEvents || []).filter(function (evt) {
      if (
        state.activityActionFilter !== "all" &&
        String(evt.action || "").toLowerCase() !== state.activityActionFilter
      )
        return false
      if (!query) return true
      return [evt.symbol, evt.action, evt.reason, evt.actor].some(function (value) {
        return String(value || "")
          .toLowerCase()
          .includes(query)
      })
    })
    els.activityList.innerHTML =
      events.map(eventMarkup).join("") ||
      '<article class="activity-card"><div><strong>No matching activity.</strong></div><div></div></article>'
  }

  function requestKindLabel(kind) {
    return String(kind || "") === "edit_image" ? "Edit blot" : "New blot"
  }

  function requestKindPill(kind) {
    var value = String(kind || "new_candidate")
    var cls = value === "edit_image" ? " request-kind-pill--edit" : ""
    return '<span class="request-kind-pill' + cls + '">' + esc(requestKindLabel(value)) + "</span>"
  }

  function requestStatusPill(status) {
    var value = String(status || "open").toLowerCase()
    var cls =
      value === "open"
        ? " request-status-pill--open"
        : value === "fulfilled"
          ? " request-status-pill--fulfilled"
          : value === "delivery_pending"
            ? " request-status-pill--delivery-pending"
            : ""
    return '<span class="request-status-pill' + cls + '">' + esc(value) + "</span>"
  }

  function requestResultMarkup(row) {
    var result = row && row.fulfilled_asset
    if (!result || !result.asset_sha256) {
      return '<div class="small">Awaiting result</div>'
    }
    var imageUrl = result.thumb_url || result.medium_url || result.full_url || ""
    var fullUrl = result.full_url || result.medium_url || imageUrl
    return [
      '<a class="request-result-link" href="' +
        esc(fullUrl) +
        '" target="_blank" rel="noopener noreferrer" aria-label="Open result image for request ' +
        esc(row.id || "") +
        '">',
      imageUrl
        ? '<img class="request-result-thumb" src="' +
          esc(imageUrl) +
          '" alt="Result for ' +
          esc(row.gene_symbol || "request") +
          '" loading="lazy" decoding="async">'
        : "",
      '<span><strong>Result image</strong><span class="small mono">' +
        esc(shortSha(result.asset_sha256)) +
        "</span></span>",
      "</a>",
    ].join("")
  }

  function requestResultDetailMarkup(row) {
    var result = row && row.fulfilled_asset
    if (!result || !result.asset_sha256) return ""
    var imageUrl = result.medium_url || result.thumb_url || result.full_url || ""
    var fullUrl = result.full_url || imageUrl
    return [
      '<section class="request-result-panel">',
      '<div><div class="detail-kicker">Result image</div><div class="detail-copy">The blot produced by this request remains attached to its history row.</div></div>',
      imageUrl
        ? '<a class="request-result-preview" href="' +
          esc(fullUrl) +
          '" target="_blank" rel="noopener noreferrer"><img src="' +
          esc(imageUrl) +
          '" alt="Result for ' +
          esc(row.gene_symbol || "request") +
          '" loading="lazy" decoding="async"></a>'
        : "",
      '<div class="request-detail-grid">',
      '<div class="request-detail-card"><span>Asset SHA</span><strong class="mono">' +
        esc(result.asset_sha256) +
        "</strong></div>",
      '<div class="request-detail-card"><span>Asset status</span><strong>' +
        esc(result.status || "unknown") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Emulsion</span><strong>' +
        esc(result.display_emulsion_code || displayEmulsionCode(result.emulsion_id) || "unknown") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Candidate ID</span><strong>' +
        esc(result.candidate_image_id || "none") +
        "</strong></div>",
      "</div>",
      "</section>",
    ].join("")
  }

  function requestSearchHaystack(row) {
    return [
      row.id,
      row.gene_symbol,
      row.full_name,
      row.requester_user_id,
      row.requester_username,
      row.request_kind,
      row.request_prompt,
      row.source_gene_symbol,
      row.source_asset_sha256,
      row.request_mode,
      row.requested_vision_id,
      row.requested_emulsion_id,
      row.requested_emulsion_label,
      row.status,
      row.created_at,
      row.fulfilled_asset_sha256,
      row.fulfillment_note,
    ]
      .map(function (value) {
        return String(value || "").toLowerCase()
      })
      .join(" ")
  }

  function filteredGenerationRequests() {
    var query = String((els.requestsSearch && els.requestsSearch.value) || "")
      .trim()
      .toLowerCase()
    var kind = String((els.requestsKind && els.requestsKind.value) || "all")
    var mode = String((els.requestsMode && els.requestsMode.value) || "all")
    var status = String((els.requestsStatus && els.requestsStatus.value) || "all")
    return (state.generationRequests || []).filter(function (row) {
      if (kind !== "all" && String(row.request_kind || "") !== kind) return false
      if (mode !== "all" && String(row.request_mode || "") !== mode) return false
      if (status !== "all" && String(row.status || "") !== status) return false
      if (!query) return true
      return requestSearchHaystack(row).includes(query)
    })
  }

  function requestSummaryMarkup(filteredRows, visibleRows) {
    var all = Array.isArray(state.generationRequests) ? state.generationRequests : []
    var openCount = all.filter(function (row) {
      return String(row.status || "") === "open"
    }).length
    var pendingCount = all.filter(function (row) {
      return String(row.status || "") === "delivery_pending"
    }).length
    var fulfilledCount = all.filter(function (row) {
      return String(row.status || "") === "fulfilled"
    }).length
    var cancelledCount = all.filter(function (row) {
      return String(row.status || "") === "cancelled"
    }).length
    var laneCount = Array.isArray(state.generationRequestLanes)
      ? state.generationRequestLanes.length
      : 0
    return [
      '<span class="request-summary-chip"><strong>' +
        esc(String(visibleRows.length)) +
        "</strong> on this page</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(filteredRows.length)) +
        "</strong> matching</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(all.length)) +
        "</strong> loaded history</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(openCount)) +
        "</strong> open</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(pendingCount)) +
        "</strong> delivery pending</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(fulfilledCount)) +
        "</strong> fulfilled</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(cancelledCount)) +
        "</strong> cancelled</span>",
      '<span class="request-summary-chip"><strong>' +
        esc(String(laneCount)) +
        "</strong> active lanes</span>",
    ].join("")
  }

  function requestRowMarkup(row) {
    var selected = String(row.id || "") === String(state.selectedRequestId || "")
    var source = row.source_asset_sha256
      ? '<div class="small mono">' +
        esc(row.source_gene_symbol || row.gene_symbol || "") +
        " · " +
        esc(shortSha(row.source_asset_sha256)) +
        "</div>"
      : '<div class="small">No source asset</div>'
    return [
      '<tr class="request-row' +
        (selected ? " is-selected" : "") +
        '" data-request-id="' +
        esc(row.id || "") +
        '" tabindex="0" aria-selected="' +
        (selected ? "true" : "false") +
        '" aria-label="Open request ' +
        esc(row.id || "") +
        " for " +
        esc(row.gene_symbol || "unknown gene") +
        '">',
      '<td class="mono">' + esc(row.id || "") + "</td>",
      "<td><div>" +
        esc(row.created_at || "") +
        '</div><div class="small">' +
        esc(row.updated_at || "") +
        "</div></td>",
      "<td><strong>" +
        esc(row.gene_symbol || "") +
        '</strong><div class="small">' +
        esc(row.full_name || "") +
        "</div></td>",
      "<td>" +
        requestKindPill(row.request_kind) +
        '<div class="request-status-stack">' +
        requestStatusPill(row.status) +
        "</div></td>",
      "<td><div>" +
        esc(row.request_mode || "") +
        '</div><div class="small mono">' +
        esc(row.requested_emulsion_label || row.requested_vision_id || "") +
        "</div></td>",
      "<td><div>" +
        esc(row.requester_username || "unknown") +
        '</div><div class="small mono">' +
        esc(row.requester_user_id || "") +
        "</div></td>",
      "<td>" + source + "</td>",
      "<td>" + requestResultMarkup(row) + "</td>",
      "</tr>",
    ].join("")
  }

  function renderRequestDetail() {
    if (!els.requestsDetail) return
    var selected = (state.generationRequests || []).find(function (row) {
      return String(row.id || "") === String(state.selectedRequestId || "")
    })
    if (!selected) {
      els.requestsDetail.innerHTML = [
        '<div class="detail-kicker">Request detail</div>',
        '<div class="detail-title">Pick a request</div>',
        '<div class="detail-copy">Click a row to inspect IDs, source asset, emulsion, prompt, and fulfillment fields.</div>',
      ].join("")
      return
    }
    var raw = JSON.stringify(selected, null, 2)
    els.requestsDetail.innerHTML = [
      '<div class="detail-kicker">Request detail</div>',
      '<div class="detail-title">' +
        esc(selected.gene_symbol || "Unknown gene") +
        " · #" +
        esc(selected.id || "") +
        "</div>",
      '<div class="badge-row">' +
        requestKindPill(selected.request_kind) +
        requestStatusPill(selected.status) +
        "</div>",
      '<div class="request-detail-grid">',
      '<div class="request-detail-card"><span>Created</span><strong>' +
        esc(selected.created_at || "") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Requester</span><strong>' +
        esc(selected.requester_username || selected.requester_user_id || "unknown") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Mode</span><strong>' +
        esc(selected.request_mode || "") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Emulsion</span><strong>' +
        esc(selected.requested_emulsion_label || selected.requested_vision_id || "") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Source gene</span><strong>' +
        esc(selected.source_gene_symbol || selected.gene_symbol || "") +
        "</strong></div>",
      '<div class="request-detail-card"><span>Source asset</span><strong class="mono">' +
        esc(selected.source_asset_sha256 || "none") +
        "</strong></div>",
      "</div>",
      requestResultDetailMarkup(selected),
      selected.request_prompt
        ? '<div><h3>Request prompt</h3><p class="small">' +
          esc(selected.request_prompt) +
          "</p></div>"
        : "",
      '<div><h3>Raw request row</h3><pre class="request-raw">' + esc(raw) + "</pre></div>",
      '<div class="vision-dashboard-actions">',
      '<button class="btn-flat" type="button" data-request-copy="' +
        esc(selected.id || "") +
        '">Copy request JSON</button>',
      '<button class="btn-flat" type="button" data-request-open-gene="' +
        esc(selected.gene_symbol || "") +
        '">Open gene review</button>',
      "</div>",
    ].join("")
  }

  function renderGenerationRequests() {
    if (state.activeTab !== "requests") return
    if (!els.requestsList) return
    var rows = filteredGenerationRequests()
    var pageSize = Math.max(
      1,
      Number.parseInt(String(state.requestPageSize || defaultRequestPageSize()), 10) ||
        defaultRequestPageSize(),
    )
    var pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
    state.requestPage = Math.max(
      1,
      Math.min(pageCount, Number.parseInt(String(state.requestPage || 1), 10) || 1),
    )
    var pageStart = (state.requestPage - 1) * pageSize
    var visibleRows = rows.slice(pageStart, pageStart + pageSize)
    if (
      !visibleRows.some(function (row) {
        return String(row.id || "") === String(state.selectedRequestId || "")
      })
    ) {
      state.selectedRequestId = visibleRows.length ? visibleRows[0].id : null
    }
    if (els.requestsSummary) els.requestsSummary.innerHTML = requestSummaryMarkup(rows, visibleRows)
    if (els.requestsPageLabel)
      els.requestsPageLabel.textContent = "Page " + state.requestPage + " of " + pageCount
    if (els.requestsPageFirst) els.requestsPageFirst.disabled = state.requestPage <= 1
    if (els.requestsPagePrev) els.requestsPagePrev.disabled = state.requestPage <= 1
    if (els.requestsPageNext) els.requestsPageNext.disabled = state.requestPage >= pageCount
    if (els.requestsPageLast) els.requestsPageLast.disabled = state.requestPage >= pageCount
    els.requestsList.innerHTML = visibleRows.length
      ? visibleRows.map(requestRowMarkup).join("")
      : '<tr><td colspan="8"><strong>No matching requests.</strong><div class="small">Try clearing filters or increasing the row limit.</div></td></tr>'
    renderRequestDetail()
  }

  function setRequestPage(nextPage) {
    var pageSize = Math.max(
      1,
      Number.parseInt(String(state.requestPageSize || defaultRequestPageSize()), 10) ||
        defaultRequestPageSize(),
    )
    var pageCount = Math.max(1, Math.ceil(filteredGenerationRequests().length / pageSize))
    state.requestPage = Math.max(
      1,
      Math.min(pageCount, Number.parseInt(String(nextPage || 1), 10) || 1),
    )
    renderGenerationRequests()
  }

  async function refreshGenerationRequests() {
    if (!els.requestsList) return
    try {
      if (els.requestsList) {
        els.requestsList.innerHTML = '<tr><td colspan="8">Loading request history…</td></tr>'
      }
      var limit = Math.max(
        1,
        Math.min(
          500,
          Number.parseInt(String((els.requestsLimit && els.requestsLimit.value) || "200"), 10) ||
            200,
        ),
      )
      var data = await apiJson("/requests/history?limit=" + encodeURIComponent(String(limit)), {
        method: "GET",
      })
      state.generationRequests = Array.isArray(data.rows) ? data.rows : []
      state.generationRequestLanes = Array.isArray(data.lane_summary) ? data.lane_summary : []
      state.requestsLoaded = true
      state.requestPage = 1
      renderGenerationRequests()
    } catch (err) {
      if (isRequestCanceled(err)) return
      var message = requestErrorMessage(err, "Requests load failed.")
      els.requestsList.innerHTML =
        '<tr><td colspan="8"><strong>Requests failed.</strong><div class="small">' +
        esc(message) +
        "</div></td></tr>"
      if (els.requestsSummary) els.requestsSummary.innerHTML = ""
      if (els.requestsDetail)
        els.requestsDetail.innerHTML = inlineFailureMarkup("Requests failed fast", message)
      setLog({ error: "Requests load failed", details: err.response || message })
    }
  }

  function selectedImageEditPrompt() {
    var selectedKind = String(state.selectedPromptKind || "")
    return (
      (state.imageEditPrompts || []).find(function (prompt) {
        return String(prompt.kind || "") === selectedKind
      }) || null
    )
  }

  function promptRowMarkup(prompt) {
    var selected = String(prompt.kind || "") === String(state.selectedPromptKind || "")
    return [
      '<button type="button" class="prompt-row' +
        (selected ? " is-selected" : "") +
        '" data-prompt-kind="' +
        esc(prompt.kind || "") +
        '">',
      '<span class="prompt-row-title"><span>' +
        esc(prompt.label || prompt.kind || "Prompt") +
        "</span>" +
        (prompt.customized
          ? '<span class="status status-approved">custom</span>'
          : '<span class="status status-draft">default</span>') +
        "</span>",
      '<span class="prompt-row-note">' + esc(prompt.description || "") + "</span>",
      "</button>",
    ].join("")
  }

  function setPromptStatus(message, tone) {
    if (!els.promptTemplateStatus) return
    els.promptTemplateStatus.textContent = String(message || "")
    els.promptTemplateStatus.dataset.tone = tone || ""
  }

  function renderImageEditPromptPrefix() {
    var prefix = state.imageEditPromptPrefix || null
    if (els.promptPrefixText) {
      els.promptPrefixText.value = prefix ? String(prefix.prompt_template || "") : ""
      els.promptPrefixText.maxLength = Math.max(1, Number(state.promptMaxLength || 2400) || 2400)
      els.promptPrefixText.disabled = !prefix
    }
    if (els.promptPrefixDefault) {
      els.promptPrefixDefault.textContent = prefix
        ? String(prefix.default_prompt_template || "")
        : ""
    }
    if (els.promptPrefixSave) els.promptPrefixSave.disabled = !prefix
  }

  function renderImageEditPromptSuffix() {
    var suffix = state.imageEditPromptSuffix || null
    if (els.promptSuffixText) {
      els.promptSuffixText.value = suffix ? String(suffix.prompt_template || "") : ""
      els.promptSuffixText.maxLength = Math.max(1, Number(state.promptMaxLength || 2400) || 2400)
      els.promptSuffixText.disabled = !suffix
    }
    if (els.promptSuffixDefault) {
      els.promptSuffixDefault.textContent = suffix
        ? String(suffix.default_prompt_template || "")
        : ""
    }
    if (els.promptSuffixSave) els.promptSuffixSave.disabled = !suffix
  }

  function setFactoryStatus(message, tone) {
    if (!els.factoryStatus) return
    els.factoryStatus.textContent = String(message || "")
    els.factoryStatus.className = "small" + (tone ? " text-" + tone : "")
  }

  function setFactoryWiringStatus(message, tone) {
    if (!els.factoryWiringStatus) return
    els.factoryWiringStatus.textContent = String(message || "")
    els.factoryWiringStatus.className = "small" + (tone ? " text-" + tone : "")
  }

  function renderFactoryWiring() {
    if (!els.factoryWiringRows || !state.factoryRecipe) return
    var visions = Array.isArray(state.factoryRecipe.visions) ? state.factoryRecipe.visions : []
    els.factoryWiringRows.innerHTML = (state.factoryRecipe.pipelines || [])
      .map(function (pipeline) {
        var options = visions
          .map(function (vision) {
            var selected = Number(vision.revision) === Number(pipeline.recommended_vision)
            return (
              '<option value="' +
              esc(String(vision.revision)) +
              '"' +
              (selected ? " selected" : "") +
              ">" +
              esc(vision.label) +
              "</option>"
            )
          })
          .join("")
        return (
          "<tr>" +
          '<th scope="row">' +
          esc(pipeline.code + " · " + pipeline.label) +
          "</th>" +
          "<td>" +
          esc(pipeline.model || "") +
          "</td>" +
          "<td>" +
          esc(
            String(pipeline.steps) +
              " steps · CFG " +
              String(pipeline.cfg) +
              " · " +
              pipeline.sampler,
          ) +
          "</td>" +
          '<td><select data-factory-recommendation="' +
          esc(pipeline.code) +
          '" aria-label="Recommended Vision for Pipeline ' +
          esc(pipeline.code) +
          '">' +
          options +
          "</select></td>" +
          "</tr>"
        )
      })
      .join("")
  }

  function selectedFactoryRecipe() {
    return {
      pipeline: String((els.factoryPipeline && els.factoryPipeline.value) || "").trim(),
      vision:
        Number.parseInt(String((els.factoryVision && els.factoryVision.value) || "0"), 10) || 0,
    }
  }

  function renderFactoryRecipe() {
    if (state.activeTab !== "factory" || !state.factoryRecipe) return
    var data = state.factoryRecipe
    var active = data.active_recipe || { pipeline: "A", vision: 1 }
    var pipelines = Array.isArray(data.pipelines) ? data.pipelines : []
    var visions = Array.isArray(data.visions) ? data.visions : []
    if (els.factoryPipeline) {
      els.factoryPipeline.innerHTML = pipelines
        .map(function (item) {
          return (
            '<option value="' +
            esc(item.code) +
            '">' +
            esc(item.code + " · " + item.label) +
            "</option>"
          )
        })
        .join("")
      els.factoryPipeline.value = String(active.pipeline || "A")
    }
    if (els.factoryVision) {
      els.factoryVision.innerHTML = visions
        .map(function (item) {
          return (
            '<option value="' + esc(String(item.revision)) + '">' + esc(item.label) + "</option>"
          )
        })
        .join("")
      els.factoryVision.value = String(active.vision || 1)
    }
    renderFactoryRecipeSelection()
    renderFactoryWiring()
    renderDiagnosticBuilder()
    if (els.factorySave) els.factorySave.disabled = state.factoryBusy
    if (els.factoryRefresh) els.factoryRefresh.disabled = state.factoryBusy
  }

  function renderFactoryRecipeSelection() {
    if (!state.factoryRecipe) return
    var selected = selectedFactoryRecipe()
    var pipeline = (state.factoryRecipe.pipelines || []).find(function (item) {
      return item.code === selected.pipeline
    })
    var vision = (state.factoryRecipe.visions || []).find(function (item) {
      return Number(item.revision) === selected.vision
    })
    var code = (selected.pipeline || "—") + (selected.vision || "—")
    var isRecommended = Boolean(
      pipeline && Number(pipeline.recommended_vision || 0) === Number(selected.vision || 0),
    )
    if (els.factoryActiveCode) els.factoryActiveCode.textContent = code
    var current = document.getElementById("factory-current")
    var active = state.factoryRecipe.active_recipe || {}
    if (current) current.textContent = "Active: " + active.pipeline + active.vision
    if (els.factoryRecipeDetail) {
      els.factoryRecipeDetail.innerHTML =
        pipeline && vision
          ? [
              "<div><span>Model</span><strong>" + esc(pipeline.model || "") + "</strong></div>",
              "<div><span>Sampling</span><strong>" +
                esc(
                  String(pipeline.steps) +
                    " steps · CFG " +
                    String(pipeline.cfg) +
                    " · " +
                    pipeline.sampler,
                ) +
                "</strong></div>",
              "<div><span>Resolution</span><strong>" +
                esc(String(pipeline.width || "") + "×" + String(pipeline.height || "")) +
                "</strong></div>",
              "<div><span>Vision</span><strong>" +
                esc(vision.label + (isRecommended ? " · recommended for this model" : "")) +
                "</strong></div>",
              "<div><span>Prompt assembly</span><strong>" +
                esc(
                  (vision.prompt_order_mode === "vision_then_manifestation"
                    ? "Vision → manifestation"
                    : "Manifestation → Vision") +
                    " · " +
                    (vision.prompt_content_mode === "full_manifestation"
                      ? "full manifestation"
                      : "tags"),
                ) +
                "</strong></div>",
            ].join("")
          : ""
    }
  }

  function selectRecommendedVisionForPipeline() {
    if (!state.factoryRecipe || !els.factoryPipeline || !els.factoryVision) return
    var pipeline = (state.factoryRecipe.pipelines || []).find(function (item) {
      return item.code === String(els.factoryPipeline.value || "")
    })
    var recommendation = Number(pipeline && pipeline.recommended_vision)
    if (recommendation > 0) els.factoryVision.value = String(recommendation)
    renderFactoryRecipeSelection()
  }

  async function refreshFactoryRecipe() {
    if (!els.factoryPipeline) return
    state.factoryBusy = true
    setFactoryStatus("Loading accepted recipes…", "")
    try {
      state.factoryRecipe = await apiJson("/factory-recipe", { method: "GET" })
      state.factoryLoaded = true
      setFactoryStatus("", "")
      renderFactoryRecipe()
    } catch (err) {
      if (isRequestCanceled(err)) return
      setFactoryStatus(requestErrorMessage(err, "Factory recipe failed to load."), "danger")
    } finally {
      state.factoryBusy = false
      renderFactoryRecipe()
    }
  }

  async function saveFactoryRecipe() {
    var selected = selectedFactoryRecipe()
    state.factoryBusy = true
    renderFactoryRecipe()
    setFactoryStatus("Activating " + selected.pipeline + selected.vision + " for future jobs…", "")
    try {
      state.factoryRecipe = await apiJson("/factory-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      })
      state.factoryLoaded = true
      if (factoryBelts) factoryBelts.invalidate()
      renderFactoryRecipe()
      setFactoryStatus(
        "Future jobs now use " +
          selected.pipeline +
          selected.vision +
          ". Queued jobs are unchanged.",
        "success",
      )
    } catch (err) {
      setFactoryStatus(requestErrorMessage(err, "Factory recipe was not changed."), "danger")
    } finally {
      state.factoryBusy = false
      renderFactoryRecipe()
    }
  }

  async function saveFactoryRecommendation(select) {
    if (!select || !state.factoryRecipe) return
    var pipeline = String(select.getAttribute("data-factory-recommendation") || "")
    var vision = Number.parseInt(String(select.value || "0"), 10) || 0
    select.disabled = true
    setFactoryWiringStatus("Saving " + pipeline + "…", "")
    try {
      state.factoryRecipe = await apiJson("/factory-recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline: pipeline, vision: vision }),
      })
      renderFactoryWiring()
      renderFactoryRecipeSelection()
      setFactoryWiringStatus(pipeline + " recommends Vision " + vision + ".", "success")
    } catch (err) {
      renderFactoryWiring()
      setFactoryWiringStatus(requestErrorMessage(err, "Recommendation failed to save."), "danger")
    }
  }

  function setDiagnosticStatus(message, tone) {
    if (!els.diagnosticStatus) return
    els.diagnosticStatus.textContent = String(message || "")
    els.diagnosticStatus.className = "small" + (tone ? " text-" + tone : "")
  }

  function persistDiagnosticDefaults() {
    try {
      window.localStorage.setItem(
        "iconoplasmDiagnosticMatrixDefaults",
        JSON.stringify({
          pipeline_codes: state.diagnosticSelectedPipelines,
          emulsion_slots: state.diagnosticEmulsionSlots,
          vision_revision: state.diagnosticVisionRevision,
        }),
      )
    } catch {}
  }

  function restoreDiagnosticDefaults() {
    try {
      var parsed = JSON.parse(
        window.localStorage.getItem("iconoplasmDiagnosticMatrixDefaults") || "null",
      )
      if (parsed && Array.isArray(parsed.pipeline_codes) && parsed.pipeline_codes.length) {
        state.diagnosticSelectedPipelines = parsed.pipeline_codes
          .map(function (code) {
            return String(code || "")
              .trim()
              .toUpperCase()
          })
          .filter(Boolean)
      }
      if (parsed && Array.isArray(parsed.emulsion_slots) && parsed.emulsion_slots.length) {
        state.diagnosticEmulsionSlots = parsed.emulsion_slots
          .map(function (slot) {
            return Number.parseInt(String(slot || "0"), 10) || 0
          })
          .filter(function (slot) {
            return slot > 0
          })
      }
      if (parsed) {
        state.diagnosticVisionRevision =
          Number.parseInt(String(parsed.vision_revision || "0"), 10) || 0
      }
    } catch {}
  }

  function diagnosticCellCount() {
    return state.diagnosticSelectedPipelines.length * state.diagnosticEmulsionSlots.length
  }

  function renderDiagnosticBuilder() {
    if (state.activeTab !== "factory") return
    var catalog = state.factoryRecipe || {}
    var pipelines = Array.isArray(catalog.pipelines) ? catalog.pipelines : []
    var visions = Array.isArray(catalog.visions) ? catalog.visions : []
    var accepted = new Set(
      pipelines.map(function (pipeline) {
        return String(pipeline.code || "")
      }),
    )
    state.diagnosticSelectedPipelines = state.diagnosticSelectedPipelines.filter(function (code) {
      return accepted.has(code)
    })
    if (!state.diagnosticSelectedPipelines.length && pipelines.length) {
      state.diagnosticSelectedPipelines = pipelines.map(function (pipeline) {
        return String(pipeline.code || "")
      })
    }
    var acceptedVisionRevisions = new Set(
      visions.map(function (vision) {
        return Number(vision.revision) || 0
      }),
    )
    if (!acceptedVisionRevisions.has(state.diagnosticVisionRevision)) {
      state.diagnosticVisionRevision = Number(catalog.active_recipe?.vision) || 0
    }
    if (els.diagnosticVision) {
      els.diagnosticVision.innerHTML = visions
        .map(function (vision) {
          return (
            '<option value="' +
            esc(String(vision.revision)) +
            '">' +
            esc(String(vision.label || "Vision " + vision.revision)) +
            "</option>"
          )
        })
        .join("")
      els.diagnosticVision.value = String(state.diagnosticVisionRevision || "")
    }
    if (els.diagnosticPipelineOptions) {
      els.diagnosticPipelineOptions.innerHTML = pipelines
        .map(function (pipeline) {
          var code = String(pipeline.code || "")
          var checked = state.diagnosticSelectedPipelines.includes(code) ? " checked" : ""
          return (
            '<label class="diagnostic-option">' +
            '<input type="checkbox" data-diagnostic-pipeline="' +
            esc(code) +
            '"' +
            checked +
            " />" +
            "<span><strong>" +
            esc(code) +
            "</strong> " +
            esc(pipeline.label || "") +
            "</span></label>"
          )
        })
        .join("")
    }
    if (els.diagnosticEmulsionChips) {
      els.diagnosticEmulsionChips.innerHTML = state.diagnosticEmulsionSlots
        .map(function (slot) {
          return (
            '<button type="button" class="diagnostic-emulsion-chip" data-diagnostic-emulsion-remove="' +
            esc(String(slot)) +
            '" aria-label="Remove emulsion ' +
            esc(String(slot)) +
            '"><span>' +
            esc(String(slot)) +
            '</span><span aria-hidden="true">×</span></button>'
          )
        })
        .join("")
    }
    var count = diagnosticCellCount()
    if (els.diagnosticCellCount) els.diagnosticCellCount.textContent = count + " cells"
    if (els.diagnosticRunButton) {
      els.diagnosticRunButton.disabled = state.diagnosticBusy || count < 1
      els.diagnosticRunButton.textContent = state.diagnosticBusy
        ? "Queueing matrix…"
        : "Run " + count + "-cell diagnostic"
    }
    if (els.diagnosticRefresh) els.diagnosticRefresh.disabled = state.diagnosticBusy
  }

  function addDiagnosticEmulsion() {
    var slot =
      Number.parseInt(
        String((els.diagnosticEmulsionInput && els.diagnosticEmulsionInput.value) || "0"),
        10,
      ) || 0
    if (slot < 1) {
      setDiagnosticStatus("Enter an assigned numeric emulsion code.", "danger")
      return
    }
    if (!state.diagnosticEmulsionSlots.includes(slot)) state.diagnosticEmulsionSlots.push(slot)
    if (els.diagnosticEmulsionInput) els.diagnosticEmulsionInput.value = ""
    persistDiagnosticDefaults()
    renderDiagnosticBuilder()
    setDiagnosticStatus("", "")
  }

  function diagnosticPipelineLabel(code) {
    var pipeline = ((state.factoryRecipe && state.factoryRecipe.pipelines) || []).find(
      function (item) {
        return String(item.code || "") === String(code || "")
      },
    )
    return pipeline ? String(pipeline.label || code) : String(code || "")
  }

  function renderDiagnosticMatrix() {
    if (state.activeTab !== "factory") return
    var run = state.diagnosticRun
    if (!run || !els.diagnosticFigure || !els.diagnosticMatrix) {
      if (els.diagnosticFigure) els.diagnosticFigure.hidden = true
      if (els.diagnosticDownload) els.diagnosticDownload.disabled = true
      return
    }
    var pipelines = Array.isArray(run.pipeline_codes) ? run.pipeline_codes : []
    var emulsions = Array.isArray(run.emulsion_slots) ? run.emulsion_slots : []
    var cells = Array.isArray(run.cells) ? run.cells : []
    var byKey = new Map()
    cells.forEach(function (cell) {
      byKey.set(String(cell.pipeline) + ":" + String(cell.emulsion_slot), cell)
    })
    els.diagnosticFigure.hidden = false
    if (els.diagnosticCaption) {
      els.diagnosticCaption.innerHTML =
        "<strong>" +
        esc(run.gene_symbol || "") +
        " diagnostic matrix</strong>" +
        "<span>One gene · " +
        pipelines.length +
        " factory lines · " +
        emulsions.length +
        " emulsions</span>"
    }
    if (els.diagnosticRunCode) els.diagnosticRunCode.textContent = String(run.id || "")
    var html = '<table class="diagnostic-table"><thead><tr><th scope="col">Factory / emulsion</th>'
    emulsions.forEach(function (slot) {
      html += '<th scope="col">' + esc(String(slot)) + "</th>"
    })
    html += "</tr></thead><tbody>"
    pipelines.forEach(function (pipeline) {
      html +=
        '<tr><th scope="row"><strong>' +
        esc(pipeline + String(run.vision_revision || "")) +
        "</strong><span>" +
        esc(diagnosticPipelineLabel(pipeline)) +
        "</span></th>"
      emulsions.forEach(function (slot) {
        var cell = byKey.get(String(pipeline) + ":" + String(slot)) || {}
        var status = String(cell.status || "open")
        var imageAlt =
          String(run.gene_symbol || "Gene") +
          " diagnostic, factory " +
          String(pipeline) +
          ", emulsion " +
          String(slot)
        var image = cell.full_url
          ? '<button type="button" class="diagnostic-cell-image" data-icono-pswp data-icono-pswp-src="' +
            esc(cell.full_url) +
            '" data-icono-pswp-alt="' +
            esc(imageAlt) +
            '" aria-label="Open full-size ' +
            esc(imageAlt) +
            '"><img src="' +
            esc(cell.full_url) +
            '" alt="' +
            esc(imageAlt) +
            '" loading="lazy" /></button>'
          : '<div class="diagnostic-cell-state"><span class="diagnostic-cell-pulse"></span>' +
            esc(status === "open" ? "Queued" : status) +
            "</div>"
        html +=
          '<td class="diagnostic-cell" data-status="' +
          esc(status) +
          '"><div class="diagnostic-cell-code">' +
          esc(cell.emulsion_code || pipeline + String(run.vision_revision || "") + "-" + slot) +
          "</div>" +
          image +
          "</td>"
      })
      html += "</tr>"
    })
    els.diagnosticMatrix.innerHTML = html + "</tbody></table>"
    var counts = run.counts || {}
    var total = Number(counts.total || run.cell_count || 0)
    var completed = Number(counts.completed || 0)
    if (els.diagnosticProgress) {
      els.diagnosticProgress.hidden = false
      els.diagnosticProgress.innerHTML =
        '<div class="diagnostic-progress-copy"><strong>' +
        esc(
          run.status === "completed" ? "Matrix complete" : completed + " of " + total + " complete",
        ) +
        "</strong><span>" +
        esc(
          Number(counts.failed || 0)
            ? String(counts.failed) + " need attention"
            : "The workstation advances one immutable factory group at a time.",
        ) +
        '</span></div><progress max="' +
        esc(String(Math.max(1, total))) +
        '" value="' +
        esc(String(completed)) +
        '"></progress>'
    }
    if (els.diagnosticLegend) {
      els.diagnosticLegend.textContent =
        "Rows identify immutable factory Pipeline + Vision recipes; columns identify emulsion slots. " +
        "Every cell holds gene " +
        String(run.gene_symbol || "") +
        " and prompt body " +
        (run.prompt_body_mode === "prose_prompt"
          ? "constant full manifestation"
          : "constant Tags") +
        ". Images retain their native portrait aspect ratio."
    }
    if (els.diagnosticDownload) els.diagnosticDownload.disabled = run.status !== "completed"
    if (run.status === "completed")
      setDiagnosticStatus(
        "Diagnostic complete. All " + total + " cells are receipt-backed.",
        "success",
      )
  }

  function scheduleDiagnosticPoll() {
    if (state.diagnosticPollTimer) window.clearTimeout(state.diagnosticPollTimer)
    state.diagnosticPollTimer = null
    if (
      state.activeTab !== "factory" ||
      (factoryBelts && factoryBelts.view() !== "diagnostics") ||
      !state.diagnosticRun ||
      state.diagnosticRun.status === "completed"
    )
      return
    state.diagnosticPollTimer = window.setTimeout(function () {
      refreshDiagnosticMatrix({ quiet: true, id: state.diagnosticRun && state.diagnosticRun.id })
    }, 5000)
  }

  function newDiagnosticRunId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function")
      return "diag-" + window.crypto.randomUUID()
    var bytes = new Uint8Array(16)
    window.crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 15) | 64
    bytes[8] = (bytes[8] & 63) | 128
    var hex = Array.prototype.map
      .call(bytes, function (value) {
        return value.toString(16).padStart(2, "0")
      })
      .join("")
    return (
      "diag-" +
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    )
  }

  function waitForDiagnosticRecovery(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms)
    })
  }

  async function recoverDiagnosticRun(runId) {
    for (var attempt = 0; attempt < 10; attempt += 1) {
      await waitForDiagnosticRecovery(1000)
      try {
        var payload = await apiJson("/diagnostic-matrices?id=" + encodeURIComponent(runId), {
          method: "GET",
        })
        if (
          payload &&
          payload.run &&
          Number(payload.run.cell_count || 0) === Number(payload.run.counts?.total || 0)
        )
          return payload
      } catch {}
    }
    return null
  }

  async function refreshDiagnosticMatrix(options) {
    var opts = options || {}
    if (!els.diagnosticMatrix) return
    if (!opts.quiet) setDiagnosticStatus("Loading latest diagnostic…", "")
    try {
      var id = opts.latest
        ? ""
        : String(opts.id || (state.diagnosticRun && state.diagnosticRun.id) || "").trim()
      var payload = await apiJson(
        "/diagnostic-matrices" + (id ? "?id=" + encodeURIComponent(id) : ""),
        { method: "GET" },
      )
      // A status read describes an existing immutable run. It must never
      // rebuild or normalize the operator's draft for the next run.
      if (payload && payload.catalog && !state.factoryLoaded) {
        state.factoryRecipe = payload.catalog
        state.factoryLoaded = true
        renderFactoryRecipe()
      }
      state.diagnosticRun = payload && payload.run ? payload.run : null
      renderDiagnosticMatrix()
      if (!opts.quiet && !state.diagnosticRun) setDiagnosticStatus("No diagnostic runs yet.", "")
    } catch (err) {
      if (isRequestCanceled(err)) return
      setDiagnosticStatus(requestErrorMessage(err, "Diagnostic status failed to load."), "danger")
    } finally {
      // A transient read failure must not freeze a still-running matrix. The
      // durable run remains authoritative, so keep polling until it reports
      // completion or the Factory tab is unmounted.
      scheduleDiagnosticPoll()
    }
  }

  async function startDiagnosticMatrix() {
    var gene = String((els.diagnosticGene && els.diagnosticGene.value) || "")
      .trim()
      .toUpperCase()
    var count = diagnosticCellCount()
    var visionRevision =
      Number.parseInt(String((els.diagnosticVision && els.diagnosticVision.value) || "0"), 10) || 0
    if (!gene || !count || !visionRevision) {
      setDiagnosticStatus(
        "Choose one gene, at least one factory line, at least one emulsion, and one Vision.",
        "danger",
      )
      return
    }
    state.diagnosticVisionRevision = visionRevision
    // Freeze and save the exact draft before the request begins. The POST can
    // take long enough for status polling and tab lifecycle work to run; none
    // of that may replace the choices for the next diagnostic.
    var submittedPipelines = state.diagnosticSelectedPipelines.slice()
    var submittedEmulsions = state.diagnosticEmulsionSlots.slice()
    persistDiagnosticDefaults()
    state.diagnosticBusy = true
    renderDiagnosticBuilder()
    setDiagnosticStatus("Queueing " + count + " immutable cells…", "")
    var runId = newDiagnosticRunId()
    var requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        gene_symbol: gene,
        pipeline_codes: submittedPipelines,
        emulsion_slots: submittedEmulsions,
        vision_revision: visionRevision,
        prompt_body_mode: (function () {
          var vision = (
            state.factoryRecipe && state.factoryRecipe.visions ? state.factoryRecipe.visions : []
          ).find(function (item) {
            return Number(item.revision) === visionRevision
          })
          return vision && vision.prompt_content_mode === "full_manifestation"
            ? "prose_prompt"
            : "taggerizer_prompt"
        })(),
      }),
    }
    try {
      var payload
      try {
        payload = await apiJson("/diagnostic-matrices", requestOptions)
      } catch (err) {
        if (!err || err.code !== "TIMEOUT") throw err
        setDiagnosticStatus("Finishing the complete " + count + "-cell matrix…", "")
        payload = await recoverDiagnosticRun(runId)
        if (!payload) {
          payload = await apiJson(
            "/diagnostic-matrices",
            Object.assign({}, requestOptions, { timeoutMs: 60000 }),
          )
        }
      }
      state.diagnosticRun = payload.run || null
      renderDiagnosticMatrix()
      setDiagnosticStatus(
        "Queued " + count + " cells. This page will update as the factory publishes them.",
        "success",
      )
      scheduleDiagnosticPoll()
    } catch (err) {
      setDiagnosticStatus(requestErrorMessage(err, "Diagnostic matrix was not queued."), "danger")
    } finally {
      state.diagnosticBusy = false
      renderDiagnosticBuilder()
    }
  }

  function loadDiagnosticCanvasImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image()
      image.onload = function () {
        resolve(image)
      }
      image.onerror = reject
      image.src = url
    })
  }

  async function downloadDiagnosticPng() {
    var run = state.diagnosticRun
    if (!run || run.status !== "completed") return
    setDiagnosticStatus("Rendering full-resolution matrix…", "")
    try {
      var pipelines = run.pipeline_codes || []
      var emulsions = run.emulsion_slots || []
      var cellWidth = 448
      var cellHeight = 640
      var rowLabelWidth = 320
      var headerHeight = 250
      var legendHeight = 210
      var canvas = document.createElement("canvas")
      canvas.width = rowLabelWidth + emulsions.length * cellWidth
      canvas.height = headerHeight + pipelines.length * cellHeight + legendHeight
      var ctx = canvas.getContext("2d")
      ctx.fillStyle = "#f5f1e8"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#18221c"
      ctx.font = "700 56px Georgia, serif"
      ctx.fillText(String(run.gene_symbol || "") + " diagnostic matrix", 36, 70)
      ctx.font = "28px Georgia, serif"
      ctx.fillText(
        pipelines.length +
          " factory lines × " +
          emulsions.length +
          " emulsions · Vision " +
          run.vision_revision,
        38,
        118,
      )
      ctx.textAlign = "center"
      ctx.font = "700 30px Georgia, serif"
      emulsions.forEach(function (slot, index) {
        ctx.fillText(String(slot), rowLabelWidth + index * cellWidth + cellWidth / 2, 205)
      })
      var cellsByKey = new Map(
        (run.cells || []).map(function (cell) {
          return [cell.pipeline + ":" + cell.emulsion_slot, cell]
        }),
      )
      for (var row = 0; row < pipelines.length; row += 1) {
        var pipeline = pipelines[row]
        var y = headerHeight + row * cellHeight
        ctx.textAlign = "left"
        ctx.font = "700 40px Georgia, serif"
        ctx.fillText(pipeline + String(run.vision_revision), 36, y + 70)
        ctx.font = "24px Georgia, serif"
        var label = diagnosticPipelineLabel(pipeline)
        ctx.fillText(label, 36, y + 108)
        for (var column = 0; column < emulsions.length; column += 1) {
          var slot = emulsions[column]
          var cell = cellsByKey.get(pipeline + ":" + slot)
          if (!cell || !cell.full_url) continue
          var image = await loadDiagnosticCanvasImage(cell.full_url)
          var x = rowLabelWidth + column * cellWidth
          var padding = 18
          var labelBand = 48
          var availableWidth = cellWidth - padding * 2
          var availableHeight = cellHeight - padding * 2 - labelBand
          var scale = Math.min(
            availableWidth / image.naturalWidth,
            availableHeight / image.naturalHeight,
          )
          var drawWidth = image.naturalWidth * scale
          var drawHeight = image.naturalHeight * scale
          var drawX = x + (cellWidth - drawWidth) / 2
          var drawY = y + labelBand + (availableHeight - drawHeight) / 2
          ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
          ctx.strokeStyle = "#b8b09f"
          ctx.strokeRect(drawX, drawY, drawWidth, drawHeight)
          ctx.fillStyle = "#18221c"
          ctx.textAlign = "center"
          ctx.font = "700 24px Georgia, serif"
          ctx.fillText(cell.emulsion_code, x + cellWidth / 2, y + 34)
        }
      }
      ctx.textAlign = "left"
      ctx.fillStyle = "#18221c"
      ctx.font = "24px Georgia, serif"
      var legendY = canvas.height - legendHeight + 54
      ctx.fillText(
        "Rows: immutable factory Pipeline + Vision. Columns: emulsion slot.",
        36,
        legendY,
      )
      ctx.fillText(
        "Gene and " +
          (run.prompt_body_mode === "prose_prompt" ? "full manifestation" : "Tags") +
          " prompt held constant. Native portrait aspect ratio retained.",
        36,
        legendY + 42,
      )
      ctx.font = "20px Georgia, serif"
      ctx.fillStyle = "#566259"
      ctx.fillText(String(run.id || "") + " · " + String(run.created_at || ""), 36, legendY + 88)
      var blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, "image/png")
      })
      if (!blob) throw new Error("PNG encoder returned no image.")
      var link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = String(run.gene_symbol || "gene") + "-diagnostic-matrix.png"
      link.click()
      window.setTimeout(function () {
        URL.revokeObjectURL(link.href)
      }, 1000)
      setDiagnosticStatus("PNG downloaded.", "success")
    } catch (err) {
      setDiagnosticStatus(requestErrorMessage(err, "PNG could not be rendered."), "danger")
    }
  }

  function renderImageEditPrompts() {
    if (state.activeTab !== "prompts") return
    if (!els.promptTemplateList) return
    renderImageEditPromptPrefix()
    renderImageEditPromptSuffix()
    var prompts = Array.isArray(state.imageEditPrompts) ? state.imageEditPrompts : []
    if (!prompts.length) {
      els.promptTemplateList.innerHTML = inlineFailureMarkup(
        "No prompts loaded",
        "Refresh this tab to load image edit prompt templates.",
      )
      if (els.promptTemplateText) {
        els.promptTemplateText.value = ""
        els.promptTemplateText.disabled = true
      }
      if (els.promptTemplateSave) els.promptTemplateSave.disabled = true
      return
    }
    if (
      !prompts.some(function (prompt) {
        return String(prompt.kind || "") === String(state.selectedPromptKind || "")
      })
    ) {
      state.selectedPromptKind = String(prompts[0].kind || "")
    }
    els.promptTemplateList.innerHTML = prompts.map(promptRowMarkup).join("")
    var selected = selectedImageEditPrompt()
    if (els.promptTemplateHeading)
      els.promptTemplateHeading.textContent = selected
        ? String(selected.label || selected.kind || "Prompt")
        : "Pick a prompt"
    if (els.promptTemplateDescription)
      els.promptTemplateDescription.textContent = selected
        ? String(selected.description || "")
        : "Pick a prompt to edit."
    if (els.promptTemplateText) {
      els.promptTemplateText.value = selected ? String(selected.prompt_template || "") : ""
      els.promptTemplateText.maxLength = Math.max(1, Number(state.promptMaxLength || 2400) || 2400)
      els.promptTemplateText.disabled = !selected
    }
    if (els.promptTemplateDefault)
      els.promptTemplateDefault.textContent = selected
        ? String(selected.default_prompt_template || "")
        : ""
    if (els.promptTemplateSave) els.promptTemplateSave.disabled = !selected
  }

  async function refreshImageEditPrompts() {
    if (!els.promptTemplateList) return
    try {
      if (els.promptsRefresh) els.promptsRefresh.disabled = true
      setPromptStatus("Loading prompts...", "")
      var data = await apiJson("/image-edit-prompts", { method: "GET" })
      state.imageEditPrompts = Array.isArray(data.prompts) ? data.prompts : []
      state.imageEditPromptPrefix = data.prefix || null
      state.imageEditPromptSuffix = data.suffix || null
      state.promptMaxLength = Math.max(1, Number(data.max_length || 2400) || 2400)
      state.promptsLoaded = true
      renderImageEditPrompts()
      setPromptStatus("Prompts loaded.", "success")
    } catch (err) {
      if (isRequestCanceled(err)) return
      var message = requestErrorMessage(err, "Prompt templates failed to load.")
      els.promptTemplateList.innerHTML = inlineFailureMarkup("Prompts failed", message)
      setPromptStatus(message, "error")
      setLog({ error: "Prompt templates load failed", details: err.response || message })
    } finally {
      if (els.promptsRefresh) els.promptsRefresh.disabled = false
    }
  }

  async function saveImageEditPromptSuffix() {
    var suffix = state.imageEditPromptSuffix || { kind: "shared_suffix" }
    if (!els.promptSuffixText) return
    var promptTemplate = String(els.promptSuffixText.value || "").trim()
    if (!promptTemplate) {
      setPromptStatus("Shared suffix cannot be empty.", "error")
      return
    }
    try {
      if (els.promptSuffixSave) els.promptSuffixSave.disabled = true
      setPromptStatus("Saving shared suffix...", "")
      var data = await apiJson("/image-edit-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: suffix.kind || "shared_suffix",
          prompt_template: promptTemplate,
        }),
      })
      if (data && data.suffix) {
        state.imageEditPromptSuffix = data.suffix
      }
      renderImageEditPromptSuffix()
      setPromptStatus("Shared suffix saved.", "success")
      setLog({ ok: true, suffix: data && data.suffix })
    } catch (err) {
      var message = requestErrorMessage(err, "Shared suffix save failed.")
      setPromptStatus(message, "error")
      setLog({ error: "Shared suffix save failed", details: err.response || message })
    } finally {
      if (els.promptSuffixSave) els.promptSuffixSave.disabled = !state.imageEditPromptSuffix
    }
  }

  async function saveImageEditPromptPrefix() {
    var prefix = state.imageEditPromptPrefix || { kind: "shared_prefix" }
    if (!els.promptPrefixText) return
    var promptTemplate = String(els.promptPrefixText.value || "").trim()
    if (!promptTemplate) {
      setPromptStatus("Shared prefix cannot be empty.", "error")
      return
    }
    try {
      if (els.promptPrefixSave) els.promptPrefixSave.disabled = true
      setPromptStatus("Saving shared prefix...", "")
      var data = await apiJson("/image-edit-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: prefix.kind || "shared_prefix",
          prompt_template: promptTemplate,
        }),
      })
      if (data && data.prefix) {
        state.imageEditPromptPrefix = data.prefix
      }
      renderImageEditPromptPrefix()
      setPromptStatus("Shared prefix saved.", "success")
      setLog({ ok: true, prefix: data && data.prefix })
    } catch (err) {
      var message = requestErrorMessage(err, "Shared prefix save failed.")
      setPromptStatus(message, "error")
      setLog({ error: "Shared prefix save failed", details: err.response || message })
    } finally {
      if (els.promptPrefixSave) els.promptPrefixSave.disabled = !state.imageEditPromptPrefix
    }
  }

  async function saveSelectedImageEditPrompt() {
    var selected = selectedImageEditPrompt()
    if (!selected || !els.promptTemplateText) return
    var promptTemplate = String(els.promptTemplateText.value || "").trim()
    if (!promptTemplate) {
      setPromptStatus("Prompt template cannot be empty.", "error")
      return
    }
    try {
      if (els.promptTemplateSave) els.promptTemplateSave.disabled = true
      setPromptStatus("Saving prompt...", "")
      var data = await apiJson("/image-edit-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selected.kind,
          prompt_template: promptTemplate,
        }),
      })
      if (data && data.prompt) {
        state.imageEditPrompts = (state.imageEditPrompts || []).map(function (prompt) {
          return String(prompt.kind || "") === String(data.prompt.kind || "") ? data.prompt : prompt
        })
      }
      renderImageEditPrompts()
      setPromptStatus("Prompt saved.", "success")
      setLog({ ok: true, prompt: data && data.prompt })
    } catch (err) {
      var message = requestErrorMessage(err, "Prompt save failed.")
      setPromptStatus(message, "error")
      setLog({ error: "Prompt save failed", details: err.response || message })
    } finally {
      if (els.promptTemplateSave) els.promptTemplateSave.disabled = !selectedImageEditPrompt()
    }
  }

  function normalizePublicationAlias(value) {
    return String(value || "")
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\s+/g, " ")
  }

  function publicationAliasCollisionKey(value) {
    return normalizePublicationAlias(value)
  }

  function publicationAliasValidationMessage(value, maxLength) {
    var alias = normalizePublicationAlias(value)
    if (!alias) return "Enter an alias first."
    if (alias.length > Number(maxLength || PUBLICATION_ALIAS_MAX_LENGTH)) {
      return (
        "Alias exceeds the " +
        String(maxLength || PUBLICATION_ALIAS_MAX_LENGTH) +
        " character limit."
      )
    }
    if (PUBLICATION_ALIAS_CONTROL_CHAR_PATTERN.test(alias)) {
      return "Alias contains a control character."
    }
    if (!/[A-Za-z\u0370-\u03ff]/u.test(alias)) {
      return "Alias must contain a letter."
    }
    return ""
  }

  function normalizePublicationAliasMap(value) {
    var bySymbol = {}
    if (!value || typeof value !== "object" || Array.isArray(value)) return bySymbol
    Object.keys(value).forEach(function (rawSymbol) {
      var symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || !Array.isArray(value[rawSymbol])) return
      var aliases = value[rawSymbol].map(normalizePublicationAlias).filter(function (alias) {
        return Boolean(alias)
      })
      if (!aliases.length) return
      bySymbol[symbol] = (bySymbol[symbol] || []).concat(aliases)
    })
    return bySymbol
  }

  function clonePublicationAliasMap(value) {
    var normalized = normalizePublicationAliasMap(value)
    return Object.fromEntries(
      Object.keys(normalized).map(function (symbol) {
        return [symbol, normalized[symbol].slice()]
      }),
    )
  }

  function publicationAliasMapRows(value) {
    var rows = []
    var normalized = normalizePublicationAliasMap(value)
    Object.keys(normalized).forEach(function (symbol) {
      normalized[symbol].forEach(function (alias) {
        rows.push({ alias: alias, symbol: symbol, key: alias })
      })
    })
    rows.sort(function (left, right) {
      return left.alias.localeCompare(right.alias) || left.symbol.localeCompare(right.symbol)
    })
    return rows
  }

  function publicationAliasMapsMatch(left, right) {
    function comparable(value) {
      var normalized = normalizePublicationAliasMap(value)
      return Object.keys(normalized)
        .sort()
        .map(function (symbol) {
          return [
            symbol,
            normalized[symbol].slice().sort(function (leftAlias, rightAlias) {
              return leftAlias.localeCompare(rightAlias)
            }),
          ]
        })
    }
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
  }

  function publicationAliasRowIndex(value) {
    return new Map(
      publicationAliasMapRows(value).map(function (row) {
        return [row.key, row]
      }),
    )
  }

  function publicationAliasCollisionRows(value, alias) {
    var collisionKey = publicationAliasCollisionKey(alias)
    return publicationAliasMapRows(value).filter(function (row) {
      return publicationAliasCollisionKey(row.alias) === collisionKey
    })
  }

  function publicationAliasDraftRows() {
    var baseline = publicationAliasRowIndex(state.publicationAliasPolicy?.by_symbol || {})
    var draft = publicationAliasRowIndex(state.publicationAliasDraftBySymbol || {})
    var keys = new Set([...baseline.keys(), ...draft.keys()])
    return Array.from(keys)
      .map(function (key) {
        var before = baseline.get(key) || null
        var after = draft.get(key) || null
        var change = "unchanged"
        if (!before && after) change = "new"
        else if (before && !after) change = "removed"
        else if (
          before &&
          after &&
          (before.symbol !== after.symbol || before.alias !== after.alias)
        )
          change = "changed"
        return {
          key: key,
          alias: after?.alias || before?.alias || "",
          symbol: after?.symbol || before?.symbol || "",
          before: before,
          after: after,
          change: change,
        }
      })
      .sort(function (left, right) {
        return left.alias.localeCompare(right.alias) || left.symbol.localeCompare(right.symbol)
      })
  }

  function publicationAliasMapWithout(value, alias) {
    var exactAlias = normalizePublicationAlias(alias)
    var next = clonePublicationAliasMap(value)
    Object.keys(next).forEach(function (symbol) {
      next[symbol] = next[symbol].filter(function (candidate) {
        return candidate !== exactAlias
      })
      if (!next[symbol].length) delete next[symbol]
    })
    return next
  }

  function publicationAliasMapWith(value, alias, symbol) {
    var exactAlias = normalizePublicationAlias(alias)
    var next = publicationAliasMapWithout(value, exactAlias)
    var canonicalSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!canonicalSymbol) return next
    next[canonicalSymbol] = (next[canonicalSymbol] || []).concat([exactAlias])
    return next
  }

  function publicationAliasMapRestoringBaseline(value, alias, baselineValue) {
    var exactAlias = normalizePublicationAlias(alias)
    var baseline = normalizePublicationAliasMap(baselineValue)
    var baselineRow = publicationAliasRowIndex(baseline).get(exactAlias)
    if (!baselineRow) return clonePublicationAliasMap(value)
    var next = publicationAliasMapWithout(value, exactAlias)
    var target = (next[baselineRow.symbol] || []).slice()
    var baselineAliases = baseline[baselineRow.symbol] || []
    var baselineIndex = baselineAliases.indexOf(exactAlias)
    var insertionIndex = target.length
    for (var nextIndex = baselineIndex + 1; nextIndex < baselineAliases.length; nextIndex += 1) {
      var nextSiblingIndex = target.indexOf(baselineAliases[nextIndex])
      if (nextSiblingIndex >= 0) {
        insertionIndex = nextSiblingIndex
        break
      }
    }
    if (insertionIndex === target.length) {
      for (var previousIndex = baselineIndex - 1; previousIndex >= 0; previousIndex -= 1) {
        var previousSiblingIndex = target.indexOf(baselineAliases[previousIndex])
        if (previousSiblingIndex >= 0) {
          insertionIndex = previousSiblingIndex + 1
          break
        }
      }
    }
    target.splice(insertionIndex, 0, exactAlias)
    next[baselineRow.symbol] = target
    return next
  }

  function publicationAliasIsDirty() {
    return Boolean(
      state.publicationAliasLoaded &&
      state.publicationAliasPolicy &&
      !publicationAliasMapsMatch(
        state.publicationAliasDraftBySymbol,
        state.publicationAliasPolicy.by_symbol,
      ),
    )
  }

  function publicationAliasNeedsPublicationRetry() {
    return Boolean(
      state.publicationAliasLoaded &&
      state.publicationAliasPolicy &&
      state.publicationAliasPublication?.in_sync === false,
    )
  }

  function setPublicationAliasStatus(message, tone) {
    if (!els.publicationAliasStatus) return
    els.publicationAliasStatus.textContent = String(message || "")
    if (tone) els.publicationAliasStatus.dataset.tone = tone
    else delete els.publicationAliasStatus.dataset.tone
  }

  function publicationAliasConflictOperations(response) {
    return Array.isArray(response?.invalid_operations)
      ? response.invalid_operations.filter(function (operation) {
          return operation && typeof operation === "object"
        })
      : []
  }

  function clearPublicationAliasConflict() {
    state.publicationAliasConflictOperations = []
    if (!els.publicationAliasConflict) return
    els.publicationAliasConflict.hidden = true
    els.publicationAliasConflict.replaceChildren()
  }

  function showPublicationAliasConflict(operations) {
    var safeOperations = Array.isArray(operations) ? operations : []
    state.publicationAliasConflictOperations = safeOperations
    if (!els.publicationAliasConflict) return
    var rows = safeOperations.map(function (operation) {
      var alias = normalizePublicationAlias(operation.alias || "")
      var requested = String(operation.symbol || "")
        .trim()
        .toUpperCase()
      var owners = Array.isArray(operation.owners)
        ? operation.owners
            .map(function (owner) {
              return String(owner || "")
                .trim()
                .toUpperCase()
            })
            .filter(Boolean)
        : []
      if (operation.reason === "owned_by_other_gene" && alias && requested && owners.length) {
        return (
          '<p>The exact label <span class="mono">' +
          esc(alias) +
          "</span> is already owned by <strong>" +
          esc(owners.join(", ")) +
          "</strong> in the published catalog. Adding it to <strong>" +
          esc(requested) +
          "</strong> would give that same exact label two owners, so the deterministic safety policy rejected it.</p>"
        )
      }
      if (operation.reason === "already_generated_for_target" && alias && requested) {
        return (
          '<p><span class="mono">' +
          esc(alias) +
          "</span> already resolves to <strong>" +
          esc(requested) +
          "</strong>; a duplicate curated mapping is not allowed.</p>"
        )
      }
      return "<p>This mapping conflicts with the published recognition catalog and was rejected.</p>"
    })
    els.publicationAliasConflict.innerHTML =
      "<strong>Not added — unsafe alias</strong>" +
      rows.join("") +
      "<p>Nothing from this rejected mapping was saved or published.</p>"
    els.publicationAliasConflict.hidden = false
  }

  function removeRejectedPublicationAliasAdditionsFromDraft(operations) {
    var next = clonePublicationAliasMap(state.publicationAliasDraftBySymbol)
    var removed = 0
    ;(Array.isArray(operations) ? operations : []).forEach(function (operation) {
      if (operation?.operation !== "add") return
      var alias = normalizePublicationAlias(operation.alias || "")
      var symbol = String(operation.symbol || "")
        .trim()
        .toUpperCase()
      var current = publicationAliasRowIndex(next).get(alias)
      if (!current || current.symbol !== symbol) return
      next = publicationAliasMapWithout(next, current.alias)
      removed += 1
    })
    state.publicationAliasDraftBySymbol = next
    return removed
  }

  function applyPublicationAliasPayload(data) {
    var policy = data && data.policy && typeof data.policy === "object" ? data.policy : null
    if (!policy) throw new Error("Publication alias response is missing its policy.")
    var revision = Number.parseInt(String(policy.revision || 0), 10)
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error("Publication alias response has an invalid revision.")
    }
    if (!policy.by_symbol || typeof policy.by_symbol !== "object") {
      throw new Error("Publication alias response is missing its mappings.")
    }
    var bySymbol = normalizePublicationAliasMap(policy.by_symbol)
    var removeBySymbol = normalizePublicationAliasMap(policy.remove_by_symbol || {})
    var aliasCount = publicationAliasMapRows(bySymbol).length
    var removalCount = publicationAliasMapRows(removeBySymbol).length
    if (Number.isFinite(Number(policy.alias_count)) && Number(policy.alias_count) !== aliasCount) {
      throw new Error("Publication alias response has an inconsistent alias count.")
    }
    if (
      Number.isFinite(Number(policy.removal_count)) &&
      Number(policy.removal_count) !== removalCount
    ) {
      throw new Error("Publication alias response has an inconsistent correction count.")
    }
    var publication =
      data && data.publication && typeof data.publication === "object" ? data.publication : {}
    var limits = data && data.limits && typeof data.limits === "object" ? data.limits : {}
    var maxAliases = Number.parseInt(
      String(
        limits.max_aliases ||
          limits.max_operations ||
          limits.max_alias_count ||
          PUBLICATION_ALIAS_MAX_OPERATIONS,
      ),
      10,
    )
    var maxAliasLength = Number.parseInt(
      String(limits.max_alias_length || limits.max_length || PUBLICATION_ALIAS_MAX_LENGTH),
      10,
    )
    state.publicationAliasPolicy = {
      schema_version: Number.parseInt(String(policy.schema_version || 0), 10) || null,
      revision: revision,
      version: String(policy.version || ""),
      alias_count: aliasCount,
      removal_count: removalCount,
      by_symbol: bySymbol,
      remove_by_symbol: removeBySymbol,
      updated_at: String(policy.updated_at || ""),
      updated_by: String(policy.updated_by || ""),
    }
    state.publicationAliasPublication = {
      version: String(publication.version || ""),
      revision: Number.parseInt(String(publication.revision || 0), 10) || null,
      in_sync: publication.in_sync === true,
      published_at: String(publication.published_at || ""),
      last_error: String(publication.last_error || ""),
    }
    state.publicationAliasLimits = {
      max_aliases:
        Number.isFinite(maxAliases) && maxAliases > 0
          ? maxAliases
          : PUBLICATION_ALIAS_MAX_OPERATIONS,
      max_alias_length:
        Number.isFinite(maxAliasLength) && maxAliasLength > 0
          ? maxAliasLength
          : PUBLICATION_ALIAS_MAX_LENGTH,
    }
    state.publicationAliasLoaded = true
  }

  function publicationAliasMappingMarkup(row) {
    var encodedAlias = encodeURIComponent(row.alias)
    var classes = ["publication-alias-mapping"]
    if (row.change !== "unchanged") classes.push("publication-alias-mapping--" + row.change)
    var stateLabel =
      row.change === "new"
        ? "New"
        : row.change === "changed"
          ? "Changed"
          : row.change === "removed"
            ? "Will remove"
            : ""
    var target = row.after || row.before || { symbol: row.symbol }
    var previousTarget = row.change === "changed" && row.before ? row.before.symbol : ""
    var actions = []
    if (row.change === "removed") {
      actions.push(
        '<button type="button" data-publication-alias-undo="' +
          esc(encodedAlias) +
          '">Undo</button>',
      )
    } else {
      actions.push(
        '<button type="button" data-publication-alias-change="' +
          esc(encodedAlias) +
          '">Change</button>',
      )
      actions.push(
        '<button type="button" class="publication-alias-remove" data-publication-alias-remove="' +
          esc(encodedAlias) +
          '">Remove</button>',
      )
      if (row.change === "changed") {
        actions.push(
          '<button type="button" data-publication-alias-undo="' +
            esc(encodedAlias) +
            '">Undo</button>',
        )
      }
    }
    return [
      '<li class="' + classes.join(" ") + '" data-change="' + esc(row.change) + '">',
      '<div class="publication-alias-mapping-copy">',
      '<span class="publication-alias-mapping-alias mono">' + esc(row.alias) + "</span>",
      '<span class="publication-alias-arrow" aria-hidden="true">→</span>',
      '<strong class="publication-alias-mapping-symbol">' + esc(target.symbol) + "</strong>",
      previousTarget
        ? '<span class="publication-alias-mapping-previous">was ' + esc(previousTarget) + "</span>"
        : "",
      stateLabel
        ? '<span class="publication-alias-change-state">' + esc(stateLabel) + "</span>"
        : "",
      "</div>",
      '<div class="publication-alias-mapping-actions">' + actions.join("") + "</div>",
      "</li>",
    ].join("")
  }

  function publicationAliasComposerCanSubmit() {
    var alias = normalizePublicationAlias(
      state.publicationAliasEditing?.alias || els.publicationAliasInput?.value || "",
    )
    var selectedSymbol = String(state.publicationAliasSelectedGene?.symbol || "")
    if (!alias || !selectedSymbol || state.publicationAliasBusy) return false
    if (
      publicationAliasValidationMessage(
        alias,
        state.publicationAliasLimits?.max_alias_length || PUBLICATION_ALIAS_MAX_LENGTH,
      )
    )
      return false
    if (
      state.publicationAliasEditing &&
      String(state.publicationAliasEditing.symbol || "") === selectedSymbol
    )
      return false
    return true
  }

  function renderPublicationAliases() {
    var policy = state.publicationAliasPolicy
    var publication = state.publicationAliasPublication || {}
    var rows = publicationAliasDraftRows()
    var aliasCount = rows.filter(function (row) {
      return row.change !== "removed"
    }).length
    var removalCount = Number(policy?.removal_count || 0)
    var maxAliases = Number(
      state.publicationAliasLimits?.max_aliases || PUBLICATION_ALIAS_MAX_OPERATIONS,
    )
    var maxAliasLength = Number(
      state.publicationAliasLimits?.max_alias_length || PUBLICATION_ALIAS_MAX_LENGTH,
    )
    var dirty = publicationAliasIsDirty()
    var retryPublication = publicationAliasNeedsPublicationRetry()
    var busy = Boolean(state.publicationAliasBusy)
    var filter = String(els.publicationAliasFilter?.value || "")
      .trim()
      .toUpperCase()
    var visibleRows = filter
      ? rows.filter(function (row) {
          return (
            row.alias.toUpperCase().includes(filter) || row.symbol.toUpperCase().includes(filter)
          )
        })
      : rows

    if (els.publicationAliasTabCount)
      els.publicationAliasTabCount.textContent = state.publicationAliasLoaded
        ? String(aliasCount)
        : "—"
    if (els.publicationAliasCount)
      els.publicationAliasCount.textContent = state.publicationAliasLoaded
        ? String(aliasCount) + " / " + String(maxAliases)
        : "—"
    if (els.publicationAliasRemovalCount)
      els.publicationAliasRemovalCount.textContent = state.publicationAliasLoaded
        ? String(removalCount)
        : "—"
    if (els.publicationAliasRevision) {
      els.publicationAliasRevision.textContent = policy ? String(policy.revision) : "—"
      els.publicationAliasRevision.title = policy?.updated_at
        ? "Updated " +
          formatTimestampShort(policy.updated_at) +
          (policy.updated_by ? " by " + policy.updated_by : "")
        : "No recorded update"
    }
    if (els.publicationAliasSync) {
      var syncState = state.publicationAliasLoaded
        ? publication.in_sync
          ? "synced"
          : "pending"
        : "unknown"
      els.publicationAliasSync.dataset.sync = syncState
      els.publicationAliasSync.textContent =
        syncState === "synced" ? "Published" : syncState === "pending" ? "Pending" : "Not loaded"
      els.publicationAliasSync.title = publication.version
        ? "Published version " + publication.version
        : "Published version unavailable"
    }
    if (els.publicationAliasDirty) {
      els.publicationAliasDirty.dataset.dirty = dirty ? "true" : "false"
      els.publicationAliasDirty.textContent = dirty ? "Unpublished changes" : "Saved policy"
    }
    if (els.publicationAliasMappings) {
      els.publicationAliasMappings.innerHTML = visibleRows.length
        ? visibleRows.map(publicationAliasMappingMarkup).join("")
        : filter
          ? '<li class="publication-alias-empty"><strong>No mappings match this filter.</strong><span>Clear the filter to see the complete draft.</span></li>'
          : '<li class="publication-alias-empty"><strong>No curated aliases yet.</strong><span>Add an exact page label and choose its canonical gene above.</span></li>'
    }
    if (els.publicationAliasInput) {
      els.publicationAliasInput.maxLength = maxAliasLength
      els.publicationAliasInput.disabled =
        !state.publicationAliasLoaded || busy || Boolean(state.publicationAliasEditing)
    }
    if (els.publicationAliasGeneQuery)
      els.publicationAliasGeneQuery.disabled = !state.publicationAliasLoaded || busy
    if (els.publicationAliasFilter)
      els.publicationAliasFilter.disabled = !state.publicationAliasLoaded || busy
    if (els.publicationAliasRefresh) els.publicationAliasRefresh.disabled = busy
    if (els.publicationAliasAdd) {
      els.publicationAliasAdd.disabled = !publicationAliasComposerCanSubmit()
      els.publicationAliasAdd.textContent = state.publicationAliasEditing
        ? "Update draft"
        : "Add mapping to draft"
    }
    if (els.publicationAliasTargetPreview) {
      var previewAlias = normalizePublicationAlias(
        state.publicationAliasEditing?.alias || els.publicationAliasInput?.value || "",
      )
      var previewGene = state.publicationAliasSelectedGene
      var showPreview = Boolean(previewAlias && previewGene?.symbol)
      els.publicationAliasTargetPreview.hidden = !showPreview
      els.publicationAliasTargetPreview.innerHTML = showPreview
        ? '<span class="mono">' +
          esc(previewAlias) +
          '</span><span class="publication-alias-target-arrow" aria-hidden="true">→</span><strong class="mono">' +
          esc(previewGene.symbol) +
          '</strong><span class="publication-alias-target-name"> · ' +
          esc(previewGene.full_name || previewGene.symbol) +
          "</span>"
        : ""
    }
    if (els.publicationAliasEditing) {
      els.publicationAliasEditing.hidden = !state.publicationAliasEditing
      els.publicationAliasEditing.textContent = state.publicationAliasEditing
        ? "Changing " + state.publicationAliasEditing.alias
        : ""
    }
    if (els.publicationAliasCancelEdit)
      els.publicationAliasCancelEdit.hidden = !state.publicationAliasEditing
    if (els.publicationAliasPublish) {
      els.publicationAliasPublish.disabled = (!dirty && !retryPublication) || busy
      els.publicationAliasPublish.textContent = busy
        ? "Working…"
        : retryPublication && !dirty
          ? "Retry publication"
          : "Publish alias changes"
    }
  }

  function closePublicationAliasSearch(options) {
    var opts = options || {}
    state.publicationAliasSearchResults = []
    state.publicationAliasSearchActiveIndex = -1
    state.publicationAliasSearchError = ""
    if (els.publicationAliasGeneResults) {
      els.publicationAliasGeneResults.hidden = true
      els.publicationAliasGeneResults.replaceChildren()
    }
    if (els.publicationAliasGeneQuery) {
      els.publicationAliasGeneQuery.setAttribute("aria-expanded", "false")
      els.publicationAliasGeneQuery.removeAttribute("aria-activedescendant")
      els.publicationAliasGeneQuery.removeAttribute("aria-busy")
    }
    if (opts.clearStatus && els.publicationAliasGeneStatus) {
      els.publicationAliasGeneStatus.textContent = ""
    }
  }

  function publicationAliasSearchIndexAfter(currentIndex, direction, resultCount) {
    var count = Math.max(0, Number.parseInt(String(resultCount || 0), 10) || 0)
    if (!count) return -1
    var current = Number(currentIndex)
    if (!Number.isInteger(current)) current = -1
    return direction === "previous" ? Math.max(current - 1, 0) : Math.min(current + 1, count - 1)
  }

  function cancelPublicationAliasSearch() {
    state.publicationAliasSearchRequestId = Number(state.publicationAliasSearchRequestId || 0) + 1
    if (state.publicationAliasSearchTimer != null && typeof window.clearTimeout === "function") {
      window.clearTimeout(state.publicationAliasSearchTimer)
    }
    state.publicationAliasSearchTimer = null
    if (state.publicationAliasSearchController) state.publicationAliasSearchController.abort()
    state.publicationAliasSearchController = null
    closePublicationAliasSearch({ clearStatus: true })
  }

  function renderPublicationAliasSearchResults() {
    if (!els.publicationAliasGeneResults || !els.publicationAliasGeneQuery) return
    var results = Array.isArray(state.publicationAliasSearchResults)
      ? state.publicationAliasSearchResults
      : []
    var error = String(state.publicationAliasSearchError || "")
    var html = ""
    if (error) {
      html =
        '<li class="publication-alias-gene-empty" role="option" aria-disabled="true">' +
        esc(error) +
        "</li>"
    } else if (!results.length) {
      html =
        '<li class="publication-alias-gene-empty" role="option" aria-disabled="true">No genes found.</li>'
    } else {
      html = results
        .map(function (gene, index) {
          var symbol = String(gene.symbol || "")
            .trim()
            .toUpperCase()
          var name = String(gene.full_name || symbol)
          var matched =
            gene.matched_by === "alias" && gene.matched_value
              ? '<span class="publication-alias-gene-match">Matched alias ' +
                esc(gene.matched_value) +
                "</span>"
              : ""
          return [
            '<li class="publication-alias-gene-option' +
              (index === state.publicationAliasSearchActiveIndex ? " active" : "") +
              '" id="publication-alias-gene-option-' +
              String(index) +
              '" role="option" aria-selected="' +
              (index === state.publicationAliasSearchActiveIndex ? "true" : "false") +
              '" data-publication-alias-gene-index="' +
              String(index) +
              '">',
            '<strong class="mono">' + esc(symbol) + "</strong>",
            '<span class="publication-alias-gene-name">' + esc(name) + "</span>",
            matched,
            "</li>",
          ].join("")
        })
        .join("")
    }
    els.publicationAliasGeneResults.innerHTML = html
    els.publicationAliasGeneResults.hidden = false
    els.publicationAliasGeneQuery.setAttribute("aria-expanded", "true")
    if (
      state.publicationAliasSearchActiveIndex >= 0 &&
      results[state.publicationAliasSearchActiveIndex]
    ) {
      els.publicationAliasGeneQuery.setAttribute(
        "aria-activedescendant",
        "publication-alias-gene-option-" + String(state.publicationAliasSearchActiveIndex),
      )
    } else {
      els.publicationAliasGeneQuery.removeAttribute("aria-activedescendant")
    }
  }

  function selectPublicationAliasGene(index) {
    var gene = state.publicationAliasSearchResults?.[Number(index)]
    var symbol = String(gene?.symbol || "")
      .trim()
      .toUpperCase()
    if (!symbol) return
    state.publicationAliasSelectedGene = {
      symbol: symbol,
      full_name: String(gene.full_name || symbol),
    }
    if (els.publicationAliasGeneQuery) {
      els.publicationAliasGeneQuery.value = symbol
      els.publicationAliasGeneQuery.removeAttribute("aria-invalid")
    }
    closePublicationAliasSearch()
    if (els.publicationAliasGeneStatus) {
      els.publicationAliasGeneStatus.textContent =
        "Selected " + symbol + ", " + state.publicationAliasSelectedGene.full_name + "."
    }
    renderPublicationAliases()
  }

  async function runPublicationAliasGeneSearch() {
    var query = String(els.publicationAliasGeneQuery?.value || "").trim()
    if (query.length < PUBLICATION_ALIAS_SEARCH_MIN_LENGTH) {
      closePublicationAliasSearch({ clearStatus: true })
      return
    }
    if (state.publicationAliasSearchController) state.publicationAliasSearchController.abort()
    var controller = typeof AbortController === "function" ? new AbortController() : null
    var requestId = Number(state.publicationAliasSearchRequestId || 0) + 1
    state.publicationAliasSearchRequestId = requestId
    state.publicationAliasSearchController = controller
    state.publicationAliasSearchError = ""
    if (els.publicationAliasGeneQuery)
      els.publicationAliasGeneQuery.setAttribute("aria-busy", "true")
    if (els.publicationAliasGeneStatus)
      els.publicationAliasGeneStatus.textContent = "Searching genes."
    var timeoutId = null
    var timedOut = false
    if (controller) {
      timeoutId = window.setTimeout(function () {
        timedOut = true
        controller.abort()
      }, ADMIN_READ_TIMEOUT_MS)
    }
    try {
      var response = await fetch(
        "/api/public/v1/genes/search?scope=catalog&limit=8&q=" + encodeURIComponent(query),
        {
          credentials: "include",
          ...(controller ? { signal: controller.signal } : {}),
        },
      )
      if (!response.ok)
        throw new Error("Gene search failed with HTTP " + String(response.status) + ".")
      var data = await response.json()
      if (
        requestId !== state.publicationAliasSearchRequestId ||
        String(els.publicationAliasGeneQuery?.value || "").trim() !== query
      )
        return
      state.publicationAliasSearchResults = (Array.isArray(data?.genes) ? data.genes : []).filter(
        function (gene) {
          return Boolean(String(gene?.symbol || "").trim())
        },
      )
      state.publicationAliasSearchActiveIndex = -1
      state.publicationAliasSearchError = ""
      renderPublicationAliasSearchResults()
      if (els.publicationAliasGeneStatus) {
        els.publicationAliasGeneStatus.textContent = state.publicationAliasSearchResults.length
          ? String(state.publicationAliasSearchResults.length) + " gene matches available."
          : "No genes found."
      }
    } catch (error) {
      if (requestId !== state.publicationAliasSearchRequestId) return
      if (controller?.signal.aborted && !timedOut) return
      state.publicationAliasSearchResults = []
      state.publicationAliasSearchActiveIndex = -1
      state.publicationAliasSearchError = timedOut
        ? "Gene search timed out. Try again."
        : requestErrorMessage(error, "Gene search failed.")
      renderPublicationAliasSearchResults()
      if (els.publicationAliasGeneStatus)
        els.publicationAliasGeneStatus.textContent = state.publicationAliasSearchError
    } finally {
      if (timeoutId != null) window.clearTimeout(timeoutId)
      if (requestId === state.publicationAliasSearchRequestId) {
        state.publicationAliasSearchController = null
        if (els.publicationAliasGeneQuery)
          els.publicationAliasGeneQuery.removeAttribute("aria-busy")
      }
    }
  }

  function schedulePublicationAliasGeneSearch() {
    if (state.publicationAliasSearchTimer != null)
      window.clearTimeout(state.publicationAliasSearchTimer)
    state.publicationAliasSearchTimer = window.setTimeout(function () {
      state.publicationAliasSearchTimer = null
      runPublicationAliasGeneSearch()
    }, PUBLICATION_ALIAS_SEARCH_DEBOUNCE_MS)
  }

  function resetPublicationAliasComposer(options) {
    var opts = options || {}
    cancelPublicationAliasSearch()
    state.publicationAliasEditing = null
    state.publicationAliasSelectedGene = null
    if (!opts.keepConflict) clearPublicationAliasConflict()
    if (els.publicationAliasInput) {
      els.publicationAliasInput.value = ""
      els.publicationAliasInput.removeAttribute("aria-invalid")
    }
    if (els.publicationAliasGeneQuery) {
      els.publicationAliasGeneQuery.value = ""
      els.publicationAliasGeneQuery.removeAttribute("aria-invalid")
    }
    renderPublicationAliases()
    if (opts.focus && els.publicationAliasInput) els.publicationAliasInput.focus()
  }

  function startPublicationAliasEdit(alias) {
    var exactAlias = normalizePublicationAlias(alias)
    var current = publicationAliasRowIndex(state.publicationAliasDraftBySymbol).get(exactAlias)
    if (!current) return
    cancelPublicationAliasPublicationRetry()
    cancelPublicationAliasSearch()
    state.publicationAliasEditing = { alias: current.alias, symbol: current.symbol }
    state.publicationAliasSelectedGene = {
      symbol: current.symbol,
      full_name: current.symbol,
    }
    if (els.publicationAliasInput) els.publicationAliasInput.value = current.alias
    if (els.publicationAliasGeneQuery) {
      els.publicationAliasGeneQuery.value = current.symbol
      els.publicationAliasGeneQuery.focus()
      els.publicationAliasGeneQuery.select()
    }
    renderPublicationAliases()
    setPublicationAliasStatus(
      "Choose a different canonical gene for " + current.alias + ", then update the draft.",
      "",
    )
  }

  async function submitPublicationAliasDraftMapping() {
    if (!state.publicationAliasLoaded || state.publicationAliasBusy) return
    var alias = normalizePublicationAlias(
      state.publicationAliasEditing?.alias || els.publicationAliasInput?.value || "",
    )
    var maxLength = Number(
      state.publicationAliasLimits?.max_alias_length || PUBLICATION_ALIAS_MAX_LENGTH,
    )
    var invalidMessage = publicationAliasValidationMessage(alias, maxLength)
    if (invalidMessage) {
      if (els.publicationAliasInput) els.publicationAliasInput.setAttribute("aria-invalid", "true")
      setPublicationAliasStatus(invalidMessage, "error")
      return
    }
    var selectedSymbol = String(state.publicationAliasSelectedGene?.symbol || "")
      .trim()
      .toUpperCase()
    if (!selectedSymbol) {
      if (els.publicationAliasGeneQuery)
        els.publicationAliasGeneQuery.setAttribute("aria-invalid", "true")
      setPublicationAliasStatus("Choose a canonical gene from the search results.", "error")
      return
    }
    if (state.publicationAliasEditing && state.publicationAliasEditing.symbol === selectedSymbol) {
      setPublicationAliasStatus("Choose a different canonical gene before updating.", "error")
      return
    }
    var current = publicationAliasRowIndex(state.publicationAliasDraftBySymbol).get(alias)
    if (!state.publicationAliasEditing && current) {
      setPublicationAliasStatus(
        alias + " is already mapped to " + current.symbol + ". Use Change to reassign it.",
        "error",
      )
      return
    }
    var conflictingVariant = publicationAliasCollisionRows(
      state.publicationAliasDraftBySymbol,
      alias,
    ).find(function (row) {
      return row.alias !== alias && row.symbol !== selectedSymbol
    })
    if (conflictingVariant) {
      setPublicationAliasStatus(
        alias +
          " conflicts with the existing variant " +
          conflictingVariant.alias +
          " → " +
          conflictingVariant.symbol +
          ". Keep collision variants on one canonical gene.",
        "error",
      )
      return
    }
    var baseline = publicationAliasRowIndex(state.publicationAliasPolicy?.by_symbol || {}).get(
      alias,
    )
    var restoredBaseline = Boolean(baseline && baseline.symbol === selectedSymbol)
    var next = restoredBaseline
      ? publicationAliasMapRestoringBaseline(
          state.publicationAliasDraftBySymbol,
          alias,
          state.publicationAliasPolicy?.by_symbol || {},
        )
      : publicationAliasMapWith(state.publicationAliasDraftBySymbol, alias, selectedSymbol)
    var operationCount =
      publicationAliasMapRows(next).length +
      publicationAliasMapRows(state.publicationAliasPolicy?.remove_by_symbol || {}).length
    var maxOperations = Number(
      state.publicationAliasLimits?.max_aliases || PUBLICATION_ALIAS_MAX_OPERATIONS,
    )
    if (operationCount > maxOperations) {
      setPublicationAliasStatus(
        "This draft would exceed the " + String(maxOperations) + " operation limit.",
        "error",
      )
      return
    }
    var wasEditing = Boolean(state.publicationAliasEditing)
    cancelPublicationAliasPublicationRetry()
    clearPublicationAliasConflict()
    try {
      state.publicationAliasBusy = true
      setPublicationAliasStatus("Checking this label against the published catalog…", "")
      renderPublicationAliases()
      await apiJson("/publication-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validate_only: true,
          expected_revision: Number(state.publicationAliasPolicy?.revision || 0),
          by_symbol: next,
          remove_by_symbol: clonePublicationAliasMap(
            state.publicationAliasPolicy?.remove_by_symbol || {},
          ),
        }),
      })
    } catch (error) {
      var operations = publicationAliasConflictOperations(error?.response)
      state.publicationAliasBusy = false
      if (operations.length) {
        showPublicationAliasConflict(operations)
        setPublicationAliasStatus(
          "Unsafe mapping rejected. Nothing was added to the draft.",
          "error",
        )
        setLog("Unsafe alias rejected before it entered the publication draft.")
        renderPublicationAliases()
        return
      }
      setPublicationAliasStatus(
        requestErrorMessage(error, "Alias safety check failed. Nothing was added."),
        "error",
      )
      renderPublicationAliases()
      return
    }
    state.publicationAliasBusy = false
    state.publicationAliasDraftBySymbol = next
    resetPublicationAliasComposer({ keepConflict: true })
    setPublicationAliasStatus(
      alias +
        " → " +
        selectedSymbol +
        (restoredBaseline
          ? " restored in the draft."
          : wasEditing
            ? " updated in the draft."
            : " added to the draft."),
      "success",
    )
    if (els.publicationAliasInput) els.publicationAliasInput.focus()
  }

  function removePublicationAliasDraftMapping(alias) {
    var exactAlias = normalizePublicationAlias(alias)
    var current = publicationAliasRowIndex(state.publicationAliasDraftBySymbol).get(exactAlias)
    if (!current) return
    cancelPublicationAliasPublicationRetry()
    state.publicationAliasDraftBySymbol = publicationAliasMapWithout(
      state.publicationAliasDraftBySymbol,
      current.alias,
    )
    if (state.publicationAliasEditing && state.publicationAliasEditing.alias === current.key) {
      resetPublicationAliasComposer()
    } else {
      renderPublicationAliases()
    }
    setPublicationAliasStatus(
      current.alias + " will be removed on publish. Use Undo in its row to restore it.",
      "",
    )
  }

  function undoPublicationAliasDraftMapping(alias) {
    var exactAlias = normalizePublicationAlias(alias)
    var baseline = publicationAliasRowIndex(state.publicationAliasPolicy?.by_symbol || {}).get(
      exactAlias,
    )
    if (!baseline) return
    cancelPublicationAliasPublicationRetry()
    state.publicationAliasDraftBySymbol = publicationAliasMapRestoringBaseline(
      state.publicationAliasDraftBySymbol,
      baseline.alias,
      state.publicationAliasPolicy?.by_symbol || {},
    )
    renderPublicationAliases()
    setPublicationAliasStatus(
      baseline.alias + " → " + baseline.symbol + " restored in the draft.",
      "success",
    )
  }

  async function refreshPublicationAliases(options) {
    cancelPublicationAliasPublicationRetry()
    cancelPublicationAliasSearch()
    var opts = options || {}
    var preservedDraft = opts.preserveDraft
      ? clonePublicationAliasMap(state.publicationAliasDraftBySymbol)
      : null
    try {
      state.publicationAliasBusy = true
      setPublicationAliasStatus("Loading curated aliases…", "")
      renderPublicationAliases()
      var data = await apiJson("/publication-aliases", { method: "GET" })
      applyPublicationAliasPayload(data)
      state.publicationAliasDraftBySymbol =
        preservedDraft || clonePublicationAliasMap(state.publicationAliasPolicy.by_symbol)
      resetPublicationAliasComposer()
      var publicationPending = publicationAliasNeedsPublicationRetry()
      setPublicationAliasStatus(
        opts.message ||
          (publicationPending
            ? "Alias policy loaded, but publication is pending. Retry publication to publish the saved policy."
            : "Alias policy loaded."),
        opts.tone || (publicationPending ? "warning" : "success"),
      )
    } catch (error) {
      if (isRequestCanceled(error)) return
      var message = requestErrorMessage(error, "Alias policy failed to load.")
      setPublicationAliasStatus(message, "error")
      setLog({ error: "Publication alias load failed", details: error.response || message })
    } finally {
      state.publicationAliasBusy = false
      renderPublicationAliases()
    }
  }

  function publicationAliasErrorCarriesSavedPolicy(error) {
    var response =
      error && error.response && typeof error.response === "object" ? error.response : null
    if (!response) return false
    if (response.saved === true || response.policy_saved === true) return true
    var code = String(response.code || "")
    return (
      code.startsWith("publication_alias_projection_") ||
      code === "publication_alias_blocklist_dependency_not_published" ||
      code === "recognition_pair_not_visible" ||
      code === "recognition_pair_dependencies_not_published"
    )
  }

  function publicationAliasErrorCanAutoRetry(error) {
    var code = String(error?.response?.code || "")
    return (
      code === "publication_alias_projection_not_visible" ||
      code === "publication_alias_projection_busy" ||
      code === "publication_alias_blocklist_dependency_not_published" ||
      code === "recognition_pair_not_visible" ||
      code === "recognition_pair_dependencies_not_published"
    )
  }

  function cancelPublicationAliasPublicationRetry(statusMessage) {
    var wasActive = Boolean(
      state.publicationAliasPublicationRetry || state.publicationAliasPublicationRetryTimer != null,
    )
    state.publicationAliasPublicationRetryRunId =
      Number(state.publicationAliasPublicationRetryRunId || 0) + 1
    if (
      state.publicationAliasPublicationRetryTimer != null &&
      typeof window.clearTimeout === "function"
    ) {
      window.clearTimeout(state.publicationAliasPublicationRetryTimer)
    }
    state.publicationAliasPublicationRetryTimer = null
    state.publicationAliasPublicationRetry = null
    if (wasActive && statusMessage) setPublicationAliasStatus(statusMessage, "warning")
    return wasActive
  }

  function publicationAliasPublicationRetryIsCurrent(retry) {
    return Boolean(
      retry &&
      state.publicationAliasPublicationRetry === retry &&
      Number(retry.run_id || 0) === Number(state.publicationAliasPublicationRetryRunId || 0),
    )
  }

  function publicationAliasPublicationRetryPolicyMatches(policy, retry) {
    if (!policy || !retry) return false
    return Boolean(
      Number(policy.revision || 0) === Number(retry.revision || 0) &&
      String(policy.version || "") === String(retry.version || "") &&
      publicationAliasMapsMatch(policy.by_symbol, retry.by_symbol) &&
      publicationAliasMapsMatch(policy.remove_by_symbol, retry.remove_by_symbol),
    )
  }

  function publicationAliasPublicationRetryEligibility(retry) {
    if (!publicationAliasPublicationRetryIsCurrent(retry)) return "canceled"
    if (state.activeTab !== "extension" || state.recognitionSection !== "aliases") return "inactive"
    if (state.publicationAliasBusy) return "busy"
    if (!state.publicationAliasLoaded || !state.publicationAliasPolicy) return "unavailable"
    if (state.publicationAliasPublication?.in_sync === true) return "published"
    if (!publicationAliasPublicationRetryPolicyMatches(state.publicationAliasPolicy, retry)) {
      return "revision_changed"
    }
    if (
      publicationAliasIsDirty() ||
      !publicationAliasMapsMatch(state.publicationAliasDraftBySymbol, retry.by_symbol)
    ) {
      return "draft_changed"
    }
    return ""
  }

  function stopPublicationAliasPublicationRetry(retry, message, tone) {
    if (!publicationAliasPublicationRetryIsCurrent(retry)) return
    cancelPublicationAliasPublicationRetry()
    if (message && state.activeTab === "extension" && state.recognitionSection === "aliases") {
      setPublicationAliasStatus(message, tone || "warning")
      renderPublicationAliases()
    }
  }

  function queuePublicationAliasPublicationRetry(retry) {
    if (!publicationAliasPublicationRetryIsCurrent(retry)) return false
    var eligibility = publicationAliasPublicationRetryEligibility(retry)
    if (eligibility) {
      stopPublicationAliasPublicationRetry(
        retry,
        eligibility === "revision_changed"
          ? "Automatic publication retry stopped because the saved alias policy changed. Refresh before trying again."
          : "",
        "warning",
      )
      return false
    }
    var attemptIndex = Number(retry.next_attempt_index || 0)
    if (attemptIndex >= PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS.length) {
      stopPublicationAliasPublicationRetry(
        retry,
        "Automatic publication retries ended after " +
          String(PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS.length) +
          " attempts. Use Retry publication to try again.",
        "warning",
      )
      return false
    }
    var delayMs = PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS[attemptIndex]
    retry.next_attempt_index = attemptIndex + 1
    setPublicationAliasStatus(
      "Publication is saved but still pending. Automatic retry " +
        String(retry.next_attempt_index) +
        " of " +
        String(PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS.length) +
        " starts in " +
        String(Math.round(delayMs / 1000)) +
        " seconds.",
      "warning",
    )
    state.publicationAliasPublicationRetryTimer = window.setTimeout(function () {
      state.publicationAliasPublicationRetryTimer = null
      runPublicationAliasPublicationRetry(retry)
    }, delayMs)
    return true
  }

  function schedulePublicationAliasPublicationRetry(error) {
    if (!publicationAliasErrorCanAutoRetry(error)) return false
    if (
      state.activeTab !== "extension" ||
      state.recognitionSection !== "aliases" ||
      state.publicationAliasBusy ||
      !state.publicationAliasLoaded ||
      !state.publicationAliasPolicy ||
      state.publicationAliasPublication?.in_sync === true ||
      publicationAliasIsDirty()
    ) {
      return false
    }
    var retryBySymbol = clonePublicationAliasMap(state.publicationAliasPolicy.by_symbol)
    if (!publicationAliasMapsMatch(state.publicationAliasDraftBySymbol, retryBySymbol)) return false
    cancelPublicationAliasPublicationRetry()
    var retry = {
      run_id: Number(state.publicationAliasPublicationRetryRunId || 0),
      revision: Number(state.publicationAliasPolicy.revision || 0),
      version: String(state.publicationAliasPolicy.version || ""),
      by_symbol: retryBySymbol,
      remove_by_symbol: clonePublicationAliasMap(
        state.publicationAliasPolicy.remove_by_symbol || {},
      ),
      next_attempt_index: 0,
    }
    state.publicationAliasPublicationRetry = retry
    return queuePublicationAliasPublicationRetry(retry)
  }

  function completePublicationAliasPublicationRetry(retry) {
    if (!publicationAliasPublicationRetryIsCurrent(retry)) return
    cancelPublicationAliasPublicationRetry()
    setPublicationAliasStatus(
      "Published; search and extensions pick up the alias policy after the manifest cache refreshes, which may take up to five minutes.",
      "success",
    )
    setLog({ ok: true, publication_aliases: state.publicationAliasPolicy })
  }

  async function runPublicationAliasPublicationRetry(retry) {
    var eligibility = publicationAliasPublicationRetryEligibility(retry)
    if (eligibility) {
      stopPublicationAliasPublicationRetry(
        retry,
        eligibility === "revision_changed"
          ? "Automatic publication retry stopped because the saved alias policy changed. Refresh before trying again."
          : "",
        "warning",
      )
      return
    }
    try {
      state.publicationAliasBusy = true
      setPublicationAliasStatus(
        "Automatic publication retry " +
          String(retry.next_attempt_index) +
          " of " +
          String(PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS.length) +
          " is running…",
        "warning",
      )
      renderPublicationAliases()
      var data = await apiJson("/publication-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_revision: retry.revision,
          by_symbol: retry.by_symbol,
          remove_by_symbol: retry.remove_by_symbol,
        }),
      })
      if (!publicationAliasPublicationRetryIsCurrent(retry)) return
      if (!publicationAliasPublicationRetryPolicyMatches(data?.policy, retry)) {
        state.publicationAliasBusy = false
        stopPublicationAliasPublicationRetry(
          retry,
          "Automatic publication retry stopped because the saved alias policy changed. Refresh before trying again.",
          "warning",
        )
        return
      }
      applyPublicationAliasPayload(data)
      state.publicationAliasDraftBySymbol = clonePublicationAliasMap(retry.by_symbol)
      state.publicationAliasBusy = false
      if (state.publicationAliasPublication?.in_sync === true) {
        completePublicationAliasPublicationRetry(retry)
        return
      }
      queuePublicationAliasPublicationRetry(retry)
    } catch (error) {
      if (!publicationAliasPublicationRetryIsCurrent(retry)) return
      if (Number(error?.status || 0) === 409) {
        state.publicationAliasBusy = false
        cancelPublicationAliasPublicationRetry()
        await refreshPublicationAliases({
          preserveDraft: true,
          message:
            "Automatic publication retry stopped because a newer alias revision was saved elsewhere. Your draft is preserved.",
          tone: "warning",
        })
        return
      }
      if (
        Number(error?.status || 0) === 503 &&
        publicationAliasErrorCarriesSavedPolicy(error) &&
        publicationAliasErrorCanAutoRetry(error) &&
        error?.response?.policy &&
        error?.response?.publication &&
        publicationAliasPublicationRetryPolicyMatches(error.response.policy, retry)
      ) {
        applyPublicationAliasPayload(error.response)
        state.publicationAliasDraftBySymbol = clonePublicationAliasMap(retry.by_symbol)
        state.publicationAliasBusy = false
        if (state.publicationAliasPublication?.in_sync === true) {
          completePublicationAliasPublicationRetry(retry)
          return
        }
        queuePublicationAliasPublicationRetry(retry)
        return
      }
      state.publicationAliasBusy = false
      stopPublicationAliasPublicationRetry(
        retry,
        "Automatic publication retry stopped: " +
          requestErrorMessage(error, "publication retry failed") +
          ". Use Retry publication to try again.",
        "warning",
      )
    } finally {
      state.publicationAliasBusy = false
      if (state.activeTab === "extension" && state.recognitionSection === "aliases")
        renderPublicationAliases()
    }
  }

  async function publishPublicationAliases() {
    if (
      !state.publicationAliasLoaded ||
      (!publicationAliasIsDirty() && !publicationAliasNeedsPublicationRetry())
    )
      return
    cancelPublicationAliasPublicationRetry()
    cancelPublicationAliasSearch()
    var expectedRevision = Number(state.publicationAliasPolicy?.revision || 0)
    var draftBySymbol = clonePublicationAliasMap(state.publicationAliasDraftBySymbol)
    var removeBySymbol = clonePublicationAliasMap(
      state.publicationAliasPolicy?.remove_by_symbol || {},
    )
    try {
      state.publicationAliasBusy = true
      setPublicationAliasStatus("Publishing the complete curated alias policy…", "")
      renderPublicationAliases()
      var data = await apiJson("/publication-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_revision: expectedRevision,
          by_symbol: draftBySymbol,
          remove_by_symbol: removeBySymbol,
        }),
      })
      if (data?.policy) {
        applyPublicationAliasPayload(data)
        state.publicationAliasDraftBySymbol = clonePublicationAliasMap(
          state.publicationAliasPolicy.by_symbol,
        )
        resetPublicationAliasComposer()
      } else {
        state.publicationAliasBusy = false
        await refreshPublicationAliases()
      }
      var inSync = state.publicationAliasPublication?.in_sync === true
      setPublicationAliasStatus(
        inSync
          ? "Published; search and extensions pick up the alias policy after the manifest cache refreshes, which may take up to five minutes."
          : "Alias policy saved. Publication is still catching up.",
        inSync ? "success" : "warning",
      )
      setLog({ ok: true, publication_aliases: state.publicationAliasPolicy })
    } catch (error) {
      var invalidOperations = publicationAliasConflictOperations(error?.response)
      if (invalidOperations.length) {
        var rejectedCount = removeRejectedPublicationAliasAdditionsFromDraft(invalidOperations)
        state.publicationAliasBusy = false
        showPublicationAliasConflict(invalidOperations)
        setPublicationAliasStatus(
          rejectedCount
            ? String(rejectedCount) +
                " unsafe mapping " +
                (rejectedCount === 1 ? "was" : "were") +
                " removed from the draft. Nothing was published."
            : "Unsafe alias policy rejected. Nothing was published.",
          "error",
        )
        setLog("Unsafe alias rejected; the saved publication policy was not changed.")
        return
      }
      if (Number(error?.status || 0) === 409) {
        state.publicationAliasBusy = false
        await refreshPublicationAliases({
          preserveDraft: true,
          message:
            "A newer alias revision was saved elsewhere. Your draft is preserved against the refreshed baseline; review it before publishing again.",
          tone: "warning",
        })
        return
      }
      if (
        Number(error?.status || 0) === 503 &&
        publicationAliasErrorCarriesSavedPolicy(error) &&
        error?.response?.policy &&
        error?.response?.publication
      ) {
        var preservedDraft = clonePublicationAliasMap(state.publicationAliasDraftBySymbol)
        try {
          applyPublicationAliasPayload(error.response)
          state.publicationAliasDraftBySymbol = preservedDraft
          state.publicationAliasBusy = false
          var retryScheduled =
            publicationAliasNeedsPublicationRetry() &&
            schedulePublicationAliasPublicationRetry(error)
          if (!retryScheduled) {
            setPublicationAliasStatus(
              publicationAliasNeedsPublicationRetry()
                ? "The alias policy is saved, but publication is still pending. Your draft is preserved; retry publication."
                : "The alias policy is published. Your draft is preserved; the manifest cache may last up to five minutes.",
              publicationAliasNeedsPublicationRetry() ? "warning" : "success",
            )
          }
          setLog(
            publicationAliasNeedsPublicationRetry()
              ? {
                  warning: "Publication alias projection incomplete",
                  publication_aliases: state.publicationAliasPolicy,
                }
              : { ok: true, publication_aliases: state.publicationAliasPolicy },
          )
          return
        } catch (_payloadError) {
          // Fall through to the ordinary request error when the 503 payload is incomplete.
        }
      }
      var message = requestErrorMessage(error, "Alias policy publish failed.")
      setPublicationAliasStatus(message, "error")
      setLog({ error: "Publication alias publish failed", details: error.response || message })
    } finally {
      state.publicationAliasBusy = false
      renderPublicationAliases()
    }
  }

  function normalizeExtensionBlocklistTerm(value) {
    return String(value || "")
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .toUpperCase()
  }

  function normalizeExtensionBlocklistTerms(values) {
    var seen = new Set()
    var terms = []
    ;(Array.isArray(values) ? values : []).forEach(function (value) {
      var term = normalizeExtensionBlocklistTerm(value)
      if (!term || seen.has(term)) return
      seen.add(term)
      terms.push(term)
    })
    terms.sort()
    return terms
  }

  function parseExtensionBlocklistPaste(value) {
    return normalizeExtensionBlocklistTerms(String(value || "").split(/[\s,]+/))
  }

  function extensionBlocklistTermsMatch(left, right) {
    var leftTerms = normalizeExtensionBlocklistTerms(left)
    var rightTerms = normalizeExtensionBlocklistTerms(right)
    if (leftTerms.length !== rightTerms.length) return false
    return leftTerms.every(function (term, index) {
      return term === rightTerms[index]
    })
  }

  function extensionBlocklistIsDirty() {
    var savedTerms = state.extensionBlocklistPolicy?.terms || []
    return !extensionBlocklistTermsMatch(state.extensionBlocklistDraft, savedTerms)
  }

  function extensionBlocklistNeedsPublicationRetry() {
    return state.extensionBlocklistLoaded && state.extensionBlocklistPublication?.in_sync === false
  }

  function setExtensionBlocklistStatus(message, tone) {
    if (!els.extensionBlocklistStatus) return
    els.extensionBlocklistStatus.textContent = String(message || "")
    els.extensionBlocklistStatus.dataset.tone = String(tone || "")
  }

  function extensionBlocklistTermValidationMessage(term, maxTermLength) {
    if (EXTENSION_BLOCKLIST_CONTROL_CHAR_PATTERN.test(term)) {
      return "A pasted term contains a control character. Use catalog aliases separated by commas or whitespace."
    }
    if (term.length > maxTermLength) {
      return term + " exceeds the " + String(maxTermLength) + " character limit."
    }
    return ""
  }

  function extensionBlocklistInvalidReasonLabel(reason) {
    if (reason === "canonical_symbol") return "Canonical symbol"
    if (reason === "not_recognition_target") return "No recognized gene label inside"
    if (reason === "not_published_alias") return "Not a published catalog alias"
    if (reason === "ambiguous_alias") return "Alias belongs to multiple genes"
    return "Invalid shared term"
  }

  function normalizeExtensionBlocklistInvalidTerms(values) {
    var seen = new Set()
    var invalidTerms = []
    ;(Array.isArray(values) ? values : []).forEach(function (value) {
      if (!value || typeof value !== "object") return
      var term = normalizeExtensionBlocklistTerm(value.term)
      if (!term || seen.has(term)) return
      seen.add(term)
      var reason = String(value.reason || "")
      invalidTerms.push({
        term: term,
        reason: reason,
        label: extensionBlocklistInvalidReasonLabel(reason),
      })
    })
    return invalidTerms
  }

  function extensionBlocklistInvalidTermsSummary(invalidTerms) {
    var terms = normalizeExtensionBlocklistInvalidTerms(invalidTerms)
    if (!terms.length) return ""
    return (
      String(terms.length) +
      (terms.length === 1 ? " term was rejected: " : " terms were rejected: ") +
      terms
        .map(function (entry) {
          return entry.term + " — " + entry.label.toLowerCase()
        })
        .join("; ") +
      ". Review the marked draft terms, then publish again."
    )
  }

  function applyExtensionBlocklistPayload(data) {
    var policy = data && data.policy && typeof data.policy === "object" ? data.policy : null
    if (!policy) throw new Error("Shared blocklist response is missing its policy.")
    var limits =
      data && data.limits && typeof data.limits === "object"
        ? data.limits
        : state.extensionBlocklistLimits || {}
    var publication =
      data && data.publication && typeof data.publication === "object" ? data.publication : {}
    var maxTerms = Number.parseInt(String(limits.max_terms || EXTENSION_BLOCKLIST_MAX_TERMS), 10)
    var maxTermLength = Number.parseInt(
      String(limits.max_term_length || EXTENSION_BLOCKLIST_MAX_TERM_LENGTH),
      10,
    )
    var revision = Number.parseInt(String(policy.revision || 0), 10)
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error("Shared blocklist response has an invalid revision.")
    }
    if (!Array.isArray(policy.terms)) {
      throw new Error("Shared blocklist response is missing its terms.")
    }
    var schemaVersion = Number.parseInt(String(policy.schema_version || 0), 10)
    state.extensionBlocklistPolicy = {
      schema_version: Number.isInteger(schemaVersion) && schemaVersion > 0 ? schemaVersion : null,
      revision,
      version: String(policy.version || ""),
      terms: normalizeExtensionBlocklistTerms(policy.terms),
      updated_at: String(policy.updated_at || ""),
      updated_by: String(policy.updated_by || ""),
    }
    state.extensionBlocklistPublication = {
      version: String(publication.version || ""),
      in_sync: publication.in_sync === true,
    }
    state.extensionBlocklistLimits = {
      max_terms:
        Number.isFinite(maxTerms) && maxTerms > 0 ? maxTerms : EXTENSION_BLOCKLIST_MAX_TERMS,
      max_term_length:
        Number.isFinite(maxTermLength) && maxTermLength > 0
          ? maxTermLength
          : EXTENSION_BLOCKLIST_MAX_TERM_LENGTH,
    }
    state.extensionBlocklistLoaded = true
  }

  function extensionBlocklistTermMarkup(term, invalidReason) {
    var invalidLabel = String(invalidReason || "")
    return [
      '<li class="extension-blocklist-term' +
        (invalidLabel ? " extension-blocklist-term-invalid" : "") +
        '"' +
        (invalidLabel ? ' data-invalid="true"' : "") +
        ">",
      '<span class="extension-blocklist-term-copy">',
      '<span class="mono">' + esc(term) + "</span>",
      invalidLabel
        ? '<span class="extension-blocklist-term-error">' + esc(invalidLabel) + "</span>"
        : "",
      "</span>",
      '<button type="button" class="extension-blocklist-remove" data-extension-blocklist-remove="' +
        esc(term) +
        '" aria-label="Remove ' +
        esc(term) +
        ' from the publication draft">',
      '<span aria-hidden="true">×</span>',
      "</button>",
      "</li>",
    ].join("")
  }

  function renderExtensionBlocklist() {
    var policy = state.extensionBlocklistPolicy
    var publication = state.extensionBlocklistPublication || {}
    var limits = state.extensionBlocklistLimits || {
      max_terms: EXTENSION_BLOCKLIST_MAX_TERMS,
      max_term_length: EXTENSION_BLOCKLIST_MAX_TERM_LENGTH,
    }
    var draftTerms = normalizeExtensionBlocklistTerms(state.extensionBlocklistDraft)
    var invalidTermsByTerm = new Map(
      normalizeExtensionBlocklistInvalidTerms(state.extensionBlocklistInvalidTerms).map(
        function (entry) {
          return [entry.term, entry.label]
        },
      ),
    )
    var dirty = state.extensionBlocklistLoaded && extensionBlocklistIsDirty()
    var retryPublication = extensionBlocklistNeedsPublicationRetry()
    var busy = Boolean(state.extensionBlocklistBusy)

    if (els.extensionBlocklistTabCount) {
      els.extensionBlocklistTabCount.textContent = state.extensionBlocklistLoaded
        ? String(draftTerms.length)
        : "—"
    }
    if (els.extensionBlocklistCount) {
      els.extensionBlocklistCount.textContent = state.extensionBlocklistLoaded
        ? draftTerms.length + " / " + String(limits.max_terms || EXTENSION_BLOCKLIST_MAX_TERMS)
        : "—"
    }
    if (els.extensionBlocklistRevision) {
      els.extensionBlocklistRevision.textContent = policy ? String(policy.revision) : "—"
      els.extensionBlocklistRevision.title = policy?.version
        ? "Policy version " + policy.version
        : "Policy version unavailable"
    }
    if (els.extensionBlocklistUpdated) {
      if (policy?.updated_at) {
        var updatedText = formatTimestampShort(policy.updated_at)
        if (policy.updated_by) updatedText += " · " + policy.updated_by
        els.extensionBlocklistUpdated.textContent = updatedText
        els.extensionBlocklistUpdated.title = policy.updated_at
      } else {
        els.extensionBlocklistUpdated.textContent = state.extensionBlocklistLoaded
          ? "No recorded update"
          : "Not loaded"
        els.extensionBlocklistUpdated.removeAttribute("title")
      }
    }
    if (els.extensionBlocklistSync) {
      var syncState = state.extensionBlocklistLoaded
        ? publication.in_sync
          ? "synced"
          : "pending"
        : "unknown"
      els.extensionBlocklistSync.dataset.sync = syncState
      els.extensionBlocklistSync.textContent =
        syncState === "synced" ? "Published" : syncState === "pending" ? "Pending" : "Not loaded"
      els.extensionBlocklistSync.title = publication.version
        ? "Published version " + publication.version
        : "Published version unavailable"
    }
    if (els.extensionBlocklistDirty) {
      els.extensionBlocklistDirty.dataset.dirty = dirty ? "true" : "false"
      els.extensionBlocklistDirty.textContent = dirty ? "Unpublished changes" : "Saved policy"
    }
    if (els.extensionBlocklistTerms) {
      els.extensionBlocklistTerms.innerHTML = draftTerms.length
        ? draftTerms
            .map(function (term) {
              return extensionBlocklistTermMarkup(term, invalidTermsByTerm.get(term))
            })
            .join("")
        : '<li class="extension-blocklist-empty"><strong>No shared terms in this draft.</strong><span>The packaged fallback remains available only until the shared policy loads.</span></li>'
    }
    if (els.extensionBlocklistInput) {
      els.extensionBlocklistInput.disabled = !state.extensionBlocklistLoaded || busy
    }
    if (els.extensionBlocklistAdd)
      els.extensionBlocklistAdd.disabled = !state.extensionBlocklistLoaded || busy
    if (els.extensionBlocklistRefresh) els.extensionBlocklistRefresh.disabled = busy
    if (els.extensionBlocklistPublish) {
      els.extensionBlocklistPublish.disabled = (!dirty && !retryPublication) || busy
      els.extensionBlocklistPublish.textContent = busy
        ? "Working…"
        : retryPublication && !dirty
          ? "Retry publication"
          : "Publish shared terms"
    }
  }

  async function refreshExtensionBlocklist(options) {
    cancelExtensionBlocklistPublicationRetry()
    var opts = options || {}
    var preservedDraft = opts.preserveDraft
      ? normalizeExtensionBlocklistTerms(state.extensionBlocklistDraft)
      : null
    try {
      state.extensionBlocklistBusy = true
      setExtensionBlocklistStatus("Loading the shared policy…", "")
      renderExtensionBlocklist()
      var data = await apiJson("/extension-blocklist", { method: "GET" })
      applyExtensionBlocklistPayload(data)
      state.extensionBlocklistInvalidTerms = []
      state.extensionBlocklistDraft = preservedDraft || state.extensionBlocklistPolicy.terms.slice()
      var publicationPending = extensionBlocklistNeedsPublicationRetry()
      setExtensionBlocklistStatus(
        opts.message ||
          (publicationPending
            ? "Shared policy loaded, but publication is pending. Retry publication to publish the saved policy."
            : "Shared policy loaded."),
        opts.tone || (publicationPending ? "warning" : "success"),
      )
    } catch (err) {
      if (isRequestCanceled(err)) return
      var message = requestErrorMessage(err, "Shared policy failed to load.")
      setExtensionBlocklistStatus(message, "error")
      setLog({ error: "Shared blocklist load failed", details: err.response || message })
    } finally {
      state.extensionBlocklistBusy = false
      renderExtensionBlocklist()
    }
  }

  function addExtensionBlocklistDraftTerms() {
    if (!els.extensionBlocklistInput || !state.extensionBlocklistLoaded) return
    var incoming = parseExtensionBlocklistPaste(els.extensionBlocklistInput.value)
    if (!incoming.length) {
      els.extensionBlocklistInput.setAttribute("aria-invalid", "true")
      setExtensionBlocklistStatus("Paste at least one term before adding to the draft.", "error")
      return
    }
    var maxTermLength = Number(
      state.extensionBlocklistLimits?.max_term_length || EXTENSION_BLOCKLIST_MAX_TERM_LENGTH,
    )
    var invalidMessage = ""
    incoming.some(function (term) {
      invalidMessage = extensionBlocklistTermValidationMessage(term, maxTermLength)
      return Boolean(invalidMessage)
    })
    if (invalidMessage) {
      els.extensionBlocklistInput.setAttribute("aria-invalid", "true")
      setExtensionBlocklistStatus(invalidMessage, "error")
      return
    }
    var current = new Set(normalizeExtensionBlocklistTerms(state.extensionBlocklistDraft))
    var added = 0
    incoming.forEach(function (term) {
      if (current.has(term)) return
      current.add(term)
      added += 1
    })
    var nextTerms = normalizeExtensionBlocklistTerms(Array.from(current))
    var maxTerms = Number(
      state.extensionBlocklistLimits?.max_terms || EXTENSION_BLOCKLIST_MAX_TERMS,
    )
    if (nextTerms.length > maxTerms) {
      els.extensionBlocklistInput.setAttribute("aria-invalid", "true")
      setExtensionBlocklistStatus(
        "This draft would exceed the " + String(maxTerms) + " term limit.",
        "error",
      )
      return
    }
    cancelExtensionBlocklistPublicationRetry()
    state.extensionBlocklistDraft = nextTerms
    els.extensionBlocklistInput.value = ""
    els.extensionBlocklistInput.removeAttribute("aria-invalid")
    renderExtensionBlocklist()
    setExtensionBlocklistStatus(
      added
        ? "Added " + String(added) + (added === 1 ? " term" : " terms") + " to the draft."
        : "Those terms are already in the draft.",
      added ? "success" : "",
    )
    els.extensionBlocklistInput.focus()
  }

  function removeExtensionBlocklistDraftTerm(term) {
    var normalized = normalizeExtensionBlocklistTerm(term)
    if (!normalized) return
    cancelExtensionBlocklistPublicationRetry()
    state.extensionBlocklistDraft = normalizeExtensionBlocklistTerms(
      state.extensionBlocklistDraft.filter(function (candidate) {
        return candidate !== normalized
      }),
    )
    state.extensionBlocklistInvalidTerms = normalizeExtensionBlocklistInvalidTerms(
      state.extensionBlocklistInvalidTerms,
    ).filter(function (entry) {
      return entry.term !== normalized
    })
    renderExtensionBlocklist()
    setExtensionBlocklistStatus(
      normalized + " removed from the draft. Publish to replace the shared list.",
      "",
    )
  }

  function extensionBlocklistErrorCarriesSavedPolicy(err) {
    var response = err && err.response && typeof err.response === "object" ? err.response : null
    if (!response) return false
    if (response.saved === true) return true
    var code = String(response.code || "")
    return (
      code.startsWith("extension_blocklist_projection_") ||
      code === "extension_blocklist_alias_dependency_not_published" ||
      code === "recognition_pair_not_visible" ||
      code === "recognition_pair_dependencies_not_published"
    )
  }

  function extensionBlocklistErrorCanAutoRetry(err) {
    var code = String(err?.response?.code || "")
    return (
      code === "extension_blocklist_projection_not_visible" ||
      code === "extension_blocklist_projection_busy" ||
      code === "extension_blocklist_alias_dependency_not_published" ||
      code === "recognition_pair_not_visible" ||
      code === "recognition_pair_dependencies_not_published"
    )
  }

  function cancelExtensionBlocklistPublicationRetry(statusMessage) {
    var wasActive = Boolean(
      state.extensionBlocklistPublicationRetry ||
      state.extensionBlocklistPublicationRetryTimer != null,
    )
    state.extensionBlocklistPublicationRetryRunId =
      Number(state.extensionBlocklistPublicationRetryRunId || 0) + 1
    if (
      state.extensionBlocklistPublicationRetryTimer != null &&
      typeof window.clearTimeout === "function"
    ) {
      window.clearTimeout(state.extensionBlocklistPublicationRetryTimer)
    }
    state.extensionBlocklistPublicationRetryTimer = null
    state.extensionBlocklistPublicationRetry = null
    if (wasActive && statusMessage) {
      setExtensionBlocklistStatus(statusMessage, "warning")
    }
    return wasActive
  }

  function extensionBlocklistPublicationRetryIsCurrent(retry) {
    return Boolean(
      retry &&
      state.extensionBlocklistPublicationRetry === retry &&
      Number(retry.run_id || 0) === Number(state.extensionBlocklistPublicationRetryRunId || 0),
    )
  }

  function extensionBlocklistPublicationRetryPolicyMatches(policy, retry) {
    if (!policy || !retry) return false
    return Boolean(
      Number(policy.revision || 0) === Number(retry.revision || 0) &&
      String(policy.version || "") === String(retry.version || "") &&
      extensionBlocklistTermsMatch(policy.terms, retry.terms),
    )
  }

  function extensionBlocklistPublicationRetryEligibility(retry) {
    if (!extensionBlocklistPublicationRetryIsCurrent(retry)) return "canceled"
    if (state.activeTab !== "extension" || state.recognitionSection !== "blocklist") {
      return "inactive"
    }
    if (state.extensionBlocklistBusy) return "busy"
    if (!state.extensionBlocklistLoaded || !state.extensionBlocklistPolicy) return "unavailable"
    if (state.extensionBlocklistPublication?.in_sync === true) return "published"
    if (!extensionBlocklistPublicationRetryPolicyMatches(state.extensionBlocklistPolicy, retry)) {
      return "revision_changed"
    }
    if (
      extensionBlocklistIsDirty() ||
      !extensionBlocklistTermsMatch(state.extensionBlocklistDraft, retry.terms)
    ) {
      return "draft_changed"
    }
    return ""
  }

  function stopExtensionBlocklistPublicationRetry(retry, message, tone) {
    if (!extensionBlocklistPublicationRetryIsCurrent(retry)) return
    cancelExtensionBlocklistPublicationRetry()
    if (message && state.activeTab === "extension" && state.recognitionSection === "blocklist") {
      setExtensionBlocklistStatus(message, tone || "warning")
      renderExtensionBlocklist()
    }
  }

  function queueExtensionBlocklistPublicationRetry(retry) {
    if (!extensionBlocklistPublicationRetryIsCurrent(retry)) return false
    var eligibility = extensionBlocklistPublicationRetryEligibility(retry)
    if (eligibility) {
      var eligibilityMessage =
        eligibility === "revision_changed"
          ? "Automatic publication retry stopped because the saved policy changed. Refresh before trying again."
          : ""
      stopExtensionBlocklistPublicationRetry(retry, eligibilityMessage, "warning")
      return false
    }
    var attemptIndex = Number(retry.next_attempt_index || 0)
    if (attemptIndex >= EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS.length) {
      stopExtensionBlocklistPublicationRetry(
        retry,
        "Automatic publication retries ended after " +
          String(EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS.length) +
          " attempts. Use Retry publication to try again.",
        "warning",
      )
      return false
    }
    var delayMs = EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS[attemptIndex]
    retry.next_attempt_index = attemptIndex + 1
    setExtensionBlocklistStatus(
      "Publication is saved but still pending. Automatic retry " +
        String(retry.next_attempt_index) +
        " of " +
        String(EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS.length) +
        " starts in " +
        String(Math.round(delayMs / 1000)) +
        " seconds.",
      "warning",
    )
    state.extensionBlocklistPublicationRetryTimer = window.setTimeout(function () {
      state.extensionBlocklistPublicationRetryTimer = null
      return runExtensionBlocklistPublicationRetry(retry)
    }, delayMs)
    return true
  }

  function scheduleExtensionBlocklistPublicationRetry(err) {
    if (!extensionBlocklistErrorCanAutoRetry(err)) return false
    if (
      state.activeTab !== "extension" ||
      state.recognitionSection !== "blocklist" ||
      state.extensionBlocklistBusy ||
      !state.extensionBlocklistLoaded ||
      !state.extensionBlocklistPolicy ||
      state.extensionBlocklistPublication?.in_sync === true ||
      extensionBlocklistIsDirty()
    ) {
      return false
    }
    var retryTerms = normalizeExtensionBlocklistTerms(state.extensionBlocklistPolicy.terms)
    if (!extensionBlocklistTermsMatch(state.extensionBlocklistDraft, retryTerms)) return false
    cancelExtensionBlocklistPublicationRetry()
    var retry = {
      run_id: Number(state.extensionBlocklistPublicationRetryRunId || 0),
      revision: Number(state.extensionBlocklistPolicy.revision || 0),
      version: String(state.extensionBlocklistPolicy.version || ""),
      terms: retryTerms,
      next_attempt_index: 0,
    }
    state.extensionBlocklistPublicationRetry = retry
    return queueExtensionBlocklistPublicationRetry(retry)
  }

  function completeExtensionBlocklistPublicationRetry(retry) {
    if (!extensionBlocklistPublicationRetryIsCurrent(retry)) return
    cancelExtensionBlocklistPublicationRetry()
    setExtensionBlocklistStatus(
      "Published; extensions pick it up on a later page load or browser restart; the manifest cache may last up to five minutes.",
      "success",
    )
    setLog({ ok: true, extension_blocklist: state.extensionBlocklistPolicy })
  }

  async function runExtensionBlocklistPublicationRetry(retry) {
    var eligibility = extensionBlocklistPublicationRetryEligibility(retry)
    if (eligibility) {
      stopExtensionBlocklistPublicationRetry(
        retry,
        eligibility === "revision_changed"
          ? "Automatic publication retry stopped because the saved policy changed. Refresh before trying again."
          : "",
        "warning",
      )
      return
    }
    try {
      state.extensionBlocklistBusy = true
      setExtensionBlocklistStatus(
        "Automatic publication retry " +
          String(retry.next_attempt_index) +
          " of " +
          String(EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS.length) +
          " is running…",
        "warning",
      )
      renderExtensionBlocklist()
      var data = await apiJson("/extension-blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: retry.terms, expected_revision: retry.revision }),
      })
      if (!extensionBlocklistPublicationRetryIsCurrent(retry)) return
      if (!extensionBlocklistPublicationRetryPolicyMatches(data?.policy, retry)) {
        state.extensionBlocklistBusy = false
        stopExtensionBlocklistPublicationRetry(
          retry,
          "Automatic publication retry stopped because the saved policy changed. Refresh before trying again.",
          "warning",
        )
        return
      }
      applyExtensionBlocklistPayload(data)
      state.extensionBlocklistDraft = retry.terms.slice()
      state.extensionBlocklistInvalidTerms = []
      state.extensionBlocklistBusy = false
      if (state.extensionBlocklistPublication?.in_sync === true) {
        completeExtensionBlocklistPublicationRetry(retry)
        return
      }
      queueExtensionBlocklistPublicationRetry(retry)
    } catch (err) {
      if (!extensionBlocklistPublicationRetryIsCurrent(retry)) return
      if (Number(err?.status || 0) === 409) {
        state.extensionBlocklistBusy = false
        cancelExtensionBlocklistPublicationRetry()
        await refreshExtensionBlocklist({
          preserveDraft: true,
          message:
            "Automatic publication retry stopped because a newer revision was saved elsewhere. Your draft is preserved.",
          tone: "warning",
        })
        return
      }
      if (
        Number(err?.status || 0) === 503 &&
        extensionBlocklistErrorCarriesSavedPolicy(err) &&
        extensionBlocklistErrorCanAutoRetry(err) &&
        err?.response?.policy &&
        err?.response?.publication &&
        extensionBlocklistPublicationRetryPolicyMatches(err.response.policy, retry)
      ) {
        applyExtensionBlocklistPayload(err.response)
        state.extensionBlocklistDraft = retry.terms.slice()
        state.extensionBlocklistInvalidTerms = []
        state.extensionBlocklistBusy = false
        if (state.extensionBlocklistPublication?.in_sync === true) {
          completeExtensionBlocklistPublicationRetry(retry)
          return
        }
        queueExtensionBlocklistPublicationRetry(retry)
        return
      }
      state.extensionBlocklistBusy = false
      stopExtensionBlocklistPublicationRetry(
        retry,
        "Automatic publication retry stopped: " +
          requestErrorMessage(err, "publication retry failed") +
          ". Use Retry publication to try again.",
        "warning",
      )
    } finally {
      state.extensionBlocklistBusy = false
      if (state.activeTab === "extension" && state.recognitionSection === "blocklist") {
        renderExtensionBlocklist()
      }
    }
  }

  async function publishExtensionBlocklist() {
    if (
      !state.extensionBlocklistLoaded ||
      (!extensionBlocklistIsDirty() && !extensionBlocklistNeedsPublicationRetry())
    )
      return
    cancelExtensionBlocklistPublicationRetry()
    var expectedRevision = Number(state.extensionBlocklistPolicy?.revision || 0)
    var draftTerms = normalizeExtensionBlocklistTerms(state.extensionBlocklistDraft)
    var maxTermLength = Number(
      state.extensionBlocklistLimits?.max_term_length || EXTENSION_BLOCKLIST_MAX_TERM_LENGTH,
    )
    var invalidMessage = ""
    draftTerms.some(function (term) {
      invalidMessage = extensionBlocklistTermValidationMessage(term, maxTermLength)
      return Boolean(invalidMessage)
    })
    if (invalidMessage) {
      setExtensionBlocklistStatus(invalidMessage, "error")
      return
    }
    try {
      state.extensionBlocklistBusy = true
      state.extensionBlocklistInvalidTerms = []
      setExtensionBlocklistStatus("Publishing the complete shared list…", "")
      renderExtensionBlocklist()
      var data = await apiJson("/extension-blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: draftTerms, expected_revision: expectedRevision }),
      })
      if (data?.policy) {
        applyExtensionBlocklistPayload(data)
        state.extensionBlocklistInvalidTerms = []
        state.extensionBlocklistDraft = state.extensionBlocklistPolicy.terms.slice()
      } else {
        state.extensionBlocklistBusy = false
        await refreshExtensionBlocklist()
      }
      var inSync = state.extensionBlocklistPublication?.in_sync === true
      setExtensionBlocklistStatus(
        inSync
          ? "Published; extensions pick it up on a later page load or browser restart; the manifest cache may last up to five minutes."
          : "Shared terms saved. Publication is still catching up.",
        inSync ? "success" : "warning",
      )
      setLog({ ok: true, extension_blocklist: state.extensionBlocklistPolicy })
    } catch (err) {
      if (Number(err?.status || 0) === 409) {
        state.extensionBlocklistBusy = false
        await refreshExtensionBlocklist({
          preserveDraft: true,
          message:
            "A newer revision was saved elsewhere. Your draft is preserved against the refreshed baseline; review it before publishing again.",
          tone: "warning",
        })
        return
      }
      if (Number(err?.status || 0) === 422) {
        var rejectedTerms = normalizeExtensionBlocklistInvalidTerms(err?.response?.invalid_terms)
        if (rejectedTerms.length) {
          state.extensionBlocklistInvalidTerms = rejectedTerms
          setExtensionBlocklistStatus(extensionBlocklistInvalidTermsSummary(rejectedTerms), "error")
          setLog({
            error: "Shared blocklist terms were rejected",
            invalid_terms: rejectedTerms,
          })
          return
        }
      }
      if (
        Number(err?.status || 0) === 503 &&
        extensionBlocklistErrorCarriesSavedPolicy(err) &&
        err?.response?.policy &&
        err?.response?.publication
      ) {
        var preservedDraft = normalizeExtensionBlocklistTerms(state.extensionBlocklistDraft)
        try {
          applyExtensionBlocklistPayload(err.response)
          state.extensionBlocklistDraft = preservedDraft
          state.extensionBlocklistBusy = false
          var retryScheduled =
            extensionBlocklistNeedsPublicationRetry() &&
            scheduleExtensionBlocklistPublicationRetry(err)
          if (!retryScheduled) {
            setExtensionBlocklistStatus(
              extensionBlocklistNeedsPublicationRetry()
                ? "The shared policy is saved, but publication is still pending. Your draft is preserved; retry publication."
                : "The shared policy is published. Your draft is preserved; extensions pick it up on a later page load or browser restart; the manifest cache may last up to five minutes.",
              extensionBlocklistNeedsPublicationRetry() ? "warning" : "success",
            )
          }
          setLog(
            extensionBlocklistNeedsPublicationRetry()
              ? {
                  warning: "Shared blocklist publication incomplete",
                  extension_blocklist: state.extensionBlocklistPolicy,
                }
              : { ok: true, extension_blocklist: state.extensionBlocklistPolicy },
          )
          return
        } catch (_payloadError) {
          // Fall through to the ordinary request error when the 503 payload is incomplete.
        }
      }
      var message = requestErrorMessage(err, "Shared policy publish failed.")
      setExtensionBlocklistStatus(message, "error")
      setLog({ error: "Shared blocklist publish failed", details: err.response || message })
    } finally {
      state.extensionBlocklistBusy = false
      renderExtensionBlocklist()
    }
  }

  function attentionMarkup(title, note, buttonLabel, symbol) {
    return [
      '<article class="list-row">',
      "<div>",
      "<strong>" + esc(title) + "</strong>",
      '<div class="small">' + esc(note) + "</div>",
      "</div>",
      "<div>",
      symbol
        ? '<button class="btn-flat" data-jump-symbol="' +
          esc(symbol) +
          '" data-jump-tab="archive">' +
          esc(buttonLabel || "Open") +
          "</button>"
        : "",
      "</div>",
      "</article>",
    ].join("")
  }

  function renderOverviewSummary() {
    if (state.activeTab !== "overview") return
    var summary = state.overviewSummary || {}
    els.overviewMetrics.innerHTML = [
      metricMarkup("Canonical set", summary.with_live, "Genes with a canonical blot set."),
      metricMarkup(
        "Broken canonical",
        summary.drift,
        "Canonical blot points at a missing or broken asset.",
      ),
      metricMarkup("Missing", summary.missing, "Genes with no usable blot candidates."),
      metricMarkup("Stale", summary.stale_assets, "Old images waiting for cleanup."),
      metricMarkup("Legacy", summary.legacy_assets, "Leftovers from older sync generations."),
    ].join("")

    var notes = (state.overviewAttention || [])
      .map(function (item) {
        if (!item || !item.symbol) return ""
        if (item.kind === "drift") {
          return attentionMarkup(
            item.symbol + " -- broken canonical",
            "The canonical blot points at a missing or broken asset.",
            "Browse",
            item.symbol,
          )
        }
        if (item.kind === "missing") {
          return attentionMarkup(
            item.symbol + " -- no canonical blot",
            "No usable candidate exists yet, so the extension has nothing canonical to show.",
            "Look",
            item.symbol,
          )
        }
        if (item.kind === "override") {
          return attentionMarkup(
            item.symbol + " -- manual override",
            "Votes are not auto-picking the canonical blot until you clear the override.",
            "Look",
            item.symbol,
          )
        }
        if (item.kind === "stale") {
          return attentionMarkup(
            item.symbol + " -- stale images",
            String(item.stale_assets || 0) + " old images hanging around.",
            "Clean up",
            item.symbol,
          )
        }
        return ""
      })
      .filter(Boolean)
    if (!notes.length)
      notes.push(
        '<article class="list-row"><div><strong>Nothing needs attention.</strong><div class="small">Use Gallery or Log for a deeper look.</div></div><div></div></article>',
      )
    els.attentionList.innerHTML = notes.join("")

    els.overviewEvents.innerHTML =
      (state.recentEvents || []).slice(0, 12).map(overviewEventMarkup).join("") ||
      '<article class="list-row"><div><strong>No recent activity.</strong></div><div></div></article>'
  }

  function renderOverviewCoverage() {
    if (state.activeTab !== "overview") return
    var coverage = state.overviewCoverage || null
    if (coverage) {
      var total = Math.max(1, Number(coverage.total || 0))
      var segments = [
        { key: "zero", label: "0 candidates", className: "zero" },
        { key: "one", label: "1 candidate", className: "one" },
        { key: "two_to_five", label: "2-5 candidates", className: "two-to-five" },
        { key: "six_plus", label: "6+ candidates", className: "six-plus" },
      ]
      var segmentStart = 0
      els.overviewCoverage.innerHTML = [
        '<svg class="coverage-bar" viewBox="0 0 ' +
          esc(String(total)) +
          ' 1" preserveAspectRatio="none" role="img" aria-label="Candidate coverage distribution">',
        segments
          .map(function (segment) {
            var value = Number(coverage[segment.key] || 0)
            var rect =
              '<rect class="coverage-segment coverage-segment--' +
              segment.className +
              '" x="' +
              esc(String(segmentStart)) +
              '" y="0" width="' +
              esc(String(value)) +
              '" height="1"><title>' +
              esc(segment.label + ": " + value) +
              "</title></rect>"
            segmentStart += value
            return rect
          })
          .join(""),
        "</svg>",
        '<div class="coverage-legend">',
        segments
          .map(function (segment) {
            return [
              '<div class="coverage-row">',
              '<span class="coverage-dot coverage-dot--' + segment.className + '"></span>',
              "<span>" + esc(segment.label) + "</span>",
              "<strong>" + esc(String(coverage[segment.key] || 0)) + "</strong>",
              "</div>",
            ].join("")
          })
          .join(""),
        "</div>",
      ].join("")
    } else {
      els.overviewCoverage.innerHTML = '<div class="small">Loading coverage…</div>'
    }
  }

  function renderOverview() {
    renderOverviewSummary()
    renderOverviewCoverage()
  }

  async function refreshOverviewSummary() {
    try {
      var data = await apiJson("/overview?event_limit=80", { method: "GET" })
      state.overviewSummary = data.summary || null
      state.overviewAttention = Array.isArray(data.attention) ? data.attention : []
      state.recentEvents = Array.isArray(data.recent_events) ? data.recent_events : []
      renderOverviewSummary()
      renderActivityFeed()
    } catch (err) {
      if (isRequestCanceled(err)) return
      var message = requestErrorMessage(err, "Overview load failed.")
      els.overviewMetrics.innerHTML = inlineFailureMarkup("Overview failed fast", message)
      els.attentionList.innerHTML =
        '<article class="list-row"><div><strong>Admin overview failed.</strong><div class="small">' +
        esc(message) +
        "</div></div><div></div></article>"
      els.overviewEvents.innerHTML =
        '<article class="list-row"><div><strong>Recent activity unavailable.</strong><div class="small">' +
        esc(message) +
        "</div></div><div></div></article>"
      setLog({ error: "Overview load failed", details: err.response || message })
    }
  }

  async function refreshOverviewCoverage() {
    try {
      state.overviewCoverage = await apiJson("/coverage", { method: "GET" })
      renderOverviewCoverage()
    } catch (err) {
      if (isRequestCanceled(err)) return
      var message = requestErrorMessage(err, "Coverage load failed.")
      els.overviewCoverage.innerHTML = inlineFailureMarkup("Coverage failed fast", message)
      setLog({ error: "Coverage load failed", details: err.response || message })
    }
  }

  async function refreshDerivedAdminViews() {
    await Promise.all([refreshOverviewSummary(), refreshOverviewCoverage()])
    if (state.visionStats.length) {
      await refreshVisionStats()
    }
  }

  function clampVisionPage(page, totalPages) {
    var cleaned = Number.parseInt(String(page || "1"), 10) || 1
    var maxPage = Math.max(1, Number(totalPages || 1))
    if (cleaned < 1) return 1
    if (cleaned > maxPage) return maxPage
    return cleaned
  }

  function setVisionPage(page) {
    var pageSize = Math.max(
      1,
      Number.parseInt(String(state.visionPageSize || defaultVisionPageSize()), 10) ||
        defaultVisionPageSize(),
    )
    var totalPages = Math.max(1, Math.ceil((state.visionStats || []).length / pageSize))
    state.visionPage = clampVisionPage(page, totalPages)
  }

  function updateVisionSortButtons() {
    document.querySelectorAll("[data-vision-sort]").forEach(function (btn) {
      var key = String(btn.getAttribute("data-vision-sort") || "")
      var active = state.visionSort.key === key
      btn.classList.toggle("is-active", active)
      btn.setAttribute("data-sort-dir", active ? state.visionSort.dir : "")
      btn.setAttribute("aria-pressed", active ? "true" : "false")
    })
  }

  function formatCompactNumber(value) {
    var num = Number(value || 0)
    if (!Number.isFinite(num)) return "0"
    return num.toLocaleString("en-US")
  }

  function safeNum(value) {
    var num = Number(value || 0)
    return Number.isFinite(num) ? num : 0
  }

  function compactMetricNumber(value) {
    var num = safeNum(value)
    try {
      if (Math.abs(num) >= 1000) {
        return new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: Math.abs(num) >= 1000000000 ? 1 : 0,
        }).format(num)
      }
    } catch {}
    return formatCompactNumber(num)
  }

  function compactPercent(value) {
    var pct = safeNum(value) * 100
    if (!Number.isFinite(pct)) return "0%"
    return (Math.round(pct * 10) / 10).toFixed(pct >= 10 ? 0 : 1).replace(/.0$/, "") + "%"
  }

  function ensureCostTrendHoverChrome() {
    if (!els.costReadTrend) return null
    var tooltip = els.costReadTrend.querySelector("[data-cost-trend-tooltip]")
    if (!tooltip) {
      tooltip = document.createElement("div")
      tooltip.className = "cost-chart-tooltip"
      tooltip.setAttribute("data-cost-trend-tooltip", "true")
      tooltip.setAttribute("aria-hidden", "true")
      els.costReadTrend.appendChild(tooltip)
    }
    return { tooltip: tooltip }
  }

  function hideCostTrendTooltip() {
    var chrome = ensureCostTrendHoverChrome()
    if (!chrome) return
    chrome.tooltip.classList.remove("is-visible")
    chrome.tooltip.setAttribute("aria-hidden", "true")
  }

  function showCostTrendTooltip(event) {
    var chrome = ensureCostTrendHoverChrome()
    if (!chrome) return
    var point = event && event.currentTarget
    if (!point) return
    var day = String(point.getAttribute("data-day") || "")
    var reads = safeNum(point.getAttribute("data-reads"))
    var limit = safeNum(point.getAttribute("data-limit"))
    chrome.tooltip.innerHTML = [
      "<strong>" + esc(day || "Unknown day") + "</strong>",
      "<div>" + esc(formatCompactNumber(reads)) + " rows read</div>",
      '<div class="cost-subtle">Smart daily allowance: ' +
        esc(compactMetricNumber(limit)) +
        "</div>",
    ].join("")
    chrome.tooltip.classList.add("is-visible")
    chrome.tooltip.setAttribute("aria-hidden", "false")
  }

  function bindCostTrendHover() {
    if (!els.costReadTrend) return
    ensureCostTrendHoverChrome()
    els.costReadTrend.querySelectorAll('[data-cost-trend-point="true"]').forEach(function (point) {
      point.addEventListener("mouseenter", showCostTrendTooltip)
      point.addEventListener("focus", showCostTrendTooltip)
      point.addEventListener("blur", hideCostTrendTooltip)
      point.addEventListener("mouseleave", hideCostTrendTooltip)
    })
  }

  function costLabel(value) {
    return String(value || "unknown")
      .replaceAll("_", " ")
      .replace(/\b\w/g, function (char) {
        return char.toUpperCase()
      })
  }

  function costFillToneClass(used, limit) {
    var safeLimit = safeNum(limit)
    if (safeLimit <= 0) return ""
    var ratio = safeNum(used) / safeLimit
    if (ratio >= 0.85) return " cost-budget-fill--danger"
    if (ratio >= 0.6) return " cost-budget-fill--warn"
    return ""
  }

  function aggregateCostRows(rows, key) {
    var map = Object.create(null)
    ;(Array.isArray(rows) ? rows : []).forEach(function (row) {
      var group = String((row && row[key]) || "unknown")
      if (!map[group]) {
        map[group] = {
          key: group,
          rows_read: 0,
          rows_written: 0,
          query_count: 0,
          request_count: 0,
        }
      }
      map[group].rows_read += safeNum(row && row.rows_read)
      map[group].rows_written += safeNum(row && row.rows_written)
      map[group].query_count += safeNum(row && row.query_count)
      map[group].request_count += safeNum(row && row.request_count)
    })
    return Object.keys(map)
      .map(function (group) {
        return map[group]
      })
      .sort(function (left, right) {
        return safeNum(right.rows_read) - safeNum(left.rows_read)
      })
  }

  function buildCostTrendSvg(days, snapshot) {
    var rows = Array.isArray(days) ? days : []
    if (!rows.length) {
      return inlineFailureMarkup(
        "No cycle data yet",
        "This internal guardrail cycle has not recorded D1 usage yet.",
      )
    }
    var width = 720
    var height = 280
    var padLeft = 50
    var padRight = 18
    var padTop = 18
    var padBottom = 34
    var usableWidth = width - padLeft - padRight
    var usableHeight = height - padTop - padBottom
    var allowanceValues = rows.map(function (row) {
      return safeNum(row && row.rows_read_daily_smart_limit)
    })
    var currentDailyLimit = allowanceValues.length
      ? allowanceValues[allowanceValues.length - 1]
      : safeNum(snapshot && snapshot.rows_read_daily_smart_limit)
    var maxValue = rows.reduce(function (acc, row) {
      return Math.max(
        acc,
        safeNum(row && row.rows_read),
        safeNum(row && row.rows_read_daily_smart_limit),
      )
    }, currentDailyLimit)
    maxValue = Math.max(maxValue, 1)
    var xStep = rows.length <= 1 ? 0 : usableWidth / (rows.length - 1)
    function xAt(index) {
      return padLeft + xStep * index
    }
    function yAt(value) {
      return padTop + usableHeight - (safeNum(value) / maxValue) * usableHeight
    }
    var area = ""
    var line = ""
    var allowanceLine = ""
    rows.forEach(function (row, index) {
      var x = xAt(index)
      var y = yAt(row && row.rows_read)
      area += (index === 0 ? "M" : "L") + x + " " + y + " "
      line += (index === 0 ? "M" : "L") + x + " " + y + " "
      allowanceLine +=
        (index === 0 ? "M" : "L") + x + " " + yAt(row && row.rows_read_daily_smart_limit) + " "
    })
    if (rows.length) {
      area += "L" + xAt(rows.length - 1) + " " + (padTop + usableHeight) + " "
      area += "L" + xAt(0) + " " + (padTop + usableHeight) + " Z"
    }
    var points = rows
      .map(function (row, index) {
        var value = safeNum(row && row.rows_read)
        var limit = safeNum(row && row.rows_read_daily_smart_limit)
        var x = xAt(index)
        var y = yAt(value)
        var dateLabel = String((row && row.day_key) || "")
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="5" fill="#b84a26" stroke="#fff9f3" stroke-width="2" tabindex="0" role="button" data-cost-trend-point="true" data-day="' +
          esc(dateLabel) +
          '" data-reads="' +
          esc(String(value)) +
          '" data-limit="' +
          esc(String(limit)) +
          '"><title>' +
          esc(
            dateLabel +
              ": " +
              formatCompactNumber(value) +
              " rows read / " +
              compactMetricNumber(limit) +
              " smart daily allowance",
          ) +
          "</title></circle>"
        )
      })
      .join("")
    var firstLabel = String((rows[0] && rows[0].day_key) || "")
    var lastLabel = String((rows[rows.length - 1] && rows[rows.length - 1].day_key) || "")
    var currentLimitY = yAt(currentDailyLimit)
    var currentLimitX = xAt(rows.length - 1)
    var allowanceMarkup =
      rows.length === 1
        ? '<line x1="' +
          padLeft +
          '" y1="' +
          currentLimitY +
          '" x2="' +
          (padLeft + usableWidth) +
          '" y2="' +
          currentLimitY +
          '" stroke="#4f7f6d" stroke-width="2" stroke-dasharray="6 6" />'
        : '<path d="' +
          allowanceLine +
          '" fill="none" stroke="#4f7f6d" stroke-width="2" stroke-dasharray="6 6" stroke-linejoin="round" stroke-linecap="round"></path>'
    return [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Rows read by day across the baked Cloudflare snapshot window">',
      '<line x1="' +
        padLeft +
        '" y1="' +
        (padTop + usableHeight) +
        '" x2="' +
        (padLeft + usableWidth) +
        '" y2="' +
        (padTop + usableHeight) +
        '" stroke="#e5ddd5" stroke-width="1" />',
      allowanceMarkup,
      '<path d="' + area + '" fill="rgba(184,74,38,0.12)" stroke="none"></path>',
      '<path d="' +
        line +
        '" fill="none" stroke="#b84a26" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      points,
      '<text x="' +
        padLeft +
        '" y="' +
        (height - 8) +
        '" font-size="11" fill="#7a6d61">' +
        esc(firstLabel) +
        "</text>",
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="' +
        (height - 8) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(lastLabel) +
        "</text>",
      '<text x="' +
        Math.max(padLeft + 6, currentLimitX - 6) +
        '" y="' +
        Math.max(12, currentLimitY - 8) +
        '" text-anchor="end" font-size="11" fill="#4f7f6d">Smart daily allowance ' +
        esc(compactMetricNumber(currentDailyLimit)) +
        "</text>",
      '<text x="' +
        padLeft +
        '" y="' +
        (padTop + 12) +
        '" font-size="11" fill="#7a6d61">Peak ' +
        esc(compactMetricNumber(maxValue)) +
        " rows</text>",
      "</svg>",
    ].join("")
  }

  function buildD1WriteAdaptiveSvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var rows = Array.isArray(d1 && d1.daily) ? d1.daily : []
    if (!rows.length) {
      return inlineFailureMarkup(
        "No D1 write history yet",
        "The baked snapshot did not include D1 daily buckets for this window.",
      )
    }
    var width = 720
    var height = 280
    var padLeft = 50
    var padRight = 18
    var padTop = 18
    var padBottom = 34
    var usableWidth = width - padLeft - padRight
    var usableHeight = height - padTop - padBottom
    var currentDailyLimit = safeNum(
      rows[rows.length - 1] && rows[rows.length - 1].rowsWrittenDailySmartLimit,
    )
    var maxValue = rows.reduce(
      function (acc, row) {
        return Math.max(
          acc,
          safeNum(row && row.rowsWritten),
          safeNum(row && row.rowsWrittenDailySmartLimit),
        )
      },
      Math.max(currentDailyLimit, 1),
    )
    var xStep = rows.length <= 1 ? 0 : usableWidth / (rows.length - 1)
    function xAt(index) {
      return padLeft + xStep * index
    }
    function yAt(value) {
      return padTop + usableHeight - (safeNum(value) / Math.max(maxValue, 1)) * usableHeight
    }
    var area = ""
    var line = ""
    var ceilingLine = ""
    rows.forEach(function (row, index) {
      var x = xAt(index)
      var y = yAt(row && row.rowsWritten)
      area += (index === 0 ? "M" : "L") + x + " " + y + " "
      line += (index === 0 ? "M" : "L") + x + " " + y + " "
      ceilingLine +=
        (index === 0 ? "M" : "L") + x + " " + yAt(row && row.rowsWrittenDailySmartLimit) + " "
    })
    if (rows.length) {
      area += "L" + xAt(rows.length - 1) + " " + (padTop + usableHeight) + " "
      area += "L" + xAt(0) + " " + (padTop + usableHeight) + " Z"
    }
    var points = rows
      .map(function (row, index) {
        var value = safeNum(row && row.rowsWritten)
        var limit = safeNum(row && row.rowsWrittenDailySmartLimit)
        var x = xAt(index)
        var y = yAt(value)
        var exhausted = value >= limit && limit > 0
        var label = formatMonthDay(row && row.date)
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="5" fill="' +
          (exhausted ? "#bf3030" : "#7d5a2d") +
          '" stroke="#fff9f3" stroke-width="2"><title>' +
          esc(
            label +
              ": " +
              formatCompactNumber(value) +
              " rows written / " +
              compactMetricNumber(limit) +
              " smart daily write ceiling",
          ) +
          "</title></circle>"
        )
      })
      .join("")
    var firstLabel = formatMonthDay(rows[0] && rows[0].date)
    var lastLabel = formatMonthDay(rows[rows.length - 1] && rows[rows.length - 1].date)
    var ceilingY = yAt(currentDailyLimit)
    var ceilingX = xAt(rows.length - 1)
    return [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Daily D1 rows written against the adaptive smart write ceiling">',
      '<line x1="' +
        padLeft +
        '" y1="' +
        (padTop + usableHeight) +
        '" x2="' +
        (padLeft + usableWidth) +
        '" y2="' +
        (padTop + usableHeight) +
        '" stroke="#e5ddd5" stroke-width="1" />',
      '<path d="' +
        ceilingLine +
        '" fill="none" stroke="#4f7f6d" stroke-width="2" stroke-dasharray="6 6" stroke-linejoin="round" stroke-linecap="round"></path>',
      '<path d="' + area + '" fill="rgba(125,90,45,0.12)" stroke="none"></path>',
      '<path d="' +
        line +
        '" fill="none" stroke="#7d5a2d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      points,
      '<text x="' +
        padLeft +
        '" y="' +
        (height - 8) +
        '" font-size="11" fill="#7a6d61">' +
        esc(firstLabel) +
        "</text>",
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="' +
        (height - 8) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(lastLabel) +
        "</text>",
      '<text x="' +
        Math.max(padLeft + 6, ceilingX - 6) +
        '" y="' +
        Math.max(12, ceilingY - 8) +
        '" text-anchor="end" font-size="11" fill="#4f7f6d">Smart daily write ceiling ' +
        esc(compactMetricNumber(currentDailyLimit)) +
        "</text>",
      '<text x="' +
        padLeft +
        '" y="' +
        (padTop + 12) +
        '" font-size="11" fill="#7a6d61">Peak ' +
        esc(compactMetricNumber(maxValue)) +
        " rows written</text>",
      "</svg>",
    ].join("")
  }

  function buildMetricTimelineSvg(rows, series, options) {
    var list = Array.isArray(rows) ? rows : []
    var specs = Array.isArray(series) ? series : []
    if (!list.length || !specs.length) {
      return chartMissingSvg(
        (options && options.emptyTitle) || "No metric history",
        (options && options.emptyMessage) ||
          "The baked snapshot does not include this metric series.",
      )
    }
    var width = Number((options && options.width) || 520)
    var height = Number((options && options.height) || 220)
    var padLeft = 46
    var padRight = 18
    var padTop = 24
    var padBottom = 34
    var usableWidth = width - padLeft - padRight
    var usableHeight = height - padTop - padBottom
    var maxValue = specs.reduce(function (acc, spec) {
      return Math.max(
        acc,
        list.reduce(function (inner, row) {
          return Math.max(inner, safeNum(spec.value(row)))
        }, 0),
      )
    }, 1)
    function xAt(index) {
      return padLeft + (list.length <= 1 ? 0 : (usableWidth * index) / (list.length - 1))
    }
    function yAt(value) {
      return padTop + usableHeight - (safeNum(value) / Math.max(maxValue, 1)) * usableHeight
    }
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="' +
        esc((options && options.ariaLabel) || "Metric timeline") +
        '">',
      '<line x1="' +
        padLeft +
        '" y1="' +
        (padTop + usableHeight) +
        '" x2="' +
        (padLeft + usableWidth) +
        '" y2="' +
        (padTop + usableHeight) +
        '" stroke="#e5ddd5"></line>',
    ]
    specs.forEach(function (spec, specIndex) {
      var path = list
        .map(function (row, index) {
          return (index === 0 ? "M" : "L") + xAt(index) + " " + yAt(spec.value(row))
        })
        .join(" ")
      svg.push(
        '<path d="' +
          path +
          '" fill="none" stroke="' +
          esc(spec.color || "#b84a26") +
          '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      )
      svg.push(
        '<text x="' +
          (padLeft + specIndex * 118) +
          '" y="17" font-size="11" font-weight="700" fill="' +
          esc(spec.color || "#b84a26") +
          '">' +
          esc(spec.label || "metric") +
          "</text>",
      )
    })
    svg.push(
      '<text x="' +
        padLeft +
        '" y="' +
        (height - 8) +
        '" font-size="11" fill="#7a6d61">' +
        esc(formatMonthDay(list[0] && list[0].date)) +
        "</text>",
    )
    svg.push(
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="' +
        (height - 8) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(formatMonthDay(list[list.length - 1] && list[list.length - 1].date)) +
        "</text>",
    )
    svg.push(
      '<text x="' +
        padLeft +
        '" y="' +
        (padTop + 16) +
        '" font-size="11" fill="#7a6d61">Peak ' +
        esc(
          options && options.formatMax
            ? options.formatMax(maxValue)
            : compactMetricNumber(maxValue),
        ) +
        "</text>",
    )
    svg.push("</svg>")
    return svg.join("")
  }

  function buildD1QueryVolumeSvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var rows = Array.isArray(d1 && d1.daily) ? d1.daily : []
    return buildMetricTimelineSvg(
      rows,
      [
        {
          label: "read queries",
          color: "#b84a26",
          value: function (row) {
            return row && row.readQueries
          },
        },
        {
          label: "write queries",
          color: "#7d5a2d",
          value: function (row) {
            return row && row.writeQueries
          },
        },
      ],
      {
        ariaLabel: "D1 read and write query volume by day",
        emptyTitle: "No D1 query history",
      },
    )
  }

  function buildD1ResponseBytesSvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var rows = Array.isArray(d1 && d1.daily) ? d1.daily : []
    return buildMetricTimelineSvg(
      rows,
      [
        {
          label: "response bytes",
          color: "#8b6f91",
          value: function (row) {
            return row && row.queryBatchResponseBytes
          },
        },
      ],
      {
        ariaLabel: "D1 query batch response bytes by day",
        formatMax: formatByteSize,
        emptyTitle: "No D1 response-byte history",
      },
    )
  }

  function buildD1LatencySvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var rows = Array.isArray(d1 && d1.daily) ? d1.daily : []
    return buildMetricTimelineSvg(
      rows,
      [
        {
          label: "avg ms",
          color: "#4f7f6d",
          value: function (row) {
            return row && row.avgQueryBatchTimeMs
          },
        },
        {
          label: "p90 ms",
          color: "#b87411",
          value: function (row) {
            return row && row.p90QueryBatchTimeMs
          },
        },
      ],
      {
        ariaLabel: "D1 query batch latency by day",
        formatMax: function (value) {
          return String(Math.round(safeNum(value) * 100) / 100) + " ms"
        },
        emptyTitle: "No D1 latency history",
      },
    )
  }

  function buildD1StorageSvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var storage = d1 && d1.storage ? d1.storage : {}
    var used = safeNum(storage.databaseSizeBytes)
    var limit = 5 * 1024 * 1024 * 1024
    var ratio = limit > 0 ? used / limit : 0
    return buildBandChartSvg(
      [
        {
          label: "D1 storage",
          note: storage.observedAt
            ? "Observed " + formatMonthDay(storage.observedAt)
            : "No storage sample date",
          value: Math.min(100, ratio * 100),
          display: formatByteSize(used) + " / " + formatByteSize(limit),
          tone: ratio >= 0.85 ? "danger" : ratio >= 0.6 ? "warn" : "ok",
        },
      ],
      {
        ariaLabel: "D1 storage usage against the free-plan storage wall",
        maxValue: 100,
        footer: "Database size, not row count.",
      },
    )
  }

  function buildDoActivityMixSvg(report) {
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var rows = Array.isArray(durableObjects && durableObjects.daily) ? durableObjects.daily : []
    if (!rows.length)
      return chartMissingSvg(
        "No DO activity history",
        "The baked snapshot did not include Durable Object daily activity.",
      )
    return buildMetricTimelineSvg(
      rows,
      [
        {
          label: "requests",
          color: "#4f7f6d",
          value: function (row) {
            return row && row.requests
          },
        },
        {
          label: "errors",
          color: "#bf3030",
          value: function (row) {
            return row && row.errors
          },
        },
        {
          label: "cpu",
          color: "#8b6f91",
          value: function (row) {
            return row && row.cpuTime
          },
        },
        {
          label: "subreq",
          color: "#b87411",
          value: function (row) {
            return row && row.subrequests
          },
        },
      ],
      {
        width: 760,
        height: 280,
        ariaLabel: "Durable Object requests, errors, CPU, and subrequests by day",
        emptyTitle: "No DO activity history",
      },
    )
  }

  function renderMetricBars(target, rows, options) {
    if (!target) return
    var list = Array.isArray(rows)
      ? rows.slice(0, Number((options && options.limit) || 6) || 6)
      : []
    if (!list.length) {
      target.innerHTML = inlineFailureMarkup(
        (options && options.emptyTitle) || "No data yet",
        (options && options.emptyMessage) || "Nothing to chart yet.",
      )
      return
    }
    var maxValue = list.reduce(function (acc, row) {
      return Math.max(acc, safeNum(row && row.value))
    }, 1)
    target.innerHTML = list
      .map(function (row) {
        var label = costLabel(row && row.key)
        var value = safeNum(row && row.value)
        var secondary = row && row.secondary ? String(row.secondary) : ""
        return [
          '<div class="cost-bar-row">',
          '<div class="cost-bar-head">',
          '<div class="cost-bar-label"><span class="cost-inline-code">' +
            esc(label) +
            "</span></div>",
          '<div class="cost-subtle">' +
            esc(compactMetricNumber(value)) +
            (options && options.valueSuffix ? " " + esc(options.valueSuffix) : "") +
            (secondary ? " · " + esc(secondary) : "") +
            "</div>",
          "</div>",
          '<progress class="cost-bar-progress" max="' +
            esc(String(maxValue)) +
            '" value="' +
            esc(String(value)) +
            '" aria-label="' +
            esc(label + ": " + compactMetricNumber(value)) +
            '"></progress>',
          row && row.note ? '<div class="cost-subtle">' + esc(row.note) + "</div>" : "",
          "</div>",
        ].join("")
      })
      .join("")
  }

  function formatByteSize(value) {
    var num = safeNum(value)
    if (num <= 0) return "0 B"
    var units = ["B", "KB", "MB", "GB", "TB"]
    var unitIndex = 0
    while (num >= 1024 && unitIndex < units.length - 1) {
      num /= 1024
      unitIndex += 1
    }
    var digits = num >= 100 || unitIndex === 0 ? 0 : 1
    return num.toFixed(digits).replace(/.0$/, "") + " " + units[unitIndex]
  }

  function formatRatioPercent(numerator, denominator) {
    var total = safeNum(denominator)
    if (total <= 0) return "—"
    var pct = (safeNum(numerator) / total) * 100
    var digits = pct >= 10 ? 1 : 2
    return (
      pct
        .toFixed(digits)
        .replace(/.00$/, "")
        .replace(/(.d)0$/, "$1") + "%"
    )
  }

  function formatMonthDay(value) {
    var raw = String(value || "").trim()
    if (!raw) return "unknown"
    var date = new Date(raw.length <= 10 ? raw + "T00:00:00Z" : raw)
    if (Number.isNaN(date.getTime())) return raw
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  }

  function formatCalendarDate(value) {
    var raw = String(value || "").trim()
    if (!raw) return "unknown"
    var date = new Date(raw.length <= 10 ? raw + "T00:00:00Z" : raw)
    if (Number.isNaN(date.getTime())) return raw
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
  }

  function formatTimestampShort(value) {
    var raw = String(value || "").trim()
    if (!raw) return "unknown"
    var date = new Date(raw)
    if (Number.isNaN(date.getTime())) return raw
    return (
      date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }) + " UTC"
    )
  }

  function costStateTone(level) {
    var value = String(level || "")
      .trim()
      .toLowerCase()
    if (!value) return "neutral"
    if (
      value === "ok" ||
      value === "ready" ||
      value === "healthy" ||
      value === "quiet" ||
      value === "present" ||
      value === "fresh" ||
      value === "covered"
    )
      return "ok"
    if (
      value === "warning" ||
      value === "warn" ||
      value === "watch" ||
      value === "partial" ||
      value === "stale"
    )
      return "warn"
    if (
      value === "danger" ||
      value === "critical" ||
      value === "error" ||
      value === "missing" ||
      value === "noisy"
    )
      return "danger"
    return "neutral"
  }

  function renderCostStateChip(label, tone) {
    return (
      '<span class="cost-state-chip cost-state-chip--' +
      esc(tone || "neutral") +
      '">' +
      esc(label || "unknown") +
      "</span>"
    )
  }

  function capacityToneFromRemaining(remaining, limit) {
    var safeLimit = safeNum(limit)
    if (safeLimit <= 0) return "neutral"
    var shareLeft = safeNum(remaining) / safeLimit
    if (shareLeft <= 0.1) return "danger"
    if (shareLeft <= 0.25) return "warn"
    return "ok"
  }

  function capacityLabelFromRemaining(remaining, limit) {
    var tone = capacityToneFromRemaining(remaining, limit)
    if (tone === "danger") return "tight"
    if (tone === "warn") return "watch"
    if (tone === "ok") return "safe"
    return "unknown"
  }

  function costToneColor(tone) {
    if (tone === "danger") return "#bf3030"
    if (tone === "warn") return "#b87411"
    if (tone === "ok") return "#2a7a4d"
    return "#9b8f82"
  }

  function renderCostDetailCard(row) {
    var valueMarkup =
      row && row.valueHtml
        ? String(row.valueHtml)
        : esc(String(row && row.value != null ? row.value : "—"))
    return [
      '<article class="cost-detail-card">',
      row && row.eyebrow ? '<div class="cost-detail-eyebrow">' + esc(row.eyebrow) + "</div>" : "",
      '<div class="cost-detail-value">' + valueMarkup + "</div>",
      row && row.copy ? '<div class="cost-detail-copy">' + esc(row.copy) + "</div>" : "",
      "</article>",
    ].join("")
  }

  // Keep the DO and integrity visuals in the same left-chart/right-info
  // cadence as D1 so future edits do not drift back into bespoke card piles.
  function buildBandChartSvg(rows, options) {
    var list = Array.isArray(rows)
      ? rows.filter(function (row) {
          return row && Number.isFinite(safeNum(row.value))
        })
      : []
    if (!list.length) {
      return inlineFailureMarkup(
        (options && options.emptyTitle) || "No chart data yet",
        (options && options.emptyMessage) ||
          "The baked snapshot did not contain enough data to draw this chart.",
      )
    }
    var width = 720
    var labelX = 18
    var trackX = 250
    var trackWidth = 330
    var valueX = width - 18
    var top = options && options.title ? 44 : 24
    var rowHeight = 52
    var bottom = options && options.footer ? 30 : 16
    var height = top + list.length * rowHeight + bottom
    var maxValue = Math.max(
      safeNum(options && options.maxValue),
      list.reduce(function (acc, row) {
        return Math.max(acc, safeNum(row && row.value))
      }, 1),
      1,
    )
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="' +
        esc((options && options.ariaLabel) || "Metric chart") +
        '">',
    ]
    if (options && options.title) {
      svg.push(
        '<text x="18" y="22" font-size="12" fill="#7a6d61">' + esc(options.title) + "</text>",
      )
    }
    list.forEach(function (row, index) {
      var y = top + index * rowHeight
      var widthPct =
        safeNum(row && row.value) <= 0
          ? 0
          : Math.max(10, Math.round((safeNum(row.value) / maxValue) * trackWidth))
      var note = row && row.note ? String(row.note) : ""
      svg.push(
        '<text x="' +
          labelX +
          '" y="' +
          (y + 14) +
          '" font-size="12" font-weight="700" fill="#1a1a1a">' +
          esc(String((row && row.label) || "Metric")) +
          "</text>",
      )
      if (note) {
        svg.push(
          '<text x="' +
            labelX +
            '" y="' +
            (y + 30) +
            '" font-size="11" fill="#7a6d61">' +
            esc(note) +
            "</text>",
        )
      }
      svg.push(
        '<rect x="' +
          trackX +
          '" y="' +
          (y + 8) +
          '" width="' +
          trackWidth +
          '" height="12" rx="999" fill="#ece4db"></rect>',
      )
      if (widthPct > 0) {
        svg.push(
          '<rect x="' +
            trackX +
            '" y="' +
            (y + 8) +
            '" width="' +
            widthPct +
            '" height="12" rx="999" fill="' +
            esc(costToneColor((row && row.tone) || "neutral")) +
            '"></rect>',
        )
      }
      svg.push(
        '<text x="' +
          valueX +
          '" y="' +
          (y + 14) +
          '" text-anchor="end" font-size="12" font-weight="700" fill="#1a1a1a">' +
          esc(
            String(
              row && row.display != null ? row.display : compactMetricNumber(row && row.value),
            ),
          ) +
          "</text>",
      )
    })
    if (options && options.footer) {
      svg.push(
        '<text x="18" y="' +
          (height - 10) +
          '" font-size="11" fill="#7a6d61">' +
          esc(options.footer) +
          "</text>",
      )
    }
    svg.push("</svg>")
    return svg.join("")
  }

  function buildDurableObjectTrafficSvg(report) {
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var rows = Array.isArray(durableObjects && durableObjects.daily) ? durableObjects.daily : []
    if (!rows.length) {
      return inlineFailureMarkup(
        "No DO daily history yet",
        "The baked snapshot did not include durable-object periodic rows for this window.",
      )
    }
    var width = 720
    var height = 280
    var padLeft = 50
    var padRight = 18
    var padTop = 18
    var padBottom = 34
    var usableWidth = width - padLeft - padRight
    var usableHeight = height - padTop - padBottom
    var currentDailyLimit = safeNum(
      (rows[rows.length - 1] && rows[rows.length - 1].rowsWrittenDailyLimit) ||
        durableObjects.dailyLimitRowsWritten,
    )
    var maxValue = rows.reduce(
      function (acc, row) {
        return Math.max(
          acc,
          safeNum(row && row.rowsWritten),
          safeNum(row && row.rowsWrittenDailyLimit),
        )
      },
      Math.max(currentDailyLimit, 1),
    )
    var xStep = rows.length <= 1 ? 0 : usableWidth / (rows.length - 1)
    function xAt(index) {
      return padLeft + xStep * index
    }
    function yAt(value) {
      return padTop + usableHeight - (safeNum(value) / Math.max(maxValue, 1)) * usableHeight
    }
    var area = ""
    var line = ""
    var ceilingLine = ""
    rows.forEach(function (row, index) {
      var x = xAt(index)
      var y = yAt(row && row.rowsWritten)
      area += (index === 0 ? "M" : "L") + x + " " + y + " "
      line += (index === 0 ? "M" : "L") + x + " " + y + " "
      ceilingLine +=
        (index === 0 ? "M" : "L") + x + " " + yAt(row && row.rowsWrittenDailyLimit) + " "
    })
    if (rows.length) {
      area += "L" + xAt(rows.length - 1) + " " + (padTop + usableHeight) + " "
      area += "L" + xAt(0) + " " + (padTop + usableHeight) + " Z"
    }
    var points = rows
      .map(function (row, index) {
        var value = safeNum(row && row.rowsWritten)
        var limit = safeNum(row && row.rowsWrittenDailyLimit)
        var x = xAt(index)
        var y = yAt(value)
        var exhausted = value >= limit && limit > 0
        var label = formatMonthDay(row && row.date)
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="5" fill="' +
          (exhausted ? "#bf3030" : "#b84a26") +
          '" stroke="#fff9f3" stroke-width="2"><title>' +
          esc(
            label +
              ": " +
              formatCompactNumber(value) +
              " DO rows written / " +
              compactMetricNumber(limit) +
              " daily ceiling",
          ) +
          "</title></circle>"
        )
      })
      .join("")
    var firstLabel = formatMonthDay(rows[0] && rows[0].date)
    var lastLabel = formatMonthDay(rows[rows.length - 1] && rows[rows.length - 1].date)
    var ceilingY = yAt(currentDailyLimit)
    var ceilingX = xAt(rows.length - 1)
    return [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Daily Durable Object rows written against the real Cloudflare ceiling">',
      '<line x1="' +
        padLeft +
        '" y1="' +
        (padTop + usableHeight) +
        '" x2="' +
        (padLeft + usableWidth) +
        '" y2="' +
        (padTop + usableHeight) +
        '" stroke="#e5ddd5" stroke-width="1" />',
      '<path d="' +
        ceilingLine +
        '" fill="none" stroke="#4f7f6d" stroke-width="2" stroke-dasharray="6 6" stroke-linejoin="round" stroke-linecap="round"></path>',
      '<path d="' + area + '" fill="rgba(184,74,38,0.12)" stroke="none"></path>',
      '<path d="' +
        line +
        '" fill="none" stroke="#b84a26" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      points,
      '<text x="' +
        padLeft +
        '" y="' +
        (height - 8) +
        '" font-size="11" fill="#7a6d61">' +
        esc(firstLabel) +
        "</text>",
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="' +
        (height - 8) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(lastLabel) +
        "</text>",
      '<text x="' +
        Math.max(padLeft + 6, ceilingX - 6) +
        '" y="' +
        Math.max(12, ceilingY - 8) +
        '" text-anchor="end" font-size="11" fill="#4f7f6d">Daily DO write ceiling ' +
        esc(compactMetricNumber(currentDailyLimit)) +
        "</text>",
      '<text x="' +
        padLeft +
        '" y="' +
        (padTop + 12) +
        '" font-size="11" fill="#7a6d61">Peak ' +
        esc(compactMetricNumber(maxValue)) +
        " rows written</text>",
      "</svg>",
    ].join("")
  }

  function getWorkerLimiterSnapshot(report) {
    if (report && report.workerLimiter) return report.workerLimiter
    return null
  }

  function buildWorkerLimiterTrafficSvg(report) {
    var workerLimiter = getWorkerLimiterSnapshot(report)
    var rows = Array.isArray(workerLimiter && workerLimiter.daily) ? workerLimiter.daily : []
    if (!rows.length) {
      return inlineFailureMarkup(
        "Worker limiter snapshot missing",
        "This baked report did not include the first-class workerLimiter section, so the dashboard is refusing to invent one from other fields.",
      )
    }
    var width = 720
    var height = 280
    var padLeft = 50
    var padRight = 18
    var padTop = 18
    var padBottom = 34
    var usableWidth = width - padLeft - padRight
    var usableHeight = height - padTop - padBottom
    var currentDailyLimit = safeNum(
      rows[rows.length - 1] && rows[rows.length - 1].rowsWrittenDailySmartLimit,
    )
    var maxValue = rows.reduce(
      function (acc, row) {
        return Math.max(
          acc,
          safeNum(row && row.rowsWritten),
          safeNum(row && row.rowsWrittenDailySmartLimit),
        )
      },
      Math.max(currentDailyLimit, 1),
    )
    var xStep = rows.length <= 1 ? 0 : usableWidth / (rows.length - 1)
    function xAt(index) {
      return padLeft + xStep * index
    }
    function yAt(value) {
      return padTop + usableHeight - (safeNum(value) / Math.max(maxValue, 1)) * usableHeight
    }
    var area = ""
    var line = ""
    var ceilingLine = ""
    rows.forEach(function (row, index) {
      var x = xAt(index)
      var y = yAt(row && row.rowsWritten)
      area += (index === 0 ? "M" : "L") + x + " " + y + " "
      line += (index === 0 ? "M" : "L") + x + " " + y + " "
      ceilingLine +=
        (index === 0 ? "M" : "L") + x + " " + yAt(row && row.rowsWrittenDailySmartLimit) + " "
    })
    if (rows.length) {
      area += "L" + xAt(rows.length - 1) + " " + (padTop + usableHeight) + " "
      area += "L" + xAt(0) + " " + (padTop + usableHeight) + " Z"
    }
    var points = rows
      .map(function (row, index) {
        var value = safeNum(row && row.rowsWritten)
        var limit = safeNum(row && row.rowsWrittenDailySmartLimit)
        var x = xAt(index)
        var y = yAt(value)
        var exhausted = value >= limit && limit > 0
        var label = formatMonthDay(row && row.date)
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="5" fill="' +
          (exhausted ? "#bf3030" : "#6b4fb0") +
          '" stroke="#fff9f3" stroke-width="2"><title>' +
          esc(
            label +
              ": " +
              formatCompactNumber(value) +
              " worker mutation rows / " +
              compactMetricNumber(limit) +
              " smart daily ceiling",
          ) +
          "</title></circle>"
        )
      })
      .join("")
    var firstLabel = formatMonthDay(rows[0] && rows[0].date)
    var lastLabel = formatMonthDay(rows[rows.length - 1] && rows[rows.length - 1].date)
    var ceilingY = yAt(currentDailyLimit)
    var ceilingX = xAt(rows.length - 1)
    return [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Daily worker mutation rows against the smart write ceiling">',
      '<line x1="' +
        padLeft +
        '" y1="' +
        (padTop + usableHeight) +
        '" x2="' +
        (padLeft + usableWidth) +
        '" y2="' +
        (padTop + usableHeight) +
        '" stroke="#e5ddd5" stroke-width="1" />',
      '<path d="' +
        ceilingLine +
        '" fill="none" stroke="#4f7f6d" stroke-width="2" stroke-dasharray="6 6" stroke-linejoin="round" stroke-linecap="round"></path>',
      '<path d="' + area + '" fill="rgba(107,79,176,0.12)" stroke="none"></path>',
      '<path d="' +
        line +
        '" fill="none" stroke="#6b4fb0" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      points,
      '<text x="' +
        padLeft +
        '" y="' +
        (height - 8) +
        '" font-size="11" fill="#7a6d61">' +
        esc(firstLabel) +
        "</text>",
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="' +
        (height - 8) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(lastLabel) +
        "</text>",
      '<text x="' +
        Math.max(padLeft + 6, ceilingX - 6) +
        '" y="' +
        Math.max(12, ceilingY - 8) +
        '" text-anchor="end" font-size="11" fill="#4f7f6d">Smart daily write ceiling ' +
        esc(compactMetricNumber(currentDailyLimit)) +
        "</text>",
      '<text x="' +
        padLeft +
        '" y="' +
        (padTop + 12) +
        '" font-size="11" fill="#7a6d61">Peak ' +
        esc(compactMetricNumber(maxValue)) +
        " worker mutation rows</text>",
      "</svg>",
    ].join("")
  }

  function renderWorkerLimiterPanel(report) {
    if (!els.costWorkerLimiterChart && !els.costWorkerLimiterBars) return
    var workerLimiter = getWorkerLimiterSnapshot(report)
    if (!workerLimiter) {
      if (els.costWorkerLimiterChart) {
        els.costWorkerLimiterChart.innerHTML = buildWorkerLimiterTrafficSvg(report)
      }
      if (els.costWorkerLimiterBars) {
        els.costWorkerLimiterBars.innerHTML = [
          '<div class="cost-status-banner">',
          renderCostStateChip("snapshot missing", "danger"),
          "<strong>Worker-side mutation headroom unavailable</strong>",
          '<div class="small">This panel now fails loud. If the baked snapshot omits <code>workerLimiter</code>, the admin page will not reverse-engineer a replacement from the D1 section.</div>',
          "</div>",
        ].join("")
      }
      return
    }
    var currentDay = workerLimiter && workerLimiter.currentDay ? workerLimiter.currentDay : {}
    var cycleTotals = workerLimiter && workerLimiter.cycleTotals ? workerLimiter.cycleTotals : {}
    var peakDay = workerLimiter && workerLimiter.peakDay ? workerLimiter.peakDay : {}
    var totals = workerLimiter && workerLimiter.totals ? workerLimiter.totals : {}
    var guardrails = workerLimiter && workerLimiter.guardrails ? workerLimiter.guardrails : {}
    var todayLimit = safeNum(currentDay.rowsWrittenDailySmartLimit)
    var todayWritten = safeNum(currentDay.rowsWritten)
    var todayRemaining = safeNum(currentDay.rowsWrittenDailyRemaining)
    var cycleLimit = safeNum(cycleTotals.rowsWrittenMonthlyLimit)
    var cycleWritten = safeNum(cycleTotals.rowsWritten)
    var cycleRemaining = safeNum(cycleTotals.rowsWrittenMonthlyRemaining)
    var tone =
      currentDay.exhausted || (todayLimit > 0 && todayRemaining <= 0)
        ? "danger"
        : cycleLimit > 0 && cycleRemaining <= 0
          ? "danger"
          : todayLimit > 0 && todayWritten / Math.max(todayLimit, 1) >= 0.8
            ? "warn"
            : "ok"
    var summaryLabel =
      tone === "danger"
        ? "mutations blocked"
        : tone === "warn"
          ? "watch worker headroom"
          : "worker headroom left"
    if (els.costWorkerLimiterChart) {
      els.costWorkerLimiterChart.innerHTML = buildWorkerLimiterTrafficSvg(report)
    }
    if (!els.costWorkerLimiterBars) return
    var rows = [
      {
        eyebrow: "Worker writes today",
        value:
          compactMetricNumber(todayWritten) +
          " / " +
          (todayLimit > 0 ? compactMetricNumber(todayLimit) : "—"),
        copy: currentDay.covered
          ? formatMonthDay(currentDay.date) +
            " · " +
            compactMetricNumber(todayRemaining) +
            " left before the worker closes mutation writes for the day."
          : "Latest day bucket is missing from this bake.",
      },
      {
        eyebrow: "Worst baked day",
        value:
          peakDay && peakDay.date
            ? formatMonthDay(peakDay.date) + " · " + compactMetricNumber(peakDay.rowsWritten)
            : "—",
        copy:
          peakDay && peakDay.date
            ? (peakDay.exhausted
                ? "Hit the smart daily write ceiling."
                : compactMetricNumber(peakDay.rowsWrittenDailyRemaining) +
                  " left on the tightest baked day.") +
              " " +
              formatRatioPercent(peakDay.rowsWritten, peakDay.rowsWrittenDailySmartLimit) +
              " of that day's ceiling."
            : "No peak worker-limiter day is available in this bake.",
      },
      {
        eyebrow: "Worker writes this cycle",
        value:
          compactMetricNumber(cycleWritten) +
          " / " +
          (cycleLimit > 0 ? compactMetricNumber(cycleLimit) : "—"),
        copy:
          compactMetricNumber(cycleRemaining) + " left before the internal-cycle write ceiling.",
      },
      {
        eyebrow: "Days at smart ceiling",
        value: compactMetricNumber(totals.daysAtDailySmartLimit),
        copy: "Baked days where worker mutation writes reached or crossed the smart daily D1 write ceiling.",
      },
      {
        eyebrow: "Guardrail config",
        value: "Burst ×" + compactMetricNumber(guardrails.dailyBurstMultiplier || 1),
        copy:
          "Cycle day " +
          compactMetricNumber(guardrails.billingCycleDayOfMonth || 0) +
          " · internal write budget " +
          compactMetricNumber(guardrails.rowsWrittenHardMonthlyBudget || 0) +
          ".",
      },
      {
        eyebrow: "Launch answer",
        valueHtml: renderCostStateChip(summaryLabel, tone),
        copy: String(
          (workerLimiter && workerLimiter.decision) ||
            (workerLimiter && workerLimiter.explanation) ||
            "Worker-limiter decision not available.",
        ),
      },
    ]
    els.costWorkerLimiterBars.innerHTML = [
      '<div class="cost-status-banner">',
      renderCostStateChip(summaryLabel, tone),
      "<strong>Worker-side mutation headroom</strong>",
      '<div class="small">This is the write guard the worker enforces for admin mutation families. Same baked cadence as the D1 and DO panels, but aimed at the operator question: can we still mutate, or is today\'s worker gate already shut?</div>',
      "</div>",
      rows
        .map(function (row) {
          return renderCostDetailCard(row)
        })
        .join(""),
    ].join("")
  }

  function buildIntegritySignalSvg(report) {
    var freshness = report && report.freshness ? report.freshness : {}
    var d1 = report && report.d1 ? report.d1 : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var automation = report && report.automation ? report.automation : {}
    var expectedWindow = safeNum(automation.rollingWindowDays || d1.expectedWindowDays || 0)
    var filledWindow = safeNum(automation.filledWindowDays)
    var coverageScore =
      expectedWindow > 0 ? Math.min(100, Math.round((filledWindow / expectedWindow) * 100)) : 0
    var freshnessTone = costStateTone(freshness.level || "neutral")
    var freshnessScore =
      freshnessTone === "ok"
        ? 100
        : freshnessTone === "warn"
          ? 60
          : freshnessTone === "danger"
            ? 24
            : 48
    return buildBandChartSvg(
      [
        {
          label: "Freshness",
          note: String(freshness.detail || "No baked freshness detail yet."),
          value: freshnessScore,
          display: String(freshness.headline || "unknown"),
          tone: freshnessTone,
        },
        {
          label: "Window coverage",
          note:
            "Filled " +
            String(filledWindow) +
            " of " +
            String(expectedWindow || 0) +
            " intended days",
          value: coverageScore,
          display: String(filledWindow) + "/" + String(expectedWindow || 0),
          tone: coverageScore >= 100 ? "ok" : coverageScore >= 70 ? "warn" : "danger",
        },
        {
          label: "Latest day bucket",
          note: currentDay.covered
            ? "Latest daily bucket is present."
            : "Latest day bucket is missing from the bake.",
          value: currentDay.covered ? 100 : 0,
          display: currentDay.covered ? "present" : "missing",
          tone: currentDay.covered ? "ok" : "danger",
        },
        {
          label: "Storage sample",
          note: automation.storageBucketPresent
            ? "D1 storage bucket is present."
            : "No D1 storage sample in this bake.",
          value: automation.storageBucketPresent ? 100 : 40,
          display: automation.storageBucketPresent ? "present" : "missing",
          tone: automation.storageBucketPresent ? "ok" : "warn",
        },
        {
          label: "Request path",
          note:
            automation.runtimeTelemetryRequests === false
              ? "request path untouched"
              : "Runtime telemetry requests are enabled.",
          value: automation.runtimeTelemetryRequests === false ? 100 : 0,
          display: automation.runtimeTelemetryRequests === false ? "quiet" : "active",
          tone: automation.runtimeTelemetryRequests === false ? "ok" : "danger",
        },
      ],
      {
        ariaLabel: "Snapshot integrity chart",
        title: "100 means healthy or present. Lower bars are the checks that need attention.",
        maxValue: 100,
        footer: "This is trust-in-the-bake, not a live uptime probe.",
      },
    )
  }

  function renderCostBudgetHeadroom(report) {
    if (!els.costBudgetHeadroom) return
    var d1 = report && report.d1 ? report.d1 : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var cycleTotals = d1 && d1.cycleTotals ? d1.cycleTotals : {}
    var readTone = capacityToneFromRemaining(
      Math.min(
        safeNum(currentDay.rowsReadDailyRemaining || currentDay.rowsReadDailySmartLimit),
        safeNum(cycleTotals.rowsReadMonthlyRemaining || cycleTotals.rowsReadMonthlyLimit),
      ),
      Math.min(
        safeNum(currentDay.rowsReadDailySmartLimit || 0),
        safeNum(cycleTotals.rowsReadMonthlyLimit || 0),
      ) ||
        Math.max(
          safeNum(currentDay.rowsReadDailySmartLimit || 0),
          safeNum(cycleTotals.rowsReadMonthlyLimit || 0),
        ),
    )
    var rows = [
      {
        label: "Today reads",
        used: safeNum(currentDay.rowsRead),
        limit: safeNum(currentDay.rowsReadDailySmartLimit),
        note: currentDay.covered
          ? formatMonthDay(currentDay.date) +
            " daily smart ceiling · " +
            compactMetricNumber(currentDay.rowsReadDailyRemaining) +
            " left today."
          : "Latest day bucket is missing, so this gauge uses the recomputed cycle remainder.",
      },
      {
        label: "Cycle reads",
        used: safeNum(cycleTotals.rowsRead),
        limit: safeNum(cycleTotals.rowsReadMonthlyLimit),
        note:
          compactMetricNumber(cycleTotals.rowsReadMonthlyRemaining) +
          " left in the internal guardrail cycle.",
      },
    ]
    var writeRows = [
      {
        scope: "Today writes",
        used: currentDay.rowsWritten,
        limit: currentDay.rowsWrittenDailySmartLimit,
        left: currentDay.rowsWrittenDailyRemaining,
      },
      {
        scope: "Cycle writes",
        used: cycleTotals.rowsWritten,
        limit: cycleTotals.rowsWrittenMonthlyLimit,
        left: cycleTotals.rowsWrittenMonthlyRemaining,
      },
    ]
    els.costBudgetHeadroom.innerHTML = [
      '<div class="cost-status-banner">',
      renderCostStateChip(
        capacityLabelFromRemaining(
          cycleTotals.rowsReadMonthlyRemaining,
          cycleTotals.rowsReadMonthlyLimit,
        ),
        readTone,
      ),
      "<strong>Read ceilings are shown against real denominators</strong>",
      '<div class="small">The gauges below are only for metrics with actual ceilings. Traffic without a ceiling is listed as exact numbers elsewhere.</div>',
      "</div>",
      rows
        .map(function (row) {
          var pct =
            row.limit > 0
              ? Math.min(100, Math.round((safeNum(row.used) / row.limit) * 1000) / 10)
              : 0
          return [
            '<div class="cost-focus-block">',
            '<div class="cost-focus-head">',
            "<strong>" + esc(row.label) + "</strong>",
            '<span class="cost-subtle">' +
              esc(compactMetricNumber(row.used)) +
              " / " +
              esc(compactMetricNumber(row.limit)) +
              "</span>",
            "</div>",
            '<progress class="cost-budget-progress' +
              costFillToneClass(row.used, row.limit) +
              '" max="100" value="' +
              esc(String(pct)) +
              '" aria-label="' +
              esc(row.label + ": " + pct + "% used") +
              '"></progress>',
            '<div class="small">' + esc(row.note) + "</div>",
            "</div>",
          ].join("")
        })
        .join(""),
      '<div class="cost-mini-grid">',
      writeRows
        .map(function (row) {
          return renderCostDetailCard({
            eyebrow: row.scope,
            value:
              compactMetricNumber(row.used) +
              " / " +
              (row.limit == null ? "—" : compactMetricNumber(row.limit)),
            copy:
              row.left == null
                ? "No baked ceiling left value."
                : compactMetricNumber(row.left) + " left in this scope.",
          })
        })
        .join(""),
      "</div>",
    ].join("")
  }

  function renderCostBudgetAnswer(report) {
    if (!els.costBudgetAnswer) return
    var d1 = report && report.d1 ? report.d1 : {}
    var cycleTotals = d1 && d1.cycleTotals ? d1.cycleTotals : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var durableCurrentDay =
      durableObjects && durableObjects.currentDay ? durableObjects.currentDay : {}
    var doLimit = safeNum(
      durableCurrentDay.rowsWrittenDailyLimit || durableObjects.dailyLimitRowsWritten,
    )
    var doRemaining = safeNum(durableCurrentDay.rowsWrittenDailyRemaining)
    var doRowsWritten = safeNum(durableCurrentDay.rowsWritten)
    var tones = [
      capacityToneFromRemaining(
        currentDay.rowsWrittenDailyRemaining,
        currentDay.rowsWrittenDailySmartLimit,
      ),
      capacityToneFromRemaining(
        cycleTotals.rowsWrittenMonthlyRemaining,
        cycleTotals.rowsWrittenMonthlyLimit,
      ),
      capacityToneFromRemaining(doRemaining, doLimit),
    ]
    var headlineTone = tones.includes("danger") ? "danger" : tones.includes("warn") ? "warn" : "ok"
    var headlineLabel =
      headlineTone === "danger"
        ? "tight headroom"
        : headlineTone === "warn"
          ? "watch headroom"
          : "room left"
    var rows = [
      {
        eyebrow: "D1 writes today",
        value:
          compactMetricNumber(currentDay.rowsWritten) +
          " / " +
          compactMetricNumber(currentDay.rowsWrittenDailySmartLimit),
        copy:
          compactMetricNumber(currentDay.rowsWrittenDailyRemaining) +
          " left before today's smart write ceiling.",
      },
      {
        eyebrow: "D1 writes this cycle",
        value:
          compactMetricNumber(cycleTotals.rowsWritten) +
          " / " +
          compactMetricNumber(cycleTotals.rowsWrittenMonthlyLimit),
        copy:
          compactMetricNumber(cycleTotals.rowsWrittenMonthlyRemaining) +
          " left before the internal-cycle write ceiling.",
      },
      {
        eyebrow: "D1 reads this cycle",
        value:
          compactMetricNumber(cycleTotals.rowsRead) +
          " / " +
          compactMetricNumber(cycleTotals.rowsReadMonthlyLimit),
        copy:
          compactMetricNumber(cycleTotals.rowsReadMonthlyRemaining) +
          " left before the internal-cycle read ceiling.",
      },
      {
        eyebrow: "Account-wide DO rows_written today",
        value:
          compactMetricNumber(doRowsWritten) +
          " / " +
          (doLimit > 0 ? compactMetricNumber(doLimit) : "—"),
        copy:
          doLimit > 0
            ? compactMetricNumber(doRemaining) +
              " left before Cloudflare's real daily wall. This is tracked DO storage-write volume for the day, not an upload count."
            : "Daily DO ceiling missing from this bake.",
      },
    ]
    els.costBudgetAnswer.innerHTML = [
      '<div class="cost-status-banner">',
      renderCostStateChip(headlineLabel, headlineTone),
      "<strong>Fast answer from the baked Cloudflare snapshot</strong>",
      '<div class="small">This page answers platform budget headroom directly. Specific live workstation-run finish odds and upload-vs-bookkeeping attribution belong in Website Ops. The DO number below is account-wide Cloudflare rows_written headroom, not a count of uploads bought by one sync.</div>',
      "</div>",
      rows
        .map(function (row) {
          return renderCostDetailCard(row)
        })
        .join(""),
    ].join("")
  }

  function ratioPressureTone(used, limit) {
    var safeLimit = safeNum(limit)
    if (safeLimit <= 0) return "neutral"
    var ratio = safeNum(used) / safeLimit
    if (ratio >= 1) return "danger"
    if (ratio >= 0.75) return "warn"
    return "ok"
  }

  function pressurePointRow(key, label, used, limit, unit, source, href, note) {
    var hasUsage = used != null && Number.isFinite(safeNum(used))
    var hasLimit = limit != null && Number.isFinite(safeNum(limit)) && safeNum(limit) > 0
    var tone = hasUsage && hasLimit ? ratioPressureTone(used, limit) : "neutral"
    return {
      key: key,
      label: label,
      used: hasUsage ? safeNum(used) : null,
      limit: hasLimit ? safeNum(limit) : null,
      unit: String(unit || ""),
      source: String(source || ""),
      href: String(href || ""),
      note: String(note || ""),
      tone: tone,
      covered: hasUsage,
    }
  }

  function freePlanPressureRows(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var storage = d1 && d1.storage ? d1.storage : {}
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var durableCurrentDay =
      durableObjects && durableObjects.currentDay ? durableObjects.currentDay : {}
    var workers = report && report.workers ? report.workers : {}
    var workersCurrentDay = workers && workers.currentDay ? workers.currentDay : {}
    var kv = report && report.kv ? report.kv : {}
    var kvCurrentDay = kv && kv.currentDay ? kv.currentDay : {}
    var queues = report && report.queues ? report.queues : {}
    var queuesCurrentDay = queues && queues.currentDay ? queues.currentDay : {}
    var pagesFunctions = report && report.pagesFunctions ? report.pagesFunctions : {}
    var pagesCurrentDay =
      pagesFunctions && pagesFunctions.currentDay ? pagesFunctions.currentDay : {}
    var workersObservability =
      report && report.workersObservability ? report.workersObservability : {}
    var observabilityCurrentDay =
      workersObservability && workersObservability.currentDay ? workersObservability.currentDay : {}
    var launchpad = Array.isArray(report && report.launchpad) ? report.launchpad : []
    function linkFor(label, fallbackPath) {
      var found = launchpad.find(function (item) {
        return (
          String((item && item.label) || "")
            .toLowerCase()
            .indexOf(label) >= 0
        )
      })
      return String((found && found.href) || fallbackPath || "")
    }
    // These are Cloudflare free-plan quota denominators, not our internal
    // D1 smart guardrails. Keep this list broad and explicit so a blank
    // account spend page never gets mistaken for a healthy private rollout.
    var rows = [
      pressurePointRow(
        "d1_reads",
        "D1 rows read today",
        currentDay.rowsRead,
        5000000,
        "rows",
        "baked",
        linkFor("d1", "/workers/d1"),
        "Cloudflare free-plan daily wall. This is the meter that disappears when we only look at billable spend.",
      ),
      pressurePointRow(
        "d1_writes",
        "D1 rows written today",
        currentDay.rowsWritten,
        100000,
        "rows",
        "baked",
        linkFor("d1", "/workers/d1"),
        "Free-plan daily write wall for D1.",
      ),
      pressurePointRow(
        "d1_storage",
        "D1 storage",
        storage.databaseSizeBytes,
        5 * 1024 * 1024 * 1024,
        "bytes",
        "baked",
        linkFor("d1", "/workers/d1"),
        "Database size, not row count.",
      ),
      pressurePointRow(
        "workers_requests",
        "Workers requests today",
        workersCurrentDay.requests,
        workers.dailyLimitRequests || 100000,
        "requests",
        workersCurrentDay.date ? "baked" : "not baked yet",
        "/workers-and-pages",
        "Account-wide Worker invocations, including Pages Functions. This is the free-plan daily Worker wall.",
      ),
      pressurePointRow(
        "workers_observability",
        "Workers observability events today",
        observabilityCurrentDay.eventCount,
        workersObservability.dailyLimitEvents || 200000,
        "events",
        observabilityCurrentDay.date ? "baked" : "not baked yet",
        "/workers-and-pages/observability",
        "Cloudflare Workers Logs events for the Iconoplasm Worker. Route attribution is read from this same native surface.",
      ),
      pressurePointRow(
        "kv_reads",
        "Workers KV reads today",
        kvCurrentDay.readRequests,
        kv.dailyLimitReads || 100000,
        "ops",
        kvCurrentDay.date ? "baked" : "not baked yet",
        "/workers/kv/namespaces",
        "KV can be a quiet pressure point when public manifests or settings are read from the edge.",
      ),
      pressurePointRow(
        "kv_writes",
        "Workers KV writes today",
        kvCurrentDay.writeRequests,
        kv.dailyLimitWritesListsDeletes || 1000,
        "ops",
        kvCurrentDay.date ? "baked" : "not baked yet",
        "/workers/kv/namespaces",
        "Writes have a much smaller free daily allowance than KV reads.",
      ),
      pressurePointRow(
        "kv_deletes",
        "Workers KV deletes today",
        kvCurrentDay.deleteRequests,
        kv.dailyLimitWritesListsDeletes || 1000,
        "ops",
        kvCurrentDay.date ? "baked" : "not baked yet",
        "/workers/kv/namespaces",
        "Deletes have the same small free daily allowance as KV writes.",
      ),
      pressurePointRow(
        "kv_lists",
        "Workers KV lists today",
        kvCurrentDay.listRequests,
        kv.dailyLimitWritesListsDeletes || 1000,
        "ops",
        kvCurrentDay.date ? "baked" : "not baked yet",
        "/workers/kv/namespaces",
        "List operations have the same small free daily allowance as KV writes.",
      ),
      pressurePointRow(
        "queues_ops",
        "Queues billable operations today",
        queuesCurrentDay.billableOperations,
        queues.dailyLimitBillableOperations || 10000,
        "ops",
        queuesCurrentDay.date ? "baked" : "not baked yet",
        "/workers/queues",
        "Queue retries and dead-letter movement can burn this faster than normal publishes suggest.",
      ),
      pressurePointRow(
        "do_rows_written",
        "Durable Object rows written today",
        durableCurrentDay.rowsWritten,
        durableCurrentDay.rowsWrittenDailyLimit || durableObjects.dailyLimitRowsWritten || 100000,
        "rows",
        "baked",
        linkFor("durable", "/workers/durable-objects"),
        "Real Cloudflare DO SQLite daily wall.",
      ),
      pressurePointRow(
        "r2_status",
        "R2 storage and operations",
        null,
        null,
        "",
        "inactive",
        "/r2/overview",
        "R2 is not active for Iconoplasm portraits right now; the dashboard requires re-subscribing before buckets are available.",
      ),
      pressurePointRow(
        "pages_functions",
        "Pages Functions requests today",
        pagesCurrentDay.requests,
        100000,
        "requests",
        pagesCurrentDay.date ? "baked" : "not baked yet",
        "/workers-and-pages",
        "Pages Functions count against Workers usage; static Pages builds are separate from extension browsing.",
      ),
    ]
    return rows
  }

  function chartMissingSvg(title, message) {
    return [
      '<svg viewBox="0 0 520 220" role="img" aria-label="' + esc(title || "Missing chart") + '">',
      '<defs><pattern id="cost-missing-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="10" stroke="#d8cec3" stroke-width="3"/></pattern></defs>',
      '<rect x="12" y="12" width="496" height="196" rx="12" fill="url(#cost-missing-hatch)" opacity="0.45"></rect>',
      '<rect x="12" y="12" width="496" height="196" rx="12" fill="none" stroke="#d8cec3"></rect>',
      '<text x="28" y="88" font-size="16" font-weight="700" fill="#4a3d33">' +
        esc(title || "Missing series") +
        "</text>",
      '<text x="28" y="114" font-size="12" fill="#7a6d61">' +
        esc(message || "The snapshot generator does not bake this series yet.") +
        "</text>",
      "</svg>",
    ].join("")
  }

  function costPressureSeries(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var d1Daily = Array.isArray(d1 && d1.daily) ? d1.daily : []
    var doDaily = Array.isArray(durableObjects && durableObjects.daily) ? durableObjects.daily : []
    var workers = report && report.workers ? report.workers : {}
    var kv = report && report.kv ? report.kv : {}
    var queues = report && report.queues ? report.queues : {}
    var workersDaily = Array.isArray(workers && workers.daily) ? workers.daily : []
    var kvDaily = Array.isArray(kv && kv.daily) ? kv.daily : []
    var queuesDaily = Array.isArray(queues && queues.daily) ? queues.daily : []
    return [
      {
        key: "d1_reads",
        label: "D1 reads",
        color: "#b84a26",
        daily: d1Daily.map(function (row) {
          return { date: row && row.date, value: safeNum(row && row.rowsRead), limit: 5000000 }
        }),
      },
      {
        key: "d1_writes",
        label: "D1 writes",
        color: "#7d5a2d",
        daily: d1Daily.map(function (row) {
          return { date: row && row.date, value: safeNum(row && row.rowsWritten), limit: 100000 }
        }),
      },
      {
        key: "do_rows",
        label: "DO rows",
        color: "#4f7f6d",
        daily: doDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.rowsWritten),
            limit:
              safeNum(row && row.rowsWrittenDailyLimit) ||
              safeNum(durableObjects.dailyLimitRowsWritten) ||
              100000,
          }
        }),
      },
      {
        key: "workers_requests",
        label: "Workers",
        color: "#8b6f91",
        daily: workersDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.requests),
            limit: safeNum(workers.dailyLimitRequests) || 100000,
          }
        }),
      },
      {
        key: "kv_reads",
        label: "KV reads",
        color: "#2f6f9f",
        daily: kvDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.readRequests),
            limit: safeNum(kv.dailyLimitReads) || 100000,
          }
        }),
      },
      {
        key: "kv_writes",
        label: "KV writes",
        color: "#7d5a2d",
        daily: kvDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.writeRequests),
            limit: safeNum(kv.dailyLimitWritesListsDeletes) || 1000,
          }
        }),
      },
      {
        key: "kv_deletes",
        label: "KV deletes",
        color: "#8b6f91",
        daily: kvDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.deleteRequests),
            limit: safeNum(kv.dailyLimitWritesListsDeletes) || 1000,
          }
        }),
      },
      {
        key: "kv_lists",
        label: "KV lists",
        color: "#9b8f82",
        daily: kvDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.listRequests),
            limit: safeNum(kv.dailyLimitWritesListsDeletes) || 1000,
          }
        }),
      },
      {
        key: "queues_ops",
        label: "Queues",
        color: "#b87411",
        daily: queuesDaily.map(function (row) {
          return {
            date: row && row.date,
            value: safeNum(row && row.billableOperations),
            limit: safeNum(queues.dailyLimitBillableOperations) || 10000,
          }
        }),
      },
    ]
  }

  function singleQuotaPoint(date, value, limit) {
    if (!date || value == null || limit == null) return []
    return [{ date: date, value: safeNum(value), limit: safeNum(limit) }]
  }

  function quotaCeilingSeries(report) {
    var byKey = {}
    costPressureSeries(report).forEach(function (item) {
      byKey[item.key] = item
    })
    var d1 = report && report.d1 ? report.d1 : {}
    var d1Storage = d1 && d1.storage ? d1.storage : {}
    var kv = report && report.kv ? report.kv : {}
    var kvStorage = kv && kv.storage ? kv.storage : {}
    var pagesFunctions = report && report.pagesFunctions ? report.pagesFunctions : {}
    var pagesDaily = Array.isArray(pagesFunctions && pagesFunctions.daily)
      ? pagesFunctions.daily
      : []
    var workersObservability =
      report && report.workersObservability ? report.workersObservability : {}
    var observabilityDaily = Array.isArray(workersObservability && workersObservability.daily)
      ? workersObservability.daily
      : []
    // Keep these denominators explicit. These are operator-facing free-plan
    // walls, not decorative chart guesses; if usage is not baked, the chart
    // renders as a missing sensor instead of pretending the metric is safe.
    byKey.d1_storage = {
      key: "d1_storage",
      label: "D1 storage",
      color: "#8b6f91",
      unit: "bytes",
      daily: singleQuotaPoint(
        d1Storage.observedAt,
        d1Storage.databaseSizeBytes,
        d1Storage.databaseLimitBytes,
      ),
    }
    byKey.pages_functions = {
      key: "pages_functions",
      label: "Pages Functions",
      color: "#4f7f6d",
      unit: "requests",
      daily: pagesDaily.map(function (row) {
        return { date: row && row.date, value: safeNum(row && row.requests), limit: 100000 }
      }),
    }
    byKey.workers_observability = {
      key: "workers_observability",
      label: "Observability events",
      color: "#b87411",
      unit: "events",
      daily: observabilityDaily.map(function (row) {
        return {
          date: row && row.date,
          value: safeNum(row && row.eventCount),
          limit:
            safeNum(row && row.eventLimit) ||
            safeNum(workersObservability.dailyLimitEvents) ||
            200000,
        }
      }),
    }
    byKey.kv_storage = {
      key: "kv_storage",
      label: "KV storage",
      color: "#2f6f9f",
      unit: "bytes",
      daily: singleQuotaPoint(kvStorage.date, kvStorage.byteCount, 1024 * 1024 * 1024),
    }
    byKey.r2_storage = {
      key: "r2_storage",
      label: "R2 storage",
      color: "#9b8f82",
      unit: "bytes",
      daily: [],
    }
    byKey.r2_class_a = {
      key: "r2_class_a",
      label: "R2 Class A",
      color: "#7d5a2d",
      unit: "ops",
      daily: [],
    }
    byKey.r2_class_b = {
      key: "r2_class_b",
      label: "R2 Class B",
      color: "#6b4fb0",
      unit: "ops",
      daily: [],
    }
    return byKey
  }

  function formatQuotaValue(value, unit) {
    return unit === "bytes" ? formatByteSize(value) : compactMetricNumber(value)
  }

  function buildQuotaCeilingTimelineSvg(series, options) {
    var item = series || {}
    var rows = (Array.isArray(item.daily) ? item.daily : []).filter(function (row) {
      return row && row.date && row.value != null && safeNum(row.limit) > 0
    })
    var unit = String(item.unit || (options && options.unit) || "")
    if (!rows.length) {
      return chartMissingSvg(
        (options && options.emptyTitle) || "No " + String(item.label || "quota") + " timeline",
        (options && options.emptyMessage) ||
          "This pressure point has a real ceiling, but the baked snapshot does not include its daily usage series yet.",
      )
    }
    var width = Number((options && options.width) || 720)
    var height = Number((options && options.height) || 260)
    var padLeft = 54
    var padRight = 20
    var padTop = 20
    var padBottom = 38
    var usableWidth = width - padLeft - padRight
    var usableHeight = height - padTop - padBottom
    var maxValue = rows.reduce(function (acc, row) {
      return Math.max(acc, safeNum(row.value), safeNum(row.limit))
    }, 1)
    function xAt(index) {
      if (rows.length <= 1) return padLeft + usableWidth
      return padLeft + (usableWidth * index) / (rows.length - 1)
    }
    function yAt(value) {
      return padTop + usableHeight - (safeNum(value) / Math.max(maxValue, 1)) * usableHeight
    }
    var area = ""
    var usedLine = ""
    var ceilingLine = ""
    rows.forEach(function (row, index) {
      var x = xAt(index)
      var usedY = yAt(row.value)
      var limitY = yAt(row.limit)
      area += (index === 0 ? "M" : "L") + x + " " + usedY + " "
      usedLine += (index === 0 ? "M" : "L") + x + " " + usedY + " "
      ceilingLine += (index === 0 ? "M" : "L") + x + " " + limitY + " "
    })
    area += "L" + xAt(rows.length - 1) + " " + (padTop + usableHeight) + " "
    area += "L" + xAt(0) + " " + (padTop + usableHeight) + " Z"
    var color = String(item.color || "#b84a26")
    var points = rows
      .map(function (row, index) {
        var x = xAt(index)
        var y = yAt(row.value)
        var ratio = safeNum(row.value) / Math.max(safeNum(row.limit), 1)
        var tone = ratio >= 1 ? "#bf3030" : ratio >= 0.75 ? "#b87411" : color
        var label =
          formatMonthDay(row.date) +
          ": " +
          formatQuotaValue(row.value, unit) +
          " / " +
          formatQuotaValue(row.limit, unit)
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="4.8" fill="' +
          esc(tone) +
          '" stroke="#fff9f3" stroke-width="2"><title>' +
          esc(label) +
          "</title></circle>"
        )
      })
      .join("")
    var last = rows[rows.length - 1]
    var firstLabel = formatMonthDay(rows[0] && rows[0].date)
    var lastLabel = formatMonthDay(last && last.date)
    var ratioLabel = formatRatioPercent(last && last.value, last && last.limit)
    return [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="' +
        esc(String(item.label || "Quota") + " usage against ceiling over time") +
        '">',
      '<line x1="' +
        padLeft +
        '" y1="' +
        (padTop + usableHeight) +
        '" x2="' +
        (padLeft + usableWidth) +
        '" y2="' +
        (padTop + usableHeight) +
        '" stroke="#e5ddd5" stroke-width="1"></line>',
      '<path d="' +
        ceilingLine +
        '" fill="none" stroke="#4f7f6d" stroke-width="2" stroke-dasharray="6 6" stroke-linejoin="round" stroke-linecap="round"></path>',
      '<path d="' + area + '" fill="rgba(184,74,38,0.10)" stroke="none"></path>',
      '<path d="' +
        usedLine +
        '" fill="none" stroke="' +
        esc(color) +
        '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      points,
      '<text x="' +
        padLeft +
        '" y="16" font-size="11" font-weight="700" fill="' +
        esc(color) +
        '">' +
        esc(String(item.label || "Usage")) +
        "</text>",
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="16" text-anchor="end" font-size="11" fill="#4f7f6d">ceiling ' +
        esc(formatQuotaValue(last && last.limit, unit)) +
        "</text>",
      '<text x="' +
        padLeft +
        '" y="' +
        (height - 10) +
        '" font-size="11" fill="#7a6d61">' +
        esc(firstLabel) +
        "</text>",
      '<text x="' +
        (padLeft + usableWidth) +
        '" y="' +
        (height - 10) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(lastLabel) +
        " · " +
        esc(ratioLabel) +
        "</text>",
      "</svg>",
    ].join("")
  }

  function renderQuotaCeiling(target, series, options) {
    if (!target) return
    target.innerHTML = buildQuotaCeilingTimelineSvg(series, options || {})
  }

  function buildQuotaTimelineSvg(report) {
    var series = costPressureSeries(report).filter(function (item) {
      return item.daily.length
    })
    if (!series.length)
      return chartMissingSvg(
        "No daily quotas",
        "D1 and Durable Object daily rows are absent from this bake.",
      )
    var width = 760
    var height = 300
    var left = 54
    var right = 20
    var top = 22
    var bottom = 42
    var usableWidth = width - left - right
    var usableHeight = height - top - bottom
    var maxRatio = series.reduce(function (acc, item) {
      return Math.max(
        acc,
        item.daily.reduce(function (inner, row) {
          return Math.max(inner, row.limit > 0 ? safeNum(row.value) / safeNum(row.limit) : 0)
        }, 0),
      )
    }, 0.01)
    maxRatio = Math.max(maxRatio, 0.01)
    var longest = series.reduce(function (acc, item) {
      return Math.max(acc, item.daily.length)
    }, 0)
    function xAt(index) {
      return left + (longest <= 1 ? 0 : (usableWidth * index) / (longest - 1))
    }
    function yAt(ratio) {
      return top + usableHeight - (safeNum(ratio) / maxRatio) * usableHeight
    }
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Daily Cloudflare free-plan quota usage timeline">',
      '<line x1="' +
        left +
        '" y1="' +
        (top + usableHeight) +
        '" x2="' +
        (left + usableWidth) +
        '" y2="' +
        (top + usableHeight) +
        '" stroke="#e5ddd5"/>',
      '<line x1="' +
        left +
        '" y1="' +
        yAt(1) +
        '" x2="' +
        (left + usableWidth) +
        '" y2="' +
        yAt(1) +
        '" stroke="#bf3030" stroke-dasharray="5 5"/>',
      '<text x="' +
        (left + usableWidth) +
        '" y="' +
        Math.max(12, yAt(1) - 5) +
        '" text-anchor="end" font-size="11" fill="#bf3030">free wall</text>',
    ]
    series.forEach(function (item, index) {
      var path = item.daily
        .map(function (row, pointIndex) {
          var ratio = row.limit > 0 ? safeNum(row.value) / safeNum(row.limit) : 0
          return (pointIndex === 0 ? "M" : "L") + xAt(pointIndex) + " " + yAt(ratio)
        })
        .join(" ")
      svg.push(
        '<path d="' +
          path +
          '" fill="none" stroke="' +
          esc(item.color) +
          '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      )
      svg.push(
        '<text x="' +
          (left + index * 118) +
          '" y="18" font-size="11" font-weight="700" fill="' +
          esc(item.color) +
          '">' +
          esc(item.label) +
          "</text>",
      )
    })
    var firstDay = series[0].daily[0] && series[0].daily[0].date
    var lastDay =
      series[0].daily[series[0].daily.length - 1] &&
      series[0].daily[series[0].daily.length - 1].date
    svg.push(
      '<text x="' +
        left +
        '" y="' +
        (height - 10) +
        '" font-size="11" fill="#7a6d61">' +
        esc(formatMonthDay(firstDay)) +
        "</text>",
    )
    svg.push(
      '<text x="' +
        (left + usableWidth) +
        '" y="' +
        (height - 10) +
        '" text-anchor="end" font-size="11" fill="#7a6d61">' +
        esc(formatMonthDay(lastDay)) +
        "</text>",
    )
    svg.push(
      '<text x="' +
        left +
        '" y="' +
        (top + 14) +
        '" font-size="11" fill="#7a6d61">Peak ' +
        esc((maxRatio * 100).toFixed(maxRatio >= 1 ? 0 : 1)) +
        "%</text>",
    )
    svg.push("</svg>")
    return svg.join("")
  }

  function buildLimitRatioHeatmapSvg(report) {
    var rows = freePlanPressureRows(report)
    var width = 520
    var rowHeight = 22
    var height = 34 + rows.length * rowHeight
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Cloudflare limit ratio heatmap">',
    ]
    rows.forEach(function (row, index) {
      var y = 28 + index * rowHeight
      var ratio = row && row.limit ? safeNum(row.used) / safeNum(row.limit) : null
      var tone =
        ratio == null ? "#d8cec3" : ratio >= 1 ? "#bf3030" : ratio >= 0.75 ? "#b87411" : "#4f7f6d"
      var opacity = ratio == null ? 0.35 : Math.max(0.24, Math.min(1, ratio))
      svg.push(
        '<text x="14" y="' +
          (y + 13) +
          '" font-size="11" fill="#4a3d33">' +
          esc(String(row.label || "").replace(" today", "")) +
          "</text>",
      )
      svg.push(
        '<rect x="290" y="' +
          y +
          '" width="170" height="14" rx="3" fill="' +
          tone +
          '" opacity="' +
          opacity.toFixed(2) +
          '"></rect>',
      )
      svg.push(
        '<text x="504" y="' +
          (y + 11) +
          '" text-anchor="end" font-size="10" fill="#7a6d61">' +
          esc(row.limit ? formatRatioPercent(row.used, row.limit) : row.source) +
          "</text>",
      )
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function buildSensorCoverageMatrixSvg(report) {
    var rows = freePlanPressureRows(report)
    var metrics = ["usage", "limit", "daily", "link"]
    var width = 520
    var height = 46 + rows.length * 22
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Telemetry sensor coverage matrix">',
    ]
    metrics.forEach(function (metric, index) {
      svg.push(
        '<text x="' +
          (260 + index * 54) +
          '" y="18" font-size="10" text-anchor="middle" fill="#7a6d61">' +
          esc(metric) +
          "</text>",
      )
    })
    rows.forEach(function (row, rowIndex) {
      var y = 34 + rowIndex * 22
      var cells = [row.used != null, row.limit != null, row.covered, Boolean(row.href)]
      svg.push(
        '<text x="14" y="' +
          (y + 13) +
          '" font-size="11" fill="#4a3d33">' +
          esc(String(row.label || "").replace(" today", "")) +
          "</text>",
      )
      cells.forEach(function (covered, cellIndex) {
        svg.push(
          '<rect x="' +
            (248 + cellIndex * 54) +
            '" y="' +
            y +
            '" width="22" height="14" rx="3" fill="' +
            (covered ? "#4f7f6d" : "#d8cec3") +
            '" opacity="' +
            (covered ? "0.95" : "0.36") +
            '"></rect>',
        )
      })
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function buildOverageMagnitudeSvg(report) {
    var rows = freePlanPressureRows(report).filter(function (row) {
      return row && row.limit
    })
    var width = 520
    var height = 220
    var left = 140
    var right = 28
    var top = 28
    var rowHeight = 24
    var maxRatio = rows.reduce(function (acc, row) {
      return Math.max(acc, safeNum(row.used) / safeNum(row.limit))
    }, 0.01)
    function xAt(ratio) {
      var normalized = Math.log10(1 + Math.max(0, ratio)) / Math.log10(1 + Math.max(1, maxRatio))
      return left + normalized * (width - left - right)
    }
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Overage magnitude dot plot">',
    ]
    svg.push(
      '<line x1="' +
        xAt(1) +
        '" y1="16" x2="' +
        xAt(1) +
        '" y2="' +
        (height - 12) +
        '" stroke="#bf3030" stroke-dasharray="4 4"></line>',
    )
    rows.slice(0, 7).forEach(function (row, index) {
      var ratio = safeNum(row.used) / safeNum(row.limit)
      var y = top + index * rowHeight
      svg.push(
        '<text x="12" y="' +
          (y + 5) +
          '" font-size="11" fill="#4a3d33">' +
          esc(String(row.label || "").replace(" today", "")) +
          "</text>",
      )
      svg.push(
        '<line x1="' +
          left +
          '" y1="' +
          y +
          '" x2="' +
          xAt(ratio) +
          '" y2="' +
          y +
          '" stroke="#d8cec3"></line>',
      )
      svg.push(
        '<circle cx="' +
          xAt(ratio) +
          '" cy="' +
          y +
          '" r="5" fill="' +
          esc(costToneColor(row.tone)) +
          '"></circle>',
      )
      svg.push(
        '<text x="' +
          (width - 12) +
          '" y="' +
          (y + 4) +
          '" text-anchor="end" font-size="10" fill="#7a6d61">' +
          esc(formatRatioPercent(row.used, row.limit)) +
          "</text>",
      )
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function buildDailyBurnCalendarSvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var rows = Array.isArray(d1 && d1.daily) ? d1.daily : []
    if (!rows.length)
      return chartMissingSvg("No burn calendar", "D1 daily buckets are absent from this bake.")
    var width = 520
    var height = 220
    var cell = 22
    var startX = 22
    var startY = 36
    var maxRows = rows.reduce(function (acc, row) {
      return Math.max(acc, safeNum(row && row.rowsRead))
    }, 1)
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Daily D1 burn calendar">',
    ]
    rows.slice(-28).forEach(function (row, index) {
      var col = index % 14
      var r = Math.floor(index / 14)
      var intensity = Math.max(0.18, Math.min(1, safeNum(row && row.rowsRead) / maxRows))
      var x = startX + col * (cell + 8)
      var y = startY + r * (cell + 28)
      svg.push(
        '<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          cell +
          '" height="' +
          cell +
          '" rx="4" fill="#b84a26" opacity="' +
          intensity.toFixed(2) +
          '"><title>' +
          esc(
            formatMonthDay(row && row.date) +
              ": " +
              compactMetricNumber(row && row.rowsRead) +
              " rows read",
          ) +
          "</title></rect>",
      )
      svg.push(
        '<text x="' +
          (x + cell / 2) +
          '" y="' +
          (y + cell + 13) +
          '" text-anchor="middle" font-size="8" fill="#7a6d61">' +
          esc(String(formatMonthDay(row && row.date)).replace(" ", "")) +
          "</text>",
      )
    })
    svg.push(
      '<text x="22" y="18" font-size="11" fill="#7a6d61">Darker cells burn more D1 reads.</text>',
    )
    svg.push("</svg>")
    return svg.join("")
  }

  function buildQueueBacklogSvg(report) {
    var queues = report && report.queues ? report.queues : {}
    var rows = Array.isArray(queues && queues.daily) ? queues.daily : []
    return buildMetricTimelineSvg(
      rows,
      [
        {
          label: "messages",
          color: "#b87411",
          value: function (row) {
            return row && row.backlogMessages
          },
        },
        {
          label: "billable ops",
          color: "#7d5a2d",
          value: function (row) {
            return row && row.billableOperations
          },
        },
        {
          label: "failures",
          color: "#bf3030",
          value: function (row) {
            return safeNum(row && row.failedOperations) + safeNum(row && row.dlqOperations)
          },
        },
      ],
      {
        ariaLabel:
          "Queue backlog messages, billable operations, and failed queue operations by day",
        emptyTitle: "No Queue backlog history",
      },
    )
  }

  function buildHeadroomSlopeSvg(report) {
    var d1 = report && report.d1 ? report.d1 : {}
    var cycleTotals = d1 && d1.cycleTotals ? d1.cycleTotals : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var doDay = durableObjects && durableObjects.currentDay ? durableObjects.currentDay : {}
    var rows = [
      {
        label: "D1 read cycle",
        used: cycleTotals.rowsRead,
        limit: cycleTotals.rowsReadMonthlyLimit,
        color: "#b84a26",
      },
      {
        label: "D1 write day",
        used: currentDay.rowsWritten,
        limit: currentDay.rowsWrittenDailySmartLimit,
        color: "#7d5a2d",
      },
      {
        label: "DO rows day",
        used: doDay.rowsWritten,
        limit: doDay.rowsWrittenDailyLimit || durableObjects.dailyLimitRowsWritten,
        color: "#4f7f6d",
      },
    ].filter(function (row) {
      return row.limit
    })
    if (!rows.length)
      return chartMissingSvg("No headroom slopes", "No denominator-backed quota rows are present.")
    var width = 520
    var height = 220
    var leftX = 42
    var midX = 250
    var rightX = 468
    var top = 34
    var rowHeight = 44
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Quota headroom slope chart">',
    ]
    svg.push(
      '<text x="' +
        leftX +
        '" y="18" font-size="10" text-anchor="middle" fill="#7a6d61">start</text><text x="' +
        midX +
        '" y="18" font-size="10" text-anchor="middle" fill="#7a6d61">now</text><text x="' +
        rightX +
        '" y="18" font-size="10" text-anchor="middle" fill="#7a6d61">wall</text>',
    )
    rows.forEach(function (row, index) {
      var y = top + index * rowHeight
      var nowX = leftX + (safeNum(row.used) / safeNum(row.limit)) * (rightX - leftX)
      svg.push(
        '<line x1="' +
          leftX +
          '" y1="' +
          y +
          '" x2="' +
          rightX +
          '" y2="' +
          y +
          '" stroke="#d8cec3"></line>',
      )
      svg.push(
        '<line x1="' +
          leftX +
          '" y1="' +
          y +
          '" x2="' +
          nowX +
          '" y2="' +
          y +
          '" stroke="' +
          esc(row.color) +
          '" stroke-width="4"></line>',
      )
      svg.push(
        '<circle cx="' + nowX + '" cy="' + y + '" r="6" fill="' + esc(row.color) + '"></circle>',
      )
      svg.push(
        '<text x="18" y="' +
          (y + 22) +
          '" font-size="11" fill="#4a3d33">' +
          esc(row.label) +
          "</text>",
      )
      svg.push(
        '<text x="' +
          (width - 18) +
          '" y="' +
          (y + 22) +
          '" text-anchor="end" font-size="11" fill="#7a6d61">' +
          esc(formatRatioPercent(row.used, row.limit)) +
          "</text>",
      )
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function buildProductSmallMultiplesSvg(report) {
    var series = costPressureSeries(report)
    var width = 760
    var height = 430
    var panelWidth = 230
    var panelHeight = 108
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Small multiple product pressure charts">',
    ]
    series.forEach(function (item, index) {
      var x0 = 22 + (index % 3) * (panelWidth + 14)
      var y0 = 30 + Math.floor(index / 3) * (panelHeight + 34)
      var list = item.daily
      svg.push(
        '<text x="' +
          x0 +
          '" y="' +
          (y0 - 10) +
          '" font-size="12" font-weight="700" fill="' +
          esc(item.color) +
          '">' +
          esc(item.label) +
          "</text>",
      )
      svg.push(
        '<rect x="' +
          x0 +
          '" y="' +
          y0 +
          '" width="' +
          panelWidth +
          '" height="' +
          panelHeight +
          '" rx="8" fill="#f6f0e9" stroke="#e4d9ce"></rect>',
      )
      if (!list.length) {
        svg.push(
          '<text x="' +
            (x0 + 12) +
            '" y="' +
            (y0 + 58) +
            '" font-size="11" fill="#7a6d61">missing</text>',
        )
        return
      }
      var maxRatio = list.reduce(function (acc, row) {
        return Math.max(acc, row.limit ? safeNum(row.value) / safeNum(row.limit) : 0)
      }, 0.01)
      var path = list
        .map(function (row, pointIndex) {
          var px =
            x0 + 12 + (list.length <= 1 ? 0 : ((panelWidth - 24) * pointIndex) / (list.length - 1))
          var py =
            y0 +
            panelHeight -
            14 -
            ((row.limit ? safeNum(row.value) / safeNum(row.limit) : 0) / Math.max(maxRatio, 0.01)) *
              (panelHeight - 30)
          return (pointIndex === 0 ? "M" : "L") + px + " " + py
        })
        .join(" ")
      svg.push(
        '<path d="' +
          path +
          '" fill="none" stroke="' +
          esc(item.color) +
          '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>',
      )
    })
    var missing = ["Workers observability", "R2 inactive"]
    missing.forEach(function (label, index) {
      var x0 = 22 + (index % 3) * (panelWidth + 14)
      var y0 = 314
      svg.push(
        '<text x="' +
          x0 +
          '" y="' +
          (y0 - 10) +
          '" font-size="12" font-weight="700" fill="#9b8f82">' +
          esc(label) +
          "</text>",
      )
      svg.push(
        '<rect x="' +
          x0 +
          '" y="' +
          y0 +
          '" width="' +
          panelWidth +
          '" height="' +
          panelHeight +
          '" rx="8" fill="#f6f0e9" stroke="#e4d9ce" stroke-dasharray="5 5"></rect>',
      )
      svg.push(
        '<text x="' +
          (x0 + 12) +
          '" y="' +
          (y0 + 58) +
          '" font-size="11" fill="#7a6d61">not baked</text>',
      )
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function buildUnknownSeriesSvg(report) {
    var rows = freePlanPressureRows(report)
      .filter(function (row) {
        return row && !row.covered
      })
      .slice(0, 6)
    if (!rows.length)
      return chartMissingSvg("No unknowns", "Every tracked pressure point has a baked usage value.")
    var width = 520
    var height = 220
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Missing telemetry series">',
    ]
    rows.forEach(function (row, index) {
      var y = 28 + index * 30
      svg.push(
        '<rect x="16" y="' +
          y +
          '" width="488" height="18" rx="4" fill="#f0e8df" stroke="#d8cec3" stroke-dasharray="4 4"></rect>',
      )
      svg.push(
        '<text x="26" y="' +
          (y + 13) +
          '" font-size="11" fill="#4a3d33">' +
          esc(row.label) +
          "</text>",
      )
      svg.push(
        '<text x="496" y="' +
          (y + 13) +
          '" text-anchor="end" font-size="10" fill="#7a6d61">' +
          esc(row.source) +
          "</text>",
      )
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function buildEventOverlaySvg(report) {
    return chartMissingSvg(
      "Event overlay not baked",
      "Deploys, extension shares, publish bursts, sync jobs, and retry events need a baked event lane.",
    )
  }

  function buildRequestDistributionSvg(report) {
    var attribution = report && report.budgetAttribution ? report.budgetAttribution : {}
    var rows =
      Array.isArray(attribution && attribution.cycleTopRequestRoutes) &&
      attribution.cycleTopRequestRoutes.length
        ? attribution.cycleTopRequestRoutes
        : Array.isArray(attribution && attribution.cycleTopRoutes)
          ? attribution.cycleTopRoutes
          : []
    if (!rows.length)
      return chartMissingSvg(
        "No route families",
        "The snapshot does not include request-family attribution yet.",
      )
    var total = rows.reduce(function (acc, row) {
      return acc + safeNum(row && (row.requestCount || row.request_count || row.value))
    }, 0)
    if (total <= 0)
      return chartMissingSvg(
        "No route families",
        "Route attribution exists but has no request-count values.",
      )
    var width = 520
    var height = 220
    var cx = 120
    var cy = 110
    var radius = 70
    var start = -Math.PI / 2
    var colors = ["#b84a26", "#4f7f6d", "#7d5a2d", "#b87411", "#8b6f91"]
    function arcPath(end) {
      var x1 = cx + radius * Math.cos(start)
      var y1 = cy + radius * Math.sin(start)
      var x2 = cx + radius * Math.cos(end)
      var y2 = cy + radius * Math.sin(end)
      var large = end - start > Math.PI ? 1 : 0
      var path =
        "M " +
        cx +
        " " +
        cy +
        " L " +
        x1 +
        " " +
        y1 +
        " A " +
        radius +
        " " +
        radius +
        " 0 " +
        large +
        " 1 " +
        x2 +
        " " +
        y2 +
        " Z"
      start = end
      return path
    }
    var svg = [
      '<svg viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Request-family distribution">',
    ]
    rows.slice(0, 5).forEach(function (row, index) {
      var value = safeNum(row && (row.requestCount || row.request_count || row.value))
      var end = start + (value / total) * Math.PI * 2
      svg.push(
        '<path d="' +
          arcPath(end) +
          '" fill="' +
          colors[index % colors.length] +
          '" opacity="0.92"></path>',
      )
      svg.push(
        '<text x="230" y="' +
          (52 + index * 24) +
          '" font-size="11" fill="#4a3d33">' +
          esc(
            displayRouteFamily(
              row && (row.routeFamily || row.route || row.key || row.label || "route"),
            ),
          ) +
          "</text>",
      )
      svg.push(
        '<text x="496" y="' +
          (52 + index * 24) +
          '" text-anchor="end" font-size="11" fill="#7a6d61">' +
          esc(formatRatioPercent(value, total)) +
          "</text>",
      )
    })
    svg.push("</svg>")
    return svg.join("")
  }

  function formatPressureUsage(row) {
    if (!row || row.used == null) return "not baked"
    var used = row.unit === "bytes" ? formatByteSize(row.used) : compactMetricNumber(row.used)
    if (row.limit == null) return used
    var limit = row.unit === "bytes" ? formatByteSize(row.limit) : compactMetricNumber(row.limit)
    return used + " / " + limit
  }

  function buildPlatformPressureSvg(rows) {
    var chartRows = (Array.isArray(rows) ? rows : []).map(function (row) {
      var hasRatio = row && row.used != null && row.limit != null && safeNum(row.limit) > 0
      return {
        label: row && row.label,
        note: row && row.source,
        value: hasRatio
          ? Math.min(100, Math.round((safeNum(row.used) / safeNum(row.limit)) * 1000) / 10)
          : 2,
        display: hasRatio
          ? formatRatioPercent(row.used, row.limit)
          : String((row && row.source) || "missing"),
        tone: (row && row.tone) || "neutral",
      }
    })
    return buildBandChartSvg(chartRows, {
      ariaLabel: "Cloudflare free-plan pressure points",
      title:
        "Percent of known free-plan quota used. Tiny gray rows mean the snapshot has no telemetry yet.",
      maxValue: 100,
      footer:
        "This map is deliberately broader than D1: missing telemetry is visible work, not safety.",
    })
  }

  function renderPlatformPressureMap(report) {
    if (!els.costPlatformPressureChart && !els.costPlatformPressureBars) return
    var rows = freePlanPressureRows(report)
    if (els.costPlatformPressureChart) {
      els.costPlatformPressureChart.innerHTML = buildPlatformPressureSvg(rows)
    }
    if (els.costPlatformPressureBars) {
      var dangerCount = rows.filter(function (row) {
        return row && row.tone === "danger"
      }).length
      var missingCount = rows.filter(function (row) {
        return row && !row.covered
      }).length
      els.costPlatformPressureBars.innerHTML = [
        '<div class="cost-status-banner">',
        renderCostStateChip(
          dangerCount > 0 ? "over free wall" : missingCount > 0 ? "incomplete bake" : "covered",
          dangerCount > 0 ? "danger" : missingCount > 0 ? "warn" : "ok",
        ),
        "<strong>Free-plan quota view</strong>",
        '<div class="small">Cloudflare Billing can be blank on a zero-dollar account. These are the operational limits that matter instead.</div>',
        "</div>",
        rows
          .map(function (row) {
            return renderCostDetailCard({
              eyebrow: row.label,
              value: formatPressureUsage(row),
              copy: row.source + " · " + row.note,
            })
          })
          .join(""),
      ].join("")
    }
  }

  function renderObservabilityLaunchpad(report) {
    if (!els.costCycleBudgetBars) return
    var d1 = report && report.d1 ? report.d1 : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var cycleTotals = d1 && d1.cycleTotals ? d1.cycleTotals : {}
    var guardrails = report && report.guardrails ? report.guardrails : {}
    var rows = [
      {
        scope: "Today reads",
        context: currentDay.covered ? formatMonthDay(currentDay.date) : "latest day missing",
        used: currentDay.rowsRead,
        limit: currentDay.rowsReadDailySmartLimit,
        left: currentDay.rowsReadDailyRemaining,
      },
      {
        scope: "Cycle reads",
        context: String(d1.cycleKey || "current cycle"),
        used: cycleTotals.rowsRead,
        limit: cycleTotals.rowsReadMonthlyLimit,
        left: cycleTotals.rowsReadMonthlyRemaining,
      },
      {
        scope: "Today writes",
        context: currentDay.covered ? formatMonthDay(currentDay.date) : "latest day missing",
        used: currentDay.rowsWritten,
        limit: currentDay.rowsWrittenDailySmartLimit,
        left: currentDay.rowsWrittenDailyRemaining,
      },
      {
        scope: "Cycle writes",
        context: String(d1.cycleKey || "current cycle"),
        used: cycleTotals.rowsWritten,
        limit: cycleTotals.rowsWrittenMonthlyLimit,
        left: cycleTotals.rowsWrittenMonthlyRemaining,
      },
    ]
    els.costCycleBudgetBars.innerHTML =
      rows
        .map(function (row) {
          return renderCostDetailCard({
            eyebrow: row.scope,
            value:
              compactMetricNumber(row.used) +
              " / " +
              (row.limit == null ? "—" : compactMetricNumber(row.limit)),
            copy:
              row.context +
              " · " +
              (row.left == null ? "left unknown" : compactMetricNumber(row.left) + " left") +
              " · " +
              (row.limit == null ? "no used %" : formatRatioPercent(row.used, row.limit) + " used"),
          })
        })
        .join("") +
      '<div class="small">Burst ×' +
      esc(String(safeNum(guardrails.dailyBurstMultiplier || 1))) +
      " means the internal smart ceiling moves as the cycle burns. Free-plan daily walls live in the pressure map above.</div>"
  }

  function renderObservabilityDatasets(report) {
    if (!els.costCycleSourceBars) return
    var durableObjects = report && report.durableObjects ? report.durableObjects : {}
    var totals = durableObjects && durableObjects.totals ? durableObjects.totals : {}
    var currentDay = durableObjects && durableObjects.currentDay ? durableObjects.currentDay : {}
    var peakDay = durableObjects && durableObjects.peakDay ? durableObjects.peakDay : {}
    var dailyLimit = safeNum(
      currentDay.rowsWrittenDailyLimit || durableObjects.dailyLimitRowsWritten,
    )
    var currentRows = safeNum(currentDay.rowsWritten)
    var currentRemaining = safeNum(currentDay.rowsWrittenDailyRemaining)
    var requests = safeNum(totals.requests)
    var errors = safeNum(totals.errors)
    var errorRate = requests > 0 ? errors / requests : null
    var usageRatio = dailyLimit > 0 ? currentRows / dailyLimit : 0
    var tone = currentDay.exhausted
      ? "danger"
      : usageRatio >= 0.8
        ? "warn"
        : dailyLimit > 0
          ? "ok"
          : "neutral"
    var summaryLabel = currentDay.exhausted
      ? "ceiling hit"
      : tone === "warn"
        ? "watch headroom"
        : tone === "ok"
          ? "headroom left"
          : "missing limit"
    var rows = [
      {
        eyebrow: "Today account-wide DO rows_written",
        value:
          compactMetricNumber(currentRows) +
          " / " +
          (dailyLimit > 0 ? compactMetricNumber(dailyLimit) : "—"),
        copy:
          formatMonthDay(currentDay.date) +
          " · " +
          (dailyLimit > 0
            ? compactMetricNumber(currentRemaining) + " left before the Cloudflare wall."
            : "Daily ceiling missing from this bake.") +
          " This is account-wide DO storage-write volume, not a per-sync upload meter.",
      },
      {
        eyebrow: "Worst baked day",
        value:
          peakDay && peakDay.date
            ? formatMonthDay(peakDay.date) + " · " + compactMetricNumber(peakDay.rowsWritten)
            : "—",
        copy:
          peakDay && peakDay.date
            ? (peakDay.exhausted
                ? "Reached the ceiling."
                : compactMetricNumber(peakDay.rowsWrittenDailyRemaining) +
                  " left on the worst day.") +
              " " +
              formatRatioPercent(peakDay.rowsWritten, peakDay.rowsWrittenDailyLimit) +
              " of the daily limit."
            : "No peak day available in this bake.",
      },
      {
        eyebrow: "Days at the ceiling",
        value: compactMetricNumber(totals.daysAtDailyLimit),
        copy: "Baked days that reached or exceeded the real 100,000 rows_written/day ceiling.",
      },
      {
        eyebrow: "Rows written in baked window",
        value: compactMetricNumber(totals.rowsWritten),
        copy: "Account-wide DO rows_written across the same baked daily window shown in the chart. It includes tracked DO work in the window, not just one sync run.",
      },
      {
        eyebrow: "Invocations in window",
        value: compactMetricNumber(requests),
        copy:
          "Script-level Cloudflare count for " +
          String(durableObjects.scriptName || "unknown script") +
          ". The write ceiling above is account-wide.",
      },
      {
        eyebrow: "Errors in window",
        value: compactMetricNumber(errors),
        copy:
          requests > 0
            ? formatRatioPercent(errors, requests) + " of script-level invocations."
            : "No invocation denominator in this bake.",
      },
    ]
    if (els.costCycleSourceChart) {
      els.costCycleSourceChart.innerHTML = buildDurableObjectTrafficSvg(report)
    }
    els.costCycleSourceBars.innerHTML = [
      '<div class="cost-status-banner">',
      renderCostStateChip(summaryLabel, tone),
      "<strong>Real daily rows_written headroom</strong>",
      '<div class="small">The line chart shows account-wide Durable Object rows_written against the real 100,000/day Cloudflare ceiling that can knock writes offline. It is a platform headroom view, not a per-sync accounting report.</div>',
      "</div>",
      rows
        .map(function (row) {
          return renderCostDetailCard(row)
        })
        .join(""),
    ].join("")
  }

  function renderObservabilityRunbook(report) {
    if (!els.costSnapshotTrustDetails) return
    var freshness = report && report.freshness ? report.freshness : {}
    var d1 = report && report.d1 ? report.d1 : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var storage = d1 && d1.storage ? d1.storage : {}
    var automation = report && report.automation ? report.automation : {}
    var publication = report && report.publication ? report.publication : {}
    var retiredMetrics = Array.isArray(report && report.retiredMetrics) ? report.retiredMetrics : []
    var rows = [
      {
        label: "Snapshot freshness",
        chip: renderCostStateChip(
          freshness.headline || "unknown",
          costStateTone(freshness.level || "neutral"),
        ),
        note: String(freshness.detail || "No bake timestamp present."),
      },
      {
        label: "Publication path",
        chip: renderCostStateChip(
          publication.state === "published" ? "KV published" : "deploy fallback",
          publication.state === "published" ? "ok" : "warn",
        ),
        note:
          publication.state === "published"
            ? "The hourly job published this snapshot through one atomic KV key."
            : "The hourly KV artifact is unavailable; the Worker bundle snapshot is being used.",
      },
      {
        label: "Retired metrics",
        chip: renderCostStateChip(
          retiredMetrics.length ? String(retiredMetrics.length) + " intentional" : "none",
          "neutral",
        ),
        note: retiredMetrics.length
          ? retiredMetrics
              .map(function (item) {
                return (
                  String(item.label || item.id || "metric") +
                  ": " +
                  String(item.reason || "retired")
                )
              })
              .join(" ")
          : "No metrics are marked as intentionally retired.",
      },
      {
        label: "Window coverage",
        chip: renderCostStateChip(
          String(safeNum(automation.filledWindowDays)) +
            "/" +
            String(safeNum(automation.rollingWindowDays || d1.expectedWindowDays || 0)) +
            " days",
          safeNum(automation.filledWindowDays) >=
            safeNum(automation.rollingWindowDays || d1.expectedWindowDays || 0)
            ? "ok"
            : "warn",
        ),
        note: "How much of the intended baked window actually arrived.",
      },
      {
        label: "Latest day bucket",
        chip: renderCostStateChip(
          currentDay.covered ? formatMonthDay(currentDay.date) : "missing",
          currentDay.covered ? "ok" : "danger",
        ),
        note: currentDay.covered
          ? "Latest daily bucket is present in the snapshot."
          : "Latest day is missing from the baked snapshot.",
      },
      {
        label: "Storage sample",
        chip: renderCostStateChip(
          automation.storageBucketPresent ? "present" : "missing",
          automation.storageBucketPresent ? "ok" : "warn",
        ),
        note: storage.observedAt
          ? "Observed " +
            formatCalendarDate(storage.observedAt) +
            " at " +
            formatByteSize(storage.databaseSizeBytes) +
            "."
          : "No D1 storage bucket in this bake.",
      },
      {
        label: "Request path",
        chip: renderCostStateChip(
          automation.runtimeTelemetryRequests === false ? "quiet" : "active",
          automation.runtimeTelemetryRequests === false ? "ok" : "danger",
        ),
        note:
          automation.runtimeTelemetryRequests === false
            ? "request path untouched"
            : "Runtime telemetry requests are enabled, which should not happen here.",
      },
    ]
    if (els.costSnapshotTrustChart) {
      els.costSnapshotTrustChart.innerHTML = buildIntegritySignalSvg(report)
    }
    els.costSnapshotTrustDetails.innerHTML = [
      '<div class="cost-status-banner">',
      renderCostStateChip("trust checks", "neutral"),
      "<strong>Can this baked view be trusted right now?</strong>",
      '<div class="small">These are freshness and integrity checks for the snapshot itself, not a live uptime probe.</div>',
      "</div>",
      rows
        .map(function (row) {
          return renderCostDetailCard({
            eyebrow: row.label,
            valueHtml: row.chip,
            copy: row.note,
          })
        })
        .join(""),
    ].join("")
  }

  function renderObservabilityQueryPack(report) {
    if (!els.costTopRoutes) return
    var launchpad = (
      Array.isArray(report && report.launchpad) ? report.launchpad.slice() : []
    ).filter(function (item) {
      return (
        String((item && item.label) || "")
          .toLowerCase()
          .indexOf("billing") < 0
      )
    })
    function hasLaunchpadLabel(text) {
      var needle = String(text || "").toLowerCase()
      return launchpad.some(function (item) {
        return (
          String((item && item.label) || "")
            .toLowerCase()
            .indexOf(needle) >= 0
        )
      })
    }
    var dashboardBase = ""
    launchpad.forEach(function (item) {
      var href = String((item && item.href) || "")
      var marker = "https://dash.cloudflare.com/?to=/"
      if (!dashboardBase && href.indexOf(marker) === 0) {
        var afterMarker = href.slice(marker.length)
        var account = afterMarker.split("/")[0] || ""
        if (account) dashboardBase = marker + account
      }
    })
    function dashboardHref(path) {
      return dashboardBase ? dashboardBase + String(path || "") : String(path || "#")
    }
    ;[
      {
        key: "workers",
        label: "Workers & Pages usage",
        href: dashboardHref("/workers-and-pages"),
        note: "Worker requests, CPU time, observability events, and build minutes. This is a free-plan quota page.",
      },
      {
        key: "kv",
        label: "Workers KV usage",
        href: dashboardHref("/workers/kv/namespaces"),
        note: "KV reads, writes, deletes, lists, and storage.",
      },
      {
        key: "queues",
        label: "Queues usage",
        href: dashboardHref("/workers/queues"),
        note: "Queue operations, queued messages, backlog, lag, and retry pressure.",
      },
      {
        key: "r2",
        label: "R2 status",
        href: dashboardHref("/r2/overview"),
        note: "R2 is not active for current Iconoplasm portrait storage, but the account status should stay visible.",
      },
    ].forEach(function (item) {
      if (!hasLaunchpadLabel(item.key)) launchpad.push(item)
    })
    var attribution = report && report.budgetAttribution ? report.budgetAttribution : {}
    var topRequestRoutes = Array.isArray(attribution && attribution.cycleTopRequestRoutes)
      ? attribution.cycleTopRequestRoutes
      : []
    var topRoutes = Array.isArray(attribution && attribution.cycleTopRoutes)
      ? attribution.cycleTopRoutes
      : []
    var currentDay = attribution && attribution.currentDay ? attribution.currentDay : {}
    var cycleTotals = attribution && attribution.cycleTotals ? attribution.cycleTotals : {}
    var sections = []

    if (topRequestRoutes.length || topRoutes.length) {
      var primaryRoutes = topRequestRoutes.length ? topRequestRoutes : topRoutes
      var attributionTone =
        safeNum(currentDay.telemetryLockedEvents) > 0
          ? "danger"
          : safeNum(currentDay.targetCapReachedEvents) > 0
            ? "warn"
            : "ok"
      var attributionSummaryLabel =
        safeNum(currentDay.telemetryLockedEvents) > 0
          ? "telemetry locked seen"
          : safeNum(currentDay.targetCapReachedEvents) > 0
            ? "cap pressure seen"
            : "routes baked"
      sections.push(
        [
          '<div class="cost-status-banner">',
          renderCostStateChip(attributionSummaryLabel, attributionTone),
          "<strong>Top routes burning request allowance</strong>",
          '<div class="small">',
          esc(
            String(
              (attribution && attribution.note) ||
                "Detailed route attribution is unavailable in this bake.",
            ),
          ),
          " ",
          esc(
            compactMetricNumber(cycleTotals.requestCount || 0) +
              " route log event(s) in-cycle. Today: " +
              compactMetricNumber(currentDay.requestCount || 0) +
              " route log event(s).",
          ),
          "</div>",
          "</div>",
          '<table class="cost-table">',
          "<thead><tr><th>Route</th><th>Outcome</th><th>Requests</th><th>Status</th><th>Context</th></tr></thead>",
          "<tbody>",
          primaryRoutes
            .map(function (row) {
              var contextBits = [
                row && row.budgetClass ? String(row.budgetClass) : "",
                row && row.sourceClass ? String(row.sourceClass) : "",
                row && row.actorClass ? String(row.actorClass) : "",
              ].filter(Boolean)
              if (row && row.latestAt)
                contextBits.push("last " + formatTimestampShort(row.latestAt))
              return [
                "<tr>",
                "<td><strong>" +
                  esc(displayRouteFamily(row && row.routeFamily)) +
                  '</strong><div class="small">Workers Observability route log</div></td>',
                "<td>" +
                  renderCostStateChip(
                    String((row && row.outcomeClass) || "unknown"),
                    String((row && row.outcomeClass) || "").indexOf("error") >= 0
                      ? "danger"
                      : String((row && row.outcomeClass) || "") === "limited"
                        ? "warn"
                        : "ok",
                  ) +
                  "</td>",
                "<td>" + esc(compactMetricNumber((row && row.requestCount) || 0)) + "</td>",
                "<td>" +
                  esc(row && row.responseStatus ? String(row.responseStatus) : "mixed") +
                  "</td>",
                "<td>" + esc(contextBits.join(" · ") || "No extra context baked.") + "</td>",
                "</tr>",
              ].join("")
            })
            .join(""),
          "</tbody>",
          "</table>",
        ].join(""),
      )
    } else if (attribution && attribution.available === false && attribution.note) {
      sections.push(
        '<div class="cost-empty-note">' +
          esc(
            String(
              attribution.note ||
                "Workers Observability route attribution is not available in this bake yet.",
            ),
          ) +
          "</div>",
      )
    }

    if (launchpad.length) {
      sections.push(
        [
          '<table class="cost-table">',
          "<thead><tr><th>Cloudflare view</th><th>Open when</th></tr></thead>",
          "<tbody>",
          launchpad
            .map(function (item) {
              return [
                "<tr>",
                '<td><a href="' +
                  esc((item && item.href) || "#") +
                  '" target="_blank" rel="noreferrer">' +
                  esc((item && item.label) || "Cloudflare dashboard") +
                  "</a></td>",
                "<td>" + esc((item && item.note) || "") + "</td>",
                "</tr>",
              ].join("")
            })
            .join(""),
          "</tbody>",
          "</table>",
          '<div class="small">Use Cloudflare links as drilldown, not as the primary dashboard. On a zero-dollar account, product usage pages are the quota record.</div>',
        ].join(""),
      )
    }

    if (!sections.length) {
      els.costTopRoutes.innerHTML =
        '<div class="cost-empty-note">No baked route attribution or Cloudflare drilldown links are available yet.</div>'
      return
    }

    els.costTopRoutes.innerHTML = sections.join("")
  }

  // Chesterton's fence:
  // This panel exists because we deliberately retired the old request-path
  // usage meter. That old path looked authoritative, but it was an
  // app-owned telemetry story sitting in the blast radius of the product
  // itself.
  //
  // The replacement has to preserve both constraints at once:
  // 1) do not generate observability load from the admin page itself, and
  // 2) still show real at-a-glance accountability in the UI.
  //
  // If this panel drifts into "just links" or "just a runbook", we have
  // recreated the exact regression that triggered the refactor. Cloudflare
  // links are drilldown escape hatches, not the primary content. Keep the
  // baked D1 budget math, attribution, durable-object summary, and the
  // zero-dollar free-plan pressure map visible in the page itself.
  // Cloudflare Billing can be blank on the free plan; product quota pages
  // are the operational source of truth for this account.
  function renderCostUsage(report) {
    if (state.activeTab !== "costs") return
    var snapshot = report && typeof report === "object" ? report : {}
    var freshness = snapshot && snapshot.freshness ? snapshot.freshness : {}
    var d1 = snapshot && snapshot.d1 ? snapshot.d1 : {}
    var currentDay = d1 && d1.currentDay ? d1.currentDay : {}
    var cycleTotals = d1 && d1.cycleTotals ? d1.cycleTotals : {}
    var lastDailyBucket = d1 && d1.lastDailyBucket ? d1.lastDailyBucket : null
    var daily = Array.isArray(d1 && d1.daily) ? d1.daily : []
    var automation = snapshot && snapshot.automation ? snapshot.automation : {}
    var durableObjects = snapshot && snapshot.durableObjects ? snapshot.durableObjects : {}
    var durableObjectTotals = durableObjects && durableObjects.totals ? durableObjects.totals : {}
    var latestDayKey = currentDay.date || (lastDailyBucket && lastDailyBucket.date) || ""
    var cycleRangeLabel =
      formatMonthDay(d1.cycleStartDate) +
      " → " +
      formatMonthDay(d1.nextCycleStartDate || d1.cycleEndDate)
    var windowCoverageLabel =
      String(safeNum(automation.filledWindowDays)) +
      "/" +
      String(safeNum(automation.rollingWindowDays || d1.expectedWindowDays || 0)) +
      " days"
    var cycleReadLimit = safeNum(cycleTotals.rowsReadMonthlyLimit)
    var todayReadLimit = safeNum(currentDay.rowsReadDailySmartLimit)
    var durableObjectRequests = safeNum(durableObjectTotals.requests)
    var durableObjectErrors = safeNum(durableObjectTotals.errors)
    var durableObjectErrorRate =
      durableObjectRequests > 0
        ? formatRatioPercent(durableObjectErrors, durableObjectRequests)
        : "—"
    var trendRows = daily.map(function (row) {
      return {
        day_key: row && row.date ? row.date : "",
        rows_read: safeNum(row && row.rowsRead),
        rows_read_daily_smart_limit: safeNum(row && row.rowsReadDailySmartLimit),
      }
    })

    if (els.costContextStrip) {
      els.costContextStrip.innerHTML = [
        '<span class="cost-context-pill"><strong>Scope</strong>budget + platform signals</span>',
        '<span class="cost-context-pill"><strong>Cycle</strong>' + esc(cycleRangeLabel) + "</span>",
        '<span class="cost-context-pill"><strong>Latest day</strong>' +
          esc(latestDayKey ? formatMonthDay(latestDayKey) : "missing") +
          "</span>",
        '<span class="cost-context-pill"><strong>Window</strong>' +
          esc(windowCoverageLabel) +
          "</span>",
      ].join("")
    }

    if (els.costMetrics) {
      els.costMetrics.innerHTML = [
        {
          label: "Freshness",
          value: String(freshness.headline || "Unknown"),
          note: String(freshness.detail || "No bake timestamp yet."),
        },
        {
          label: "Cycle",
          value: cycleRangeLabel,
          note: String(safeNum(d1.daysRemainingInCycle || 0)) + " day(s) left.",
        },
        {
          label: "D1 reads",
          value:
            todayReadLimit > 0
              ? compactMetricNumber(currentDay.rowsRead) +
                " / " +
                compactMetricNumber(todayReadLimit)
              : compactMetricNumber(currentDay.rowsRead),
          note: currentDay.covered ? formatMonthDay(currentDay.date) : "bucket missing",
        },
        {
          label: "DO traffic",
          value: compactMetricNumber(durableObjectRequests),
          note:
            durableObjectErrors > 0
              ? compactMetricNumber(durableObjectErrors) + " errors · " + durableObjectErrorRate
              : "no errors baked",
        },
      ]
        .map(function (metric) {
          return [
            '<article class="cost-metric">',
            '<div class="cost-metric-label">' + esc(metric.label) + "</div>",
            '<div class="cost-metric-value">' + esc(metric.value) + "</div>",
            '<div class="cost-metric-note">' + esc(metric.note) + "</div>",
            "</article>",
          ].join("")
        })
        .join("")
    }

    if (els.costTrendMeta) {
      els.costTrendMeta.textContent = latestDayKey ? formatMonthDay(latestDayKey) : "missing"
    }

    if (els.costReadTrend) {
      els.costReadTrend.innerHTML = trendRows.length
        ? buildCostTrendSvg(trendRows, {
            rows_read_daily_smart_limit: safeNum(currentDay.rowsReadDailySmartLimit),
          })
        : inlineFailureMarkup(
            "No D1 read history yet",
            "The baked snapshot did not include D1 daily buckets for this window.",
          )
      if (trendRows.length) bindCostTrendHover()
    }

    if (els.costD1WriteAdaptiveChart)
      els.costD1WriteAdaptiveChart.innerHTML = buildD1WriteAdaptiveSvg(snapshot)
    if (els.costWorkerLimiterChart)
      els.costWorkerLimiterChart.innerHTML = buildWorkerLimiterTrafficSvg(snapshot)
    if (els.costDoTrafficChart)
      els.costDoTrafficChart.innerHTML = buildDurableObjectTrafficSvg(snapshot)
    var quotaSeries = quotaCeilingSeries(snapshot)
    renderQuotaCeiling(els.costD1QueryVolumeChart, quotaSeries.workers_requests)
    renderQuotaCeiling(els.costD1ResponseBytesChart, quotaSeries.kv_reads)
    renderQuotaCeiling(els.costD1LatencyChart, quotaSeries.kv_writes)
    renderQuotaCeiling(els.costD1StorageChart, quotaSeries.kv_deletes)
    renderQuotaCeiling(els.costDoActivityMixChart, quotaSeries.kv_lists)
    renderQuotaCeiling(els.costProductSmallMultiples, quotaSeries.queues_ops)
    renderQuotaCeiling(els.costLimitRatioHeatmap, quotaSeries.d1_storage)
    renderQuotaCeiling(els.costSensorCoverageMatrix, quotaSeries.pages_functions, {
      emptyTitle: "Pages Functions not separated yet",
      emptyMessage:
        "Workers usage is baked, but Pages Functions does not have a separate daily series in this snapshot.",
    })
    renderQuotaCeiling(els.costOverageMagnitudePlot, quotaSeries.workers_observability, {
      emptyTitle: "Workers observability not baked yet",
      emptyMessage:
        "Cloudflare exposes a free-plan observability-event ceiling; this snapshot still lacks the daily usage series.",
    })
    renderQuotaCeiling(els.costDailyBurnCalendar, quotaSeries.r2_class_b, {
      emptyTitle: "R2 Class B inactive",
      emptyMessage:
        "R2 is inactive for Iconoplasm portraits, so this ceiling stays visibly unmonitored instead of hidden.",
    })
    renderQuotaCeiling(els.costQueueBacklogChart, quotaSeries.kv_storage)
    renderQuotaCeiling(els.costHeadroomSlopeChart, quotaSeries.r2_storage, {
      emptyTitle: "R2 storage inactive",
      emptyMessage:
        "R2 is inactive for Iconoplasm portraits, so there is no storage timeline to plot.",
    })
    renderQuotaCeiling(els.costSnapshotIntegrityChart, quotaSeries.r2_class_a, {
      emptyTitle: "R2 Class A inactive",
      emptyMessage:
        "R2 is inactive for Iconoplasm portraits, so there is no Class A operations timeline to plot.",
    })
    if (els.costEventOverlayChart)
      els.costEventOverlayChart.innerHTML = buildIntegritySignalSvg(snapshot)
    if (els.costUnknownSeries) els.costUnknownSeries.innerHTML = buildUnknownSeriesSvg(snapshot)
    if (els.costRequestDistributionChart)
      els.costRequestDistributionChart.innerHTML = buildRequestDistributionSvg(snapshot)
    renderObservabilityRunbook(snapshot)
    renderObservabilityQueryPack(snapshot)
  }

  function renderCostObservabilityNotice(payload) {
    renderCostUsage(payload || {})
  }

  async function refreshCostUsage() {
    if (els.costRefresh) els.costRefresh.disabled = true
    if (els.costUpdatedAt) {
      els.costUpdatedAt.textContent = state.costLoaded
        ? "Reloading baked Cloudflare snapshot…"
        : "Loading baked Cloudflare snapshot…"
    }
    try {
      // Chesterton's fence:
      // This request reads only the already-baked snapshot payload.
      // Pulling live telemetry here would recreate the exact budget hazard we
      // retired: admin observability generating its own observability load.
      // The authenticated endpoint reads one atomically-published KV value,
      // with the deploy-time constant as a fallback. It performs no D1, DO,
      // GraphQL, or Cloudflare analytics queries.
      var payload = await apiJson("/cost/snapshot?ts=" + encodeURIComponent(String(Date.now())), {
        method: "GET",
        headers: {
          "Cache-Control": "no-store",
        },
      })
      if (!payload || !payload.snapshot || typeof payload.snapshot !== "object") {
        throw new Error("Snapshot endpoint returned no snapshot payload.")
      }
      var report = payload.snapshot
      state.costLoaded = true
      state.costReport = report
      renderCostUsage(report)
      if (els.costUpdatedAt) {
        var freshness = report && report.freshness ? report.freshness : {}
        var publication = report && report.publication ? report.publication : {}
        els.costUpdatedAt.textContent =
          String(freshness.headline || "Snapshot unavailable") +
          (Number.isFinite(Number(freshness.ageMinutes))
            ? " · " + String(freshness.ageMinutes) + " min old"
            : "") +
          (publication.state ? " · " + String(publication.state).replace("_", " ") : "")
      }
    } catch (err) {
      if (isRequestCanceled(err)) return
      state.costLoaded = false
      if (els.costUpdatedAt)
        els.costUpdatedAt.textContent = "Snapshot unavailable · publication endpoint failed"
      if (els.costMetrics)
        els.costMetrics.innerHTML = inlineFailureMarkup(
          "Snapshot load failed",
          requestErrorMessage(err, "Snapshot load failed."),
        )
      if (els.costSnapshotTrustChart) els.costSnapshotTrustChart.innerHTML = ""
      if (els.costSnapshotTrustDetails) els.costSnapshotTrustDetails.innerHTML = ""
      if (els.costReadTrend) els.costReadTrend.innerHTML = ""
      if (els.costD1WriteAdaptiveChart) els.costD1WriteAdaptiveChart.innerHTML = ""
      if (els.costWorkerLimiterChart) els.costWorkerLimiterChart.innerHTML = ""
      if (els.costDoTrafficChart) els.costDoTrafficChart.innerHTML = ""
      if (els.costD1QueryVolumeChart) els.costD1QueryVolumeChart.innerHTML = ""
      if (els.costD1ResponseBytesChart) els.costD1ResponseBytesChart.innerHTML = ""
      if (els.costD1LatencyChart) els.costD1LatencyChart.innerHTML = ""
      if (els.costD1StorageChart) els.costD1StorageChart.innerHTML = ""
      if (els.costDoActivityMixChart) els.costDoActivityMixChart.innerHTML = ""
      if (els.costProductSmallMultiples) els.costProductSmallMultiples.innerHTML = ""
      if (els.costLimitRatioHeatmap) els.costLimitRatioHeatmap.innerHTML = ""
      if (els.costSensorCoverageMatrix) els.costSensorCoverageMatrix.innerHTML = ""
      if (els.costOverageMagnitudePlot) els.costOverageMagnitudePlot.innerHTML = ""
      if (els.costDailyBurnCalendar) els.costDailyBurnCalendar.innerHTML = ""
      if (els.costQueueBacklogChart) els.costQueueBacklogChart.innerHTML = ""
      if (els.costHeadroomSlopeChart) els.costHeadroomSlopeChart.innerHTML = ""
      if (els.costSnapshotIntegrityChart) els.costSnapshotIntegrityChart.innerHTML = ""
      if (els.costEventOverlayChart) els.costEventOverlayChart.innerHTML = ""
      if (els.costUnknownSeries) els.costUnknownSeries.innerHTML = ""
      if (els.costRequestDistributionChart) els.costRequestDistributionChart.innerHTML = ""
      if (els.costTopRoutes) els.costTopRoutes.innerHTML = ""
      if (els.costUpdatedAt)
        els.costUpdatedAt.textContent = requestErrorMessage(err, "Snapshot load failed.")
      setLog({
        error: "Snapshot load failed",
        details: err.response || requestErrorMessage(err, "Snapshot load failed."),
      })
    } finally {
      if (els.costRefresh) els.costRefresh.disabled = false
    }
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false
    var tag = String(target.tagName || "").toLowerCase()
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "option") return true
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  function preloadImage(url) {
    var safeUrl = String(url || "").trim()
    if (!safeUrl || state.preloadedImageUrls[safeUrl]) return
    state.preloadedImageUrls[safeUrl] = true
    try {
      var img = new Image()
      img.decoding = "async"
      img.src = safeUrl
    } catch {}
  }

  function normalizeVisionId(value) {
    return String(value || "").trim()
  }

  function visionDetailLimitForRow(row) {
    var imageCount = Number((row && row.image_count) || 0)
    var boundedLimit = defaultVisionPageSize() === 8 ? 12 : 24
    if (!Number.isFinite(imageCount) || imageCount <= 0) return boundedLimit
    return Math.max(1, Math.min(boundedLimit, Math.round(imageCount)))
  }

  function sortedVisionRows() {
    var sortKey = state.visionSort.key
    var sortDir = state.visionSort.dir === "asc" ? 1 : -1
    return (state.visionStats || []).slice().sort(function (left, right) {
      function label(row) {
        return String(row.artist_name || row.artist_tag || row.vision_id || "")
      }
      if (sortKey === "vision") return label(left).localeCompare(label(right)) * sortDir
      if (sortKey === "images")
        return (Number(left.image_count || 0) - Number(right.image_count || 0)) * sortDir
      if (sortKey === "score")
        return (Number(left.avg_vote || 0) - Number(right.avg_vote || 0)) * sortDir
      if (sortKey === "rejection")
        return (Number(left.rejection_rate || 0) - Number(right.rejection_rate || 0)) * sortDir
      var byLive = (Number(left.live_count || 0) - Number(right.live_count || 0)) * sortDir
      if (byLive) return byLive
      return label(left).localeCompare(label(right)) * sortDir
    })
  }

  function visibleVisionRows() {
    var rows = sortedVisionRows()
    var pageSize = Math.max(
      1,
      Number.parseInt(String(state.visionPageSize || defaultVisionPageSize()), 10) ||
        defaultVisionPageSize(),
    )
    var totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
    state.visionPage = clampVisionPage(state.visionPage, totalPages)
    var start = (state.visionPage - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }

  function findSelectedVisionAsset(detail) {
    var assets = Array.isArray(detail && detail.assets) ? detail.assets : []
    if (!assets.length) return null
    var preferredSha = String(state.selectedVisionAssetSha || "").toLowerCase()
    if (preferredSha) {
      var selected = assets.find(function (asset) {
        return String(asset.asset_sha256 || "").toLowerCase() === preferredSha
      })
      if (selected) return selected
    }
    return assets[0] || null
  }

  function currentVisionAssetIndex(detail) {
    var assets = Array.isArray(detail && detail.assets) ? detail.assets : []
    if (!assets.length) return 0
    var selected = findSelectedVisionAsset(detail)
    var index = selected
      ? assets.findIndex(function (asset) {
          return asset.asset_sha256 === selected.asset_sha256
        })
      : 0
    return index >= 0 ? index : 0
  }

  function mergeVisionAssets(previewAssets, detailAssets) {
    var bySha = {}
    var merged = []
    ;(Array.isArray(previewAssets) ? previewAssets : [])
      .concat(Array.isArray(detailAssets) ? detailAssets : [])
      .forEach(function (asset) {
        var sha = String((asset && asset.asset_sha256) || "").toLowerCase()
        if (!sha) return
        if (!bySha[sha]) {
          bySha[sha] = Object.assign({}, asset)
          merged.push(bySha[sha])
        } else {
          Object.assign(bySha[sha], asset)
        }
      })
    return merged
  }

  function writeVisionDetailCache(visionId, detail) {
    var cleanedVisionId = normalizeVisionId(visionId)
    if (!cleanedVisionId || !detail || !detail.vision) return null
    var mergedDetail = {
      vision: Object.assign({}, detail.vision),
      assets: mergeVisionAssets(state.visionPreviewMap[cleanedVisionId] || [], detail.assets || []),
    }
    state.visionDetailCache[cleanedVisionId] = {
      vision: Object.assign({}, mergedDetail.vision),
      assets: mergedDetail.assets.map(function (asset) {
        return Object.assign({}, asset)
      }),
    }
    return mergedDetail
  }

  function visionArtistId(value) {
    var artistId =
      displayEmulsionCode(value && value.emulsion_id) ||
      String((value && value.artist_id) || "").trim()
    if (artistId) return artistId
    return ""
  }

  function displayEmulsionCode(rawEmulsionId) {
    return String(rawEmulsionId || "").trim()
  }

  function seedVisionDetailFromPreview(row, assetSha) {
    if (!row || !row.vision_id) return false
    var previewAssets = state.visionPreviewMap[row.vision_id] || []
    if (!previewAssets.length) return false
    state.selectedVisionDetail = {
      vision: Object.assign({}, row),
      assets: mergeVisionAssets(previewAssets, []),
    }
    state.selectedVisionAssetSha = String(
      assetSha || state.selectedVisionAssetSha || previewAssets[0].asset_sha256 || "",
    )
    renderVisionCleanupPanel()
    return true
  }

  function preloadVisionNeighbors(detail) {
    var assets = Array.isArray(detail && detail.assets) ? detail.assets : []
    if (!assets.length) return
    var currentIndex = currentVisionAssetIndex(detail)
    ;[currentIndex, currentIndex - 1, currentIndex + 1].forEach(function (index) {
      if (index < 0 || index >= assets.length) return
      var asset = assets[index]
      preloadImage(asset && (asset.medium_url || asset.hero_url || asset.thumb_url))
    })
  }

  function setSelectedVisionAsset(assetSha) {
    var cleaned = String(assetSha || "").trim()
    if (!cleaned || !state.selectedVisionDetail) return
    state.selectedVisionAssetSha = cleaned
    renderVisionCleanupPanel()
    renderVisionStats()
    preloadVisionNeighbors(state.selectedVisionDetail)
  }

  function navigateSelectedVisionAsset(delta) {
    var detail = state.selectedVisionDetail
    var assets = Array.isArray(detail && detail.assets) ? detail.assets : []
    if (assets.length <= 1) return
    var currentIndex = currentVisionAssetIndex(detail)
    var nextIndex = (currentIndex + delta + assets.length) % assets.length
    setSelectedVisionAsset(assets[nextIndex].asset_sha256 || "")
  }

  function selectRelativeVision(delta) {
    var rows = visibleVisionRows()
    if (!rows.length) return
    var currentId = String(state.selectedVisionId || "")
    var currentIndex = rows.findIndex(function (row) {
      return String(row.vision_id || "") === currentId
    })
    if (currentIndex < 0) currentIndex = 0
    var nextIndex = currentIndex + delta
    if (nextIndex < 0 || nextIndex >= rows.length) return
    var nextRow = rows[nextIndex]
    var previewAssets = state.visionPreviewMap[nextRow.vision_id] || []
    var assetIndex = currentVisionAssetIndex(state.selectedVisionDetail)
    var nextAsset =
      previewAssets[Math.min(assetIndex, Math.max(0, previewAssets.length - 1))] ||
      previewAssets[0] ||
      null
    refreshVisionDetail(nextRow.vision_id, {
      assetSha: nextAsset ? nextAsset.asset_sha256 : undefined,
    }).catch(function (err) {
      setLog({
        error: "Vision detail failed",
        details: err.response || requestErrorMessage(err, "Vision detail failed."),
      })
    })
  }

  function currentVisionContext() {
    var detail = state.selectedVisionDetail
    var vision = detail && detail.vision ? detail.vision : null
    var asset = findSelectedVisionAsset(detail)
    return { vision: vision, asset: asset }
  }

  function visionRowById(visionId) {
    var cleanedVisionId = String(visionId || "").trim()
    if (!cleanedVisionId) return null
    return (
      (state.visionStats || []).find(function (row) {
        return String((row && row.vision_id) || "") === cleanedVisionId
      }) || null
    )
  }

  function renderVisionQuickActions() {
    if (state.activeTab !== "styles") return
    var context = currentVisionContext()
    var vision = context.vision
    var asset = context.asset
    if (els.visionQuickContext) {
      els.visionQuickContext.innerHTML = vision
        ? [
            "<strong>" +
              esc(
                vision.artist_name || vision.artist_tag || vision.vision_id || "Selected artist",
              ) +
              "</strong>",
            '<span class="small mono">' +
              esc(vision.artist_tag || vision.vision_id || "") +
              "</span>",
            asset && asset.gene_symbol
              ? '<span class="small">Current gene: ' + esc(asset.gene_symbol) + "</span>"
              : "",
            '<span class="small">Use the public blocklist form to block this artist tag across the site. Use gene review for one-off image cleanup.</span>',
          ]
            .filter(Boolean)
            .join(" · ")
        : "Select an artist to inspect details. This tab is for artist-tag blocklisting. Use gene review when only one image is bad."
    }
    if (els.visionOpenCurrentGene) {
      els.visionOpenCurrentGene.disabled = !(asset && asset.gene_symbol)
      els.visionOpenCurrentGene.textContent =
        asset && asset.gene_symbol ? "Open " + asset.gene_symbol : "Open current gene"
    }
    if (els.visionCopyCurrentTag) {
      els.visionCopyCurrentTag.disabled = !(vision && (vision.artist_tag || vision.vision_id))
      els.visionCopyCurrentTag.textContent =
        vision && (vision.artist_tag || vision.vision_id) ? "Copy artist tag" : "Copy artist tag"
    }
  }

  async function openVisionGene(symbol) {
    var detailSymbol = String(symbol || "").trim()
    if (!detailSymbol) return
    els.status.value = "all"
    els.stale.value = "name"
    els.search.value = detailSymbol
    setActiveTab("archive")
    refreshAssets()
    refreshGeneDetail(detailSymbol).catch(function (err) {
      setLog({
        error: "Gene detail failed",
        details: err.response || requestErrorMessage(err, "Gene detail failed."),
      })
    })
  }

  function renderVisionPreviewButton(visionId, asset, active) {
    if (!asset || !asset.thumb_url) return ""
    var label = String(asset.gene_symbol || "gene")
    var titleParts = [label]
    if (asset.artist_name || asset.artist_tag)
      titleParts.push(String(asset.artist_name || asset.artist_tag))
    if (asset.status) titleParts.push(String(asset.status))
    return [
      '<button class="vision-preview-button' + (active ? " is-active" : "") + '"',
      ' type="button"',
      ' data-vision-open="' + esc(visionId || "") + '"',
      ' data-vision-asset="' + esc(asset.asset_sha256 || "") + '"',
      ' title="' + esc(titleParts.join(" · ")) + '">',
      '<img src="' +
        esc(asset.thumb_url) +
        '" alt="' +
        esc(label + " preview") +
        '" loading="lazy" />',
      '<span class="vision-preview-gene">' + esc(label) + "</span>",
      "</button>",
    ].join("")
  }

  function renderVisionPreviewCell(row) {
    var visionId = String((row && row.vision_id) || "")
    var assets = state.visionPreviewMap[visionId] || []
    var loading = Boolean(state.loadingVisionPreviewIds[visionId])
    if (!assets.length) {
      return (
        '<div class="vision-preview-empty">' +
        esc(loading ? "Loading examples…" : "Examples appear here.") +
        "</div>"
      )
    }
    var html = assets
      .map(function (asset) {
        return renderVisionPreviewButton(
          visionId,
          asset,
          state.selectedVisionAssetSha === asset.asset_sha256 &&
            state.selectedVisionId === visionId,
        )
      })
      .join("")
    var moreCount = Math.max(0, Number(row.image_count || 0) - assets.length)
    if (moreCount > 0) {
      html +=
        '<button class="vision-preview-more" type="button" data-vision-open="' +
        esc(visionId) +
        '">+' +
        esc(String(moreCount)) +
        "</button>"
    }
    return '<div class="vision-preview-strip">' + html + "</div>"
  }

  function renderVisionEmulsionCell(row) {
    var id = visionArtistId(row)
    if (!id) return '<div class="vision-preview-empty">—</div>'
    return (
      '<div class="vision-emulsion-stack"><span class="vision-emulsion-chip mono">' +
      esc(id) +
      "</span></div>"
    )
  }

  function renderVisionCleanupPanel() {
    if (state.activeTab !== "styles") return
    if (!els.visionCleanupPanel) return
    var detail = state.selectedVisionDetail
    if (!detail || !detail.vision) {
      if (els.visionCleanupSummary) {
        els.visionCleanupSummary.textContent = "Click a row or thumbnail to inspect this artist."
      }
      els.visionCleanupPanel.innerHTML = [
        '<div class="detail-kicker">Artist workbench</div>',
        '<div class="detail-title">Pick a vision</div>',
        '<div class="detail-copy">The scorecard can now open straight into this side panel. Pick a row to compare that artist across genes, scrub left and right, and run quick actions without leaving the table.</div>',
      ].join("")
      renderVisionQuickActions()
      return
    }

    var vision = detail.vision
    var assets = Array.isArray(detail.assets) ? detail.assets : []
    var selectedAsset = findSelectedVisionAsset(detail)
    state.selectedVisionAssetSha = selectedAsset ? String(selectedAsset.asset_sha256 || "") : ""
    preloadVisionNeighbors(detail)

    var currentIndex = currentVisionAssetIndex(detail)
    var selectedBadges = []
    if (vision.blacklisted)
      selectedBadges.push('<span class="badge-pill badge-mismatch">Blacklisted</span>')
    if (selectedAsset && selectedAsset.is_current)
      selectedBadges.push('<span class="badge-pill badge-live">Canonical</span>')
    if (selectedAsset && selectedAsset.status === "rejected")
      selectedBadges.push('<span class="badge-pill badge-missing">Rejected</span>')
    if (selectedAsset && selectedAsset.is_stale)
      selectedBadges.push('<span class="badge-pill badge-stale">Stale</span>')

    if (els.visionCleanupSummary) {
      els.visionCleanupSummary.textContent = String(
        vision.artist_name || vision.artist_tag || vision.vision_id || "Selected vision",
      )
    }

    els.visionCleanupPanel.innerHTML = [
      '<div class="detail-kicker">Artist workbench</div>',
      '<div class="vision-panel-header">',
      '<div class="detail-title">' +
        esc(vision.artist_name || vision.artist_tag || vision.vision_id || "Unknown vision") +
        "</div>",
      '<div class="small mono">' + esc(vision.artist_tag || vision.vision_id || "") + "</div>",
      '<div class="badge-row">' + selectedBadges.join("") + "</div>",
      "</div>",
      '<div class="vision-panel-frame">',
      selectedAsset && selectedAsset.medium_url
        ? '<img src="' +
          esc(selectedAsset.medium_url) +
          '" alt="Selected artist example" loading="eager" fetchpriority="high" />'
        : '<div class="gallery-empty gallery-empty--media">No preview available</div>',
      "</div>",
      '<div class="vision-panel-nav">',
      '<button type="button" data-vision-nav="prev"' +
        (assets.length <= 1 ? " disabled" : "") +
        ">Prev</button>",
      '<span class="pager-status mono">' +
        esc(assets.length ? "Image " + (currentIndex + 1) + " of " + assets.length : "No images") +
        "</span>",
      '<button type="button" data-vision-nav="next"' +
        (assets.length <= 1 ? " disabled" : "") +
        ">Next</button>",
      "</div>",
      selectedAsset
        ? [
            '<div class="vision-panel-meta">',
            '<div><button class="vision-gene-link" type="button" data-vision-detail-action="open-gene" data-symbol="' +
              esc(selectedAsset.gene_symbol || "") +
              '"><strong>' +
              esc(selectedAsset.gene_symbol || "Unknown gene") +
              "</strong></button> · " +
              esc(selectedAsset.status || "draft") +
              "</div>",
            '<div class="small">score ' +
              esc(String(selectedAsset.score || 0)) +
              " · +" +
              esc(String(selectedAsset.upvotes || 0)) +
              " / -" +
              esc(String(selectedAsset.downvotes || 0)) +
              " · " +
              esc(String(selectedAsset.width || "?")) +
              "×" +
              esc(String(selectedAsset.height || "?")) +
              "</div>",
            visionArtistId(vision)
              ? '<div class="small mono">Emulsion ' + esc(visionArtistId(vision)) + "</div>"
              : "",
            '<div class="small mono">' + esc(shortSha(selectedAsset.asset_sha256 || "")) + "</div>",
            "</div>",
            '<div class="vision-panel-actions">',
            '<button class="btn-flat" type="button" data-vision-detail-action="copy" data-sha="' +
              esc(selectedAsset.asset_sha256 || "") +
              '">Copy SHA</button>',
            '<button class="btn-flat" type="button" data-vision-detail-action="open-gene" data-symbol="' +
              esc(selectedAsset.gene_symbol || "") +
              '">Open gene review</button>',
            !selectedAsset.is_current && selectedAsset.status !== "rejected"
              ? '<button class="btn-primary" type="button" data-vision-detail-action="publish" data-symbol="' +
                esc(selectedAsset.gene_symbol || "") +
                '" data-sha="' +
                esc(selectedAsset.asset_sha256 || "") +
                '">Make canonical</button>'
              : "",
            selectedAsset.status !== "rejected"
              ? '<button class="btn-danger" type="button" data-vision-detail-action="reject" data-symbol="' +
                esc(selectedAsset.gene_symbol || "") +
                '" data-sha="' +
                esc(selectedAsset.asset_sha256 || "") +
                '">Reject image</button>'
              : "",
            selectedAsset.is_stale
              ? '<button type="button" data-vision-detail-action="unstale" data-symbol="' +
                esc(selectedAsset.gene_symbol || "") +
                '" data-sha="' +
                esc(selectedAsset.asset_sha256 || "") +
                '">Restore image</button>'
              : "",
            "</div>",
          ].join("")
        : "",
      '<div class="vision-stat-grid">',
      '<article class="vision-stat-card"><span>Images</span><strong>' +
        esc(formatCompactNumber(vision.image_count || 0)) +
        "</strong></article>",
      '<article class="vision-stat-card"><span>Canonical now</span><strong>' +
        esc(formatCompactNumber(vision.live_count || 0)) +
        "</strong></article>",
      '<article class="vision-stat-card"><span>Avg vote</span><strong>' +
        esc(String(Math.round(Number(vision.avg_vote || 0) * 100) / 100)) +
        "</strong></article>",
      '<article class="vision-stat-card"><span>Rejected</span><strong>' +
        esc(String(Math.round(Number(vision.rejection_rate || 0) * 1000) / 10)) +
        "%</strong></article>",
      "</div>",
      vision.blacklist_reason
        ? '<div class="small">Blacklist note: ' + esc(vision.blacklist_reason) + "</div>"
        : "",
      '<div class="detail-kicker">This artist across genes</div>',
      '<div class="vision-panel-strip">' +
        assets
          .map(function (asset) {
            return renderVisionPreviewButton(
              vision.vision_id,
              asset,
              selectedAsset && selectedAsset.asset_sha256 === asset.asset_sha256,
            )
          })
          .join("") +
        "</div>",
      '<div class="vision-artist-actions">',
      '<button class="btn-flat" type="button" data-vision-artist-action="copy-tag">Copy artist tag</button>',
      '<button class="btn-flat" type="button" data-vision-artist-action="open-current-gene"' +
        (selectedAsset && selectedAsset.gene_symbol ? "" : " disabled") +
        ">Open gene page</button>",
      "</div>",
    ].join("")
    renderVisionQuickActions()
  }

  function renderStylesPendingList() {
    if (!els.stylesPending) return
    var pendingRows = (state.pendingBlacklistSubmissions || []).map(function (row) {
      return [
        '<article class="list-row">',
        "<div>",
        "<strong>" +
          esc(row.artist_name_input || row.normalized_input || "Unknown submission") +
          "</strong>",
        '<div class="small mono">Artist tag request from /blocklist</div>',
        '<div class="small">Queued by ' +
          esc(row.requested_by || "unknown") +
          (row.source ? " · " + esc(row.source) : "") +
          "</div>",
        "</div>",
        '<div class="event-meta">' + esc(row.requested_at || "") + "</div>",
        "</article>",
      ].join("")
    })

    els.stylesPending.innerHTML = pendingRows.length
      ? pendingRows.join("")
      : '<article class="list-row"><div><strong>No artist-tag requests waiting.</strong><div class="small">New requests from /blocklist stay here until workstation sync applies them to the site blocklist.</div></div><div></div></article>'
  }

  function renderStylesNotesList() {
    if (!els.stylesNotes) return
    var logRows = (state.blacklistedStyles || []).map(function (row) {
      var showTagLine =
        row.artist_tag &&
        row.artist_name &&
        String(row.artist_tag).toLowerCase() !== String(row.artist_name).toLowerCase()
      return [
        '<article class="list-row">',
        "<div>",
        "<strong>" + esc(row.artist_name || row.artist_tag || "Unknown source") + "</strong>",
        row.artist_tag
          ? '<div class="small mono">' +
            esc(showTagLine ? row.artist_tag : "Artist tag " + row.artist_tag) +
            "</div>"
          : "",
        '<div class="small">' + esc(row.reason || "No reason recorded.") + "</div>",
        "</div>",
        '<div class="event-meta">' + esc(row.updated_at || row.created_at || "") + "</div>",
        "</article>",
      ].join("")
    })

    els.stylesNotes.innerHTML = logRows.length
      ? logRows.join("")
      : '<article class="list-row"><div><strong>No artist tags are blocklisted yet.</strong><div class="small">Once workstation sync applies a request from /blocklist, the site blocklist entry will show up here.</div></div><div></div></article>'
  }

  async function ensureVisibleVisionPreviews(rows) {
    var pageRows = Array.isArray(rows) ? rows : []
    var missingVisionIds = pageRows
      .map(function (row) {
        return String((row && row.vision_id) || "")
      })
      .filter(function (visionId) {
        return (
          visionId && !state.visionPreviewMap[visionId] && !state.loadingVisionPreviewIds[visionId]
        )
      })
    if (!missingVisionIds.length) return
    missingVisionIds.forEach(function (visionId) {
      state.loadingVisionPreviewIds[visionId] = true
    })
    renderVisionStats()
    var requestId = ++state.visionPreviewRequestId
    try {
      var data = await apiJson(
        "/votes/vision-previews?vision_ids=" +
          encodeURIComponent(missingVisionIds.join(",")) +
          "&limit=3",
        { method: "GET" },
      )
      if (requestId !== state.visionPreviewRequestId) return
      ;(Array.isArray(data && data.rows) ? data.rows : []).forEach(function (row) {
        var visionId = String((row && row.vision_id) || "")
        if (!visionId) return
        state.visionPreviewMap[visionId] = Array.isArray(row.assets) ? row.assets : []
      })
    } catch (err) {
      if (isRequestCanceled(err)) return
      setLog({
        error: "Vision preview load failed",
        details: err.response || requestErrorMessage(err, "Preview load failed."),
      })
    } finally {
      missingVisionIds.forEach(function (visionId) {
        delete state.loadingVisionPreviewIds[visionId]
      })
      renderVisionStats()
    }
  }

  async function refreshVisionDetail(visionId, options) {
    var opts = options || {}
    var cleanedVisionId = String(visionId || "").trim()
    if (!cleanedVisionId) return
    var currentRow =
      (state.visionStats || []).find(function (row) {
        return String((row && row.vision_id) || "") === cleanedVisionId
      }) || null
    state.selectedVisionId = cleanedVisionId
    renderVisionStats()
    if (opts.assetSha) state.selectedVisionAssetSha = String(opts.assetSha || "")
    if (!opts.keepDetail) {
      var cached = state.visionDetailCache[cleanedVisionId] || null
      if (cached) {
        state.selectedVisionDetail = {
          vision: Object.assign({}, cached.vision),
          assets: mergeVisionAssets(
            state.visionPreviewMap[cleanedVisionId] || [],
            cached.assets || [],
          ),
        }
        renderVisionCleanupPanel()
      } else if (!seedVisionDetailFromPreview(currentRow, opts.assetSha)) {
        state.selectedVisionDetail = null
        renderVisionCleanupPanel()
      }
    }
    var requestId = ++state.visionDetailRequestId
    try {
      var data = await apiJson(
        "/votes/vision-detail?vision_id=" +
          encodeURIComponent(cleanedVisionId) +
          "&limit=" +
          encodeURIComponent(String(visionDetailLimitForRow(currentRow))),
        { method: "GET" },
      )
      if (requestId !== state.visionDetailRequestId) return
      state.selectedVisionDetail =
        data && data.detail ? writeVisionDetailCache(cleanedVisionId, data.detail) : null
      if (!opts.assetSha) {
        var selectedAsset = findSelectedVisionAsset(state.selectedVisionDetail)
        state.selectedVisionAssetSha = selectedAsset ? String(selectedAsset.asset_sha256 || "") : ""
      }
      renderVisionCleanupPanel()
    } catch (err) {
      if (isRequestCanceled(err)) return
      if (requestId !== state.visionDetailRequestId) return
      state.selectedVisionDetail = null
      renderVisionStats()
      if (els.visionCleanupSummary)
        els.visionCleanupSummary.textContent = "Vision detail unavailable."
      els.visionCleanupPanel.innerHTML = inlineFailureMarkup(
        "Vision detail failed fast",
        requestErrorMessage(err, "Could not load this artist."),
      )
      renderVisionQuickActions()
      setLog({
        error: "Vision detail failed",
        details: err.response || requestErrorMessage(err, "Vision detail failed."),
      })
    }
  }

  function renderVisionStats() {
    if (state.activeTab !== "styles") return
    var sortKey = state.visionSort.key
    var rows = sortedVisionRows()
    var pageSize = Math.max(
      1,
      Number.parseInt(String(state.visionPageSize || defaultVisionPageSize()), 10) ||
        defaultVisionPageSize(),
    )
    var totalRows = rows.length
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
    state.visionPage = clampVisionPage(state.visionPage, totalPages)
    var start = (state.visionPage - 1) * pageSize
    var end = Math.min(totalRows, start + pageSize)
    var pageRows = rows.slice(start, end)

    updateVisionSortButtons()
    if (els.visionStatsMeta) {
      els.visionStatsMeta.innerHTML = totalRows
        ? [
            "<span>showing " + esc(String(start + 1)) + "-" + esc(String(end)) + "</span>",
            "<span>of " + esc(String(totalRows)) + " visions</span>",
            "<span>sorted by " +
              esc(String(sortKey)) +
              " " +
              esc(String(state.visionSort.dir)) +
              "</span>",
          ].join(" &middot; ")
        : "No vision stats yet."
    }
    if (els.visionPageLabel) {
      els.visionPageLabel.textContent = "Page " + state.visionPage + " of " + totalPages
    }
    if (els.visionPageSize) els.visionPageSize.value = String(pageSize)
    if (els.visionPageFirst) els.visionPageFirst.disabled = state.visionPage <= 1
    if (els.visionPagePrev) els.visionPagePrev.disabled = state.visionPage <= 1
    if (els.visionPageNext) els.visionPageNext.disabled = state.visionPage >= totalPages
    if (els.visionPageLast) els.visionPageLast.disabled = state.visionPage >= totalPages

    els.visionStatsList.innerHTML = pageRows.length
      ? pageRows
          .map(function (row) {
            var isSelected = String(state.selectedVisionId || "") === String(row.vision_id || "")
            return [
              '<tr class="vision-table-row' + (isSelected ? " is-selected" : "") + '">',
              '<td><button class="vision-open-btn" type="button" data-vision-open="' +
                esc(row.vision_id || "") +
                '"><strong>' +
                esc(row.artist_name || row.artist_tag || row.vision_id || "Unknown vision") +
                '</strong><span class="small">' +
                esc(row.artist_tag || row.vision_id || "") +
                "</span></button></td>",
              '<td class="vision-preview-cell">' + renderVisionPreviewCell(row) + "</td>",
              '<td class="vision-emulsion-cell">' + renderVisionEmulsionCell(row) + "</td>",
              "<td>" + esc(String(row.image_count || 0)) + "</td>",
              "<td>" + esc(String(Math.round(Number(row.avg_vote || 0) * 100) / 100)) + "</td>",
              "<td>" +
                esc(String(Math.round(Number(row.rejection_rate || 0) * 1000) / 10)) +
                "%</td>",
              "<td>" + esc(String(row.live_count || 0)) + "</td>",
              '<td><div class="actions"><button class="btn-flat" type="button" data-vision-open="' +
                esc(row.vision_id || "") +
                '">Open panel</button>' +
                (row.blacklisted
                  ? '<span class="small">Blacklisted</span>'
                  : '<span class="small">Use public form</span>') +
                "</div></td>",
              "</tr>",
            ].join("")
          })
          .join("")
      : '<tr><td colspan="8">No vision stats yet.</td></tr>'

    ensureVisibleVisionPreviews(pageRows).catch(function (err) {
      setLog({
        error: "Preview hydration failed",
        details: err.response || requestErrorMessage(err, "Preview hydration failed."),
      })
    })

    renderStylesPendingList()
    renderStylesNotesList()
  }

  async function refreshVisionStats() {
    try {
      if (els.visionStatsList) {
        els.visionStatsList.innerHTML = tableFailureMarkup(
          "Loading vision scorecard…",
          "Waiting for the admin read-model endpoints to answer.",
          8,
        )
      }
      var results = await Promise.all([
        apiJson("/votes/vision-stats", { method: "GET" }),
        apiJson("/artist-blacklist-submissions/pending?limit=100", { method: "GET" }),
      ])
      var data = results[0] || {}
      var pendingData = results[1] || {}
      state.visionStats = Array.isArray(data.rows) ? data.rows : []
      state.visionPreviewMap = {}
      state.visionDetailCache = {}
      state.preloadedImageUrls = {}
      state.loadingVisionPreviewIds = {}
      state.blacklistedStyles = Array.isArray(data.blacklisted) ? data.blacklisted : []
      state.pendingBlacklistSubmissions = Array.isArray(pendingData.requests)
        ? pendingData.requests
        : []
      state.visionPage = 1
      renderVisionStats()
    } catch (err) {
      if (isRequestCanceled(err)) return
      var message = requestErrorMessage(err, "Vision stats failed.")
      if (els.visionStatsList) {
        els.visionStatsList.innerHTML = tableFailureMarkup(
          "Vision scorecard failed fast",
          message,
          8,
        )
      }
      if (els.visionStatsMeta) {
        els.visionStatsMeta.innerHTML = '<span class="text-danger">Vision stats unavailable.</span>'
      }
      if (els.stylesNotes) {
        els.stylesNotes.innerHTML =
          '<article class="list-row"><div><strong>Vision stats unavailable.</strong><div class="small">' +
          esc(message) +
          "</div></div><div></div></article>"
      }
      if (els.stylesPending) {
        els.stylesPending.innerHTML =
          '<article class="list-row"><div><strong>Submission queue unavailable.</strong><div class="small">' +
          esc(message) +
          "</div></div><div></div></article>"
      }
      setLog({ error: "Vision stats failed", details: err.response || message })
    }
  }

  function filteredAssets() {
    return state.assets.slice()
  }

  function batchUnstaleSymbolsForVisibleSlice() {
    var seen = new Set()
    filteredAssets().forEach(function (row) {
      var symbol = String((row && row.gene_symbol) || "")
        .trim()
        .toUpperCase()
      if (!symbol) return
      // This button intentionally acts on the current visible slice so the
      // admin can narrow the target with the existing search/filter controls
      // and then apply one batch restore without guessing what else will move.
      var rowHasStale =
        Number((row && row.stale_count) || 0) > 0 || Boolean(row && (row.has_stale || row.is_stale))
      if (rowHasStale) seen.add(symbol)
    })
    return Array.from(seen)
  }

  function syncVisibleBatchActions() {
    if (!els.unstaleVisible) return
    var symbols = batchUnstaleSymbolsForVisibleSlice()
    var count = symbols.length
    els.unstaleVisible.disabled = count === 0
    els.unstaleVisible.textContent = count
      ? "Restore stale in view (" + count + ")"
      : "Restore stale in view"
    els.unstaleVisible.title = count
      ? "Restore stale status for every visible gene in the current gallery slice."
      : "No visible genes in this slice have stale status to restore."
  }

  function dedupeGalleryRows(rows) {
    var seen = new Set()
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      var symbol = String((row && row.gene_symbol) || "")
      if (!symbol || seen.has(symbol)) return false
      seen.add(symbol)
      return true
    })
  }

  function detailEventMarkup(evt) {
    return [
      '<article class="event-row">',
      '<div class="event-thumb">',
      evt.thumb_url
        ? '<img src="' +
          esc(evt.thumb_url) +
          '" alt="Event thumbnail" loading="lazy" width="64" height="64" />'
        : "",
      "</div>",
      '<div class="event-meta-block">',
      "<strong>" + esc(evt.action || "event") + "</strong>",
      '<div class="small">' + esc(evt.reason || "No note recorded.") + "</div>",
      '<div class="small mono">' + esc(evt.created_at || "") + "</div>",
      "</div>",
      "</article>",
    ].join("")
  }

  function pickDetailCandidate(detail) {
    var candidates = Array.isArray(detail && detail.candidates) ? detail.candidates : []
    if (!candidates.length) return null
    var preferredSha = String(state.selectedCandidateSha || "").toLowerCase()
    if (preferredSha) {
      var preferred = candidates.find(function (candidate) {
        return String(candidate.asset_sha256 || "").toLowerCase() === preferredSha
      })
      if (preferred) return preferred
    }
    var live = candidates.find(function (candidate) {
      return Boolean(candidate && candidate.is_live)
    })
    return live || candidates[0] || null
  }

  function galleryOverlayButton(label, action, symbol, sha, tone) {
    var classes = ["gallery-overlay-button"]
    if (tone === "primary") classes.push("gallery-overlay-button--primary")
    if (tone === "danger") classes.push("gallery-overlay-button--danger")
    return (
      '<button class="' +
      classes.join(" ") +
      '" type="button" data-card-action="' +
      esc(action) +
      '" data-symbol="' +
      esc(symbol || "") +
      '" data-sha="' +
      esc(sha || "") +
      '">' +
      esc(label) +
      "</button>"
    )
  }

  function renderLiveCard(a) {
    var imageUrl =
      a.live_thumb_url || a.leader_thumb_url || a.live_medium_url || a.leader_medium_url || ""
    var badges = []
    if (a.live_sha) badges.push('<span class="badge-pill badge-live">Canonical</span>')
    if (a.admin_override)
      badges.push('<span class="badge-pill badge-pinned">Manual override</span>')
    if (a.leader_sha && a.leader_sha !== a.live_sha)
      badges.push('<span class="badge-pill badge-pinned">Votes differ</span>')
    if (a.has_mismatch) badges.push('<span class="badge-pill badge-mismatch">Mismatch</span>')
    if (a.missing) badges.push('<span class="badge-pill badge-missing">No canonical blot</span>')
    if (a.has_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>')
    var actions = []
    if (a.leader_sha && a.leader_sha !== a.live_sha) {
      actions.push(
        galleryOverlayButton("Set vote winner", "publish", a.gene_symbol, a.leader_sha, "primary"),
      )
    }
    if (a.live_sha) {
      actions.push(galleryOverlayButton("Reject", "reject", a.gene_symbol, a.live_sha, "danger"))
    }
    return [
      '<article class="gallery-card' +
        (state.selectedGene === String(a.gene_symbol || "") ? " is-selected" : "") +
        '" role="button" tabindex="0" data-gene-symbol="' +
        esc(a.gene_symbol || "") +
        '">',
      '<div class="gallery-media">',
      imageUrl
        ? '<img src="' +
          esc(imageUrl) +
          '" alt="Blot for ' +
          esc(a.gene_symbol || "") +
          '" loading="lazy" width="160" height="160" />'
        : '<div class="gallery-empty gallery-empty--media">No blot</div>',
      "</div>",
      '<div class="gallery-card-meta">',
      '<div class="gallery-title">' + esc(a.gene_symbol || "") + "</div>",
      '<div class="gallery-subtitle">' +
        esc(
          (a.candidate_count || 0) +
            " candidates · " +
            (a.live_vision_id || a.leader_vision_id || "no vision"),
        ) +
        "</div>",
      '<div class="badge-row">' + badges.join("") + "</div>",
      "</div>",
      actions.length ? '<div class="gallery-card-overlay">' + actions.join("") + "</div>" : "",
      "</article>",
    ].join("")
  }

  function renderCandidateCard(a) {
    var badges = [statusPill(a.status)]
    if (a.is_live) badges.push('<span class="badge-pill badge-live">Canonical</span>')
    if (a.admin_override)
      badges.push('<span class="badge-pill badge-pinned">Manual override</span>')
    if (a.is_stale) badges.push('<span class="badge-pill badge-stale">Stale</span>')
    if (a.is_legacy) badges.push('<span class="badge-pill badge-missing">Legacy</span>')
    var actions = [galleryOverlayButton("Review", "open", a.gene_symbol, "")]
    actions.push(galleryOverlayButton("Copy SHA", "copy", a.gene_symbol, a.asset_sha256))
    if (!a.is_live)
      actions.push(
        galleryOverlayButton("Make canonical", "publish", a.gene_symbol, a.asset_sha256, "primary"),
      )
    actions.push(galleryOverlayButton("Reject", "reject", a.gene_symbol, a.asset_sha256, "danger"))
    return [
      '<article class="gallery-card' +
        (state.selectedGene === String(a.gene_symbol || "") ? " is-selected" : "") +
        '" role="button" tabindex="0" data-gene-symbol="' +
        esc(a.gene_symbol || "") +
        '">',
      '<div class="gallery-media">',
      a.thumb_url
        ? '<img src="' +
          esc(a.thumb_url) +
          '" alt="Candidate blot for ' +
          esc(a.gene_symbol || "") +
          '" loading="lazy" width="160" height="160" />'
        : '<div class="gallery-empty gallery-empty--media">No blot</div>',
      "</div>",
      '<div class="gallery-card-meta">',
      '<div class="gallery-title">' + esc(a.gene_symbol || "") + "</div>",
      '<div class="gallery-subtitle">' +
        esc(
          (a.artist_name || a.artist_tag || a.vision_id || "Unknown vision") +
            " · score " +
            String(a.image_score || 0),
        ) +
        "</div>",
      '<div class="badge-row">' + badges.join("") + "</div>",
      "</div>",
      '<div class="gallery-card-overlay">' + actions.join("") + "</div>",
      "</article>",
    ].join("")
  }

  function renderCompareCard(a) {
    var badges = []
    if (a.live_sha) badges.push('<span class="badge-pill badge-live">Canonical</span>')
    if (a.admin_override)
      badges.push('<span class="badge-pill badge-pinned">Manual override</span>')
    if (a.leader_sha && a.leader_sha !== a.live_sha)
      badges.push('<span class="badge-pill badge-pinned">Votes differ</span>')
    if (a.has_mismatch) badges.push('<span class="badge-pill badge-mismatch">Mismatch</span>')
    if (a.missing) badges.push('<span class="badge-pill badge-missing">No canonical blot</span>')
    var actions = []
    if (a.leader_sha && a.leader_sha !== a.live_sha)
      actions.push(
        galleryOverlayButton("Set vote winner", "publish", a.gene_symbol, a.leader_sha, "primary"),
      )
    if (a.live_sha)
      actions.push(galleryOverlayButton("Reject", "reject", a.gene_symbol, a.live_sha, "danger"))
    return [
      '<article class="gallery-card' +
        (state.selectedGene === String(a.gene_symbol || "") ? " is-selected" : "") +
        '" role="button" tabindex="0" data-gene-symbol="' +
        esc(a.gene_symbol || "") +
        '">',
      '<div class="gallery-media">',
      '<div class="gallery-media-split">',
      '<div class="gallery-media-panel">',
      '<div class="gallery-media-image">',
      a.live_thumb_url
        ? '<img src="' +
          esc(a.live_thumb_url) +
          '" alt="Canonical blot for ' +
          esc(a.gene_symbol || "") +
          '" loading="lazy" width="160" height="160" />'
        : '<div class="gallery-empty gallery-empty--media">No canonical blot</div>',
      "</div>",
      '<div class="gallery-media-label">Canonical</div>',
      "</div>",
      '<div class="gallery-media-panel">',
      '<div class="gallery-media-image">',
      a.leader_thumb_url
        ? '<img src="' +
          esc(a.leader_thumb_url) +
          '" alt="Vote winner for ' +
          esc(a.gene_symbol || "") +
          '" loading="lazy" width="160" height="160" />'
        : '<div class="gallery-empty gallery-empty--media">No vote winner</div>',
      "</div>",
      '<div class="gallery-media-label">Vote winner</div>',
      "</div>",
      "</div>",
      "</div>",
      '<div class="gallery-card-meta">',
      '<div class="gallery-title">' + esc(a.gene_symbol || "") + "</div>",
      '<div class="gallery-subtitle">' +
        esc(
          (a.live_vision_id || "no canonical") + " vs " + (a.leader_vision_id || "no vote winner"),
        ) +
        "</div>",
      '<div class="badge-row">' + badges.join("") + "</div>",
      "</div>",
      actions.length ? '<div class="gallery-card-overlay">' + actions.join("") + "</div>" : "",
      "</article>",
    ].join("")
  }

  function renderGeneDetail() {
    if (state.activeTab !== "archive") return
    var detail = state.selectedGeneDetail
    if (!detail) {
      els.detail.innerHTML = [
        '<div class="detail-kicker">Gene review</div>',
        '<div class="detail-title">Pick a gene</div>',
        '<div class="detail-copy">Click any gene to inspect candidates. The canonical blot is what the extension shows; votes auto-pick it unless a manual override is active.</div>',
      ].join("")
      return
    }

    var headerBadges = []
    if (detail.live_sha)
      headerBadges.push('<span class="badge-pill badge-live">Canonical blot set</span>')
    if (detail.admin_override)
      headerBadges.push('<span class="badge-pill badge-pinned">Manual override</span>')

    var candidates = Array.isArray(detail.candidates) ? detail.candidates : []
    var recentEvents = Array.isArray(detail.recent_events) ? detail.recent_events : []
    var heroCandidate = pickDetailCandidate(detail)
    state.selectedCandidateSha = heroCandidate ? String(heroCandidate.asset_sha256 || "") : ""

    els.detail.innerHTML = [
      '<div class="detail-kicker">Gene review</div>',
      heroCandidate
        ? [
            '<div class="detail-hero">',
            '<div class="detail-hero-frame">',
            heroCandidate.medium_url
              ? '<img src="' +
                esc(heroCandidate.medium_url) +
                '" alt="Selected blot for ' +
                esc(detail.gene_symbol || "") +
                '" loading="lazy" width="320" height="320" />'
              : '<div class="gallery-empty gallery-empty--media">No preview</div>',
            "</div>",
            '<div class="detail-hero-meta">',
            "<strong>" +
              esc(
                heroCandidate.artist_name ||
                  heroCandidate.artist_tag ||
                  heroCandidate.vision_id ||
                  "Unknown vision",
              ) +
              "</strong>",
            '<div class="small">score ' +
              esc(String(heroCandidate.vote_score || 0)) +
              " · +" +
              esc(String(heroCandidate.image_upvotes || 0)) +
              " / -" +
              esc(String(heroCandidate.image_downvotes || 0)) +
              "</div>",
            '<div class="small mono">' + esc(shortSha(heroCandidate.asset_sha256 || "")) + "</div>",
            "</div>",
            "</div>",
          ].join("")
        : "",
      '<div class="detail-title">' + esc(detail.gene_symbol || "") + "</div>",
      detail.full_name ? '<div class="small">' + esc(detail.full_name) + "</div>" : "",
      '<div class="badge-row">' + headerBadges.join("") + "</div>",
      '<div class="detail-copy">' + esc(detail.manifestation || "No sample note yet.") + "</div>",
      '<div class="small">' +
        esc(
          detail.admin_override
            ? "Manual override is active. Clear it to let votes pick the canonical blot again."
            : "Votes automatically keep the canonical blot synced to the top eligible candidate.",
        ) +
        "</div>",
      '<div class="candidate-actions">',
      '<button class="btn-flat" data-detail-action="rollback" data-symbol="' +
        esc(detail.gene_symbol || "") +
        '">Roll back</button>',
      '<button class="btn-flat" data-detail-action="unpublish" data-symbol="' +
        esc(detail.gene_symbol || "") +
        '">Unpublish</button>',
      detail.admin_override
        ? '<button class="btn-flat" data-detail-action="clear-override" data-symbol="' +
          esc(detail.gene_symbol || "") +
          '">Clear override</button>'
        : "",
      "</div>",
      '<div class="detail-kicker">Candidates</div>',
      '<div class="candidate-list">',
      candidates.length
        ? candidates
            .map(function (candidate) {
              var badges = [statusPill(candidate.status)]
              if (candidate.is_live)
                badges.push('<span class="badge-pill badge-live">Canonical</span>')
              if (candidate.is_stale)
                badges.push('<span class="badge-pill badge-stale">Stale</span>')
              if (candidate.is_legacy)
                badges.push('<span class="badge-pill badge-missing">Legacy</span>')
              return [
                '<article class="candidate-row' +
                  (heroCandidate &&
                  String(heroCandidate.asset_sha256 || "") === String(candidate.asset_sha256 || "")
                    ? " is-selected"
                    : "") +
                  '" data-candidate-sha="' +
                  esc(candidate.asset_sha256 || "") +
                  '">',
                '<div class="candidate-thumb">',
                candidate.thumb_url
                  ? '<img src="' +
                    esc(candidate.thumb_url) +
                    '" alt="Candidate blot" loading="lazy" width="64" height="64" />'
                  : "",
                "</div>",
                '<div class="candidate-meta">',
                "<div><strong>" +
                  esc(
                    candidate.artist_name ||
                      candidate.artist_tag ||
                      candidate.vision_id ||
                      "Unknown vision",
                  ) +
                  "</strong></div>",
                '<div class="small">score ' +
                  esc(String(candidate.vote_score || 0)) +
                  " · +" +
                  esc(String(candidate.image_upvotes || 0)) +
                  " / -" +
                  esc(String(candidate.image_downvotes || 0)) +
                  "</div>",
                '<div class="small mono">' + esc(shortSha(candidate.asset_sha256 || "")) + "</div>",
                '<div class="badge-row">' + badges.join("") + "</div>",
                '<div class="candidate-actions">',
                '<button class="btn-flat" data-detail-action="copy" data-symbol="' +
                  esc(detail.gene_symbol || "") +
                  '" data-sha="' +
                  esc(candidate.asset_sha256 || "") +
                  '">Copy SHA</button>',
                !candidate.is_live
                  ? '<button class="btn-primary" data-detail-action="publish" data-symbol="' +
                    esc(detail.gene_symbol || "") +
                    '" data-sha="' +
                    esc(candidate.asset_sha256 || "") +
                    '">Make canonical</button>'
                  : "",
                '<button class="btn-danger" data-detail-action="reject" data-symbol="' +
                  esc(detail.gene_symbol || "") +
                  '" data-sha="' +
                  esc(candidate.asset_sha256 || "") +
                  '">Reject</button>',
                "</div>",
                "</div>",
                "</article>",
              ].join("")
            })
            .join("")
        : '<div class="gallery-empty">No candidate blots found for this gene.</div>',
      "</div>",
      '<div class="detail-kicker">Recent events</div>',
      '<div class="event-list">',
      recentEvents.length
        ? recentEvents.slice(0, 6).map(detailEventMarkup).join("")
        : '<div class="gallery-empty">No admin events yet.</div>',
      "</div>",
    ].join("")
  }

  async function refreshGeneDetail(symbol) {
    var safeSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!safeSymbol) return
    state.selectedGene = safeSymbol
    state.selectedGeneDetail = null
    state.selectedCandidateSha = ""
    els.detail.innerHTML = [
      '<div class="detail-kicker">Gene review</div>',
      '<div class="detail-title">' + esc(safeSymbol) + "</div>",
      '<div class="detail-copy">Loading candidate blots, canonical state, and recent events…</div>',
    ].join("")
    var detail = await apiJson("/gene/" + encodeURIComponent(safeSymbol), { method: "GET" })
    state.selectedGeneDetail = detail || null
    renderGeneDetail()
  }

  function renderTable() {
    if (state.activeTab !== "archive") return
    var assets = filteredAssets()
    if (!assets.length) {
      els.body.innerHTML =
        '<div class="gallery-empty gallery-empty--full-row">Nothing matched this gallery slice.</div>'
      syncVisibleBatchActions()
      return
    }
    els.body.innerHTML = assets
      .map(function (a) {
        if (state.galleryMode === "all") return renderCandidateCard(a)
        if (state.galleryMode === "side-by-side") return renderCompareCard(a)
        return renderLiveCard(a)
      })
      .join("")
    syncVisibleBatchActions()
  }

  async function refreshAssets() {
    try {
      els.refresh.disabled = true
      els.meta.textContent = "Loading..."
      var status = encodeURIComponent(String(els.status.value || "all").toLowerCase())
      var sort = encodeURIComponent(String(els.stale.value || "name").toLowerCase())
      var limit = Math.max(1, Math.min(120, Number.parseInt(els.limit.value || "60", 10) || 60))
      var symbol = encodeURIComponent(
        String(els.search.value || "")
          .trim()
          .toUpperCase(),
      )
      var path =
        "/gallery?page=1&filter=" +
        status +
        "&sort=" +
        sort +
        "&limit=" +
        limit +
        "&mode=" +
        encodeURIComponent(state.galleryMode)
      if (symbol) path += "&query=" + symbol
      var data = await apiJson(path, { method: "GET" })
      state.galleryMode = String(data.mode || state.galleryMode || "live")
      syncGalleryModeButtons()
      state.assets =
        state.galleryMode === "all"
          ? Array.isArray(data.rows)
            ? data.rows
            : []
          : dedupeGalleryRows(data.rows)
      state.archiveLoaded = true
      els.meta.innerHTML = [
        "<span>" +
          state.assets.length +
          (state.galleryMode === "all" ? " cards shown" : " genes shown") +
          "</span>",
        "<span>total " + esc(String(data.total || state.assets.length)) + "</span>",
        "<span>filter " + esc(String(els.status.value || "all")) + "</span>",
        "<span>sort " + esc(String(els.stale.value || "name")) + "</span>",
        "<span>mode " + esc(activeModeLabel()) + "</span>",
      ].join(" &middot; ")
      renderTable()
      if (
        state.selectedGene &&
        state.assets.some(function (row) {
          return String(row.gene_symbol || "") === state.selectedGene
        })
      ) {
        refreshGeneDetail(state.selectedGene).catch(function (err) {
          setLog({ error: String(err.message || err), details: err.response || null })
        })
      }
    } catch (err) {
      if (isRequestCanceled(err)) return
      state.archiveLoaded = false
      els.meta.innerHTML = '<span class="text-danger">Failed to load.</span>'
      setLog({ error: String(err.message || err), details: err.response || null })
    } finally {
      els.refresh.disabled = false
    }
  }

  function reasonOrUndefined() {
    var r = String(els.actionReason.value || "").trim()
    return r || undefined
  }

  async function runMutation(path, payload) {
    return apiJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    })
  }

  async function handleTableAction(action, symbol, sha) {
    if (action === "copy") {
      await navigator.clipboard.writeText(String(sha || ""))
      setLog("Copied SHA for " + symbol + ": " + sha)
      return
    }

    var reason = reasonOrUndefined()
    if (action === "reject") {
      if (!sha) throw new Error("Missing SHA for reject")
      if (!window.confirm("Reject this image for " + symbol + "?")) return
      var rejectBody = { symbol: symbol, asset_sha256: sha }
      if (reason) rejectBody.reason = reason
      setLog(await runMutation("/reject", rejectBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }

    if (action === "publish") {
      if (!sha) throw new Error("Missing SHA for publish")
      if (
        !window.confirm(
          "Make this the canonical blot for " +
            symbol +
            "? This creates a manual override until you clear it.",
        )
      )
        return
      var publishBody = { symbol: symbol, asset_sha256: sha }
      if (reason) publishBody.reason = reason
      setLog(await runMutation("/publish", publishBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }

    if (action === "clear-override") {
      if (
        !window.confirm(
          "Clear the manual override for " + symbol + " and let votes pick the canonical blot?",
        )
      )
        return
      var clearBody = { symbol: symbol }
      if (reason) clearBody.reason = reason
      setLog(await runMutation("/clear-override", clearBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }

    if (action === "unpublish") {
      if (!window.confirm("Unpublish " + symbol + "?")) return
      var unpublishBody = { symbol: symbol }
      if (reason) unpublishBody.reason = reason
      setLog(await runMutation("/unpublish", unpublishBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }

    if (action === "unstale") {
      if (!sha) throw new Error("Missing SHA for unstale")
      if (!window.confirm("Restore this image for " + symbol + "?")) return
      var unstaleBody = { symbol: symbol, asset_sha256: sha }
      if (reason) unstaleBody.reason = reason
      setLog(await runMutation("/unstale", unstaleBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }

    if (action === "purge-legacy") {
      if (!sha) throw new Error("Missing SHA for purge legacy")
      if (!window.confirm("Permanently delete this legacy image for " + symbol + "? No undo."))
        return
      var purgeBody = { symbol: symbol, asset_sha256: sha }
      if (reason) purgeBody.reason = reason
      setLog(await runMutation("/purge-legacy", purgeBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }

    if (action === "rollback") {
      if (!window.confirm("Roll back " + symbol + " to previous blot?")) return
      var rollbackBody = { symbol: symbol }
      if (reason) rollbackBody.reason = reason
      setLog(await runMutation("/rollback", rollbackBody))
      await refreshAssets()
      await refreshDerivedAdminViews()
      return
    }
  }

  async function handleVisibleBatchUnstale() {
    var symbols = batchUnstaleSymbolsForVisibleSlice()
    if (!symbols.length) throw new Error("No visible stale genes to restore.")
    var query = String((els.search && els.search.value) || "")
      .trim()
      .toUpperCase()
    var prompt = query
      ? "Restore stale samples for " + symbols.length + ' visible genes matching "' + query + '"?'
      : "Restore stale samples for " +
        symbols.length +
        " visible genes in the current gallery slice?"
    if (!window.confirm(prompt)) return
    var body = { symbols: symbols }
    var reason = reasonOrUndefined()
    if (reason) body.reason = reason
    setLog(await runMutation("/unstale-batch", body))
    await refreshAssets()
    await refreshDerivedAdminViews()
    if (
      state.selectedGene &&
      symbols.indexOf(String(state.selectedGene || "").toUpperCase()) !== -1
    ) {
      await refreshGeneDetail(state.selectedGene)
    }
  }

  function bindActions() {
    window.addEventListener("beforeunload", function (event) {
      if (!publicationAliasIsDirty() && !extensionBlocklistIsDirty()) return
      event.preventDefault()
      event.returnValue = ""
    })

    if (els.tabs) {
      els.tabs.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-tab]")
        if (!btn) return
        setActiveTab(String(btn.getAttribute("data-tab") || "overview"))
      })
      els.tabs.addEventListener("keydown", function (ev) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return
        var tabs = Array.from(els.tabs.querySelectorAll('[role="tab"]'))
        if (!tabs.length) return
        var current = Math.max(0, tabs.indexOf(document.activeElement))
        var next = current
        if (ev.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length
        if (ev.key === "ArrowRight") next = (current + 1) % tabs.length
        if (ev.key === "Home") next = 0
        if (ev.key === "End") next = tabs.length - 1
        ev.preventDefault()
        var nextTab = tabs[next]
        setActiveTab(String(nextTab.getAttribute("data-tab") || "overview"))
        nextTab.focus()
      })
    }

    if (els.recognitionTabs) {
      els.recognitionTabs.addEventListener("click", function (ev) {
        var button = ev.target.closest("[data-recognition-section]")
        if (!button) return
        setRecognitionSection(String(button.getAttribute("data-recognition-section") || "aliases"))
      })
      els.recognitionTabs.addEventListener("keydown", function (ev) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return
        var tabs = Array.from(
          els.recognitionTabs.querySelectorAll('[role="tab"][data-recognition-section]'),
        )
        if (!tabs.length) return
        var current = Math.max(0, tabs.indexOf(document.activeElement))
        var next = current
        if (ev.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length
        if (ev.key === "ArrowRight") next = (current + 1) % tabs.length
        if (ev.key === "Home") next = 0
        if (ev.key === "End") next = tabs.length - 1
        ev.preventDefault()
        var nextTab = tabs[next]
        setRecognitionSection(String(nextTab.getAttribute("data-recognition-section") || "aliases"))
        nextTab.focus()
      })
    }

    if (els.promptsRefresh) {
      els.promptsRefresh.addEventListener("click", refreshImageEditPrompts)
    }
    if (els.factoryRefresh) els.factoryRefresh.addEventListener("click", refreshFactoryRecipe)
    if (els.factorySave) els.factorySave.addEventListener("click", saveFactoryRecipe)
    if (els.factoryPipeline)
      els.factoryPipeline.addEventListener("change", selectRecommendedVisionForPipeline)
    if (els.factoryVision)
      els.factoryVision.addEventListener("change", renderFactoryRecipeSelection)
    if (els.factoryWiringRows) {
      els.factoryWiringRows.addEventListener("change", function (ev) {
        var select = ev.target.closest("[data-factory-recommendation]")
        if (select) saveFactoryRecommendation(select)
      })
    }
    if (els.diagnosticVision) {
      els.diagnosticVision.addEventListener("change", function () {
        state.diagnosticVisionRevision =
          Number.parseInt(String(els.diagnosticVision.value || "0"), 10) || 0
        persistDiagnosticDefaults()
      })
    }
    if (els.diagnosticPipelineOptions) {
      els.diagnosticPipelineOptions.addEventListener("change", function (ev) {
        var input = ev.target.closest("[data-diagnostic-pipeline]")
        if (!input) return
        state.diagnosticSelectedPipelines = Array.from(
          els.diagnosticPipelineOptions.querySelectorAll("[data-diagnostic-pipeline]:checked"),
        ).map(function (node) {
          return String(node.getAttribute("data-diagnostic-pipeline") || "")
        })
        persistDiagnosticDefaults()
        renderDiagnosticBuilder()
      })
    }
    if (els.diagnosticEmulsionAdd)
      els.diagnosticEmulsionAdd.addEventListener("click", addDiagnosticEmulsion)
    if (els.diagnosticEmulsionInput) {
      els.diagnosticEmulsionInput.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return
        ev.preventDefault()
        addDiagnosticEmulsion()
      })
    }
    if (els.diagnosticEmulsionChips) {
      els.diagnosticEmulsionChips.addEventListener("click", function (ev) {
        var button = ev.target.closest("[data-diagnostic-emulsion-remove]")
        if (!button) return
        var slot =
          Number.parseInt(
            String(button.getAttribute("data-diagnostic-emulsion-remove") || "0"),
            10,
          ) || 0
        state.diagnosticEmulsionSlots = state.diagnosticEmulsionSlots.filter(function (value) {
          return value !== slot
        })
        persistDiagnosticDefaults()
        renderDiagnosticBuilder()
      })
    }
    if (els.diagnosticRunButton)
      els.diagnosticRunButton.addEventListener("click", startDiagnosticMatrix)
    if (els.diagnosticRefresh)
      els.diagnosticRefresh.addEventListener("click", function () {
        refreshDiagnosticMatrix({ quiet: false, latest: true })
      })
    if (els.diagnosticDownload)
      els.diagnosticDownload.addEventListener("click", downloadDiagnosticPng)
    if (els.promptTemplateList) {
      els.promptTemplateList.addEventListener("click", function (ev) {
        var row = ev.target.closest("[data-prompt-kind]")
        if (!row) return
        state.selectedPromptKind = String(row.getAttribute("data-prompt-kind") || "")
        renderImageEditPrompts()
        setPromptStatus("", "")
      })
    }
    if (els.promptTemplateSave) {
      els.promptTemplateSave.addEventListener("click", saveSelectedImageEditPrompt)
    }
    if (els.promptSuffixSave) {
      els.promptSuffixSave.addEventListener("click", saveImageEditPromptSuffix)
    }
    if (els.promptPrefixSave) {
      els.promptPrefixSave.addEventListener("click", saveImageEditPromptPrefix)
    }
    if (els.publicationAliasRefresh) {
      els.publicationAliasRefresh.addEventListener("click", function () {
        if (
          publicationAliasIsDirty() &&
          !window.confirm("Discard this unpublished alias draft and reload the saved policy?")
        ) {
          setPublicationAliasStatus("Draft kept. Nothing was reloaded.", "")
          return
        }
        refreshPublicationAliases()
      })
    }
    if (els.publicationAliasForm) {
      els.publicationAliasForm.addEventListener("submit", function (ev) {
        ev.preventDefault()
        submitPublicationAliasDraftMapping()
      })
    }
    if (els.publicationAliasInput) {
      els.publicationAliasInput.addEventListener("input", function () {
        els.publicationAliasInput.removeAttribute("aria-invalid")
        clearPublicationAliasConflict()
        renderPublicationAliases()
      })
    }
    if (els.publicationAliasGeneQuery) {
      els.publicationAliasGeneQuery.addEventListener("input", function () {
        state.publicationAliasSelectedGene = null
        els.publicationAliasGeneQuery.removeAttribute("aria-invalid")
        clearPublicationAliasConflict()
        cancelPublicationAliasSearch()
        if (
          String(els.publicationAliasGeneQuery.value || "").trim().length >=
          PUBLICATION_ALIAS_SEARCH_MIN_LENGTH
        ) {
          schedulePublicationAliasGeneSearch()
        }
        renderPublicationAliases()
      })
      els.publicationAliasGeneQuery.addEventListener("keydown", function (ev) {
        var results = state.publicationAliasSearchResults || []
        if (ev.key === "ArrowDown" && results.length) {
          ev.preventDefault()
          state.publicationAliasSearchActiveIndex = publicationAliasSearchIndexAfter(
            state.publicationAliasSearchActiveIndex,
            "next",
            results.length,
          )
          renderPublicationAliasSearchResults()
          return
        }
        if (ev.key === "ArrowUp" && results.length) {
          ev.preventDefault()
          state.publicationAliasSearchActiveIndex = publicationAliasSearchIndexAfter(
            state.publicationAliasSearchActiveIndex,
            "previous",
            results.length,
          )
          renderPublicationAliasSearchResults()
          return
        }
        if (ev.key === "Enter") {
          ev.preventDefault()
          if (results.length) {
            selectPublicationAliasGene(
              Math.max(0, Number(state.publicationAliasSearchActiveIndex || 0)),
            )
          } else {
            submitPublicationAliasDraftMapping()
          }
          return
        }
        if (ev.key === "Escape") {
          ev.preventDefault()
          closePublicationAliasSearch({ clearStatus: true })
        }
      })
    }
    if (els.publicationAliasGeneResults) {
      els.publicationAliasGeneResults.addEventListener("pointerdown", function (ev) {
        var option = ev.target.closest("[data-publication-alias-gene-index]")
        if (!option) return
        ev.preventDefault()
        selectPublicationAliasGene(
          Number(option.getAttribute("data-publication-alias-gene-index") || 0),
        )
        if (els.publicationAliasGeneQuery) els.publicationAliasGeneQuery.focus()
      })
    }
    if (els.publicationAliasCancelEdit) {
      els.publicationAliasCancelEdit.addEventListener("click", function () {
        resetPublicationAliasComposer({ focus: true })
        setPublicationAliasStatus("Mapping edit canceled.", "")
      })
    }
    if (els.publicationAliasFilter) {
      els.publicationAliasFilter.addEventListener("input", renderPublicationAliases)
    }
    if (els.publicationAliasMappings) {
      els.publicationAliasMappings.addEventListener("click", function (ev) {
        var change = ev.target.closest("[data-publication-alias-change]")
        var remove = ev.target.closest("[data-publication-alias-remove]")
        var undo = ev.target.closest("[data-publication-alias-undo]")
        var button = change || remove || undo
        if (!button) return
        var attribute = change
          ? "data-publication-alias-change"
          : remove
            ? "data-publication-alias-remove"
            : "data-publication-alias-undo"
        var alias = ""
        try {
          alias = decodeURIComponent(String(button.getAttribute(attribute) || ""))
        } catch {
          return
        }
        if (change) startPublicationAliasEdit(alias)
        else if (remove) removePublicationAliasDraftMapping(alias)
        else undoPublicationAliasDraftMapping(alias)
      })
    }
    if (els.publicationAliasPublish) {
      els.publicationAliasPublish.addEventListener("click", publishPublicationAliases)
    }
    if (els.extensionBlocklistRefresh) {
      els.extensionBlocklistRefresh.addEventListener("click", function () {
        if (
          extensionBlocklistIsDirty() &&
          !window.confirm("Discard this unpublished draft and reload the shared policy?")
        ) {
          setExtensionBlocklistStatus("Draft kept. Nothing was reloaded.", "")
          return
        }
        refreshExtensionBlocklist()
      })
    }
    if (els.extensionBlocklistAdd) {
      els.extensionBlocklistAdd.addEventListener("click", addExtensionBlocklistDraftTerms)
    }
    if (els.extensionBlocklistInput) {
      els.extensionBlocklistInput.addEventListener("input", function () {
        els.extensionBlocklistInput.removeAttribute("aria-invalid")
      })
      els.extensionBlocklistInput.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" || (!ev.ctrlKey && !ev.metaKey)) return
        ev.preventDefault()
        addExtensionBlocklistDraftTerms()
      })
    }
    if (els.extensionBlocklistTerms) {
      els.extensionBlocklistTerms.addEventListener("click", function (ev) {
        var remove = ev.target.closest("[data-extension-blocklist-remove]")
        if (!remove) return
        removeExtensionBlocklistDraftTerm(
          String(remove.getAttribute("data-extension-blocklist-remove") || ""),
        )
      })
    }
    if (els.extensionBlocklistPublish) {
      els.extensionBlocklistPublish.addEventListener("click", publishExtensionBlocklist)
    }

    document.body.addEventListener("click", async function (ev) {
      if (els.publicationAliasGeneResults && !ev.target.closest(".publication-alias-combobox")) {
        closePublicationAliasSearch()
      }
      var jump = ev.target.closest("[data-jump-symbol]")
      if (!jump) return
      var symbol = String(jump.getAttribute("data-jump-symbol") || "")
      var tab = String(jump.getAttribute("data-jump-tab") || "archive")
      els.status.value = "all"
      els.stale.value = "name"
      els.search.value = symbol
      setActiveTab(tab)
      refreshAssets()
    })

    if (els.body) {
      els.body.addEventListener("click", async function (ev) {
        var actionBtn = ev.target.closest("[data-card-action]")
        if (actionBtn) {
          ev.stopPropagation()
          var action = String(actionBtn.getAttribute("data-card-action") || "")
          var symbol = String(actionBtn.getAttribute("data-symbol") || "")
          var sha = String(actionBtn.getAttribute("data-sha") || "")
          try {
            actionBtn.disabled = true
            if (action === "open") {
              await refreshGeneDetail(symbol)
            } else {
              await handleTableAction(action, symbol, sha)
              if (symbol) await refreshGeneDetail(symbol)
            }
          } catch (err) {
            setLog({ error: String(err.message || err), details: err.response || null })
          } finally {
            actionBtn.disabled = false
          }
          return
        }

        var card = ev.target.closest("[data-gene-symbol]")
        if (!card) return
        refreshGeneDetail(String(card.getAttribute("data-gene-symbol") || "")).catch(
          function (err) {
            setLog({ error: String(err.message || err), details: err.response || null })
          },
        )
      })

      els.body.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return
        var card = ev.target.closest("[data-gene-symbol]")
        if (!card) return
        ev.preventDefault()
        refreshGeneDetail(String(card.getAttribute("data-gene-symbol") || "")).catch(
          function (err) {
            setLog({ error: String(err.message || err), details: err.response || null })
          },
        )
      })
    }

    document.body.addEventListener("click", async function (ev) {
      var modeBtn = ev.target.closest("[data-gallery-mode]")
      if (modeBtn) {
        var nextMode = String(modeBtn.getAttribute("data-gallery-mode") || "live")
        if (nextMode !== state.galleryMode) {
          state.galleryMode = nextMode
          syncGalleryModeButtons()
          refreshAssets()
        }
        return
      }

      var visionOpenBtn = ev.target.closest("[data-vision-open]")
      if (visionOpenBtn) {
        var visionId = String(visionOpenBtn.getAttribute("data-vision-open") || "")
        var assetSha = String(visionOpenBtn.getAttribute("data-vision-asset") || "")
        refreshVisionDetail(visionId, { assetSha: assetSha || undefined }).catch(function (err) {
          setLog({
            error: "Vision detail failed",
            details: err.response || requestErrorMessage(err, "Vision detail failed."),
          })
        })
        return
      }

      var visionNavBtn = ev.target.closest("[data-vision-nav]")
      if (visionNavBtn) {
        var delta = String(visionNavBtn.getAttribute("data-vision-nav") || "") === "prev" ? -1 : 1
        navigateSelectedVisionAsset(delta)
        return
      }

      var visionArtistActionBtn = ev.target.closest("[data-vision-artist-action]")
      if (visionArtistActionBtn) {
        var artistAction = String(
          visionArtistActionBtn.getAttribute("data-vision-artist-action") || "",
        )
        var context = currentVisionContext()
        if (artistAction === "copy-tag") {
          await navigator.clipboard.writeText(
            String(
              (context.vision && (context.vision.artist_tag || context.vision.vision_id)) || "",
            ),
          )
          setLog(
            "Copied artist tag for " +
              String(
                (context.vision &&
                  (context.vision.artist_name ||
                    context.vision.artist_tag ||
                    context.vision.vision_id)) ||
                  "selected artist",
              ),
          )
        } else if (artistAction === "open-current-gene") {
          await openVisionGene(context.asset && context.asset.gene_symbol)
        }
        return
      }

      var visionDetailActionBtn = ev.target.closest("[data-vision-detail-action]")
      if (visionDetailActionBtn) {
        var detailAction = String(
          visionDetailActionBtn.getAttribute("data-vision-detail-action") || "",
        )
        var detailSymbol = String(visionDetailActionBtn.getAttribute("data-symbol") || "")
        var detailSha = String(visionDetailActionBtn.getAttribute("data-sha") || "")
        try {
          visionDetailActionBtn.disabled = true
          if (detailAction === "open-gene") {
            await openVisionGene(detailSymbol)
          } else {
            await handleTableAction(detailAction, detailSymbol, detailSha)
            if (state.selectedVisionId) {
              await refreshVisionDetail(state.selectedVisionId, {
                assetSha: detailSha || state.selectedVisionAssetSha,
                keepDetail: true,
              })
            }
          }
        } catch (err) {
          setLog({ error: String(err.message || err), details: err.response || null })
        } finally {
          visionDetailActionBtn.disabled = false
        }
        return
      }

      var sortBtn = ev.target.closest("[data-vision-sort]")
      if (sortBtn) {
        var key = String(sortBtn.getAttribute("data-vision-sort") || "live")
        if (state.visionSort.key === key) {
          state.visionSort.dir = state.visionSort.dir === "asc" ? "desc" : "asc"
        } else {
          state.visionSort = { key: key, dir: key === "vision" ? "asc" : "desc" }
        }
        state.visionPage = 1
        renderVisionStats()
        return
      }

      if (ev.target.closest("#vision-page-first")) {
        setVisionPage(1)
        renderVisionStats()
        return
      }

      if (ev.target.closest("#vision-page-prev")) {
        setVisionPage(state.visionPage - 1)
        renderVisionStats()
        return
      }

      if (ev.target.closest("#vision-page-next")) {
        setVisionPage(state.visionPage + 1)
        renderVisionStats()
        return
      }

      if (ev.target.closest("#vision-page-last")) {
        setVisionPage(
          Math.max(
            1,
            Math.ceil(
              (state.visionStats || []).length /
                Math.max(1, state.visionPageSize || defaultVisionPageSize()),
            ),
          ),
        )
        renderVisionStats()
        return
      }

      var logFilterBtn = ev.target.closest("[data-log-filter]")
      if (logFilterBtn) {
        state.activityActionFilter = String(logFilterBtn.getAttribute("data-log-filter") || "all")
        document.querySelectorAll("[data-log-filter]").forEach(function (btn) {
          btn.classList.toggle(
            "active",
            String(btn.getAttribute("data-log-filter") || "all") === state.activityActionFilter,
          )
        })
        renderActivityFeed()
        return
      }
    })

    document.addEventListener("keydown", function (ev) {
      if (state.activeTab !== "styles") return
      if (isEditableTarget(ev.target)) return
      if (!state.selectedVisionId) return
      if (ev.key === "ArrowLeft") {
        ev.preventDefault()
        navigateSelectedVisionAsset(-1)
        return
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault()
        navigateSelectedVisionAsset(1)
        return
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault()
        selectRelativeVision(-1)
        return
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault()
        selectRelativeVision(1)
      }
    })

    if (els.detail) {
      els.detail.addEventListener("click", async function (ev) {
        var candidateCard = ev.target.closest("[data-candidate-sha]")
        if (candidateCard && !ev.target.closest("[data-detail-action]")) {
          state.selectedCandidateSha = String(
            candidateCard.getAttribute("data-candidate-sha") || "",
          )
          renderGeneDetail()
          return
        }
        var btn = ev.target.closest("[data-detail-action]")
        if (!btn) return
        var action = String(btn.getAttribute("data-detail-action") || "")
        var symbol = String(btn.getAttribute("data-symbol") || "")
        var sha = String(btn.getAttribute("data-sha") || "")
        try {
          btn.disabled = true
          await handleTableAction(action, symbol, sha)
          await refreshGeneDetail(symbol)
        } catch (err) {
          setLog({ error: String(err.message || err), details: err.response || null })
        } finally {
          btn.disabled = false
        }
      })
    }

    if (els.visionOpenCurrentGene) {
      els.visionOpenCurrentGene.addEventListener("click", function () {
        var context = currentVisionContext()
        openVisionGene(context.asset && context.asset.gene_symbol)
      })
    }

    if (els.visionCopyCurrentTag) {
      els.visionCopyCurrentTag.addEventListener("click", async function () {
        var context = currentVisionContext()
        var artistTag = String(
          (context.vision && (context.vision.artist_tag || context.vision.vision_id)) || "",
        ).trim()
        if (!artistTag) return
        await navigator.clipboard.writeText(artistTag)
        setLog("Copied artist tag: " + artistTag)
      })
    }

    if (els.unstaleVisible) {
      els.unstaleVisible.addEventListener("click", async function () {
        try {
          els.unstaleVisible.disabled = true
          await handleVisibleBatchUnstale()
        } catch (err) {
          setLog({ error: String(err.message || err), details: err.response || null })
        } finally {
          syncVisibleBatchActions()
        }
      })
    }

    if (els.costRefresh) {
      els.costRefresh.addEventListener("click", function () {
        refreshCostUsage()
      })
    }

    if (els.requestsRefresh) {
      els.requestsRefresh.addEventListener("click", function () {
        refreshGenerationRequests()
      })
    }
    ;[els.requestsSearch, els.requestsKind, els.requestsMode, els.requestsStatus].forEach(
      function (input) {
        if (!input) return
        input.addEventListener("input", function () {
          state.requestPage = 1
          renderGenerationRequests()
        })
        input.addEventListener("change", function () {
          state.requestPage = 1
          renderGenerationRequests()
        })
      },
    )
    if (els.requestsLimit) {
      els.requestsLimit.addEventListener("change", refreshGenerationRequests)
    }
    if (els.requestsPageSize) {
      els.requestsPageSize.value = String(state.requestPageSize)
      els.requestsPageSize.addEventListener("change", function () {
        state.requestPageSize = Math.max(
          1,
          Number.parseInt(String(els.requestsPageSize.value || defaultRequestPageSize()), 10) ||
            defaultRequestPageSize(),
        )
        state.requestPage = 1
        renderGenerationRequests()
      })
    }
    if (els.requestsPageFirst)
      els.requestsPageFirst.addEventListener("click", function () {
        setRequestPage(1)
      })
    if (els.requestsPagePrev)
      els.requestsPagePrev.addEventListener("click", function () {
        setRequestPage(state.requestPage - 1)
      })
    if (els.requestsPageNext)
      els.requestsPageNext.addEventListener("click", function () {
        setRequestPage(state.requestPage + 1)
      })
    if (els.requestsPageLast) {
      els.requestsPageLast.addEventListener("click", function () {
        setRequestPage(
          Math.ceil(
            filteredGenerationRequests().length /
              Math.max(1, state.requestPageSize || defaultRequestPageSize()),
          ),
        )
      })
    }
    if (els.requestsList) {
      els.requestsList.addEventListener("click", function (ev) {
        var row = ev.target.closest("[data-request-id]")
        if (!row) return
        state.selectedRequestId = row.getAttribute("data-request-id")
        renderGenerationRequests()
      })
      els.requestsList.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return
        var row = ev.target.closest("[data-request-id]")
        if (!row) return
        ev.preventDefault()
        state.selectedRequestId = row.getAttribute("data-request-id")
        renderGenerationRequests()
        if (els.requestsDetail) els.requestsDetail.focus({ preventScroll: true })
      })
    }
    if (els.requestsDetail) {
      els.requestsDetail.addEventListener("click", async function (ev) {
        var copyBtn = ev.target.closest("[data-request-copy]")
        if (copyBtn) {
          var selected = (state.generationRequests || []).find(function (row) {
            return String(row.id || "") === String(copyBtn.getAttribute("data-request-copy") || "")
          })
          if (!selected) return
          await navigator.clipboard.writeText(JSON.stringify(selected, null, 2))
          setLog("Copied request #" + selected.id + " JSON.")
          return
        }
        var openBtn = ev.target.closest("[data-request-open-gene]")
        if (openBtn) {
          openVisionGene(openBtn.getAttribute("data-request-open-gene") || "")
        }
      })
    }

    window.addEventListener("hashchange", function () {
      var hashTab = String(window.location.hash || "")
        .replace(/^#/, "")
        .trim()
      if (hashTab && els.panels[hashTab]) {
        setActiveTab(hashTab)
      }
    })
  }

  function init() {
    factoryBelts = window.IconoplasmFactoryBelts.create({
      document: document,
      escapeHtml: esc,
      fetchPayload: function () {
        return apiJson("/factory-belts", { method: "GET" })
      },
      onViewChange: function (view) {
        if (state.diagnosticPollTimer) window.clearTimeout(state.diagnosticPollTimer)
        state.diagnosticPollTimer = null
        if (view === "diagnostics") refreshDiagnosticMatrix({ quiet: true })
      },
    })
    restoreDiagnosticDefaults()
    var initialTab = String(window.location.hash || "")
      .replace(/^#/, "")
      .trim()
    if (!initialTab || !els.panels[initialTab]) initialTab = "overview"
    setActiveTab(initialTab)
    syncGalleryModeButtons()
    els.visionStatsList.innerHTML =
      '<tr><td colspan="8">Open this tab to load the scorecard.</td></tr>'
    if (els.visionStatsMeta)
      els.visionStatsMeta.textContent = "Open this tab to load the scorecard."
    renderVisionCleanupPanel()
    renderVisionQuickActions()
    if (els.stylesPending) {
      els.stylesPending.innerHTML =
        '<article class="list-row"><div><strong>No artist-tag requests waiting.</strong><div class="small">Open the tab to load requests from /blocklist.</div></div><div></div></article>'
    }
    els.stylesNotes.innerHTML =
      '<article class="list-row"><div><strong>No artist tags are blocklisted yet.</strong><div class="small">Open the tab to load the current site blocklist.</div></div><div></div></article>'
    syncVisibleBatchActions()
    els.refresh.addEventListener("click", function () {
      refreshAssets()
    })
    els.status.addEventListener("change", refreshAssets)
    els.stale.addEventListener("change", refreshAssets)
    els.limit.addEventListener("change", refreshAssets)
    els.search.addEventListener("input", refreshAssets)
    if (els.visionPageSize) {
      els.visionPageSize.addEventListener("change", function () {
        state.visionPageSize = Math.max(
          1,
          Number.parseInt(String(els.visionPageSize.value || defaultVisionPageSize()), 10) ||
            defaultVisionPageSize(),
        )
        state.visionPage = 1
        renderVisionStats()
      })
    }
    if (els.activityFilter) {
      els.activityFilter.addEventListener("input", renderActivityFeed)
    }
    if (els.requestsList) {
      els.requestsList.innerHTML =
        '<tr><td colspan="8">Open this tab to load request history.</td></tr>'
    }
    if (els.promptTemplateList) {
      els.promptTemplateList.innerHTML = inlineFailureMarkup(
        "Prompts not loaded",
        "Open this tab to load image edit prompt templates.",
      )
    }
    renderExtensionBlocklist()
    bindActions()
  }

  init()
})()
