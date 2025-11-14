/**
 * Admin API endpoints for GeneGuessr
 * Protected by Cloudflare Access
 */

import { parseCookies } from './auth.js';
import { buildStructurePreviewPayload, sanitizeProteinSummary } from './lib/structure-utils.js';

const CAMERA_MODES = ['perspective', 'orthographic'];
const ANTIALIASING_MODES = ['off', 'fxaa'];
const BACKGROUND_MODES = ['auto', 'dark', 'light', 'custom'];

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
};

const coerceBoolean = (value, fallback) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const sanitizeColor = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return fallback;
  }
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return fallback;
  }
  return `#${hex}`;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const mergeDeep = (target, source) => {
  if (!source || typeof source !== 'object') {
    return target;
  }
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = value.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return mergeDeep({}, item);
        }
        return item;
      });
      continue;
    }
    if (value && typeof value === 'object') {
      target[key] = mergeDeep(target[key] || {}, value);
      continue;
    }
    target[key] = value;
  }
  return target;
};

const createProfileTemplate = () => ({
  camera: {
    mode: 'perspective',
    fieldOfView: 48,
    near: 0.1,
    far: 1800,
  },
  lighting: {
    enabled: true,
    exposure: 1.1,
    lights: [
      { id: 'key', label: 'Key', inclination: 170, azimuth: 30, intensity: 1.4, color: '#ffffff' },
      { id: 'fill', label: 'Fill', inclination: 32, azimuth: 210, intensity: 0.7, color: '#c9d5ff' },
      { id: 'rim', label: 'Rim', inclination: 85, azimuth: 315, intensity: 0.45, color: '#92b4ff' },
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
    mode: 'fxaa',
    edgeThresholdMin: 0.125,
    edgeThresholdMax: 0.25,
    iterations: 2,
    subpixelQuality: 0.75,
  },
  fog: {
    enabled: true,
    intensity: 0.5,
    color: '#0f172a',
    near: 0,
    far: 200,
  },
  outline: {
    enabled: true,
    scale: 0.5,
    threshold: 0.35,
    color: '#0f172a',
  },
  background: {
    mode: 'auto',
    dark: '#0f172a',
    light: '#f8f1e7',
    custom: '#0f172a',
  },
  extras: {
    hideAxes: true,
    disableMarking: true,
  },
});

const templateProfile = createProfileTemplate();

const buildProfile = (id, name, description, overrides = {}) => ({
  id,
  name,
  description,
  ...mergeDeep(clone(templateProfile), overrides),
});

const BUILT_IN_PROFILES = [
  buildProfile('studio', 'Studio Balanced', 'Cinematic soft lighting with subtle fog.', {}),
  buildProfile('cinematic', 'Cinematic Ultra', 'High quality occlusion + deeper fog.', {
    occlusion: { samples: 128, radius: 8, blurKernelSize: 9, resolutionScale: 1 },
    fog: { intensity: 0.75, color: '#050816' },
    lighting: {
      exposure: 1.25,
      lights: [
        { id: 'key', label: 'Key', inclination: 160, azimuth: 20, intensity: 1.6, color: '#ffe7d3' },
        { id: 'fill', label: 'Fill', inclination: 25, azimuth: 210, intensity: 0.8, color: '#c4d2ff' },
        { id: 'rim', label: 'Rim', inclination: 95, azimuth: 315, intensity: 0.6, color: '#7dafff' },
      ],
    },
  }),
  buildProfile('performance', 'Performance', 'Lightweight settings for low-power GPUs.', {
    occlusion: { enabled: false, samples: 0, radius: 0 },
    fog: { enabled: false, intensity: 0 },
    outline: { enabled: false },
    antialiasing: { mode: 'fxaa', iterations: 1, subpixelQuality: 0.5 },
    extras: { hideAxes: true, disableMarking: true },
    lighting: {
      exposure: 1,
      lights: [
        { id: 'key', label: 'Key', inclination: 175, azimuth: 25, intensity: 1.2, color: '#ffffff' },
        { id: 'fill', label: 'Fill', inclination: 35, azimuth: 200, intensity: 0.35, color: '#cdd5ff' },
        { id: 'rim', label: 'Rim', inclination: 90, azimuth: 300, intensity: 0.25, color: '#91a4ff' },
      ],
    },
  }),
];

const cloneProfile = (profile) => ({
  id: profile.id,
  name: profile.name,
  description: profile.description || '',
  camera: clone(profile.camera),
  lighting: clone(profile.lighting),
  occlusion: clone(profile.occlusion),
  antialiasing: clone(profile.antialiasing),
  fog: clone(profile.fog),
  outline: clone(profile.outline),
  background: clone(profile.background),
  extras: clone(profile.extras),
});

const extractProfileSections = (profile) => ({
  camera: clone(profile.camera),
  lighting: clone(profile.lighting),
  occlusion: clone(profile.occlusion),
  antialiasing: clone(profile.antialiasing),
  fog: clone(profile.fog),
  outline: clone(profile.outline),
  background: clone(profile.background),
  extras: clone(profile.extras),
});

const defaultProfile = cloneProfile(BUILT_IN_PROFILES[0]);

export const DEFAULT_GRAPHICS_SETTINGS = {
  version: 2,
  ...extractProfileSections(defaultProfile),
  profileManager: {
    activeProfileId: defaultProfile.id,
    profiles: BUILT_IN_PROFILES.map(cloneProfile),
  },
};

const profileTemplateSections = () => extractProfileSections(defaultProfile);

const sanitizeProfileId = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
  return cleaned || fallback;
};

