/**
 * Admin API endpoints for GeneGuessr
 * Restricted to the admin Discord session identity.
 */

import { parseCookies } from "./auth.js"
import { sanitizeProteinSummary } from "./lib/structure-utils.js"
import {
  buildDiscordRecapImageKey,
  DISCORD_RECAP_RENDER_CONTRACT,
  isValidIsoDay,
  canWriteDiscordRecapImage,
  canReadDiscordRecapImage,
  putDiscordRecapImage,
  headDiscordRecapImage,
} from "./lib/discord-recap-images.js"
import {
  fetchProteinByUniprot as loadProtein,
  getDailySelectionProteinIds,
  pickDailyTarget,
  getBlendedSimilarity,
} from "./lib/protein-store.js"
import { buildClueSections, maskClueSections, sanitizeTargetProtein } from "./lib/game-engine.js"
import { getDailyGuessAggregates, getGuessAggregatesForDateRange } from "./lib/guess-aggregates.js"
import { getGameSessionWriteEvidence } from "./lib/game-session-write-evidence.js"

function addDaysISO(dateIso, days) {
  const base = new Date(`${dateIso}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

const DISCORD_RECAP_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const ADMIN_SCHEDULE_DAY_CACHE_PREFIX = "admin_schedule_day:v2:"
const ADMIN_SCHEDULE_DAY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
const ADMIN_SCHEDULE_MAX_FUTURE_DAYS = 370
// Family-balanced daily selection changes every computed preview. Bump the
// payload version so no flat-protein schedule entry survives the deployment.
const ADMIN_SCHEDULE_CACHE_VERSION = 3
const DAILY_TARGET_SALT_FALLBACK = "geneguessr-v2-939b5a0b"

async function listAllKvKeys(env, prefix) {
  const keys = []
  let cursor = undefined
  do {
    const res = await env.KV.list({ prefix, cursor })
    keys.push(...(res?.keys || []))
    cursor = res?.cursor
    if (!res?.list_complete) {
      continue
    }
    break
  } while (cursor)
  return keys
}

function buildAdminScheduleDayCacheKey(date) {
  return `${ADMIN_SCHEDULE_DAY_CACHE_PREFIX}${date}`
}

async function deleteAdminScheduleDayCacheEntry(env, date) {
  if (!isValidIsoDay(date)) {
    return
  }
  try {
    await env.KV.delete(buildAdminScheduleDayCacheKey(date))
  } catch (err) {
    console.warn("Failed to delete admin schedule day cache entry", err)
  }
}

function normalizeUniprotId(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
  return raw || null
}

function isScheduleDayCacheEntryValid(entry, { date, overrideUniprotId, salt }) {
  if (!entry || typeof entry !== "object") {
    return false
  }
  if (entry.cache_version !== ADMIN_SCHEDULE_CACHE_VERSION) {
    return false
  }
  if (entry.date !== date) {
    return false
  }
  if (entry.salt !== salt) {
    return false
  }
  const cachedOverride = normalizeUniprotId(entry.override_uniprot_id)
  if (cachedOverride !== normalizeUniprotId(overrideUniprotId)) {
    return false
  }
  const computedUniprot = normalizeUniprotId(entry.computed_uniprot_id)
  const computedProteinUniprot = normalizeUniprotId(entry?.computed?.uniprot)
  if (!computedUniprot || !computedProteinUniprot || computedUniprot !== computedProteinUniprot) {
    return false
  }
  return true
}

function toScheduleUpcomingRow(entry) {
  return {
    date: entry?.date || null,
    override_uniprot_id: normalizeUniprotId(entry?.override_uniprot_id),
    override_protein: entry?.override_protein || null,
    computed: entry?.computed || null,
    skipped_alpha_fold: Number.isFinite(entry?.skipped_alpha_fold)
      ? entry.skipped_alpha_fold
      : null,
  }
}

async function buildScheduleDayCacheEntry(env, { date, overrideByDate, salt }) {
  const plannedOverride = normalizeUniprotId(overrideByDate.get(date)?.uniprot_id)
  const selection = await pickDailyTarget(env.DB, salt, date)
  const computedProtein = selection?.protein ? sanitizeProteinSummary(selection.protein) : null
  const computedUniprot = normalizeUniprotId(
    computedProtein?.uniprot || selection?.protein?.uniprot,
  )

  let overrideProtein = null
  if (plannedOverride) {
    try {
      const protein = await loadProtein(env.DB, plannedOverride)
      overrideProtein = protein ? sanitizeProteinSummary(protein) : null
    } catch {
      overrideProtein = null
    }
  }

  return {
    cache_version: ADMIN_SCHEDULE_CACHE_VERSION,
    date,
    salt,
    computed_uniprot_id: computedUniprot,
    computed: computedProtein,
    override_uniprot_id: plannedOverride,
    override_protein: overrideProtein,
    skipped_alpha_fold: Number.isFinite(selection?.skippedAlphaFold)
      ? selection.skippedAlphaFold
      : null,
    generated_at: Date.now(),
  }
}

async function putScheduleDayCacheEntry(env, entry) {
  const date = entry?.date
  if (!isValidIsoDay(date)) {
    return
  }
  try {
    await env.KV.put(buildAdminScheduleDayCacheKey(date), JSON.stringify(entry), {
      expirationTtl: ADMIN_SCHEDULE_DAY_CACHE_TTL_SECONDS,
    })
  } catch (err) {
    console.warn(`Admin schedule day cache write failed for ${date}; serving uncached`, err)
  }
}

function decodeBase64Png(value) {
  const input = String(value || "").trim()
  if (!input) return null

  const cleaned = input.replace(/^data:image\/png;base64,/i, "").replace(/\s+/g, "")
  if (!cleaned) return null

  try {
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
    const hasPngSignature =
      bytes.byteLength >= pngSignature.length &&
      pngSignature.every((expected, index) => bytes[index] === expected)
    return hasPngSignature ? bytes : null
  } catch {
    return null
  }
}

const CAMERA_MODES = ["perspective", "orthographic"]
const ANTIALIASING_MODES = ["off", "fxaa"]
const BACKGROUND_MODES = ["auto", "dark", "light", "custom"]

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

const coerceBoolean = (value, fallback) => {
  if (typeof value === "boolean") {
    return value
  }
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

const sanitizeColor = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback
  }
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return fallback
  }
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return fallback
  }
  return `#${hex}`
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const mergeDeep = (target, source) => {
  if (!source || typeof source !== "object") {
    return target
  }
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = value.map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return mergeDeep({}, item)
        }
        return item
      })
      continue
    }
    if (value && typeof value === "object") {
      target[key] = mergeDeep(target[key] || {}, value)
      continue
    }
    target[key] = value
  }
  return target
}

