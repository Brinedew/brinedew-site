/* GENERATED FILE. Edit shared/iconoplasm-tag-categories.js and rerun node scripts/sync-iconoplasm-shared.mjs. */

// The only Iconoplasm tag-category tree on the website (B-879). The Worker
// imports this file; the browser gets quartz/static/iconoplasm/generated/
// tag-categories.js from scripts/sync-iconoplasm-shared.mjs. The generator's
// copy is DEFAULT_TAG_CATEGORIES, CATEGORY_ALIASES and RETIRED_TAG_CATEGORIES in
// the Iconoplasm repo's src/manifestation.py; change both together.
//
// Saved tags are immutable versions, and 98% of them (18,856 of 19,217 on
// 26 Sep 2026) predate this tree. They are upcast when read, never rewritten
// in bulk: a caretaker's next save stores the current shape.

// Starter rows mirror the authoring prompt; saved category names are never a whitelist.
export const TAG_CATEGORIES = Object.freeze([
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
])

// A retired name whose tags live on under a successor.
export const TAG_CATEGORY_ALIASES = Object.freeze({ pose_mood: "pose" })

// A retired name with no successor. The owner retired "colors" because colour
// words in the tag list pull image generation off course, so these tags are
// dropped from prompts and from the caretaker editor, not merely hidden.
export const RETIRED_TAG_CATEGORIES = Object.freeze(["colors"])

function tagsOf(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
  return list
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function parsedFields(fields) {
  if (fields && typeof fields === "object" && !Array.isArray(fields)) return fields
  if (typeof fields !== "string" || !fields.trim()) return {}
  try {
    const parsed = JSON.parse(fields)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const key = (tag) => tag.trim().toLowerCase()

// Tags that belong only to a retired category. A word also grouped under a kept
// category (say "silver" under hair) stays.
export function retiredTagSet(fields) {
  const saved = parsedFields(fields)
  const kept = new Set()
  for (const [name, value] of Object.entries(saved)) {
    if (!RETIRED_TAG_CATEGORIES.includes(name)) for (const tag of tagsOf(value)) kept.add(key(tag))
  }
  const retired = new Set()
  for (const name of RETIRED_TAG_CATEGORIES) {
    for (const tag of tagsOf(saved[name])) if (!kept.has(key(tag))) retired.add(key(tag))
  }
  return retired
}

// The flat, comma-separated tag list an image prompt uses, minus retired tags.
export function promptTagsWithoutRetired(tagsText, fields) {
  const retired = retiredTagSet(fields)
  const tags = String(tagsText ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
  if (!retired.size) return tags.join(", ")
  return tags.filter((tag) => !retired.has(key(tag))).join(", ")
}

// Saved fields in the current shape: aliases folded into their successor (each
// tag once, order kept), retired categories dropped, tree order first, then
// saved extras in their saved order.
export function upcastTagFields(saved) {
  const fields = Object.assign(Object.create(null), parsedFields(saved))
  for (const [retired, successor] of Object.entries(TAG_CATEGORY_ALIASES)) {
    if (!Object.hasOwn(fields, retired)) continue
    const value = fields[retired]
    if (!Array.isArray(value) && typeof value !== "string") continue
    const successorTags = Array.isArray(fields[successor])
      ? fields[successor]
      : typeof fields[successor] === "string" && fields[successor]
        ? [fields[successor]]
        : []
    const retiredTags = Array.isArray(value) ? value : value ? [value] : []
    fields[successor] = [...new Set([...successorTags, ...retiredTags])]
    delete fields[retired]
  }
  for (const retired of RETIRED_TAG_CATEGORIES) delete fields[retired]
  const ordered = Object.create(null)
  for (const name of TAG_CATEGORIES) ordered[name] = Object.hasOwn(fields, name) ? fields[name] : []
  for (const name of Object.keys(fields))
    if (!Object.hasOwn(ordered, name)) ordered[name] = fields[name]
  return ordered
}
