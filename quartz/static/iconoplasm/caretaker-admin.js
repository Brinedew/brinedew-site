;(function caretakerAdminModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared || !modules.registry || !modules.detail) {
    throw new Error("Caretaker admin modules must load before the caretaker admin facade.")
  }

  var shared = modules.shared
  var context = shared.createContext()
  var detailController
  var registryController = modules.registry.create(context, {
    renderDetail: function renderDetail() {
      detailController.render()
    },
  })
  detailController = modules.detail.create(context, {
    loadRegistry: function loadRegistry(options) {
      return registryController.load(options)
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
    registryController.bindEvents()
    if (modules.cooldown) modules.cooldown.bind(nextRoot)
    registryController.load()
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