const createProfileTemplate = () => ({
  camera: {
    mode: "perspective",
    fieldOfView: 48,
    near: 0.1,
    far: 1800,
  },
  lighting: {
    enabled: true,
    exposure: 1.1,
    lights: [
      { id: "key", label: "Key", inclination: 170, azimuth: 30, intensity: 1.4, color: "#ffffff" },
      {
        id: "fill",
        label: "Fill",
        inclination: 32,
        azimuth: 210,
        intensity: 0.7,
        color: "#c9d5ff",
      },
      { id: "rim", label: "Rim", inclination: 85, azimuth: 315, intensity: 0.45, color: "#92b4ff" },
    ],
  },
  occlusion: {
    enabled: true,
    samples: 64,
    radius: 6,
    bias: 0.8,
    blurKernelSize: 7,
    resolutionScale: 1,
  },
  antialiasing: {
    mode: "fxaa",
    edgeThresholdMin: 0.125,
    edgeThresholdMax: 0.25,
    iterations: 2,
    subpixelQuality: 0.75,
  },
  fog: {
    enabled: true,
    intensity: 0.5,
    color: "#0f172a",
    near: 0,
    far: 200,
  },
  outline: {
    enabled: true,
    scale: 0.5,
    threshold: 0.35,
    color: "#0f172a",
  },
  background: {
    mode: "auto",
    dark: "#0f172a",
    light: "#f8f1e7",
    custom: "#0f172a",
  },
  extras: {
    hideAxes: true,
    disableMarking: true,
  },
})

const templateProfile = createProfileTemplate()

const buildProfile = (id, name, description, overrides = {}) => ({
  id,
  name,
  description,
  ...mergeDeep(clone(templateProfile), overrides),
})

const BUILT_IN_PROFILES = [
  buildProfile("studio", "Studio Balanced", "Cinematic soft lighting with subtle fog.", {}),
  buildProfile("cinematic", "Cinematic Ultra", "High quality occlusion + deeper fog.", {
    occlusion: { samples: 128, radius: 8, blurKernelSize: 9, resolutionScale: 1 },
    fog: { intensity: 0.75, color: "#050816" },
    lighting: {
      exposure: 1.25,
      lights: [
        {
          id: "key",
          label: "Key",
          inclination: 160,
          azimuth: 20,
          intensity: 1.6,
          color: "#ffe7d3",
        },
        {
          id: "fill",
          label: "Fill",
          inclination: 25,
          azimuth: 210,
          intensity: 0.8,
          color: "#c4d2ff",
        },
        {
          id: "rim",
          label: "Rim",
          inclination: 95,
          azimuth: 315,
          intensity: 0.6,
          color: "#7dafff",
        },
      ],
    },
  }),
  buildProfile("performance", "Performance", "Lightweight settings for low-power GPUs.", {
    occlusion: { enabled: false, samples: 0, radius: 0 },
    fog: { enabled: false, intensity: 0 },
    outline: { enabled: false },
    antialiasing: { mode: "fxaa", iterations: 1, subpixelQuality: 0.5 },
    extras: { hideAxes: true, disableMarking: true },
    lighting: {
      exposure: 1,
      lights: [
        {
          id: "key",
          label: "Key",
          inclination: 175,
          azimuth: 25,
          intensity: 1.2,
          color: "#ffffff",
        },
        {
          id: "fill",
          label: "Fill",
          inclination: 35,
          azimuth: 200,
          intensity: 0.35,
          color: "#cdd5ff",
        },
        {
          id: "rim",
          label: "Rim",
          inclination: 90,
          azimuth: 300,
          intensity: 0.25,
          color: "#91a4ff",
        },
      ],
    },
  }),
]

const cloneProfile = (profile) => ({
  id: profile.id,
  name: profile.name,
  description: profile.description || "",
  camera: clone(profile.camera),
  lighting: clone(profile.lighting),
  occlusion: clone(profile.occlusion),
  antialiasing: clone(profile.antialiasing),
  fog: clone(profile.fog),
  outline: clone(profile.outline),
  background: clone(profile.background),
  extras: clone(profile.extras),
})

const extractProfileSections = (profile) => ({
  camera: clone(profile.camera),
  lighting: clone(profile.lighting),
  occlusion: clone(profile.occlusion),
  antialiasing: clone(profile.antialiasing),
  fog: clone(profile.fog),
  outline: clone(profile.outline),
  background: clone(profile.background),
  extras: clone(profile.extras),
})

const defaultProfile = cloneProfile(BUILT_IN_PROFILES[0])

export const DEFAULT_GRAPHICS_SETTINGS = {
  version: 2,
  ...extractProfileSections(defaultProfile),
  profileManager: {
    activeProfileId: defaultProfile.id,
    profiles: BUILT_IN_PROFILES.map(cloneProfile),
  },
}

