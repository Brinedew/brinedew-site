interface TagState {
  tag: string
  collapsed: boolean
}

let currentTagState: Array<TagState>

function toggleTag(this: HTMLElement) {
  const tagGroup = this.closest(".tag-group") as HTMLElement
  const tagPagesOuter = tagGroup?.querySelector(".tag-pages-outer") as HTMLElement
  if (!tagGroup || !tagPagesOuter) return

  const tag = this.dataset.tag
  if (!tag) return

  // Check current state - support both CSS classes and inline styles
  let isOpen = tagPagesOuter.classList.contains("open") || 
               tagPagesOuter.style.display === "block" ||
               (!tagPagesOuter.style.display && !tagPagesOuter.classList.contains("closed"))
  
  if (isOpen) {
    tagPagesOuter.classList.remove("open")
    tagPagesOuter.classList.add("closed")
    tagPagesOuter.style.display = "none"
  } else {
    tagPagesOuter.classList.add("open") 
    tagPagesOuter.classList.remove("closed")
    tagPagesOuter.style.display = "block"
  }

  // Save state to localStorage using hierarchical paths
  const key = "TagExplorer.expandedTags"
  const expandedTags = new Set(JSON.parse(localStorage.getItem(key) || "[]"))
  
  if (isOpen) {
    expandedTags.delete(tag)
  } else {
    expandedTags.add(tag)
  }
  
  localStorage.setItem(key, JSON.stringify([...expandedTags]))
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
    
    if (tag && tagPagesOuter) {
      // Set initial state based on localStorage and default depth
      const shouldBeOpen = expandedTags.has(tag) || 
                          (tagPagesOuter.style.display === "block") ||
                          (!tagPagesOuter.style.display && !expandedTags.has(tag) && 
                           parseInt(tagGroup.getAttribute("data-depth") || "0") < 1)
      
      if (shouldBeOpen) {
        tagPagesOuter.classList.add("open")
        tagPagesOuter.classList.remove("closed")
        tagPagesOuter.style.display = "block"
        expandedTags.add(tag) // Ensure it's in the saved state
      } else {
        tagPagesOuter.classList.remove("open")
        tagPagesOuter.classList.add("closed")
        tagPagesOuter.style.display = "none"
      }
      
      // Add click handler
      container.addEventListener("click", toggleTag)
    }
  })
  
  // Save any default open states that weren't already saved
  localStorage.setItem(key, JSON.stringify([...expandedTags]))
}

document.addEventListener("nav", setupTagExplorer)
window.addEventListener("resize", setupTagExplorer)

setupTagExplorer()