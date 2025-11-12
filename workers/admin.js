/**
 * Admin API endpoints for GeneGuessr
 * Protected by Cloudflare Access
 */

import { parseCookies } from './auth.js';

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
    const graphicsSettings = graphicsSettingsJson ? JSON.parse(graphicsSettingsJson) : null;
    
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
  
  // Validate fields
  const validationRules = {
    // String enums
    cameraMode: (v) => ['perspective', 'orthographic'].includes(v),
    occlusionQuality: (v) => ['off', 'low', 'medium', 'high', 'ultra'].includes(v),
    antialiasingMode: (v) => ['off', 'fxaa'].includes(v),
    lightingPreset: (v) => ['default', 'dramatic', 'soft', 'studio'].includes(v),
    
    // Numbers
    fogIntensity: (v) => typeof v === 'number' && v >= 0 && v <= 1,
    outlineScale: (v) => typeof v === 'number' && v >= 0.1 && v <= 2,
    outlineThreshold: (v) => typeof v === 'number' && v >= 0.1 && v <= 1,
    
    // Booleans
    outlineEnabled: (v) => typeof v === 'boolean',
    backgroundColor: (v) => typeof v === 'boolean',
    hideAxes: (v) => typeof v === 'boolean',
    disableMarking: (v) => typeof v === 'boolean',
  };
  
  for (const [field, validator] of Object.entries(validationRules)) {
    if (field in payload && !validator(payload[field])) {
      return Response.json({ 
        error: `Invalid value for ${field}` 
      }, { status: 400 });
    }
  }
  
  // Save to KV
  await env.KV.put('graphics_settings', JSON.stringify(payload), {
    metadata: {
      updated_by: 'admin',
      updated_at: Date.now()
    }
  });
  
  return Response.json({
    success: true,
    message: 'Graphics settings updated',
    settings: payload
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
