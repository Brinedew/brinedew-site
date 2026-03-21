let isReaderMode = false

const readReaderModeCookie = (name: string) => {
  const parts = (document.cookie || "").split(/;\s*/)
  for (const part of parts) {
    const index = part.indexOf("=")
    if (index < 0) continue
    if (part.slice(0, index) !== name) continue
    return decodeURIComponent(part.slice(index + 1))
  }
  return ""
}

const writeReaderModeCookie = (name: string, value: string) => {
  const host = window.location.hostname.toLowerCase()
  const attrs = ["Path=/", "SameSite=Lax", value ? "Max-Age=31536000" : "Max-Age=0"]
  if (host === "brinedew.bio" || host.endsWith(".brinedew.bio")) {
    attrs.push("Domain=.brinedew.bio")
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`
}

const emitReaderModeChangeEvent = (mode: "on" | "off") => {
  const event: CustomEventMap["readermodechange"] = new CustomEvent("readermodechange", {
    detail: { mode },
  })
  document.dispatchEvent(event)
}

document.addEventListener("nav", () => {
  isReaderMode =
    (readReaderModeCookie("brinedew_reader_mode") || localStorage.getItem("readerMode")) === "on"

  const switchReaderMode = () => {
    isReaderMode = !isReaderMode
    const newMode = isReaderMode ? "on" : "off"
    document.documentElement.setAttribute("reader-mode", newMode)
    if (newMode === "on") {
      localStorage.setItem("readerMode", "on")
      writeReaderModeCookie("brinedew_reader_mode", "on")
    } else {
      localStorage.removeItem("readerMode")
      writeReaderModeCookie("brinedew_reader_mode", "")
    }
    emitReaderModeChangeEvent(newMode)
  }

  for (const readerModeButton of document.getElementsByClassName("readermode")) {
    readerModeButton.addEventListener("click", switchReaderMode)
    window.addCleanup(() => readerModeButton.removeEventListener("click", switchReaderMode))
  }

  // Set initial state
  document.documentElement.setAttribute("reader-mode", isReaderMode ? "on" : "off")
})