const profileTemplateSections = () => extractProfileSections(defaultProfile)

const sanitizeProfileId = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback
  }
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
  return cleaned || fallback
}

const generateProfileId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return `custom-${Date.now().toString(36)}-${counter}`
  }
})()

const normalizeCameraSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().camera)
  return {
    mode: CAMERA_MODES.includes(section?.mode) ? section.mode : base.mode,
    fieldOfView: clampNumber(section?.fieldOfView, 20, 120, base.fieldOfView),
    near: clampNumber(section?.near, 0.01, 10, base.near),
    far: clampNumber(section?.far, 200, 6000, base.far),
  }
}

const normalizeLight = (light, fallback) => {
  const base = fallback || {
    id: "light",
    label: "Light",
    inclination: 160,
    azimuth: 0,
    intensity: 1,
    color: "#ffffff",
  }
  return {
    id: sanitizeProfileId(light?.id, base.id),
    label: typeof light?.label === "string" && light.label.trim() ? light.label.trim() : base.label,
    inclination: clampNumber(light?.inclination, 0, 180, base.inclination),
    azimuth: clampNumber(light?.azimuth, 0, 360, base.azimuth),
    intensity: clampNumber(light?.intensity, 0, 3, base.intensity),
    color: sanitizeColor(light?.color, base.color),
  }
}

const normalizeLightingSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().lighting)
  const lightsSource = Array.isArray(section?.lights) ? section.lights : base.lights
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    exposure: clampNumber(section?.exposure, 0.5, 2.5, base.exposure),
    lights: lightsSource.map((light, idx) =>
      normalizeLight(light, base.lights[idx] || base.lights[0]),
    ),
  }
}

const normalizeOcclusionSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().occlusion)
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    samples: clampNumber(section?.samples, 0, 256, base.samples),
    radius: clampNumber(section?.radius, 0, 20, base.radius),
    bias: clampNumber(section?.bias, 0, 2, base.bias),
    blurKernelSize: clampNumber(section?.blurKernelSize, 1, 15, base.blurKernelSize),
    resolutionScale: clampNumber(section?.resolutionScale, 0.25, 2, base.resolutionScale),
  }
}

const normalizeAntialiasingSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().antialiasing)
  return {
    mode: ANTIALIASING_MODES.includes(section?.mode) ? section.mode : base.mode,
    edgeThresholdMin: clampNumber(section?.edgeThresholdMin, 0.05, 1, base.edgeThresholdMin),
    edgeThresholdMax: clampNumber(section?.edgeThresholdMax, 0.1, 1, base.edgeThresholdMax),
    iterations: clampNumber(section?.iterations, 1, 4, base.iterations),
    subpixelQuality: clampNumber(section?.subpixelQuality, 0, 1, base.subpixelQuality),
  }
}

const normalizeFogSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().fog)
  const near = clampNumber(section?.near, 0, 1000, base.near)
  const far = clampNumber(section?.far, near + 50, 5000, base.far)
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    intensity: clampNumber(section?.intensity, 0, 1, base.intensity),
    color: sanitizeColor(section?.color, base.color),
    near,
    far,
  }
}

const normalizeOutlineSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().outline)
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    scale: clampNumber(section?.scale, 0.1, 2, base.scale),
    threshold: clampNumber(section?.threshold, 0.05, 1, base.threshold),
    color: sanitizeColor(section?.color, base.color),
  }
}

const normalizeBackgroundSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().background)
  return {
    mode: BACKGROUND_MODES.includes(section?.mode) ? section.mode : base.mode,
    dark: sanitizeColor(section?.dark, base.dark),
    light: sanitizeColor(section?.light, base.light),
    custom: sanitizeColor(section?.custom, base.custom),
  }
}

const normalizeExtrasSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().extras)
  return {
    hideAxes: coerceBoolean(section?.hideAxes, base.hideAxes),
    disableMarking: coerceBoolean(section?.disableMarking, base.disableMarking),
  }
}

const normalizeProfile = (profile, fallback) => {
  const defaultSections = profileTemplateSections()
  const safeFallback = fallback || {
    id: generateProfileId(),
    name: "Custom Profile",
    description: "",
    ...defaultSections,
  }
  return {
    id: sanitizeProfileId(profile?.id, safeFallback.id),
    name:
      typeof profile?.name === "string" && profile.name.trim()
        ? profile.name.trim().slice(0, 80)
        : safeFallback.name,
    description:
      typeof profile?.description === "string"
        ? profile.description.trim().slice(0, 240)
        : safeFallback.description,
    camera: normalizeCameraSection(profile?.camera, safeFallback.camera),
    lighting: normalizeLightingSection(profile?.lighting, safeFallback.lighting),
    occlusion: normalizeOcclusionSection(profile?.occlusion, safeFallback.occlusion),
    antialiasing: normalizeAntialiasingSection(profile?.antialiasing, safeFallback.antialiasing),
    fog: normalizeFogSection(profile?.fog, safeFallback.fog),
    outline: normalizeOutlineSection(profile?.outline, safeFallback.outline),
    background: normalizeBackgroundSection(profile?.background, safeFallback.background),
    extras: normalizeExtrasSection(profile?.extras, safeFallback.extras),
  }
}

