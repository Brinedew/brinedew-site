/* roughloop.js — draws authentic rough.js sketch marks over the lab card.
   Requires rough.js loaded first (window.rough).
   Mark elements:
     .js-rough-ellipse  -> hand-drawn loop around the element
     .js-rough-strike   -> hand-drawn strike line across the element
   Optional attrs: data-stroke (color), data-seed (int).
   Exposes window.IconoRough.draw(root). Redraws on resize + font load. */
(function () {
  var NS = "http://www.w3.org/2000/svg";

  function clear(root) {
    root.querySelectorAll("svg.js-rough-gen").forEach(function (s) { s.remove(); });
  }
  function mkSvg(w, h, left, top) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "js-rough-gen");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.style.position = "absolute";
    svg.style.left = left + "px";
    svg.style.top = top + "px";
    svg.style.overflow = "visible";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "4";
    return svg;
  }
  function ensureRel(el) {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
  }

  function draw(root) {
    root = root || document;
    if (!window.rough) return;
    clear(root);

    root.querySelectorAll(".js-rough-ellipse").forEach(function (el, i) {
      var w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      var padX = w * 0.16 + 7, padY = h * 0.40 + 5;
      var sw = w + padX * 2, sh = h + padY * 2;
      var svg = mkSvg(sw, sh, -padX, -padY);
      var rc = window.rough.svg(svg);
      var node = rc.ellipse(sw / 2, sh / 2, w + padX * 1.7, h + padY * 1.55, {
        stroke: el.getAttribute("data-stroke") || "#2c7a72",
        strokeWidth: 2.1, roughness: 1.5, bowing: 1.4,
        seed: parseInt(el.getAttribute("data-seed") || (i + 3), 10)
      });
      svg.appendChild(node);
      ensureRel(el);
      el.appendChild(svg);
    });

    root.querySelectorAll(".js-rough-strike").forEach(function (el, i) {
      var w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      var svg = mkSvg(w, h, 0, 0);
      var rc = window.rough.svg(svg);
      var y = h * (parseFloat(el.getAttribute("data-y")) || 0.56);
      var node = rc.line(w * 0.015, y + h * 0.04, w * 0.985, y - h * 0.05, {
        stroke: el.getAttribute("data-stroke") || "#2c7a72",
        strokeWidth: 2, roughness: 1.7, bowing: 2.4,
        seed: parseInt(el.getAttribute("data-seed") || (i + 11), 10)
      });
      svg.appendChild(node);
      ensureRel(el);
      el.appendChild(svg);
    });
  }

  var raf;
  function schedule(root) {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { draw(root); });
  }

  window.IconoRough = { draw: draw };

  function init() {
    draw(document);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { draw(document); });
    window.addEventListener("resize", function () { schedule(document); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
