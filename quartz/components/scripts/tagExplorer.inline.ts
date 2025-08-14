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

  const isOpen = tagPagesOuter.classList.contains("open")
  
  if (isOpen) {
    tagPagesOuter.classList.remove("open")
  } else {
    tagPagesOuter.classList.add("open")
  }

  // Save state to localStorage
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

  // Initialize tag states
  const tagContainers = tagExplorer.querySelectorAll(".tag-container")
  tagContainers.forEach((container) => {
    const tag = container.getAttribute("data-tag")
    const tagPagesOuter = container.parentNode?.querySelector(".tag-pages-outer") as HTMLElement
    
    if (tag && tagPagesOuter) {
      // Set initial state based on localStorage
      if (expandedTags.has(tag)) {
        tagPagesOuter.classList.add("open")
      }
      
      // Add click handler
      container.addEventListener("click", toggleTag)
    }
  })
}

document.addEventListener("nav", setupTagExplorer)
window.addEventListener("resize", setupTagExplorer)

setupTagExplorer()