const normalizeProfileManager = (manager) => {
  const providedProfiles = Array.isArray(manager?.profiles) ? manager.profiles : []
  const seen = new Set()
  const normalizedProfiles = []

  const addProfile = (profile, fallback) => {
    const normalized = normalizeProfile(profile, fallback)
    if (seen.has(normalized.id)) {
      return
    }
    seen.add(normalized.id)
    normalizedProfiles.push(normalized)
  }

  providedProfiles.forEach((profile) => {
    const fallback = BUILT_IN_PROFILES.find((p) => p.id === profile?.id)
    addProfile(profile, fallback)
  })

  BUILT_IN_PROFILES.forEach((profile) => {
    if (!seen.has(profile.id)) {
      addProfile(profile, profile)
    }
  })

  if (normalizedProfiles.length === 0) {
    normalizedProfiles.push(cloneProfile(defaultProfile))
  }

  const requestedActiveId = sanitizeProfileId(manager?.activeProfileId, normalizedProfiles[0].id)
  const activeProfileId = normalizedProfiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : normalizedProfiles[0].id

  return {
    activeProfileId,
    profiles: normalizedProfiles,
  }
}

const upgradeLegacyPayload = (payload) => {
  if (!payload || payload.camera || payload.lighting) {
    return payload
  }

  const qualityMap = {
    off: { enabled: false, samples: 0, radius: 0, bias: 0.8 },
    low: { samples: 16, radius: 2 },
    medium: { samples: 32, radius: 4 },
    high: { samples: 64, radius: 6 },
    ultra: { samples: 128, radius: 8 },
  }
  const preset = qualityMap[payload.occlusionQuality] || qualityMap.medium

  return {
    camera: {
      mode: payload.cameraMode || "perspective",
      fieldOfView: 48,
      near: 0.1,
      far: 1800,
    },
    lighting: {
      enabled: true,
      exposure: 1.1,
      lights: clone(templateProfile.lighting.lights),
    },
    occlusion: {
      enabled: payload.occlusionQuality !== "off",
      samples: preset.samples ?? 32,
      radius: preset.radius ?? 4,
      bias: preset.bias ?? 0.8,
      blurKernelSize: 7,
      resolutionScale: 1,
    },
    antialiasing: {
      mode: payload.antialiasingMode || "fxaa",
      edgeThresholdMin: 0.125,
      edgeThresholdMax: 0.25,
      iterations: 2,
      subpixelQuality: 0.75,
    },
    fog: {
      enabled: true,
      intensity: typeof payload.fogIntensity === "number" ? payload.fogIntensity : 0.5,
      color: "#0f172a",
      near: 0,
      far: 200,
    },
    outline: {
      enabled: payload.outlineEnabled !== false,
      scale: typeof payload.outlineScale === "number" ? payload.outlineScale : 0.5,
      threshold: typeof payload.outlineThreshold === "number" ? payload.outlineThreshold : 0.35,
      color: "#0f172a",
    },
    background: {
      mode: payload.backgroundColor ? "auto" : "dark",
      dark: "#0f172a",
      light: "#f8f1e7",
      custom: "#0f172a",
    },
    extras: {
      hideAxes: payload.hideAxes !== false,
      disableMarking: payload.disableMarking !== false,
    },
    profileManager: {
      activeProfileId: "studio",
      profiles: BUILT_IN_PROFILES.map(cloneProfile),
    },
  }
}

export const normalizeGraphicsSettings = (payload) => {
  const upgraded = upgradeLegacyPayload(payload)
  if (!upgraded) {
    return clone(DEFAULT_GRAPHICS_SETTINGS)
  }
  const normalized = {
    version: 2,
    camera: normalizeCameraSection(upgraded.camera, templateProfile.camera),
    lighting: normalizeLightingSection(upgraded.lighting, templateProfile.lighting),
    occlusion: normalizeOcclusionSection(upgraded.occlusion, templateProfile.occlusion),
    antialiasing: normalizeAntialiasingSection(upgraded.antialiasing, templateProfile.antialiasing),
    fog: normalizeFogSection(upgraded.fog, templateProfile.fog),
    outline: normalizeOutlineSection(upgraded.outline, templateProfile.outline),
    background: normalizeBackgroundSection(upgraded.background, templateProfile.background),
    extras: normalizeExtrasSection(upgraded.extras, templateProfile.extras),
  }
  normalized.profileManager = normalizeProfileManager(upgraded.profileManager)

  // Keep active profile definition in sync with the top-level config
  const activeIndex = normalized.profileManager.profiles.findIndex(
    (profile) => profile.id === normalized.profileManager.activeProfileId,
  )
  if (activeIndex >= 0) {
    normalized.profileManager.profiles[activeIndex] = {
      ...normalized.profileManager.profiles[activeIndex],
      ...extractProfileSections(normalized),
    }
  }

  return normalized
}

export async function isAdmin(request, env) {
  try {
    const cookies = parseCookies(request.headers.get("Cookie") || "")
    const sessionId = cookies.session
    if (!sessionId) {
      return false
    }

    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    if (!resp.ok) {
      return false
    }

    const session = await resp.json()
    if (!session || !session.user_id) {
      return false
    }

    const allowedDiscordId =
      typeof env.ADMIN_DISCORD_USER_ID === "string" && env.ADMIN_DISCORD_USER_ID.trim()
        ? env.ADMIN_DISCORD_USER_ID.trim()
        : null
    if (!allowedDiscordId) {
      return false
    }
    return String(session.user_id) === allowedDiscordId
  } catch {
    return false
  }
}

/**
 * POST /api/admin/override-protein
 * Set protein override for specific date
 */
