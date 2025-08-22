type TagStateMap = Record<string, boolean>
const STORAGE_KEY = "TagExplorer.state.v2"
const SEEDED_KEY = "TagExplorer.seeded.v2"
const LEGACY_KEY = "TagExplorer.expandedTags"

const norm = (t: string) => t.trim().replace(/\/+/g, "/") // normalize keys

function loadState(): TagStateMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveState(state: TagStateMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// One-time migration from open-set → boolean map
function migrateLegacy() {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return
  let arr: unknown
  try { arr = JSON.parse(raw) } catch { arr = [] }
  const state = loadState()
  if (Array.isArray(arr)) {
    for (const t of arr) {
      if (typeof t === "string") state[norm(t)] = true // legacy stored "open" entries
    }
    saveState(state)
  }
  localStorage.removeItem(LEGACY_KEY)
}

function applyTagState(group: HTMLElement, outer: HTMLElement, open: boolean) {
  if (open) {
    outer.classList.add("open")
    outer.classList.remove("closed")
    outer.style.display = "block"
    group.classList.add("tag-expanded")
    group.classList.remove("tag-collapsed")
    group.setAttribute('aria-expanded', 'true')
  } else {
    outer.classList.remove("open")
    outer.classList.add("closed")
    outer.style.display = "none"
    group.classList.add("tag-collapsed")
    group.classList.remove("tag-expanded")
    group.setAttribute('aria-expanded', 'false')
  }
}

function toggleTagSection(tagGroup: HTMLElement, tagRaw: string, forceState?: boolean) {
  const outer = tagGroup.querySelector(".tag-pages-outer") as HTMLElement | null
  if (!outer) return false

  const tag = norm(tagRaw)
  const isOpen = tagGroup.classList.contains("tag-expanded") || outer.classList.contains("open")
  const shouldOpen = forceState !== undefined ? forceState : !isOpen

  applyTagState(tagGroup, outer, shouldOpen)

  const state = loadState()
  state[tag] = shouldOpen
  saveState(state)
  return shouldOpen
}

function handleTagNameClick(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  
  const tagContainer = event.currentTarget as HTMLElement
  const tagGroup = tagContainer.closest(".tag-group") as HTMLElement
  const tag = tagContainer.getAttribute("data-tag")
  if (!tagGroup || !tag) return

  const tagPagesOuter = tagGroup.querySelector(".tag-pages-outer") as HTMLElement
  if (!tagPagesOuter) return
  
  // Check if currently expanded
  const isOpen = tagPagesOuter.classList.contains("open") || 
                 tagPagesOuter.style.display === "block" ||
                 (!tagPagesOuter.style.display && !tagPagesOuter.classList.contains("closed"))
  
  if (isOpen) {
    // If expanded, navigate to tag page
    const tagUrl = `/tags/${tag}`
    window.location.href = tagUrl
  } else {
    // If collapsed, expand the section
    toggleTagSection(tagGroup, tag, true)
  }
}

function handleTagIconClick(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  
  const tagIcon = event.currentTarget as HTMLElement
  const tagContainer = tagIcon.closest(".tag-container") as HTMLElement
  const tagGroup = tagContainer?.closest(".tag-group") as HTMLElement
  const tag = tagContainer?.getAttribute("data-tag")
  if (!tagGroup || !tag) return

  // Arrow always toggles, regardless of current state
  toggleTagSection(tagGroup, tag)
}

function toggleTagExplorer(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  
  const button = event.currentTarget as HTMLElement
  const nearestTagExplorer = button.closest(".tag-explorer") as HTMLElement
  const tagExplorerContent = nearestTagExplorer?.querySelector(".tag-explorer-content") as HTMLElement
  if (!nearestTagExplorer || !tagExplorerContent) return

  // Toggle the collapsed state
  const isCollapsed = nearestTagExplorer.classList.toggle("collapsed")
  
  // Update ARIA attributes
  button.setAttribute("aria-expanded", String(!isCollapsed))
  
  // Save state to localStorage
  const key = "TagExplorer.collapsed"
  localStorage.setItem(key, String(isCollapsed))
}

function setupTagExplorer() {
  const root = document.querySelector(".tag-explorer")
  if (!root) return

  migrateLegacy() // safe no-op after first run

  // Set up main header toggle functionality  
  const headerButton = root.querySelector(".tag-explorer-header") as HTMLElement
  if (headerButton) {
    // Load and restore collapsed state immediately to prevent flash
    const collapsedKey = "TagExplorer.collapsed"
    const isCollapsed = localStorage.getItem(collapsedKey) === "true"
    
    // Apply state synchronously
    if (isCollapsed) {
      root.classList.add("collapsed")
      headerButton.setAttribute("aria-expanded", "false")
    } else {
      root.classList.remove("collapsed")  
      headerButton.setAttribute("aria-expanded", "true")
    }
    
    // Add click handler
    headerButton.addEventListener("click", toggleTagExplorer)
  }

  const state = loadState()
  const seeded = localStorage.getItem(SEEDED_KEY) === "1"
  let mutated = false

  root.querySelectorAll<HTMLElement>(".tag-group").forEach(group => {
    const container = group.querySelector<HTMLElement>(".tag-container")
    const tagRaw = container?.getAttribute("data-tag")
    const outer = group.querySelector<HTMLElement>(".tag-pages-outer")
    if (!tagRaw || !outer) return

    const tag = norm(tagRaw)
    let open: boolean

    if (tag in state) {
      // Use saved state
      open = !!state[tag]
    } else if (!seeded) {
      // First-ever visit: start with all tags closed for clean experience
      open = false
      state[tag] = open
      mutated = true
    } else {
      // After seeding, default closed for unknowns
      open = false
    }

    applyTagState(group, outer, open)
    
    // Add separate click handlers for tag name and icon
    const tagNameArea = container.querySelector(".tag-name-area") as HTMLElement
    const tagIcon = container.querySelector(".tag-icon") as HTMLElement
    
    if (tagNameArea) {
      // Make the tag name area clickable by setting data-tag on it
      tagNameArea.setAttribute("data-tag", tag)
      tagNameArea.style.cursor = "pointer"
      tagNameArea.addEventListener("click", handleTagNameClick)
    }
    
    if (tagIcon) {
      tagIcon.style.cursor = "pointer"
      tagIcon.addEventListener("click", handleTagIconClick)
    }
  })

  if (!seeded || mutated) {
    saveState(state)
    localStorage.setItem(SEEDED_KEY, "1")
  }
}

// Guard against duplicate binding in SPA contexts
(function bindOnce() {
  // @ts-ignore
  if ((window as any).__tagExplorerBound) return
  document.addEventListener("nav", setupTagExplorer, { passive: true })
  // @ts-ignore
  ;(window as any).__tagExplorerBound = true
})()

setupTagExplorer()