const generateProfileId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `custom-${Date.now().toString(36)}-${counter}`;
  };
})();

const normalizeCameraSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().camera);
  return {
    mode: CAMERA_MODES.includes(section?.mode) ? section.mode : base.mode,
    fieldOfView: clampNumber(section?.fieldOfView, 20, 120, base.fieldOfView),
    near: clampNumber(section?.near, 0.01, 10, base.near),
    far: clampNumber(section?.far, 200, 6000, base.far),
  };
};

const normalizeLight = (light, fallback) => {
  const base = fallback || { id: 'light', label: 'Light', inclination: 160, azimuth: 0, intensity: 1, color: '#ffffff' };
  return {
    id: sanitizeProfileId(light?.id, base.id),
    label: typeof light?.label === 'string' && light.label.trim() ? light.label.trim() : base.label,
    inclination: clampNumber(light?.inclination, 0, 180, base.inclination),
    azimuth: clampNumber(light?.azimuth, 0, 360, base.azimuth),
    intensity: clampNumber(light?.intensity, 0, 3, base.intensity),
    color: sanitizeColor(light?.color, base.color),
  };
};

const normalizeLightingSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().lighting);
  const lightsSource = Array.isArray(section?.lights) ? section.lights : base.lights;
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    exposure: clampNumber(section?.exposure, 0.5, 2.5, base.exposure),
    lights: lightsSource.map((light, idx) => normalizeLight(light, base.lights[idx] || base.lights[0])),
  };
};

const normalizeOcclusionSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().occlusion);
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    samples: clampNumber(section?.samples, 0, 256, base.samples),
    radius: clampNumber(section?.radius, 0, 20, base.radius),
    bias: clampNumber(section?.bias, 0, 2, base.bias),
    blurKernelSize: clampNumber(section?.blurKernelSize, 1, 15, base.blurKernelSize),
    resolutionScale: clampNumber(section?.resolutionScale, 0.25, 2, base.resolutionScale),
  };
};

const normalizeAntialiasingSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().antialiasing);
  return {
    mode: ANTIALIASING_MODES.includes(section?.mode) ? section.mode : base.mode,
    edgeThresholdMin: clampNumber(section?.edgeThresholdMin, 0.05, 1, base.edgeThresholdMin),
    edgeThresholdMax: clampNumber(section?.edgeThresholdMax, 0.1, 1, base.edgeThresholdMax),
    iterations: clampNumber(section?.iterations, 1, 4, base.iterations),
    subpixelQuality: clampNumber(section?.subpixelQuality, 0, 1, base.subpixelQuality),
  };
};

const normalizeFogSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().fog);
  const near = clampNumber(section?.near, 0, 1000, base.near);
  const far = clampNumber(section?.far, near + 50, 5000, base.far);
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    intensity: clampNumber(section?.intensity, 0, 1, base.intensity),
    color: sanitizeColor(section?.color, base.color),
    near,
    far,
  };
};

const normalizeOutlineSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().outline);
  return {
    enabled: coerceBoolean(section?.enabled, base.enabled),
    scale: clampNumber(section?.scale, 0.1, 2, base.scale),
    threshold: clampNumber(section?.threshold, 0.05, 1, base.threshold),
    color: sanitizeColor(section?.color, base.color),
  };
};

const normalizeBackgroundSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().background);
  return {
    mode: BACKGROUND_MODES.includes(section?.mode) ? section.mode : base.mode,
    dark: sanitizeColor(section?.dark, base.dark),
    light: sanitizeColor(section?.light, base.light),
    custom: sanitizeColor(section?.custom, base.custom),
  };
};

const normalizeExtrasSection = (section, fallback) => {
  const base = clone(fallback || profileTemplateSections().extras);
  return {
    hideAxes: coerceBoolean(section?.hideAxes, base.hideAxes),
    disableMarking: coerceBoolean(section?.disableMarking, base.disableMarking),
  };
};

const normalizeProfile = (profile, fallback) => {
  const defaultSections = profileTemplateSections();
  const safeFallback = fallback || {
    id: generateProfileId(),
    name: 'Custom Profile',
    description: '',
    ...defaultSections,
  };
  return {
    id: sanitizeProfileId(profile?.id, safeFallback.id),
    name: typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 80) : safeFallback.name,
    description: typeof profile?.description === 'string' ? profile.description.trim().slice(0, 240) : safeFallback.description,
    camera: normalizeCameraSection(profile?.camera, safeFallback.camera),
    lighting: normalizeLightingSection(profile?.lighting, safeFallback.lighting),
    occlusion: normalizeOcclusionSection(profile?.occlusion, safeFallback.occlusion),
    antialiasing: normalizeAntialiasingSection(profile?.antialiasing, safeFallback.antialiasing),
    fog: normalizeFogSection(profile?.fog, safeFallback.fog),
    outline: normalizeOutlineSection(profile?.outline, safeFallback.outline),
    background: normalizeBackgroundSection(profile?.background, safeFallback.background),
    extras: normalizeExtrasSection(profile?.extras, safeFallback.extras),
  };
};

const normalizeProfileManager = (manager) => {
  const providedProfiles = Array.isArray(manager?.profiles) ? manager.profiles : [];
  const seen = new Set();
  const normalizedProfiles = [];

  const addProfile = (profile, fallback) => {
    const normalized = normalizeProfile(profile, fallback);
    if (seen.has(normalized.id)) {
      return;
    }
    seen.add(normalized.id);
    normalizedProfiles.push(normalized);
  };

  providedProfiles.forEach((profile) => {
    const fallback = BUILT_IN_PROFILES.find((p) => p.id === profile?.id);
    addProfile(profile, fallback);
  });

  BUILT_IN_PROFILES.forEach((profile) => {
    if (!seen.has(profile.id)) {
      addProfile(profile, profile);
    }
  });

  if (normalizedProfiles.length === 0) {
    normalizedProfiles.push(cloneProfile(defaultProfile));
  }

  const requestedActiveId = sanitizeProfileId(manager?.activeProfileId, normalizedProfiles[0].id);
  const activeProfileId = normalizedProfiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : normalizedProfiles[0].id;

  return {
    activeProfileId,
    profiles: normalizedProfiles,
  };
};

