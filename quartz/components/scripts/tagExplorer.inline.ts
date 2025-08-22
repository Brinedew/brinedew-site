interface TagState {
  tag: string
  collapsed: boolean
}

let currentTagState: Array<TagState>

function toggleTagSection(tagGroup: HTMLElement, tag: string, forceState?: boolean) {
  const tagPagesOuter = tagGroup.querySelector(".tag-pages-outer") as HTMLElement
  if (!tagPagesOuter) return false

  // Check current state - support both CSS classes and inline styles
  let isOpen = tagPagesOuter.classList.contains("open") || 
               tagPagesOuter.style.display === "block" ||
               (!tagPagesOuter.style.display && !tagPagesOuter.classList.contains("closed"))
  
  // If forceState is provided, use it; otherwise toggle
  const shouldOpen = forceState !== undefined ? forceState : !isOpen
  
  if (shouldOpen) {
    tagPagesOuter.classList.add("open") 
    tagPagesOuter.classList.remove("closed")
    tagPagesOuter.style.display = "block"
    tagGroup.classList.add("tag-expanded")
    tagGroup.classList.remove("tag-collapsed")
  } else {
    tagPagesOuter.classList.remove("open")
    tagPagesOuter.classList.add("closed")
    tagPagesOuter.style.display = "none"
    tagGroup.classList.add("tag-collapsed")
    tagGroup.classList.remove("tag-expanded")
  }

  // Save state to localStorage using hierarchical paths
  const key = "TagExplorer.expandedTags"
  const expandedTags = new Set(JSON.parse(localStorage.getItem(key) || "[]"))
  
  if (shouldOpen) {
    expandedTags.add(tag)
  } else {
    expandedTags.delete(tag)
  }
  
  localStorage.setItem(key, JSON.stringify([...expandedTags]))
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

function setupTagExplorer() {
  const tagExplorer = document.querySelector(".tag-explorer")
  if (!tagExplorer) return

  // Load saved state
  const key = "TagExplorer.expandedTags"
  const expandedTags = new Set(JSON.parse(localStorage.getItem(key) || "[]"))

  // Initialize tag states for hierarchical structure
  const tagContainers = tagExplorer.querySelectorAll(".tag-container")
  tagContainers.forEach((container) => {
    const tag = container.getAttribute("data-tag")
    const tagGroup = container.closest(".tag-group") as HTMLElement
    const tagPagesOuter = tagGroup?.querySelector(".tag-pages-outer") as HTMLElement
    
    if (tag && tagGroup && tagPagesOuter) {
      // Set initial state based on localStorage and default depth
      const shouldBeOpen = expandedTags.has(tag) || 
                          (tagPagesOuter.style.display === "block") ||
                          (!tagPagesOuter.style.display && !expandedTags.has(tag) && 
                           parseInt(tagGroup.getAttribute("data-depth") || "0") < 1)
      
      if (shouldBeOpen) {
        tagPagesOuter.classList.add("open")
        tagPagesOuter.classList.remove("closed")
        tagPagesOuter.style.display = "block"
        tagGroup.classList.add("tag-expanded")
        tagGroup.classList.remove("tag-collapsed")
        expandedTags.add(tag) // Ensure it's in the saved state
      } else {
        tagPagesOuter.classList.remove("open")
        tagPagesOuter.classList.add("closed")
        tagPagesOuter.style.display = "none"
        tagGroup.classList.add("tag-collapsed")
        tagGroup.classList.remove("tag-expanded")
      }
      
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
    }
  })
  
  // Save any default open states that weren't already saved
  localStorage.setItem(key, JSON.stringify([...expandedTags]))
}

document.addEventListener("nav", setupTagExplorer)
window.addEventListener("resize", setupTagExplorer)

setupTagExplorer()