export async function handleOverrideProtein(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  let payload
  try {
    payload = await request.json()
  } catch (err) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { date, uniprot_id } = payload

  if (!date || !uniprot_id) {
    return Response.json(
      {
        error: "Missing required fields: date, uniprot_id",
      },
      { status: 400 },
    )
  }

  // Validate date format (YYYY-MM-DD)
  if (!isValidIsoDay(date)) {
    return Response.json(
      {
        error: "Invalid date format. Use YYYY-MM-DD",
      },
      { status: 400 },
    )
  }

  // Store override in KV
  const key = `puzzle_override:${date}`
  await env.KV.put(key, uniprot_id, {
    metadata: {
      set_by: "admin",
      set_at: Date.now(),
    },
  })
  await deleteAdminScheduleDayCacheEntry(env, date)

  // Invalidate the game's daily bootstrap cache so the override takes effect immediately.
  try {
    const prefix = `daily_bootstrap:${date}:`
    const bootstrapKeys = await listAllKvKeys(env, prefix)
    if (bootstrapKeys.length) {
      await Promise.all(bootstrapKeys.map((k) => env.KV.delete(k.name)))
      console.log(`Deleted ${bootstrapKeys.length} daily bootstrap cache entries for ${date}`)
    }
  } catch (err) {
    console.warn("Failed to delete daily bootstrap cache after override update", err)
  }

  return Response.json({
    success: true,
    message: `Protein override set for ${date}`,
    date,
    uniprot_id,
  })
}

/**
 * POST /api/admin/feature-flags
 * Update feature flags
 */
export async function handleFeatureFlags(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  let payload
  try {
    payload = await request.json()
  } catch (err) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Get current flags
  const currentFlagsJson = await env.KV.get("feature_flags")
  const currentFlags = currentFlagsJson ? JSON.parse(currentFlagsJson) : {}

  // Merge with updates
  const updatedFlags = { ...currentFlags, ...payload }

  // Save to KV
  await env.KV.put("feature_flags", JSON.stringify(updatedFlags), {
    metadata: {
      updated_by: "admin",
      updated_at: Date.now(),
    },
  })

  return Response.json({
    success: true,
    message: "Feature flags updated",
    flags: updatedFlags,
  })
}

/**
 * GET /api/admin/status
 * Get current admin status (overrides, feature flags)
 */
export async function handleAdminStatus(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    const today = new Date().toISOString().split("T")[0]

    // Check if there's an override for today
    const todayOverride = await env.KV.get(`puzzle_override:${today}`)

    // Get feature flags
    const featureFlagsJson = await env.KV.get("feature_flags")
    const featureFlags = featureFlagsJson ? JSON.parse(featureFlagsJson) : {}

    // Get graphics settings
    const graphicsSettingsJson = await env.KV.get("graphics_settings")
    let graphicsSettings = clone(DEFAULT_GRAPHICS_SETTINGS)
    if (graphicsSettingsJson) {
      try {
        graphicsSettings = normalizeGraphicsSettings(JSON.parse(graphicsSettingsJson))
      } catch (err) {
        console.error("Error parsing graphics settings; falling back to defaults", err)
      }
    }

    // List all puzzle overrides (scan KV keys)
    const overridesList = await env.KV.list({ prefix: "puzzle_override:" })
    const overrides = await Promise.all(
      overridesList.keys.map(async (key) => {
        try {
          const value = await env.KV.get(key.name)
          return {
            date: key.name.replace("puzzle_override:", ""),
            uniprot_id: value,
            metadata: key.metadata || {},
          }
        } catch (err) {
          console.error(`Error fetching override ${key.name}:`, err)
          return null
        }
      }),
    )

    // Filter out null values (failed fetches)
    const validOverrides = overrides.filter((o) => o !== null)
    const gameSessionWriteEvidence = await getGameSessionWriteEvidence(env.DB)

    return Response.json({
      today: {
        date: today,
        override: todayOverride || null,
      },
      feature_flags: featureFlags,
      graphics_settings: graphicsSettings,
      all_overrides: validOverrides,
      game_session_write_evidence: gameSessionWriteEvidence,
    })
  } catch (err) {
    console.error("Error in handleAdminStatus:", err)
    return Response.json(
      {
        error: "Internal server error",
        details: err.message,
      },
      { status: 500 },
    )
  }
}

/**
 * GET /api/admin/schedule
 * Returns:
 * - history: recorded actual picks (what players actually saw)
 * - upcoming: next N days (computed + any planned overrides)
 */
