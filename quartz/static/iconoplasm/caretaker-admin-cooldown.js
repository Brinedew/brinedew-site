;(function caretakerAdminCooldownModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules) {
    throw new Error("Caretaker admin modules must load before the cooldown module.")
  }

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

  modules.cooldown = Object.freeze({ bind: bindCooldown })
})(window)
