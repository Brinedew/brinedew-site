var photoSwipeModulePromise = null
var imageDimensionsCache = Object.create(null)
var imageDimensionsPromiseCache = Object.create(null)
var installedDocuments = new WeakMap()

function ensureStylesheet(documentRef) {
  if (documentRef.querySelector('link[data-icono-style="photoswipe"]')) return
  var link = documentRef.createElement("link")
  link.rel = "stylesheet"
  link.href = new URL("./vendor/photoswipe.css?v=20260311a", import.meta.url).href
  link.setAttribute("data-icono-style", "photoswipe")
  documentRef.head.appendChild(link)
}

function ensurePhotoSwipe(documentRef) {
  ensureStylesheet(documentRef)
  if (photoSwipeModulePromise) return photoSwipeModulePromise
  photoSwipeModulePromise = import("./vendor/photoswipe.esm.js?v=20260306d")
    .then(function (module) {
      return module && module.default ? module.default : module
    })
    .catch(function (error) {
      photoSwipeModulePromise = null
      throw error
    })
  return photoSwipeModulePromise
}

export function lightboxDimensionsForTrigger(trigger) {
  var width = Number((trigger && trigger.getAttribute("data-pswp-width")) || 0)
  var height = Number((trigger && trigger.getAttribute("data-pswp-height")) || 0)
  if (width > 0 && height > 0) return { width: width, height: height }
  var img = trigger && trigger.querySelector ? trigger.querySelector("img") : null
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { width: img.naturalWidth, height: img.naturalHeight }
  }
  return { width: 1, height: 1 }
}

function measureSourceDimensions(url) {
  var resolvedUrl = String(url || "").trim()
  if (!resolvedUrl) return Promise.resolve(null)
  if (imageDimensionsCache[resolvedUrl]) return Promise.resolve(imageDimensionsCache[resolvedUrl])
  if (imageDimensionsPromiseCache[resolvedUrl]) return imageDimensionsPromiseCache[resolvedUrl]
  imageDimensionsPromiseCache[resolvedUrl] = new Promise(function (resolve) {
    var img = new Image()
    function finish(value) {
      delete imageDimensionsPromiseCache[resolvedUrl]
      if (value && value.width > 0 && value.height > 0) imageDimensionsCache[resolvedUrl] = value
      resolve(value)
    }
    img.addEventListener(
      "load",
      function () {
        finish({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
      },
      { once: true },
    )
    img.addEventListener(
      "error",
      function () {
        finish(null)
      },
      { once: true },
    )
    img.src = resolvedUrl
  })
  return imageDimensionsPromiseCache[resolvedUrl]
}

export function installIconoplasmLightbox(documentRef) {
  var targetDocument = documentRef || document
  if (installedDocuments.has(targetDocument)) return installedDocuments.get(targetDocument)
  var handler = function (event) {
    var trigger =
      event.target && event.target.closest ? event.target.closest("[data-icono-pswp]") : null
    if (!trigger) return
    var gallery = trigger.closest("[data-icono-lightbox]")
    if (!gallery || !targetDocument.documentElement.contains(gallery)) return
    event.preventDefault()
    event.stopPropagation()
    var triggers = Array.from(gallery.querySelectorAll("[data-icono-pswp]"))
    var items = triggers.map(function (item) {
      var dimensions = lightboxDimensionsForTrigger(item)
      return {
        src: item.getAttribute("data-icono-pswp-src"),
        width: dimensions.width,
        height: dimensions.height,
        alt: item.getAttribute("data-icono-pswp-alt") || item.getAttribute("aria-label") || "",
      }
    })
    var index = Math.max(0, triggers.indexOf(trigger))
    void Promise.all([
      ensurePhotoSwipe(targetDocument),
      measureSourceDimensions(items[index] && items[index].src),
    ])
      .then(function (results) {
        var measured = results[1]
        if (measured && measured.width > 0 && measured.height > 0 && items[index]) {
          items[index].width = measured.width
          items[index].height = measured.height
          trigger.setAttribute("data-pswp-width", String(measured.width))
          trigger.setAttribute("data-pswp-height", String(measured.height))
        }
        var pswp = new results[0]({
          dataSource: items,
          index: index,
          bgOpacity: 0.92,
          spacing: 0.12,
          wheelToZoom: true,
          mouseMovePan: true,
          loop: false,
          imageClickAction: "zoom",
          tapAction: "toggle-controls",
          bgClickAction: "close",
          showHideAnimationType: "fade",
          paddingFn: function () {
            return { top: 28, bottom: 28, left: 28, right: 28 }
          },
        })
        pswp.init()
      })
      .catch(function (error) {
        console.error("[Iconoplasm] failed to load PhotoSwipe:", error)
      })
  }
  targetDocument.addEventListener("click", handler, true)
  var cleanup = function () {
    targetDocument.removeEventListener("click", handler, true)
    installedDocuments.delete(targetDocument)
  }
  installedDocuments.set(targetDocument, cleanup)
  return cleanup
}