const upgradeLegacyPayload = (payload) => {
  if (!payload || payload.camera || payload.lighting) {
    return payload;
  }

  const qualityMap = {
    off: { enabled: false, samples: 0, radius: 0, bias: 0.8 },
    low: { samples: 16, radius: 2 },
    medium: { samples: 32, radius: 4 },
    high: { samples: 64, radius: 6 },
    ultra: { samples: 128, radius: 8 },
  };
  const preset = qualityMap[payload.occlusionQuality] || qualityMap.medium;

  return {
    camera: {
      mode: payload.cameraMode || 'perspective',
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
      enabled: payload.occlusionQuality !== 'off',
      samples: preset.samples ?? 32,
      radius: preset.radius ?? 4,
      bias: preset.bias ?? 0.8,
      blurKernelSize: 7,
      resolutionScale: 1,
    },
    antialiasing: {
      mode: payload.antialiasingMode || 'fxaa',
      edgeThresholdMin: 0.125,
      edgeThresholdMax: 0.25,
      iterations: 2,
      subpixelQuality: 0.75,
    },
    fog: {
      enabled: true,
      intensity: typeof payload.fogIntensity === 'number' ? payload.fogIntensity : 0.5,
      color: '#0f172a',
      near: 0,
      far: 200,
    },
    outline: {
      enabled: payload.outlineEnabled !== false,
      scale: typeof payload.outlineScale === 'number' ? payload.outlineScale : 0.5,
      threshold: typeof payload.outlineThreshold === 'number' ? payload.outlineThreshold : 0.35,
      color: '#0f172a',
    },
    background: {
      mode: payload.backgroundColor ? 'auto' : 'dark',
      dark: '#0f172a',
      light: '#f8f1e7',
      custom: '#0f172a',
    },
    extras: {
      hideAxes: payload.hideAxes !== false,
      disableMarking: payload.disableMarking !== false,
    },
    profileManager: {
      activeProfileId: 'studio',
      profiles: BUILT_IN_PROFILES.map(cloneProfile),
    },
  };
};

export const normalizeGraphicsSettings = (payload) => {
  const upgraded = upgradeLegacyPayload(payload);
  if (!upgraded) {
    return clone(DEFAULT_GRAPHICS_SETTINGS);
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
  };
  normalized.profileManager = normalizeProfileManager(upgraded.profileManager);

  // Keep active profile definition in sync with the top-level config
  const activeIndex = normalized.profileManager.profiles.findIndex(
    (profile) => profile.id === normalized.profileManager.activeProfileId
  );
  if (activeIndex >= 0) {
    normalized.profileManager.profiles[activeIndex] = {
      ...normalized.profileManager.profiles[activeIndex],
      ...extractProfileSections(normalized),
    };
  }

  return normalized;
};

/**
 * Verify user is admin (brinedew@proton.me)
 * Cloudflare Access injects CF-Access-Authenticated-User-Email header
 */
function isAdmin(request) {
  const email = request.headers.get('CF-Access-Authenticated-User-Email');
  return email === 'brinedew@proton.me';
}

/**
 * POST /api/admin/override-protein
 * Set protein override for specific date
 */
export async function handleOverrideProtein(request, env) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  const { date, uniprot_id } = payload;
  
  if (!date || !uniprot_id) {
    return Response.json({ 
      error: 'Missing required fields: date, uniprot_id' 
    }, { status: 400 });
  }
  
  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ 
      error: 'Invalid date format. Use YYYY-MM-DD' 
    }, { status: 400 });
  }
  
  // Store override in KV
  const key = `puzzle_override:${date}`;
  await env.KV.put(key, uniprot_id, {
    metadata: {
      set_by: 'admin',
      set_at: Date.now()
    }
  });
  
  return Response.json({
    success: true,
    message: `Protein override set for ${date}`,
    date,
    uniprot_id
  });
}

/**
 * POST /api/admin/feature-flags
 * Update feature flags
 */
export async function handleFeatureFlags(request, env) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  // Get current flags
  const currentFlagsJson = await env.KV.get('feature_flags');
  const currentFlags = currentFlagsJson ? JSON.parse(currentFlagsJson) : {};
  
  // Merge with updates
  const updatedFlags = { ...currentFlags, ...payload };
  
  // Save to KV
  await env.KV.put('feature_flags', JSON.stringify(updatedFlags), {
    metadata: {
      updated_by: 'admin',
      updated_at: Date.now()
    }
  });
  
  return Response.json({
    success: true,
    message: 'Feature flags updated',
    flags: updatedFlags
  });
}

/**
 * GET /api/admin/status
 * Get current admin status (overrides, feature flags)
 */
