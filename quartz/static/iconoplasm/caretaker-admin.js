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