export async function handleAdminSchedule(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const futureDaysRaw = url.searchParams.get("futureDays")
    const parsedFutureDays = Number(futureDaysRaw ?? 30)
    const futureDays = Math.max(
      0,
      Math.min(
        ADMIN_SCHEDULE_MAX_FUTURE_DAYS,
        Number.isFinite(parsedFutureDays) ? Math.floor(parsedFutureDays) : 30,
      ),
    )

    const today = new Date().toISOString().slice(0, 10)

    // Overrides map (we'll use it for upcoming rows)
    const overrideKeys = await listAllKvKeys(env, "puzzle_override:")
    const overrides = await Promise.all(
      overrideKeys.map(async (key) => {
        try {
          const value = await env.KV.get(key.name)
          return {
            date: key.name.replace("puzzle_override:", ""),
            uniprot_id: normalizeUniprotId(value),
            metadata: key.metadata || {},
          }
        } catch {
          return null
        }
      }),
    )
    const overrideByDate = new Map(overrides.filter(Boolean).map((entry) => [entry.date, entry]))

    // Actual picks (history)
    const actualKeys = await listAllKvKeys(env, "puzzle_actual:")
    const historyRaw = actualKeys
      .map((key) => {
        const date = key.name.replace("puzzle_actual:", "")
        const meta = key.metadata || {}
        return {
          date,
          uniprot_id: meta.uniprot_id || null,
          source: meta.source || null,
          override_id: meta.override_id || null,
          rejected_count: Number.isFinite(meta.rejected_count) ? meta.rejected_count : null,
          recorded_at: Number.isFinite(meta.recorded_at) ? meta.recorded_at : null,
        }
      })
      .filter((row) => row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    // Fetch protein data for history rows to get gene symbols
    // Also cross-reference with override keys to fix source for days where
    // the bootstrap cache caused source to be recorded as "unknown"
    const history = await Promise.all(
      historyRaw.map(async (row) => {
        // If source is missing/unknown but an override key exists for this date,
        // it was an override — fix the source retroactively
        let source = row.source
        if (
          (!source || source === "unknown" || source === "actual") &&
          overrideByDate.has(row.date)
        ) {
          const ovr = overrideByDate.get(row.date)
          // Verify the override uniprot matches the actual pick
          if (!row.uniprot_id || ovr.uniprot_id === row.uniprot_id) {
            source = "override"
          }
        }
        const patched = { ...row, source }

        if (patched.uniprot_id) {
          try {
            const protein = await loadProtein(env.DB, patched.uniprot_id)
            return { ...patched, protein: protein ? sanitizeProteinSummary(protein) : null }
          } catch {
            return patched
          }
        }
        return patched
      }),
    )
    const recordedDates = new Set(history.map((row) => row.date).filter(Boolean))

    // Upcoming (planned)
    const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT_FALLBACK
    const dates = []
    for (let offset = 0; offset <= futureDays; offset += 1) {
      dates.push(addDaysISO(today, offset))
    }
    const plannedDates = dates.filter((date) => !recordedDates.has(date))

    const cachedRowsByDate = new Map()
    await Promise.all(
      plannedDates.map(async (date) => {
        try {
          const cached = await env.KV.get(buildAdminScheduleDayCacheKey(date), { type: "json" })
          if (cached && typeof cached === "object") {
            cachedRowsByDate.set(date, cached)
          }
        } catch (err) {
          console.warn(`Admin schedule day cache read failed for ${date}; recomputing`, err)
        }
      }),
    )

    const upcomingByDate = new Map()
    const missingDates = []
    for (const date of plannedDates) {
      const plannedOverride = normalizeUniprotId(overrideByDate.get(date)?.uniprot_id)
      const cachedEntry = cachedRowsByDate.get(date)
      if (
        isScheduleDayCacheEntryValid(cachedEntry, {
          date,
          overrideUniprotId: plannedOverride,
          salt,
        })
      ) {
        upcomingByDate.set(date, cachedEntry)
        continue
      }
      missingDates.push(date)
    }

    if (missingDates.length) {
      // Warm the shared family pool once before parallel day computations.
      await getDailySelectionProteinIds(env.DB)
      const BATCH_SIZE = 16
      for (let i = 0; i < missingDates.length; i += BATCH_SIZE) {
        const batchDates = missingDates.slice(i, i + BATCH_SIZE)
        const builtEntries = await Promise.all(
          batchDates.map((date) =>
            buildScheduleDayCacheEntry(env, {
              date,
              overrideByDate,
              salt,
            }),
          ),
        )

        builtEntries.forEach((entry) => {
          if (entry?.date) {
            upcomingByDate.set(entry.date, entry)
          }
        })

        await Promise.allSettled(builtEntries.map((entry) => putScheduleDayCacheEntry(env, entry)))
      }
    }

    const upcoming = plannedDates.map((date) => {
      const entry = upcomingByDate.get(date)
      if (!entry) {
        return {
          date,
          override_uniprot_id: normalizeUniprotId(overrideByDate.get(date)?.uniprot_id),
          override_protein: null,
          computed: null,
          skipped_alpha_fold: null,
        }
      }
      return toScheduleUpcomingRow(entry)
    })

    const payload = {
      today,
      history,
      upcoming,
    }
    return Response.json(payload)
  } catch (err) {
    console.error("Error in handleAdminSchedule:", err)
    return Response.json({ error: "Internal server error", details: err.message }, { status: 500 })
  }
}

/**
 * GET /api/admin/cards?date=YYYY-MM-DD
 * Returns clue sections for a specific date's resolved pick.
 */
export async function handleAdminCards(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const date = url.searchParams.get("date")
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "Missing or invalid date (YYYY-MM-DD)" }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)
    let resolvedUniprot = null
    let audit = null
    let actualJson = null

    // For the current day, override takes precedence (admin may change today's target).
    // For past days, prefer recorded actual (history shouldn't change with later overrides).
    if (date === today) {
      const overrideId = await env.KV.get(`puzzle_override:${date}`)
      if (overrideId) {
        resolvedUniprot = overrideId
        audit = {
          date,
          uniprot_id: overrideId,
          source: "override",
          override_id: overrideId,
          rejected: [],
        }
      }
    }

    // Prefer recorded actual pick (history shouldn't change if overrides change later)
    if (!resolvedUniprot) {
      const actualKey = `puzzle_actual:${date}`
      actualJson = await env.KV.get(actualKey)
      if (actualJson) {
        try {
          const record = JSON.parse(actualJson)
          resolvedUniprot = record?.uniprot_id || null
          audit = record || null
        } catch {
          resolvedUniprot = null
        }
      }
    }

    // If not recorded and not overridden, use planned override, else computed.
    if (!resolvedUniprot) {
      const overrideId = await env.KV.get(`puzzle_override:${date}`)
      if (overrideId) {
        resolvedUniprot = overrideId
        audit = {
          date,
          uniprot_id: overrideId,
          source: "override",
          override_id: overrideId,
          rejected: [],
        }
      }
    }

    if (!resolvedUniprot) {
      const salt = env?.DAILY_TARGET_SALT || "geneguessr-v2-939b5a0b"
      const selection = await pickDailyTarget(env.DB, salt, date)
      resolvedUniprot = selection?.protein?.uniprot || null
      audit = {
        date,
        uniprot_id: resolvedUniprot,
        source: "computed",
        override_id: null,
        rejected: [],
        skipped_alpha_fold: Number.isFinite(selection?.skippedAlphaFold)
          ? selection.skippedAlphaFold
          : null,
      }
    }

    if (!resolvedUniprot) {
      return Response.json({ error: "No target found for date" }, { status: 404 })
    }

    const protein = await loadProtein(env.DB, resolvedUniprot)
    if (!protein) {
      return Response.json(
        { error: "Protein not found", uniprot_id: resolvedUniprot },
        { status: 404 },
      )
    }

    const clueSections = buildClueSections(protein)
    const maskedSections = maskClueSections(clueSections, new Set())

    return Response.json({
      date,
      selection: {
        uniprot_id: resolvedUniprot,
        source: audit?.source || null,
        override_id: audit?.override_id || null,
        rejected: Array.isArray(audit?.rejected) ? audit.rejected : [],
        skipped_alpha_fold: Number.isFinite(audit?.skipped_alpha_fold)
          ? audit.skipped_alpha_fold
          : null,
        recorded: Boolean(actualJson),
      },
      protein: sanitizeTargetProtein(protein, { revealIdentity: true }),
      neighbors: Array.isArray(protein?.neighbors) ? protein.neighbors : [],
      clue: {
        start: maskedSections,
        all: clueSections,
      },
    })
  } catch (err) {
    console.error("Error in handleAdminCards:", err)
    return Response.json({ error: "Internal server error", details: err.message }, { status: 500 })
  }
}

