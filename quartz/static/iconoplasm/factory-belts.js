;(function () {
  function createFactoryBelts(options) {
    var doc = options.document
    var root = doc.getElementById("factory-belts")
    var status = doc.getElementById("factory-belts-status")
    var refresh = doc.getElementById("factory-belts-refresh")
    var updates = doc.getElementById("factory-belts-updates")
    var filter = doc.getElementById("factory-belts-filter")
    var search = doc.getElementById("factory-belts-search")
    var payload = null
    var pending = null
    var mounted = false
    var view = "outputs"
    var timer = null
    var requestId = 0
    var busy = false
    var pins = []
    var esc = options.escapeHtml
    try {
      var saved = JSON.parse(window.localStorage.getItem("iconoplasm.factory-pins") || "[]")
      pins = Array.isArray(saved)
        ? saved
            .filter(function (x) {
              return /^[A-Z][1-9]\d*$/.test(x)
            })
            .slice(0, 32)
        : []
    } catch (_) {}

    function age(value) {
      var time = Date.parse(
        String(value || "").replace(" ", "T") + (/Z$|[+]\d\d:\d\d$/.test(value) ? "" : "Z"),
      )
      if (!Number.isFinite(time)) return ""
      var minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
      if (minutes < 1) return "Just now"
      if (minutes < 60) return minutes + "m ago"
      if (minutes < 1440) return Math.floor(minutes / 60) + "h ago"
      return Math.floor(minutes / 1440) + "d ago"
    }

    function render() {
      if (!mounted || !payload) return
      var query = search.value.trim().toLowerCase()
      var belts = payload.belts
        .filter(function (belt) {
          var retired = belt.status !== "accepted"
          if (filter.value === "retired" ? !retired : retired) return false
          if (
            filter.value === "recent" &&
            !belt.active &&
            !belt.open_count &&
            !belt.outputs.length &&
            !pins.includes(belt.code)
          )
            return false
          return !query || (belt.code + " " + belt.label).toLowerCase().includes(query)
        })
        .sort(function (a, b) {
          return (
            Number(pins.includes(b.code)) - Number(pins.includes(a.code)) ||
            Number(b.active) - Number(a.active) ||
            String(b.outputs[0]?.created_at || "").localeCompare(
              String(a.outputs[0]?.created_at || ""),
            ) ||
            a.code.localeCompare(b.code, undefined, { numeric: true })
          )
        })
      root.innerHTML =
        belts
          .map(function (belt) {
            var pinned = pins.includes(belt.code)
            var state =
              belt.status !== "accepted"
                ? "Retired"
                : belt.open_count
                  ? belt.open_count + " open"
                  : "Idle"
            var images = belt.outputs
              .map(function (asset) {
                var alt = asset.gene_symbol + " · " + asset.emulsion_id
                return (
                  '<figure class="factory-output"><button type="button" data-icono-pswp data-icono-pswp-src="' +
                  esc(asset.full_url) +
                  '" data-icono-pswp-alt="' +
                  esc(alt) +
                  '" data-pswp-width="' +
                  esc(asset.width || "") +
                  '" data-pswp-height="' +
                  esc(asset.height || "") +
                  '" aria-label="Open ' +
                  esc(alt) +
                  '"><img src="' +
                  esc(asset.thumb_url) +
                  '" alt="' +
                  esc(alt) +
                  '" loading="lazy" decoding="async"></button>' +
                  "<figcaption><strong>" +
                  esc(asset.gene_symbol) +
                  '</strong><time title="' +
                  esc(asset.created_at || "") +
                  '">' +
                  age(asset.created_at) +
                  "</time><span>" +
                  esc(asset.emulsion_id) +
                  (asset.status === "rejected" ? " · Rejected" : "") +
                  "</span></figcaption></figure>"
                )
              })
              .join("")
            return (
              '<article class="factory-belt" data-factory-code="' +
              esc(belt.code) +
              '"><div class="factory-belt-label"><div><h3>' +
              esc(belt.code) +
              '</h3><button type="button" class="factory-pin secondary" data-factory-pin="' +
              esc(belt.code) +
              '" aria-pressed="' +
              pinned +
              '" aria-label="' +
              (pinned ? "Unpin " : "Pin ") +
              esc(belt.code) +
              '">' +
              (pinned ? "Pinned" : "Pin") +
              "</button></div><p>" +
              esc(belt.label) +
              '</p><span class="factory-belt-state">' +
              esc(state) +
              (belt.active ? " · <strong>Active</strong>" : "") +
              '</span></div><div class="factory-belt-images" data-icono-lightbox tabindex="0" role="group" aria-label="' +
              esc(belt.code) +
              ' latest outputs">' +
              (images || '<p class="factory-belt-empty">No published outputs</p>') +
              "</div></article>"
            )
          })
          .join("") || '<p class="small">No matching factories.</p>'
    }

    function stop() {
      window.clearTimeout(timer)
      timer = null
    }

    function schedule() {
      stop()
      // Poll only while this visible belt view has open work. A pending update
      // freezes both order and thumbnails until the operator chooses to apply it.
      if (
        !mounted ||
        view !== "outputs" ||
        doc.hidden ||
        pending ||
        !payload?.belts.some(function (belt) {
          return belt.open_count > 0
        })
      )
        return
      timer = window.setTimeout(function () {
        load(false)
      }, 30000)
    }

    async function load(apply) {
      if (busy || !mounted || view !== "outputs" || doc.hidden) return
      busy = true
      refresh.disabled = true
      var id = ++requestId
      if (!payload) status.textContent = "Loading outputs…"
      try {
        var next = await options.fetchPayload()
        if (id !== requestId || !mounted) return
        if (!next.ok || !Array.isArray(next.belts)) throw new Error("Invalid factory response")
        if (!payload || (apply && !doc.querySelector(".pswp"))) {
          payload = next
          pending = null
          updates.hidden = true
          render()
        } else if (JSON.stringify(payload) !== JSON.stringify(next)) {
          pending = next
          updates.hidden = false
        }
        status.textContent = ""
      } catch (error) {
        if (id === requestId && mounted) status.textContent = "Outputs unavailable. Retry refresh."
      } finally {
        if (id === requestId) {
          busy = false
          refresh.disabled = false
          schedule()
        }
      }
    }

    function selectView(next) {
      view = next
      doc.querySelectorAll("[data-factory-view]").forEach(function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.factoryView === view))
      })
      doc.querySelectorAll("[data-factory-section]").forEach(function (section) {
        section.hidden = section.dataset.factorySection !== view
      })
      stop()
      options.onViewChange(view)
      if (view === "outputs" && mounted) {
        render()
        if (!pending) load(!payload)
        else schedule()
      }
    }

    doc.getElementById("factory-views").addEventListener("click", function (event) {
      var button = event.target.closest("[data-factory-view]")
      if (button) selectView(button.dataset.factoryView)
    })
    root.addEventListener("click", function (event) {
      var button = event.target.closest("[data-factory-pin]")
      if (!button) return
      var code = button.dataset.factoryPin
      pins = pins.includes(code)
        ? pins.filter(function (x) {
            return x !== code
          })
        : pins.concat(code).slice(-32)
      try {
        window.localStorage.setItem("iconoplasm.factory-pins", JSON.stringify(pins))
      } catch (_) {}
      render()
      root.querySelector('[data-factory-pin="' + code + '"]')?.focus()
    })
    refresh.addEventListener("click", function () {
      load(true)
    })
    updates.addEventListener("click", function () {
      if (!pending || doc.querySelector(".pswp")) return
      payload = pending
      pending = null
      updates.hidden = true
      render()
      schedule()
    })
    filter.addEventListener("change", render)
    search.addEventListener("input", render)
    doc.addEventListener("visibilitychange", function () {
      if (doc.hidden) stop()
      else if (mounted && view === "outputs") {
        if (!pending) load(!payload)
        else schedule()
      }
    })
    return {
      mount: function () {
        mounted = true
        selectView(view)
      },
      unmount: function () {
        mounted = false
        ++requestId
        busy = false
        refresh.disabled = false
        stop()
        root.replaceChildren()
      },
      refresh: function () {
        return load(true)
      },
      invalidate: function () {
        payload = null
        pending = null
        updates.hidden = true
        return load(true)
      },
      view: function () {
        return view
      },
    }
  }
  window.IconoplasmFactoryBelts = { create: createFactoryBelts }
})()
