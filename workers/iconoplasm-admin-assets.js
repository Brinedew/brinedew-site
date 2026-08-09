const ICONOPLASM_ADMIN_ASSET_VERSION_TOKEN = "__ICONOPLASM_ADMIN_ASSET_VERSION__"

export function iconoplasmAdminAssetVersion(env) {
  const configured = String(env?.ICONOPLASM_HTML_SHELL_CACHE_VERSION || "")
    .trim()
    .slice(0, 200)
  const validUtf8 = new TextDecoder().decode(new TextEncoder().encode(configured || "dev"))
  return encodeURIComponent(validUtf8)
}

export function renderIconoplasmAdminHtml(html, env) {
  return String(html || "").replaceAll(
    ICONOPLASM_ADMIN_ASSET_VERSION_TOKEN,
    iconoplasmAdminAssetVersion(env),
  )
}
