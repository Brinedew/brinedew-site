const readThemeCookie = (name: string) => {
  const parts = (document.cookie || "").split(/;\s*/)
  for (const part of parts) {
    const index = part.indexOf("=")
    if (index < 0) continue
    if (part.slice(0, index) !== name) continue
    return decodeURIComponent(part.slice(index + 1))
  }
  return ""
}

const writeThemeCookie = (name: string, value: string) => {
  const host = window.location.hostname.toLowerCase()
  const attrs = ["Path=/", "SameSite=Lax", value ? "Max-Age=31536000" : "Max-Age=0"]
  if (host === "brinedew.bio" || host.endsWith(".brinedew.bio")) {
    attrs.push("Domain=.brinedew.bio")
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`
}

const userPref = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
const currentTheme = readThemeCookie("brinedew_theme") || localStorage.getItem("theme") || userPref
document.documentElement.setAttribute("data-theme", currentTheme)
document.documentElement.setAttribute("saved-theme", currentTheme)

const emitThemeChangeEvent = (theme: "light" | "dark") => {
  const event: CustomEventMap["themechange"] = new CustomEvent("themechange", {
    detail: { theme },
  })
  document.dispatchEvent(event)
}

document.addEventListener("nav", () => {
  const switchTheme = () => {
    const newTheme =
      document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"
    document.documentElement.setAttribute("data-theme", newTheme)
    document.documentElement.setAttribute("saved-theme", newTheme)
    localStorage.setItem("theme", newTheme)
    writeThemeCookie("brinedew_theme", newTheme)
    emitThemeChangeEvent(newTheme)
  }

  const themeChange = (e: MediaQueryListEvent) => {
    if (localStorage.getItem("theme") || readThemeCookie("brinedew_theme")) return
    const newTheme = e.matches ? "dark" : "light"
    document.documentElement.setAttribute("data-theme", newTheme)
    document.documentElement.setAttribute("saved-theme", newTheme)
    emitThemeChangeEvent(newTheme)
  }

  for (const darkmodeButton of document.getElementsByClassName("darkmode")) {
    darkmodeButton.addEventListener("click", switchTheme)
    window.addCleanup(() => darkmodeButton.removeEventListener("click", switchTheme))
  }

  // Listen for changes in prefers-color-scheme
  const colorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
  colorSchemeMediaQuery.addEventListener("change", themeChange)
  window.addCleanup(() => colorSchemeMediaQuery.removeEventListener("change", themeChange))
})