/**
 * GET /api/admin/guess-stats?date=YYYY-MM-DD&limit=25
 * Returns aggregated guess counts for a given day (no per-user data).
 */
export async function handleAdminGuessStats(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const date = url.searchParams.get("date")
    const limitRaw = url.searchParams.get("limit")
    const limit = limitRaw != null ? Number(limitRaw) : 25

    const data = await getDailyGuessAggregates(env.DB, { day: date, limit })
    if (!data.ok) {
      return Response.json({ error: "Missing or invalid date (YYYY-MM-DD)" }, { status: 400 })
    }

    return Response.json(data)
  } catch (err) {
    console.error("Error in handleAdminGuessStats:", err)
    return Response.json({ error: "Internal server error", details: err.message }, { status: 500 })
  }
}

/**
 * GET /api/admin/guess-analytics?range=week|month|year
 * Returns aggregated guess counts across a recent window (admin-only).
 *
 * Caching: computed at most once per UTC day per range (KV-backed), and only
 * when an admin requests it (no background jobs).
 */
export async function handleAdminGuessAnalytics(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const rangeRaw = (url.searchParams.get("range") || "").toLowerCase()

    const windowDaysByRange = {
      week: 7,
      month: 30,
      year: 365,
      "7d": 7,
      "30d": 30,
      "365d": 365,
    }
    const windowDays = windowDaysByRange[rangeRaw] || null
    if (!windowDays) {
      return Response.json({ error: "Missing or invalid range (week|month|year)" }, { status: 400 })
    }

    const endDay = new Date().toISOString().slice(0, 10)
    const startDay = addDaysISO(endDay, -(windowDays - 1))
    const limit = 50

    const cacheKey = `admin_guess_analytics:v1:${windowDays}:${endDay}`
    try {
      const cached = await env.KV.get(cacheKey)
      if (cached) {
        const payload = JSON.parse(cached)
        return Response.json(payload)
      }
    } catch (err) {
      console.warn("Admin guess analytics cache read failed; recomputing", err)
    }

    const data = await getGuessAggregatesForDateRange(env.DB, { startDay, endDay, limit })
    if (!data.ok) {
      return Response.json({ error: "Failed to compute guess analytics" }, { status: 500 })
    }

    const payload = {
      ...data,
      range: rangeRaw,
      windowDays,
      generatedAt: Date.now(),
    }

    try {
      // Keep a short TTL so KV doesn’t accumulate indefinitely; key is day-scoped anyway.
      await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 * 60 * 48 })
    } catch (err) {
      console.warn("Admin guess analytics cache write failed; serving uncached", err)
    }

    return Response.json(payload)
  } catch (err) {
    console.error("Error in handleAdminGuessAnalytics:", err)
    return Response.json({ error: "Internal server error", details: err.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/graphics-settings
 * Update graphics settings for 3D protein viewer
 */
export async function handleGraphicsSettings(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  let payload
  try {
    payload = await request.json()
  } catch (err) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const normalized = normalizeGraphicsSettings(payload)

  await env.KV.put("graphics_settings", JSON.stringify(normalized), {
    metadata: {
      updated_by: "admin",
      updated_at: Date.now(),
    },
  })

  return Response.json({
    success: true,
    message: `Graphics settings updated (active profile: ${normalized.profileManager.activeProfileId})`,
    settings: normalized,
  })
}

/**
 * DELETE /api/admin/override-protein
 * Remove protein override for specific date
 */
export async function handleDeleteOverride(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  const url = new URL(request.url)
  const date = url.searchParams.get("date")

  if (!date) {
    return Response.json(
      {
        error: "Missing required parameter: date",
      },
      { status: 400 },
    )
  }
  if (!isValidIsoDay(date)) {
    return Response.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 })
  }

  const key = `puzzle_override:${date}`
  await env.KV.delete(key)
  await deleteAdminScheduleDayCacheEntry(env, date)

  return Response.json({
    success: true,
    message: `Protein override removed for ${date}`,
  })
}

/**
 * POST /api/admin/discord-recap-image
 * Upload a rendered PNG for a specific day (used by admin panel pre-rendering).
 * Body: { day: "YYYY-MM-DD", uniprot_id: "P12345", image_base64: "..." }
 */
export async function handleAdminDiscordRecapImageUpload(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!canWriteDiscordRecapImage(env)) {
    return Response.json(
      { error: "Recap image storage is not configured for writes" },
      { status: 500 },
    )
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const day = String(payload?.day || "").trim()
  if (!isValidIsoDay(day)) {
    return Response.json({ error: "Invalid day format. Use YYYY-MM-DD" }, { status: 400 })
  }
  const uniprotId = String(payload?.uniprot_id || "")
    .trim()
    .toUpperCase()
  if (!/^[A-Z0-9]+(?:-[0-9]+)?$/.test(uniprotId)) {
    return Response.json({ error: "Invalid or missing uniprot_id" }, { status: 400 })
  }

  const bytes = decodeBase64Png(payload?.image_base64)
  if (!bytes) {
    return Response.json(
      { error: "image_base64 must contain a valid PNG payload" },
      { status: 400 },
    )
  }
  if (bytes.byteLength > DISCORD_RECAP_IMAGE_MAX_BYTES) {
    return Response.json(
      {
        error: `Image too large (${bytes.byteLength} bytes). Max is ${DISCORD_RECAP_IMAGE_MAX_BYTES} bytes.`,
      },
      { status: 400 },
    )
  }

  const identity = { day, uniprotId }
  const { key } = await putDiscordRecapImage(env, identity, bytes, { contentType: "image/png" })

  return Response.json({
    success: true,
    day,
    uniprot_id: uniprotId,
    render_contract: DISCORD_RECAP_RENDER_CONTRACT,
    key,
    bytes: bytes.byteLength,
  })
}

/**
 * GET /api/admin/discord-recap-image?day=YYYY-MM-DD&uniprot=P12345
 * Returns cache status for an exact day/target/renderer recap image.
 */
export async function handleAdminDiscordRecapImageStatus(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!canReadDiscordRecapImage(env)) {
    return Response.json({ error: "Recap image storage is not configured" }, { status: 500 })
  }

  const url = new URL(request.url)
  const day = String(url.searchParams.get("day") || "").trim()
  if (!isValidIsoDay(day)) {
    return Response.json({ error: "Invalid day format. Use YYYY-MM-DD" }, { status: 400 })
  }
  const uniprotId = String(url.searchParams.get("uniprot") || "")
    .trim()
    .toUpperCase()
  if (!/^[A-Z0-9]+(?:-[0-9]+)?$/.test(uniprotId)) {
    return Response.json({ error: "Invalid or missing uniprot" }, { status: 400 })
  }

  const identity = { day, uniprotId }
  const key = buildDiscordRecapImageKey(identity)
  const head = await headDiscordRecapImage(env, identity)
  if (!head) {
    return Response.json({
      day,
      uniprot_id: uniprotId,
      key,
      exists: false,
    })
  }

  return Response.json({
    day,
    uniprot_id: uniprotId,
    key,
    exists: true,
    size: head.size || null,
    uploadedAt: head.uploadedAt || null,
    metadata: head.metadata || {},
  })
}