export async function handleAdminStatus(request, env) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Check if there's an override for today
    const todayOverride = await env.KV.get(`puzzle_override:${today}`);
    
    // Get feature flags
    const featureFlagsJson = await env.KV.get('feature_flags');
    const featureFlags = featureFlagsJson ? JSON.parse(featureFlagsJson) : {};
    
    // Get graphics settings
    const graphicsSettingsJson = await env.KV.get('graphics_settings');
    let graphicsSettings = clone(DEFAULT_GRAPHICS_SETTINGS);
    if (graphicsSettingsJson) {
      try {
        graphicsSettings = normalizeGraphicsSettings(JSON.parse(graphicsSettingsJson));
      } catch (err) {
        console.error('Error parsing graphics settings; falling back to defaults', err);
      }
    }
    
    // List all puzzle overrides (scan KV keys)
    const overridesList = await env.KV.list({ prefix: 'puzzle_override:' });
    const overrides = await Promise.all(
      overridesList.keys.map(async (key) => {
        try {
          const value = await env.KV.get(key.name);
          return {
            date: key.name.replace('puzzle_override:', ''),
            uniprot_id: value,
            metadata: key.metadata || {}
          };
        } catch (err) {
          console.error(`Error fetching override ${key.name}:`, err);
          return null;
        }
      })
    );
    
    // Filter out null values (failed fetches)
    const validOverrides = overrides.filter(o => o !== null);
    
    return Response.json({
      today: {
        date: today,
        override: todayOverride || null
      },
      feature_flags: featureFlags,
      graphics_settings: graphicsSettings,
      all_overrides: validOverrides
    });
  } catch (err) {
    console.error('Error in handleAdminStatus:', err);
    return Response.json({ 
      error: 'Internal server error', 
      details: err.message 
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/graphics-settings
 * Update graphics settings for 3D protein viewer
 */
export async function handleGraphicsSettings(request, env) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  const normalized = normalizeGraphicsSettings(payload);
  
  await env.KV.put('graphics_settings', JSON.stringify(normalized), {
    metadata: {
      updated_by: 'admin',
      updated_at: Date.now()
    }
  });
  
  return Response.json({
    success: true,
    message: `Graphics settings updated (active profile: ${normalized.profileManager.activeProfileId})`,
    settings: normalized
  });
}

/**
 * DELETE /api/admin/override-protein
 * Remove protein override for specific date
 */
export async function handleDeleteOverride(request, env) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  
  if (!date) {
    return Response.json({ 
      error: 'Missing required parameter: date' 
    }, { status: 400 });
  }
  
  const key = `puzzle_override:${date}`;
  await env.KV.delete(key);
  
  return Response.json({
    success: true,
    message: `Protein override removed for ${date}`
  });
}

/**
 * GET /api/admin/protein-preview
 * Prepare Mol* render payload for admin preview
 */
export async function handleProteinPreview(request, env) {
  if (!isAdmin(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const url = new URL(request.url);
  const uniprot = url.searchParams.get('uniprot');
  if (!uniprot) {
    return Response.json({ error: 'Missing required parameter: uniprot' }, { status: 400 });
  }

  try {
    const protein = await fetchProteinByUniprot(uniprot);
    if (!protein) {
      return Response.json({ error: `Protein ${uniprot} not found` }, { status: 404 });
    }
    const preview = buildStructurePreviewPayload(protein);
    if (!preview) {
      return Response.json({ error: 'No valid structure available for preview' }, { status: 422 });
    }
    return Response.json({
      protein: sanitizeProteinSummary(protein),
      representation: preview.representation,
      renderOptions: preview.renderOptions
    });
  } catch (err) {
    console.error('Error building protein preview', err);
    return Response.json({ error: 'Failed to build preview' }, { status: 500 });
  }
}

async function fetchProteinByUniprot(uniprot) {
  const response = await fetch('https://brinedew.bio/static/geneguessr/data.json');
  if (!response.ok) {
    throw new Error('Failed to fetch protein database');
  }
  const proteins = await response.json();
  const normalized = `${uniprot}`.trim().toUpperCase();
  return proteins.find((protein) => (protein.uniprot || '').toUpperCase() === normalized) || null;
}
