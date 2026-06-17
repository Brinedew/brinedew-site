const [, , zoneName, targetScript, ...patterns] = process.argv

if (!zoneName || !targetScript || patterns.length === 0) {
  console.error(
    "Usage: node scripts/reassign-cloudflare-worker-routes.mjs <zone-name> <target-script> <pattern> [pattern...]",
  )
  process.exit(1)
}

const apiToken = process.env.CLOUDFLARE_API_TOKEN
if (!apiToken) {
  console.error("CLOUDFLARE_API_TOKEN is required")
  process.exit(1)
}

async function callCloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const payload = await response.json()
  if (!response.ok || !payload?.success) {
    console.error(`Cloudflare API call failed for ${path}`)
    console.error(JSON.stringify(payload, null, 2))
    process.exit(1)
  }
  return payload
}

const zoneLookup = await callCloudflare(`/zones?name=${encodeURIComponent(zoneName)}`)
const zoneId = zoneLookup?.result?.[0]?.id
if (!zoneId) {
  console.error(`Could not resolve zone ID for ${zoneName}`)
  process.exit(1)
}

const routesPayload = await callCloudflare(`/zones/${zoneId}/workers/routes`)
const routes = Array.isArray(routesPayload?.result) ? routesPayload.result : []

for (const pattern of patterns) {
  const existingRoute = routes.find((route) => route.pattern === pattern)
  if (existingRoute?.script === targetScript) {
    console.log(`Route already points at ${targetScript}: ${pattern}`)
    continue
  }

  if (existingRoute?.id) {
    await callCloudflare(`/zones/${zoneId}/workers/routes/${existingRoute.id}`, {
      method: "PUT",
      body: JSON.stringify({ pattern, script: targetScript }),
    })
    console.log(`Reassigned existing route ${pattern} -> ${targetScript}`)
    continue
  }

  await callCloudflare(`/zones/${zoneId}/workers/routes`, {
    method: "POST",
    body: JSON.stringify({ pattern, script: targetScript }),
  })
  console.log(`Created route ${pattern} -> ${targetScript}`)
}