/**
 * GET /api/admin/discord-recap-images?images=YYYY-MM-DD~P12345,...
 * Returns cache status for multiple exact day/target/renderer recap images.
 */
export async function handleAdminDiscordRecapImageStatuses(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!canReadDiscordRecapImage(env)) {
    return Response.json({ error: "Recap image storage is not configured" }, { status: 500 })
  }

  const url = new URL(request.url)
  const rawImages = String(url.searchParams.get("images") || "")
  const uniqueImages = Array.from(
    new Set(
      rawImages
        .split(",")
        .map((value) => String(value || "").trim())
        .filter((value) => {
          const [day, uniprotId, ...rest] = value.split("~")
          return (
            rest.length === 0 &&
            isValidIsoDay(day) &&
            /^[A-Z0-9]+(?:-[0-9]+)?$/.test(String(uniprotId || "").toUpperCase())
          )
        }),
    ),
  ).slice(0, 370)

  if (uniqueImages.length === 0) {
    return Response.json(
      { error: "Provide at least one valid image in images=YYYY-MM-DD~P12345,..." },
      { status: 400 },
    )
  }

  const statuses = Object.create(null)
  await Promise.all(
    uniqueImages.map(async (value) => {
      const [day, rawUniprotId] = value.split("~")
      const uniprotId = rawUniprotId.toUpperCase()
      const identity = { day, uniprotId }
      const key = buildDiscordRecapImageKey(identity)
      const head = await headDiscordRecapImage(env, identity)
      statuses[day] = head
        ? {
            day,
            uniprot_id: uniprotId,
            key,
            exists: true,
            size: head.size || null,
            uploadedAt: head.uploadedAt || null,
            metadata: head.metadata || {},
          }
        : {
            day,
            uniprot_id: uniprotId,
            key,
            exists: false,
          }
    }),
  )

  return Response.json({
    ok: true,
    count: uniqueImages.length,
    days: statuses,
  })
}

/**
 * GET /api/admin/similarity?gene1=PKP1&gene2=PKP2
 * Compute cosine similarity between two genes' embeddings.
 */
export async function handleAdminSimilarity(request, env) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const gene1 = url.searchParams.get("gene1")
    const gene2 = url.searchParams.get("gene2")

    if (!gene1 || !gene2) {
      return Response.json({ error: "Missing gene1 or gene2 parameter" }, { status: 400 })
    }

    const simResult = await getBlendedSimilarity(env.DB, gene1.toUpperCase(), gene2.toUpperCase())

    if (simResult.blended === null) {
      return Response.json({ error: `No embedding for ${gene1} or ${gene2}` }, { status: 404 })
    }

    return Response.json({
      gene1: gene1.toUpperCase(),
      gene2: gene2.toUpperCase(),
      percent: simResult.blended,
      isLadder: simResult.isLadder,
      ladderRank: simResult.ladderRank,
    })
  } catch (err) {
    console.error("Error computing similarity", err)
    return Response.json({ error: "Failed to compute similarity" }, { status: 500 })
  }
}
