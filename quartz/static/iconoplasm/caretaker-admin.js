;(function caretakerAdminModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared || !modules.registry || !modules.detail || !modules.offer) {
    throw new Error("Caretaker admin modules must load before the caretaker admin facade.")
  }

  var shared = modules.shared
  var context = shared.createContext()
  var registryController
  var detailController
  var offerController

  registryController = modules.registry.create(context, {
    renderDetail: function renderDetail() {
      detailController.render()
    },
    renderOfferState: function renderOfferState() {
      offerController.renderState()
    },
  })
  detailController = modules.detail.create(context, {
    loadRegistry: function loadRegistry(options) {
      return registryController.load(options)
    },
    renderOfferState: function renderOfferState() {
      offerController.renderState()
    },
  })
  offerController = modules.offer.create(context, {
    commandLabel: function commandLabel(actionKey, normalLabel) {
      return detailController.commandLabel(actionKey, normalLabel)
    },
    loadRegistry: function loadRegistry(options) {
      return registryController.load(options)
    },
    performMutation: function performMutation(actionKey, path, body, button, acceptedMessage) {
      return detailController.performMutation(actionKey, path, body, button, acceptedMessage)
    },
  })

  // B-1021: the gene change cooldown (minutes). The admin account is exempt;
  // the Worker owns the setting (caretaker-switch-cooldown.js).
  var COOLDOWN_PATH = "/api/iconoplasm/admin/caretaker-switch-cooldown"

  function cooldownRequest(init) {
    return global
      .fetch(
        COOLDOWN_PATH,
        Object.assign({ credentials: "include", headers: { Accept: "application/json" } }, init),
      )
      .then(function readCooldown(response) {
        return response
          .json()
          .catch(function noJson() {
            return {}
          })
          .then(function checkCooldown(payload) {
            if (!response.ok) throw new Error(payload.error || "HTTP " + response.status)
            return payload
          })
      })
  }

  function bindCooldown(root) {
    var form = root.querySelector("[data-caretaker-cooldown]")
    if (!form) return
    var input = form.querySelector("[data-caretaker-cooldown-minutes]")
    var status = form.querySelector("[data-caretaker-cooldown-status]")
    var save = form.querySelector("[data-caretaker-cooldown-save]")
    cooldownRequest({ method: "GET" })
      .then(function showCooldown(payload) {
        input.value = String(payload.minutes)
      })
      .catch(function showLoadError(error) {
        status.textContent = error.message
      })
    if (form.dataset.bound === "true") return
    form.dataset.bound = "true"
    form.addEventListener("submit", function saveCooldown(event) {
      event.preventDefault()
      save.disabled = true
      status.textContent = ""
      cooldownRequest({
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: Number(input.value) }),
      })
        .then(function showSaved(payload) {
          input.value = String(payload.minutes)
          status.textContent = "Saved"
        })
        .catch(function showSaveError(error) {
          status.textContent = error.message
        })
        .finally(function enableSave() {
          save.disabled = false
        })
    })
  }

  function mount(container) {
    var nextRoot = container || document.querySelector("[data-caretaker-admin]")
    if (!nextRoot) return false
    if (context.mounted && context.root === nextRoot) return true
    if (context.mounted) unmount()
    context.mounted = true
    context.root = nextRoot
    context.state = shared.createState()
    shared.collectRefs(context)
    offerController.bindEvents()
    registryController.renderPolicy()
    offerController.renderState()
    bindCooldown(nextRoot)
    Promise.allSettled([registryController.loadTerms(), registryController.load()])
    return true
  }

  function unmount() {
    context.mounted = false
    if (context.eventController) context.eventController.abort()
    context.eventController = null
    context.requestControllers.forEach(function abortRequest(controller) {
      controller.abort()
    })
    context.requestControllers.clear()
    context.timers.forEach(function clearScheduled(timer) {
      global.clearTimeout(timer)
    })
    context.timers.clear()
    context.root = null
    context.refs = {}
  }

  global.IconoplasmCaretakerAdmin = Object.freeze({ mount: mount, unmount: unmount })
})(window)
