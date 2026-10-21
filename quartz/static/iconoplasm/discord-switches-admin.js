;(function discordSwitchesAdminModule(global) {
  "use strict"

  // The admin panel's Discord tab: one switch per thing the bot posts. The
  // Worker owns the setting and the list (workers/discord-integration-switches.js);
  // a flip saves at once, and a failed save puts the switch back.
  var SWITCHES_PATH = "/api/iconoplasm/admin/discord-switches"

  function switchesRequest(init) {
    return global
      .fetch(
        SWITCHES_PATH,
        Object.assign({ credentials: "include", headers: { Accept: "application/json" } }, init),
      )
      .then(function readSwitches(response) {
        return response
          .json()
          .catch(function noJson() {
            return {}
          })
          .then(function checkSwitches(payload) {
            if (!response.ok) throw new Error(payload.error || "HTTP " + response.status)
            return payload
          })
      })
  }

  function changedLine(payload) {
    if (!payload.updated_at) return ""
    return "Last changed " + new Date(payload.updated_at).toLocaleString()
  }

  function renderSwitches(list, status, payload) {
    list.replaceChildren()
    ;(payload.items || []).forEach(function renderSwitch(item) {
      var row = document.createElement("li")
      row.className = "discord-switches__row"
      var text = document.createElement("label")
      text.className = "discord-switches__text"
      text.htmlFor = "discord-switch-" + item.id
      var name = document.createElement("span")
      name.className = "discord-switches__name"
      name.textContent = item.label
      var where = document.createElement("span")
      where.className = "discord-switches__where"
      where.textContent = item.where
      text.append(name, where)
      var input = document.createElement("input")
      input.type = "checkbox"
      input.id = "discord-switch-" + item.id
      input.className = "discord-switches__toggle"
      input.setAttribute("role", "switch")
      input.checked = payload.switches[item.id] !== false
      input.addEventListener("change", function saveSwitch() {
        var wanted = input.checked
        var changes = {}
        changes[item.id] = wanted
        input.disabled = true
        status.textContent = ""
        switchesRequest({
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ switches: changes }),
        })
          .then(function showSaved(saved) {
            input.checked = saved.switches[item.id] !== false
            status.textContent =
              item.label + (input.checked ? " is on. " : " is off. ") + changedLine(saved)
          })
          .catch(function showSaveError(error) {
            input.checked = !wanted
            status.textContent = item.label + " was not changed: " + error.message
          })
          .finally(function enableSwitch() {
            input.disabled = false
          })
      })
      row.append(text, input)
      list.append(row)
    })
    status.textContent = changedLine(payload)
  }

  function mount() {
    var list = document.querySelector("[data-discord-switches]")
    var status = document.querySelector("[data-discord-switches-status]")
    if (!list || !status) return
    status.textContent = "Loading…"
    switchesRequest({ method: "GET" })
      .then(function showSwitches(payload) {
        renderSwitches(list, status, payload)
      })
      .catch(function showLoadError(error) {
        list.replaceChildren()
        status.textContent = error.message
      })
  }

  global.IconoplasmDiscordSwitches = Object.freeze({ mount: mount })
})(window)
