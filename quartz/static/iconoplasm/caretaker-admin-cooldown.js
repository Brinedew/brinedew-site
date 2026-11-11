;(function caretakerAdminCooldownModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules) {
    throw new Error("Caretaker admin modules must load before the cooldown module.")
  }

  // B-1021: the gene change cooldown (minutes). The admin account is exempt;
  // the Worker owns the setting (caretaker-switch-cooldown.js).
  var COOLDOWN_PATH = "/api/iconoplasm/admin/caretaker-switch-cooldown"
  // B-1190: the autosave cooldown (seconds) and the emergency account-age gate
  // (off by default), owned by caretaker-save-cooldown.js and
  // caretaker-account-age-gate.js.
  var SAVE_COOLDOWN_PATH = "/api/iconoplasm/admin/caretaker-save-cooldown"
  var ACCOUNT_AGE_GATE_PATH = "/api/iconoplasm/admin/caretaker-account-age-gate"

  function jsonRequest(path, init) {
    return global
      .fetch(
        path,
        Object.assign({ credentials: "include", headers: { Accept: "application/json" } }, init),
      )
      .then(function readJson(response) {
        return response
          .json()
          .catch(function noJson() {
            return {}
          })
          .then(function checkJson(payload) {
            if (!response.ok) throw new Error(payload.error || "HTTP " + response.status)
            return payload
          })
      })
  }

  function cooldownRequest(init) {
    return jsonRequest(COOLDOWN_PATH, init)
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

  function bindSaveCooldown(root) {
    var form = root.querySelector("[data-caretaker-save-cooldown]")
    if (!form) return
    var input = form.querySelector("[data-caretaker-save-cooldown-seconds]")
    var status = form.querySelector("[data-caretaker-save-cooldown-status]")
    var save = form.querySelector("[data-caretaker-save-cooldown-save]")
    jsonRequest(SAVE_COOLDOWN_PATH, { method: "GET" })
      .then(function showCooldown(payload) {
        input.value = String(payload.seconds)
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
      jsonRequest(SAVE_COOLDOWN_PATH, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: Number(input.value) }),
      })
        .then(function showSaved(payload) {
          input.value = String(payload.seconds)
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

  function bindAccountAgeGate(root) {
    var form = root.querySelector("[data-caretaker-account-age-gate]")
    if (!form) return
    var enabled = form.querySelector("[data-caretaker-account-age-enabled]")
    var days = form.querySelector("[data-caretaker-account-age-days]")
    var status = form.querySelector("[data-caretaker-account-age-status]")
    var save = form.querySelector("[data-caretaker-account-age-save]")
    jsonRequest(ACCOUNT_AGE_GATE_PATH, { method: "GET" })
      .then(function showGate(payload) {
        enabled.checked = payload.enabled === true
        days.value = String(payload.min_days)
      })
      .catch(function showLoadError(error) {
        status.textContent = error.message
      })
    if (form.dataset.bound === "true") return
    form.dataset.bound = "true"
    form.addEventListener("submit", function saveGate(event) {
      event.preventDefault()
      save.disabled = true
      status.textContent = ""
      jsonRequest(ACCOUNT_AGE_GATE_PATH, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: Boolean(enabled.checked), min_days: Number(days.value) }),
      })
        .then(function showSaved(payload) {
          enabled.checked = payload.enabled === true
          days.value = String(payload.min_days)
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

  modules.cooldown = Object.freeze({
    bind: function bindAll(root) {
      bindCooldown(root)
      bindSaveCooldown(root)
      bindAccountAgeGate(root)
    },
  })
})(window)
