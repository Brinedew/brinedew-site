// Starter rows mirror the authoring prompt; saved category names are never a whitelist.
export const TAG_CATEGORIES = [
  "archetype",
  "body",
  "face",
  "hair",
  "outfit",
  "accessories",
  "fantastical",
  "action",
  "pose",
  "signature",
  "background",
  "composition",
]

export function readTagFields(source) {
  return JSON.parse(source?.dataset.fieldsJson || "{}")
}

function tagList(text) {
  return String(text || "")
    .split(/,|\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function mountCaretakerTagEditor(form) {
  const source = form?.querySelector("[data-icono-caretaker-tags]")
  const host = form?.querySelector("[data-icono-caretaker-tag-categories]")
  if (!source || !host) return
  const doc = host.ownerDocument
  const fields = Object.assign(Object.create(null), readTagFields(source))
  const known = new Set(
    Object.values(fields)
      .flat()
      .filter((value) => typeof value === "string"),
  )
  const ungrouped = tagList(source.value).filter((tag) => !known.has(tag))
  if (ungrouped.length) {
    const current = fields.uncategorized
    fields.uncategorized = [
      ...(Array.isArray(current) ? current : typeof current === "string" ? [current] : []),
      ...ungrouped,
    ]
  }
  for (const key of TAG_CATEGORIES) if (!Object.hasOwn(fields, key)) fields[key] = []
  source.dataset.fieldsJson = JSON.stringify(fields)

  function button(text, label, action) {
    const node = doc.createElement("button")
    node.type = "button"
    node.textContent = text
    node.setAttribute("aria-label", label)
    node.disabled = source.disabled
    if (source.disabled) node.setAttribute("data-icono-caretaker-disabled", "")
    node.addEventListener("click", action)
    return node
  }

  function commit() {
    const values = Object.values(fields)
      .flat()
      .filter((value) => typeof value === "string")
    // Preserve surviving prompt order, appending only newly authored tags.
    source.value = [
      ...new Set([...tagList(source.value).filter((tag) => values.includes(tag)), ...values]),
    ].join(", ")
    source.dataset.fieldsJson = JSON.stringify(fields)
    source.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }))
  }

  function edit(container, category, index, trigger) {
    const input = doc.createElement("input")
    input.className = "icono-caretaker-tag-input"
    input.setAttribute("aria-label", index == null ? `Add ${category} tag` : `Edit ${category} tag`)
    input.placeholder = "Tag"
    input.value = index == null ? "" : fields[category][index]
    trigger.hidden = true
    trigger.after(input)
    let finished = false
    function finish(cancel, keepAdding = false) {
      if (finished) return
      finished = true
      const value = input.value.trim().normalize("NFC")
      if (!cancel && value) {
        if (index == null) {
          if (!fields[category].includes(value)) fields[category].push(value)
        } else fields[category][index] = value
        commit()
      }
      input.remove()
      trigger.hidden = false
      if (!cancel && value) {
        if (index == null) {
          if (
            ![...container.querySelectorAll("[data-tag-value]")].some(
              (node) => node.dataset.tagValue === value,
            )
          ) {
            container.insertBefore(tagChip(category, value), trigger)
          }
        } else trigger.replaceWith(tagChip(category, value))
      }
      if (keepAdding) edit(container, category, null, trigger)
    }
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault()
        finish(event.key === "Escape", event.key === "Enter" && index == null)
      }
    })
    input.addEventListener("blur", () => finish(false))
    input.focus()
    input.select?.()
  }

  function tagChip(category, tag) {
    const chip = doc.createElement("span")
    chip.className = "icono-caretaker-tag"
    chip.dataset.tagValue = tag
    const name = button(tag.replaceAll("_", " "), `Edit ${tag}`, () =>
      edit(chip.parentElement, category, fields[category].indexOf(tag), chip),
    )
    const remove = button("×", `Remove ${tag}`, () => {
      const index = fields[category].indexOf(tag)
      if (index >= 0) fields[category].splice(index, 1)
      commit()
      const add = chip.parentElement.querySelector("[data-add-tag]")
      chip.remove()
      add?.focus()
    })
    chip.append(name, remove)
    return chip
  }

  function render() {
    host.replaceChildren()
    for (const [category, raw] of Object.entries(fields)) {
      // Retain non-tag metadata byte-for-byte in fields_json; it is not a tag row.
      if (!Array.isArray(raw) && typeof raw !== "string") continue
      if (typeof raw === "string") fields[category] = raw ? [raw] : []
      const row = doc.createElement("div")
      row.className = "icono-caretaker-tag-row"
      row.dataset.tagCategory = category
      const label = doc.createElement("span")
      label.className = "icono-caretaker-tag-category"
      label.textContent = category.replaceAll("_", " ")
      const values = doc.createElement("div")
      values.className = "icono-caretaker-tag-values"
      fields[category].forEach((tag) => {
        if (typeof tag !== "string") return
        values.append(tagChip(category, tag))
      })
      const add = button("+", `Add ${category} tag`, () => edit(values, category, null, add))
      add.dataset.addTag = ""
      values.append(add)
      row.append(label, values)
      host.append(row)
    }
    const addCategory = button("+ Category", "Add category", () => {
      const input = doc.createElement("input")
      input.className = "icono-caretaker-tag-input"
      input.placeholder = "Category"
      input.setAttribute("aria-label", "Category name")
      addCategory.replaceWith(input)
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return
        if (event.key === "Escape") {
          event.preventDefault()
          render()
        }
        if (event.key !== "Enter") return
        event.preventDefault()
        const name = input.value.trim()
        if (!name) return
        if (!Object.hasOwn(fields, name)) fields[name] = []
        commit()
        render()
        const row = [...host.querySelectorAll("[data-tag-category]")].find(
          (node) => node.dataset.tagCategory === name,
        )
        row?.querySelector("[data-add-tag]")?.click()
      })
      input.focus()
    })
    addCategory.className = "icono-caretaker-add-category"
    host.append(addCategory)
  }
  render()
  source.dataset.fieldsJson = JSON.stringify(fields)
  source.dataset.initialFieldsJson = source.dataset.fieldsJson
}
